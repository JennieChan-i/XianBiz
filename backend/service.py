import json
from datetime import date
from .db import BusinessError, encode, history, insert, integer, now, require, row

def portion(amount, qty, total):
    return (amount * qty * 2 + total) // (2 * total) if total else 0

def text(value, name, required=False):
    require(isinstance(value,str) and len(value)<=2000, f'{name}格式不正确')
    value=value.strip()
    require(not required or bool(value), f'请填写{name}')
    return value

def number(conn, prefix, table):
    # Transaction serialization and permanent rows ensure unique consecutive numbers.
    seq=conn.execute(f'SELECT COALESCE(MAX(id),0)+1 FROM {table}').fetchone()[0]
    return f'{prefix}{date.today():%Y%m%d}-{seq:06d}'

def settings(conn):
    return {r['key']:json.loads(r['value']) for r in conn.execute('SELECT * FROM settings')}

def save_settings(conn,p):
    current=settings(conn)
    for key in ('shop_name','start_date','default_threshold'):
        if key in p:
            v=p[key]
            if key=='shop_name': v=text(v,'店铺名称',True)
            if key=='default_threshold': v=integer(v,'库存阈值')
            if key=='start_date':
                try: date.fromisoformat(v)
                except (ValueError,TypeError): raise BusinessError('请选择有效启用日期')
                require(key not in current or current[key]==v,'启用日期设置后不能直接回改')
            conn.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,encode(v)))
    history(conn,'settings',0,'设置',current,settings(conn))
    return settings(conn)

def product(conn,p,id=None):
    inventory_mode=p.get('inventory_mode','opening')
    require(inventory_mode in ('catalogue','opening'),'商品库存录入方式不正确')
    data={k:text(p.get(k,''),k,k in ('code','name')) for k in ('code','name','category','brand','season','note')}
    data['price']=integer(p.get('price',0),'批发价')
    data['active']=int(bool(p.get('active',True)))
    before=row(conn,'products',id) if id else None
    if id:
        conn.execute('UPDATE products SET '+','.join(k+'=?' for k in data)+' WHERE id=?',(*data.values(),id))
    else: id=insert(conn,'products',**data)
    for sku in p.get('skus',[]):
        color=text(sku.get('color','默认'),'颜色',True)
        size=text(sku.get('size','无尺码'),'尺码',True)
        barcode=text(sku.get('barcode',''),'条码') or None
        threshold=integer(sku.get('threshold',settings(conn).get('default_threshold',5)),'库存阈值')
        old=conn.execute('SELECT id FROM skus WHERE product_id=? AND color=? AND size=?',(id,color,size)).fetchone()
        if old:
            conn.execute('UPDATE skus SET barcode=?,threshold=?,active=? WHERE id=?',(barcode,threshold,int(bool(sku.get('active',True))),old['id']))
        else:
            sid=insert(conn,'skus',product_id=id,color=color,size=size,barcode=barcode,threshold=threshold)
            if inventory_mode=='catalogue':
                require(sku.get('stock') in (None,0) and sku.get('cost') in (None,0),'普通建档不能录入库存或成本，请通过采购收货或期初库存录入')
                count=cost=0
            else:
                require(sku.get('stock') is not None,'请填写期初件数，无库存请明确填写0')
                count=integer(sku.get('stock'),'期初件数')
                cost=integer(sku.get('cost',0),'期初成本')
            conn.execute('UPDATE skus SET active=? WHERE id=?',(int(bool(sku.get('active',True))),sid))
            if count: receive_stock(conn,sid,count,cost,'opening',f'product:{id}')
            elif cost>0: conn.execute('UPDATE skus SET avg_cost=?,cost_known=1 WHERE id=?',(cost,sid))
    history(conn,'product',id,'修改' if before else '新增',before,data)
    skus=[dict(sku) for sku in conn.execute('SELECT s.*,p.code,p.name,p.price,p.active product_active FROM skus s JOIN products p ON p.id=s.product_id WHERE product_id=? ORDER BY s.id',(id,))]
    for sku in skus:
        sku['available']=max(0,sku['stock']-reserved(conn,sku['id']))
    return {'id':id,'skus':skus}

def opening_editable(conn,sku_id):
    # Even a confirmed reservation or a saved count basis makes the opening
    # balance part of subsequent business; only untouched openings can be corrected.
    if conn.execute("SELECT 1 FROM inventory_ledger WHERE sku_id=? AND kind NOT IN ('opening','opening_correction') LIMIT 1",(sku_id,)).fetchone():
        return False
    if conn.execute("SELECT 1 FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.sku_id=? AND o.state!='draft' LIMIT 1",(sku_id,)).fetchone():
        return False
    if conn.execute('SELECT 1 FROM stocktake_items WHERE sku_id=? LIMIT 1',(sku_id,)).fetchone():
        return False
    return True

def correct_opening(conn,sku_id,p):
    before=row(conn,'skus',sku_id)
    require(opening_editable(conn,sku_id),'此SKU已发生后续业务，不能更正期初；请通过采购、销售或盘点处理',409)
    require(p.get('expected_stock')==before['stock'] and p.get('expected_value')==before['value'] and p.get('expected_cost')==before['avg_cost'],'库存或成本已变化，请重新打开商品编辑后再更正',409)
    qty=integer(p.get('qty'),'期初件数')
    cost=integer(p.get('cost'),'期初单位成本')
    value=integer(qty*cost,'期初库存总成本')
    reason=text(p.get('reason',''),'期初更正原因',True)
    require(qty!=before['stock'] or cost!=before['avg_cost'],'期初件数和成本未发生变化')
    conn.execute('UPDATE skus SET stock=?,value=?,avg_cost=?,cost_known=? WHERE id=?',(qty,value,cost,int(qty>0 or cost>0),sku_id))
    inv(conn,sku_id,qty-before['stock'],value-before['value'],'opening_correction',f'sku:{sku_id}',reason)
    after=row(conn,'skus',sku_id)
    history(conn,'sku',sku_id,'期初更正',before,after,reason)
    # Opening capital corrections are not operating profit/loss. Original
    # inventory rows and dates stay unchanged; the difference is appended today.
    return {**after,'opening_editable':True}

def party(conn,p,id=None):
    kind=p.get('kind')
    require(kind in ('customer','supplier'),'往来类型不正确')
    data={k:text(p.get(k,''),k,k=='name') for k in ('name','phone','address','note')}
    require(data['name']!='__anonymous__','此名称为系统保留，请使用其他名称')
    data.update(kind=kind,active=int(bool(p.get('active',True))))
    before=row(conn,'parties',id) if id else None
    if id:
        require(before['kind']==kind,'不允许改变往来类型')
        conn.execute('UPDATE parties SET '+','.join(k+'=?' for k in data)+' WHERE id=?',(*data.values(),id))
    else:
        id=insert(conn,'parties',**data)
        opening=integer(p.get('opening',0),'期初欠款')
        if opening: insert(conn,'debts',party_id=id,amount=opening,source='期初欠款',created_at=now())
    history(conn,'party',id,'修改' if before else '新增',before,data)
    return {'id':id}

def reserved(conn,sku_id):
    return conn.execute('SELECT COALESCE(SUM(reserved),0) FROM order_lines WHERE sku_id=?',(sku_id,)).fetchone()[0]

def available(conn,sku_id):
    return max(0,row(conn,'skus',sku_id)['stock']-reserved(conn,sku_id))

def reserve_delta(conn,line_id,qty,source,reason):
    conn.execute('UPDATE order_lines SET reserved=reserved+? WHERE id=?',(qty,line_id))
    insert(conn,'reservation_events',line_id=line_id,qty=qty,source=source,reason=reason,created_at=now())

def inv(conn,sku_id,qty,amount,kind,source,reason=''):
    insert(conn,'inventory_ledger',sku_id=sku_id,qty=qty,amount=amount,stock_after=row(conn,'skus',sku_id)['stock'],kind=kind,source=source,reason=reason,created_at=now())

def profit(conn,kind,amount,source,order_id=None,at=None):
    if amount: insert(conn,'profit_ledger',kind=kind,amount=amount,source=source,order_id=order_id,created_at=at or now())

def adjust_cost(conn,fulfillment_id,delta,qty,source):
    if not delta: return
    f=row(conn,'fulfillments',fulfillment_id)
    previous=conn.execute('SELECT COALESCE(SUM(amount),0) FROM cost_adjustments WHERE fulfillment_id=?',(fulfillment_id,)).fetchone()[0]
    old_total=f['cost']+previous
    insert(conn,'cost_adjustments',fulfillment_id=fulfillment_id,source=source,qty=qty,amount=delta,created_at=now())
    returned_delta=0
    consumed=0
    for r in conn.execute('SELECT * FROM returns WHERE fulfillment_id=? ORDER BY id',(fulfillment_id,)).fetchall():
        before=portion(old_total,consumed+r['qty'],f['qty'])-portion(old_total,consumed,f['qty'])
        after=portion(old_total+delta,consumed+r['qty'],f['qty'])-portion(old_total+delta,consumed,f['qty'])
        difference=after-before
        consumed+=r['qty']
        returned_delta+=difference
        if r['sellable']:
            # Revaluation of still-present saleable returned units. If already consumed,
            # the difference is an adjustment to cost on the adjustment date.
            line=row(conn,'order_lines',f['line_id']); s=row(conn,'skus',line['sku_id'])
            capitalized=portion(difference,min(max(s['stock'],0),r['qty']),r['qty'])
            if capitalized:
                value=max(0,s['value']+capitalized)
                conn.execute('UPDATE skus SET value=?,avg_cost=? WHERE id=?',(value,portion(value,1,s['stock']),s['id']))
                inv(conn,s['id'],0,capitalized,'return_cost_adjustment',source)
            profit(conn,'cost_adjustment',-(difference-capitalized),source,f['order_id'])
        else:
            profit(conn,'inventory_loss',-difference,source,f['order_id'])
    profit(conn,'cost_adjustment',-(delta-returned_delta),source,f['order_id'])

def receive_stock(conn,sku_id,qty,unit_cost,kind,source,reason=''):
    integer(qty,'入库数量',1); integer(unit_cost,'单位成本')
    integer(qty*unit_cost,'本次入库成本总额')
    s=row(conn,'skus',sku_id)
    # Cost-estimated shortage lots are settled before physical positive stock.
    cover=min(qty,max(0,-s['stock']))
    left=cover
    lots=conn.execute('''SELECT n.id,n.remaining,n.estimate,n.fulfillment_id,f.created_at,'sale' kind FROM negative_lots n JOIN fulfillments f ON f.id=n.fulfillment_id WHERE n.sku_id=? AND n.remaining>0
      UNION ALL SELECT id,remaining,estimate,NULL,created_at,'inventory' FROM inventory_shortages WHERE sku_id=? AND remaining>0 ORDER BY created_at,kind,id''',(sku_id,sku_id)).fetchall()
    for lot in lots:
        n=min(left,lot['remaining'])
        if not n: break
        if lot['kind']=='sale':
            conn.execute('UPDATE negative_lots SET remaining=remaining-? WHERE id=?',(n,lot['id']))
            adjust_cost(conn,lot['fulfillment_id'],n*(unit_cost-lot['estimate']),n,source)
        else:
            conn.execute('UPDATE inventory_shortages SET remaining=remaining-? WHERE id=?',(n,lot['id']))
            profit(conn,'inventory_loss',-n*(unit_cost-lot['estimate']),source)
        left-=n
    # Non-sale negative count adjustments have no sale lot to revalue.
    s=row(conn,'skus',sku_id)
    positive=qty-cover
    value=s['value']+positive*unit_cost
    stock=s['stock']+qty
    avg=portion(value,1,stock) if stock>0 else unit_cost
    conn.execute('UPDATE skus SET stock=?,value=?,avg_cost=?,cost_known=1 WHERE id=?',(stock,value if stock>0 else 0,avg,sku_id))
    inv(conn,sku_id,qty,qty*unit_cost,kind,source,reason)

def issue_stock(conn,sku_id,qty,kind,source,reason='',estimate=None,force=False,line_id=None):
    integer(qty,'出库数量',1)
    s=row(conn,'skus',sku_id)
    own=row(conn,'order_lines',line_id)['reserved'] if line_id else 0
    free=max(0,s['stock']-reserved(conn,sku_id))
    need=max(0,qty-own-free)
    require(force or need==0,'库存不足或已被其他订单预留，请确认强制出库并填写原因',409)
    if force:
        require(bool(reason.strip()),'强制出库必须填写原因')
    if own:
        reserve_delta(conn,line_id,-min(qty,own),source,'交付释放本单预留')
    if need and force:
        for other in conn.execute('SELECT * FROM order_lines WHERE sku_id=? AND reserved>0 AND id!=? ORDER BY id',(sku_id,line_id or -1)).fetchall():
            take=min(need,other['reserved'])
            reserve_delta(conn,other['id'],-take,source,reason)
            history(conn,'order',other['order_id'],'预留被挪用',{'reserved':other['reserved']},{'reserved':other['reserved']-take},reason)
            need-=take
            if need<=0: break
    positive=min(qty,max(0,s['stock']))
    base=portion(s['value'],positive,max(0,s['stock']))
    shortage=qty-positive
    cost=s['avg_cost']
    if shortage and not s['cost_known']:
        require(estimate is not None,'无历史成本，请输入暂估单位成本')
        cost=integer(estimate,'暂估成本')
    conn.execute('UPDATE skus SET stock=stock-?,value=value-? WHERE id=?',(qty,base,sku_id))
    total=base+shortage*cost
    inv(conn,sku_id,-qty,-total,kind,source,reason)
    return total,shortage,cost

def order_state(conn,id):
    o=row(conn,'orders',id)
    if o['state']=='draft': return
    totals=conn.execute('SELECT SUM(qty) q,SUM(fulfilled) f,SUM(terminated) t FROM order_lines WHERE order_id=?',(id,)).fetchone()
    if not totals['f'] and totals['t']==totals['q']: state='cancelled'
    elif totals['f']==totals['q']: state='completed'
    elif totals['f']: state='partial'
    else: state='confirmed'
    conn.execute('UPDATE orders SET state=? WHERE id=?',(state,id))

def make_order(conn,p,anonymous_party=None):
    kind=p.get('kind'); require(kind in ('sale','purchase'),'单据类型不正确')
    pid=p.get('party_id') or None
    if pid:
        pr=row(conn,'parties',pid)
        internal=anonymous_party==pid and pr['name']=='__anonymous__' and kind=='sale'
        require((pr['active'] or internal) and pr['kind']==('customer' if kind=='sale' else 'supplier'),'请选择正确且启用的往来单位')
    require(pid or kind=='sale','采购必须关联供应商')
    draft=bool(p.get('draft',False))
    require(not (kind=='purchase' and draft),'采购只保留四种主状态，未提交内容请使用本机暂存')
    require(not draft or pid,'散客请直接交付并结清')
    lines=p.get('lines',[])
    require(isinstance(lines,list) and 0<len(lines)<=1000,'至少添加一个 SKU，单次最多1000行')
    id=insert(conn,'orders',number=number(conn,'XS' if kind=='sale' else 'CG','orders'),kind=kind,party_id=pid,state='draft' if draft else 'confirmed',note=text(p.get('note',''),'备注'),created_at=now(),confirmed_at=None if draft else now())
    seen=set(); warnings=[]
    for line in lines:
        sku=row(conn,'skus',integer(line.get('sku_id'),'SKU',1)); pro=row(conn,'products',sku['product_id'])
        require(sku['active'] and pro['active'],'商品已停用')
        require(sku['id'] not in seen,'同一SKU请合并为一行'); seen.add(sku['id'])
        qty=integer(line.get('qty'),'订购数量',1); price=integer(line.get('price'),'单价')
        integer(qty*price,'单行合同金额')
        lid=insert(conn,'order_lines',order_id=id,sku_id=sku['id'],description=f"{pro['code']} {pro['name']} / {sku['color']} / {sku['size']}",qty=qty,price=price)
        if kind=='sale' and not draft:
            old=conn.execute("SELECT COUNT(*) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE l.sku_id=? AND o.id!=? AND o.kind='sale' AND o.state!='draft' AND l.qty-l.fulfilled-l.terminated-l.reserved>0",(sku['id'],id)).fetchone()[0]
            if old: warnings.append(f"{pro['code']} {sku['color']}/{sku['size']}存在历史欠货，请检查手动分配")
            n=min(qty,available(conn,sku['id']))
            if n: reserve_delta(conn,lid,n,f'order:{id}','确认自动预留')
    if not draft:
        payments=p.get('payments',[])
        total=sum(x['qty']*x['price'] for x in lines)
        if not pid:
            require(p.get('direct') and sum(integer(x.get('amount'),'收款金额',1) for x in payments)==total,'散客必须全部交付并全额结清')
        if p.get('direct'):
            fulfill(conn,id,{'lines':[{'line_id':r['id'],'qty':r['qty'],'estimate':next((l.get('estimate') for l in lines if l['sku_id']==r['sku_id']),None)} for r in conn.execute('SELECT * FROM order_lines WHERE order_id=?',(id,))], 'force':bool(p.get('force')), 'reason':p.get('reason',''), 'freight':p.get('freight',0)})
        if payments:
            if not pid:
                # Anonymous customer is an internal clearing party, hidden from master lists.
                found=conn.execute("SELECT id FROM parties WHERE kind='customer' AND name='__anonymous__'").fetchone()
                pid=found[0] if found else insert(conn,'parties',kind='customer',name='__anonymous__',active=0)
                conn.execute('UPDATE orders SET party_id=? WHERE id=?',(pid,id))
                for f in conn.execute('SELECT * FROM fulfillments WHERE order_id=?',(id,)):
                    insert(conn,'debts',party_id=pid,order_id=id,fulfillment_id=f['id'],amount=f['amount'],source=f"fulfillment:{f['id']}",created_at=now())
            fund(conn,{'party_id':pid,'order_id':id,'channels':payments,'note':'开单收付'})
            apply_order_advance(conn,id)
    history(conn,'order',id,'创建',None,{'kind':kind,'draft':draft})
    conn.execute('DELETE FROM drafts WHERE kind=?',(kind,))
    return {'id':id,'warnings':warnings}

def confirm_draft(conn,id,p):
    o=row(conn,'orders',id); require(o['state']=='draft','此单不是草稿')
    conn.execute("UPDATE orders SET state='confirmed',confirmed_at=? WHERE id=?",(now(),id))
    if o['kind']=='sale':
        for l in conn.execute('SELECT * FROM order_lines WHERE order_id=?',(id,)).fetchall():
            n=min(l['qty'],available(conn,l['sku_id']))
            if n: reserve_delta(conn,l['id'],n,f'order:{id}','草稿确认预留')
    history(conn,'order',id,'确认草稿',o,row(conn,'orders',id))
    return {'id':id}

def update_draft(conn,id,p):
    o=row(conn,'orders',id)
    require(o['kind']=='sale' and o['state']=='draft','仅未生效销售草稿可修改',409)
    pid=integer(p.get('party_id'),'客户',1)
    customer=row(conn,'parties',pid)
    require(customer['kind']=='customer' and customer['active'],'请选择启用的客户')
    lines=p.get('lines',[]);require(isinstance(lines,list) and 0<len(lines)<=1000,'请添加商品明细')
    before=order_detail(conn,id)
    conn.execute('DELETE FROM order_lines WHERE order_id=?',(id,))
    conn.execute('UPDATE orders SET party_id=?,note=? WHERE id=?',(pid,text(p.get('note',''),'备注'),id))
    seen=set()
    for line in lines:
        sku=row(conn,'skus',integer(line.get('sku_id'),'SKU',1));pro=row(conn,'products',sku['product_id'])
        require(sku['active'] and pro['active'],'商品已停用');require(sku['id'] not in seen,'同一SKU请合并');seen.add(sku['id'])
        qty=integer(line.get('qty'),'数量',1);price=integer(line.get('price'),'单价');integer(qty*price,'单行金额')
        insert(conn,'order_lines',order_id=id,sku_id=sku['id'],description=f"{pro['code']} {pro['name']} / {sku['color']} / {sku['size']}",qty=qty,price=price)
    if not p.get('draft'):
        confirm_draft(conn,id,{})
        if p.get('direct'):
            fulfill(conn,id,{'lines':[{'line_id':l['id'],'qty':l['qty'],'estimate':next((i.get('estimate') for i in lines if i['sku_id']==l['sku_id']),None)} for l in conn.execute('SELECT * FROM order_lines WHERE order_id=?',(id,))],'force':bool(p.get('force')),'reason':p.get('reason','')})
        if p.get('payments'):
            fund(conn,{'party_id':pid,'order_id':id,'channels':p['payments'],'note':'草稿确认收款'})
            apply_order_advance(conn,id)
    conn.execute('DELETE FROM drafts WHERE kind=?',('sale',))
    history(conn,'order',id,'修改草稿',before,order_detail(conn,id))
    return {'id':id,'warnings':[]}

def fulfill(conn,id,p):
    o=row(conn,'orders',id)
    require(o['state'] in ('confirmed','partial') and not o['remaining_terminated'],'此单已结束或尚未确认')
    lines=p.get('lines',[]); require(bool(lines),'请填写本次履约数量')
    seen=set()
    for item in lines:
        l=row(conn,'order_lines',integer(item.get('line_id'),'明细ID',1))
        require(l['order_id']==id and l['id'] not in seen,'明细不属于此单或重复'); seen.add(l['id'])
        qty=integer(item.get('qty'),'本次数量',1)
        require(qty<=l['qty']-l['fulfilled']-l['terminated'],'本次数量超过待履约数量')
        fid=insert(conn,'fulfillments',order_id=id,line_id=l['id'],qty=qty,amount=qty*l['price'],cost=0,created_at=now())
        src=f'fulfillment:{fid}'
        if o['kind']=='sale':
            cost,shortage,estimate=issue_stock(conn,l['sku_id'],qty,'sale',src,p.get('reason',''),item.get('estimate'),bool(p.get('force')),l['id'])
            conn.execute('UPDATE fulfillments SET cost=? WHERE id=?',(cost,fid))
            if shortage: insert(conn,'negative_lots',sku_id=l['sku_id'],fulfillment_id=fid,qty=shortage,remaining=shortage,estimate=estimate)
            profit(conn,'revenue',qty*l['price'],src,id)
            profit(conn,'sale_cost',-cost,src,id)
        else:
            receive_stock(conn,l['sku_id'],qty,l['price'],'purchase',src)
            conn.execute('UPDATE fulfillments SET cost=? WHERE id=?',(qty*l['price'],fid))
        conn.execute('UPDATE order_lines SET fulfilled=fulfilled+? WHERE id=?',(qty,l['id']))
        if o['party_id'] and qty*l['price']:
            insert(conn,'debts',party_id=o['party_id'],order_id=id,fulfillment_id=fid,amount=qty*l['price'],source=src,created_at=now())
    apply_order_advance(conn,id)
    order_state(conn,id)
    history(conn,'order',id,'交付' if o['kind']=='sale' else '收货',o,row(conn,'orders',id),p.get('reason',''))
    freight=integer(p.get('freight',0),'采购运费')
    if freight:
        require(o['kind']=='purchase','仅采购可登记采购运费')
        expense(conn,{'category':'采购运费','amount':freight,'business_date':str(date.today()),'channel':p.get('channel','现金'),'note':o['number']})
    return {'id':id,'state':row(conn,'orders',id)['state']}

def terminate(conn,id,p):
    o=row(conn,'orders',id); require(o['state'] in ('draft','confirmed','partial'),'此单已结束')
    reason=text(p.get('reason',''),'终止原因',True)
    for l in conn.execute('SELECT * FROM order_lines WHERE order_id=?',(id,)).fetchall():
        if l['reserved']: reserve_delta(conn,l['id'],-l['reserved'],f'order:{id}',reason)
        conn.execute('UPDATE order_lines SET terminated=qty-fulfilled WHERE id=?',(l['id'],))
    conn.execute("UPDATE orders SET remaining_terminated=1,state=CASE WHEN state='draft' THEN 'cancelled' ELSE state END WHERE id=?",(id,))
    order_state(conn,id); history(conn,'order',id,'终止剩余',o,row(conn,'orders',id),reason)
    return {'id':id}

def manual_reserve(conn,id,p):
    o=row(conn,'orders',id); require(o['kind']=='sale' and o['state'] in ('confirmed','partial') and not o['remaining_terminated'],'此单不可分配')
    require(bool(p.get('lines')),'请填写本次分配数量')
    for i in p.get('lines',[]):
        l=row(conn,'order_lines',i['line_id']); require(l['order_id']==id,'明细不属于此单')
        n=integer(i.get('qty'),'分配数量',1)
        require(n<=l['qty']-l['fulfilled']-l['terminated']-l['reserved'] and n<=available(conn,l['sku_id']),'分配量超过可用库存或欠货量')
        reserve_delta(conn,l['id'],n,f'order:{id}','手动分配补货')
    return {'id':id}

def debt_balance(conn,id):
    d=row(conn,'debts',id)
    return d['amount']-conn.execute('SELECT COALESCE(SUM(amount),0) FROM allocations WHERE debt_id=?',(id,)).fetchone()[0]

def credit_balance(conn,id):
    c=row(conn,'credits',id)
    return c['amount']-c['refunded']-conn.execute('SELECT COALESCE(SUM(amount),0) FROM allocations WHERE credit_id=?',(id,)).fetchone()[0]

def allocate(conn,credit_id,debt_id,amount,kind='manual'):
    amount=integer(amount,'核销金额',1)
    c=row(conn,'credits',credit_id); d=row(conn,'debts',debt_id)
    require(c['party_id']==d['party_id'],'不可跨往来单位核销')
    require(amount<=credit_balance(conn,credit_id) and amount<=debt_balance(conn,debt_id),'核销金额超过可用余额')
    return insert(conn,'allocations',credit_id=credit_id,debt_id=debt_id,amount=amount,kind=kind,created_at=now())

def apply_order_advance(conn,id):
    for c in conn.execute("SELECT * FROM credits WHERE order_id=? AND source='payment' ORDER BY id",(id,)).fetchall():
        for d in conn.execute('SELECT * FROM debts WHERE order_id=? ORDER BY id',(id,)).fetchall():
            amount=min(credit_balance(conn,c['id']),debt_balance(conn,d['id']))
            if amount: allocate(conn,c['id'],d['id'],amount,'order_advance')

def fund(conn,p):
    pid=integer(p.get('party_id'),'往来单位',1); pr=row(conn,'parties',pid)
    channels=p.get('channels',[]); require(isinstance(channels,list) and bool(channels),'请填写收付款渠道和金额')
    total=0
    for ch in channels:
        text(ch.get('channel',''),'渠道',True); total+=integer(ch.get('amount'),'金额',1)
    integer(total,'收付款总额',1)
    oid=p.get('order_id') or None
    if oid: require(row(conn,'orders',oid)['party_id']==pid,'单据不属于此往来单位')
    refund=bool(p.get('refund'))
    fid=insert(conn,'funds',number=number(conn,'ZJ','funds'),party_id=pid,order_id=oid,amount=-total if refund else total,note=text(p.get('note',''),'备注'),created_at=now())
    for ch in channels: insert(conn,'fund_channels',fund_id=fid,channel=ch['channel'],amount=ch['amount'])
    if refund:
        remain=total
        for c in p.get('refund_credits',[]):
            credit=row(conn,'credits',c['credit_id']); require(credit['party_id']==pid,'退款贷项不属于此单位')
            n=integer(c.get('amount'),'退款分配',1)
            require(n<=credit_balance(conn,credit['id']) and n<=remain,'退款超过可退余额')
            conn.execute('UPDATE credits SET refunded=refunded+? WHERE id=?',(n,credit['id']))
            insert(conn,'refund_allocations',fund_id=fid,credit_id=credit['id'],amount=n)
            remain-=n
        require(remain==0,'退款必须明确分配全部可退贷项')
        cid=None
    else:
        cid=insert(conn,'credits',party_id=pid,order_id=oid,fund_id=fid,amount=total,source='payment',created_at=now())
        for a in p.get('allocations',[]): allocate(conn,cid,a['debt_id'],a['amount'])
    history(conn,'fund',fid,'退款' if refund else '实际收付',None,{'amount':-total if refund else total,'credit_id':cid},p.get('note',''))
    return {'id':fid,'credit_id':cid}

def allocations(conn,p):
    items=p.get('items',[]); require(bool(items),'请选择债项和贷项')
    for a in items: allocate(conn,a['credit_id'],a['debt_id'],a['amount'])
    return {'count':len(items)}

def return_goods(conn,id,p,settle_anonymous=True):
    o=row(conn,'orders',id); reason=text(p.get('reason',''),'退货原因',True)
    require(o['state'] not in ('draft','cancelled'),'此单尚无可退履约')
    items=p.get('lines',[]); require(bool(items),'请选择退货明细')
    ids=[]
    for item in items:
        f=row(conn,'fulfillments',integer(item.get('fulfillment_id'),'履约ID',1)); require(f['order_id']==id,'履约不属于此单')
        qty=integer(item.get('qty'),'退货数量',1); require(qty<=f['qty']-f['returned'],'退货超过剩余可退数量')
        l=row(conn,'order_lines',f['line_id'])
        delta=conn.execute('SELECT COALESCE(SUM(amount),0) FROM cost_adjustments WHERE fulfillment_id=?',(f['id'],)).fetchone()[0]
        final_cost=f['cost']+delta
        cost=portion(final_cost,f['returned']+qty,f['qty'])-portion(final_cost,f['returned'],f['qty'])
        amount=qty*l['price']; sellable=bool(item.get('sellable',True))
        rid=insert(conn,'returns',number=number(conn,'TH','returns'),order_id=id,fulfillment_id=f['id'],qty=qty,amount=amount,cost=cost,sellable=int(sellable),reason=reason,created_at=now())
        ids.append(rid); src=f'return:{rid}'
        if o['kind']=='sale':
            profit(conn,'return_revenue',-amount,src,id); profit(conn,'return_cost',cost,src,id)
            if sellable:
                # Split integer total cost into two exact unit-price groups.
                unit,remainder=divmod(cost,qty)
                if qty-remainder: receive_stock(conn,l['sku_id'],qty-remainder,unit,'sale_return',src,reason)
                if remainder: receive_stock(conn,l['sku_id'],remainder,unit+1,'sale_return',src,reason)
            else: profit(conn,'inventory_loss',-cost,src,id)
        else:
            current_cost,_,_=issue_stock(conn,l['sku_id'],qty,'purchase_return',src,reason)
            profit(conn,'inventory_gain',amount-current_cost,src,id)
        conn.execute('UPDATE fulfillments SET returned=returned+? WHERE id=?',(qty,f['id']))
        conn.execute('UPDATE order_lines SET returned=returned+? WHERE id=?',(qty,l['id']))
        if o['party_id'] and amount:
            cid=insert(conn,'credits',party_id=o['party_id'],order_id=id,amount=amount,source=src,created_at=now())
            for d in conn.execute('SELECT * FROM debts WHERE order_id=? ORDER BY id',(id,)).fetchall():
                n=min(credit_balance(conn,cid),debt_balance(conn,d['id']))
                if n: allocate(conn,cid,d['id'],n,'return_offset')
    anonymous=bool(o['party_id'] and row(conn,'parties',o['party_id'])['name']=='__anonymous__')
    exchange_id=None
    if p.get('exchange'):
        exchange=dict(p['exchange']); exchange.update(kind=o['kind'],party_id=o['party_id'])
        if anonymous:
            exchange.update(direct=True,payments=[],draft=False)
        exchange_id=make_order(conn,exchange,anonymous_party=o['party_id'] if anonymous else None)['id']
        for rid in ids: conn.execute('UPDATE returns SET exchange_order_id=? WHERE id=?',(exchange_id,rid))
        # Price differences remain explicit credit/debt for manual offset/refund.
    if anonymous and settle_anonymous:
        linked=[id]+([exchange_id] if exchange_id else [])
        debts=[dict(d) for oid in linked for d in conn.execute('SELECT * FROM debts WHERE order_id=? ORDER BY id',(oid,))]
        credits=[dict(c) for oid in linked for c in conn.execute('SELECT * FROM credits WHERE order_id=? ORDER BY id',(oid,))]
        for credit in credits:
            for debt in debts:
                n=min(credit_balance(conn,credit['id']),debt_balance(conn,debt['id']))
                if n: allocate(conn,credit['id'],debt['id'],n,'anonymous_exchange_offset')
        debt_total=sum(debt_balance(conn,d['id']) for d in debts)
        credit_total=sum(credit_balance(conn,c['id']) for c in credits)
        channels=p.get('settlement_channels',[])
        total=sum(integer(ch.get('amount'),'当场结清金额',1) for ch in channels)
        require(total==abs(debt_total-credit_total),'散客退换货必须当场结清价差，请填写准确的收付渠道和金额')
        if debt_total:
            fund(conn,{'party_id':o['party_id'],'order_id':exchange_id or id,'channels':channels,'allocations':[{'debt_id':d['id'],'amount':debt_balance(conn,d['id'])} for d in debts if debt_balance(conn,d['id'])],'note':'散客换货补款'})
        elif credit_total:
            fund(conn,{'party_id':o['party_id'],'order_id':id,'channels':channels,'refund':True,'refund_credits':[{'credit_id':c['id'],'amount':credit_balance(conn,c['id'])} for c in credits if credit_balance(conn,c['id'])],'note':'散客退换货退款'})
    history(conn,'order',id,'退换货',o,{'return_ids':ids,'exchange_order_id':exchange_id},reason)
    return {'ids':ids,'exchange_order_id':exchange_id}

def reverse_order(conn,id,p):
    o=row(conn,'orders',id); reason=text(p.get('reason',''),'整单冲正原因',True)
    require(not conn.execute("SELECT 1 FROM history WHERE entity='order' AND entity_id=? AND action='整单冲正'",(id,)).fetchone(),'此单已整单冲正')
    require(not conn.execute('SELECT 1 FROM returns WHERE order_id=? AND exchange_order_id IS NOT NULL',(id,)).fetchone(),'此单存在换货关联，请分别冲正关联新单并逐笔处理退货')
    remaining=[{'fulfillment_id':f['id'],'qty':f['qty']-f['returned'],'sellable':True} for f in conn.execute('SELECT * FROM fulfillments WHERE order_id=?',(id,)) if f['qty']>f['returned']]
    if remaining: return_goods(conn,id,{'lines':remaining,'reason':reason},settle_anonymous=False)
    for f in conn.execute('SELECT f.* FROM funds f WHERE order_id=? AND amount>0 AND reversal_of IS NULL AND NOT EXISTS(SELECT 1 FROM funds r WHERE r.reversal_of=f.id)',(id,)).fetchall():
        reverse_fund(conn,f['id'],{'reason':reason})
    for c in conn.execute('SELECT * FROM credits WHERE order_id=? ORDER BY id',(id,)).fetchall():
        for d in conn.execute('SELECT * FROM debts WHERE order_id=? ORDER BY id',(id,)).fetchall():
            n=min(credit_balance(conn,c['id']),debt_balance(conn,d['id']))
            if n: allocate(conn,c['id'],d['id'],n,'reversal_offset')
    if o['state'] in ('draft','confirmed','partial') and not o['remaining_terminated']: terminate(conn,id,{'reason':reason})
    history(conn,'order',id,'整单冲正',o,{'returned_remaining':remaining},reason)
    return {'id':id}

def reverse_fund(conn,id,p):
    f=row(conn,'funds',id); reason=text(p.get('reason',''),'冲正原因',True)
    require(f['reversal_of'] is None,'不能对冲正流水再次冲正')
    require(not conn.execute('SELECT 1 FROM funds WHERE reversal_of=?',(id,)).fetchone(),'此笔已冲正')
    if f['amount']<0:
        items=conn.execute('SELECT * FROM refund_allocations WHERE fund_id=?',(id,)).fetchall()
        require(bool(items),'缺少可追溯的退款分配，不能直接冲正')
        for a in items:
            conn.execute('UPDATE credits SET refunded=refunded-? WHERE id=?',(a['amount'],a['credit_id']))
        rid=insert(conn,'funds',number=number(conn,'CZ','funds'),party_id=f['party_id'],order_id=f['order_id'],amount=-f['amount'],note=reason,reversal_of=id,created_at=now())
        for ch in conn.execute('SELECT * FROM fund_channels WHERE fund_id=?',(id,)):
            insert(conn,'fund_channels',fund_id=rid,channel=ch['channel'],amount=ch['amount'])
        history(conn,'fund',id,'退款冲正',f,{'reversal_id':rid},reason)
        return {'id':rid}
    credits=conn.execute('SELECT * FROM credits WHERE fund_id=?',(id,)).fetchall()
    # Reverse allocations by appending a replacement obligation rather than deleting history.
    for c in credits:
        require(c['refunded']==0,'已发生退款，请先通过关联调整处理，不能重复冲正')
        for a in conn.execute('SELECT a.*,d.order_id,d.fulfillment_id FROM allocations a JOIN debts d ON d.id=a.debt_id WHERE a.credit_id=?',(c['id'],)).fetchall():
            insert(conn,'debts',party_id=f['party_id'],order_id=a['order_id'],fulfillment_id=a['fulfillment_id'],amount=a['amount'],source=f'reverse_fund:{id}',created_at=now())
        conn.execute('UPDATE credits SET refunded=refunded+? WHERE id=?',(credit_balance(conn,c['id']),c['id']))
    rid=insert(conn,'funds',number=number(conn,'CZ','funds'),party_id=f['party_id'],order_id=f['order_id'],amount=-f['amount'],note=reason,reversal_of=id,created_at=now())
    for ch in conn.execute('SELECT * FROM fund_channels WHERE fund_id=?',(id,)):
        insert(conn,'fund_channels',fund_id=rid,channel=ch['channel'],amount=ch['amount'])
    history(conn,'fund',id,'冲正',f,{'reversal_id':rid},reason)
    return {'id':rid}

def expense(conn,p):
    business_date=p.get('business_date',str(date.today()))
    try: date.fromisoformat(business_date)
    except (ValueError,TypeError): raise BusinessError('费用归属日期无效')
    data={'category':text(p.get('category',''),'费用类别',True),'amount':integer(p.get('amount'),'费用金额',1),'business_date':business_date,'channel':text(p.get('channel','现金'),'支付渠道',True),'note':text(p.get('note',''),'备注'),'created_at':now()}
    id=insert(conn,'expenses',**data)
    profit(conn,'expense',-data['amount'],f'expense:{id}',at=business_date+'T12:00:00+08:00')
    return {'id':id}

def reverse_expense(conn,id,p):
    e=row(conn,'expenses',id); reason=text(p.get('reason',''),'冲正原因',True)
    require(not e['is_reversal'] and not conn.execute('SELECT 1 FROM expenses WHERE reversal_of=?',(id,)).fetchone(),'费用已冲正或属于冲正记录')
    rid=insert(conn,'expenses',category=e['category'],amount=e['amount'],business_date=str(date.today()),channel=e['channel'],note=reason,reversal_of=id,is_reversal=1,created_at=now())
    profit(conn,'expense',e['amount'],f'expense_reversal:{rid}')
    history(conn,'expense',id,'冲正',e,{'reversal_id':rid},reason)
    return {'id':rid}

def create_stocktake(conn,p):
    id=insert(conn,'stocktakes',number=number(conn,'PD','stocktakes'),state='open',note=text(p.get('note',''),'备注'),created_at=now())
    return {'id':id}

def count_stock(conn,id,p):
    require(row(conn,'stocktakes',id)['state']=='open','盘点已确认')
    for i in p.get('items',[]):
        s=row(conn,'skus',i['sku_id']); count=integer(i.get('count'),'实盘数量')
        ledger=conn.execute('SELECT COALESCE(MAX(id),0) FROM inventory_ledger WHERE sku_id=?',(s['id'],)).fetchone()[0]
        require('expected_ledger_id' not in i or i['expected_ledger_id']==ledger,'点数期间出现库存变化，请重新清点',409)
        conn.execute('INSERT INTO stocktake_items(stocktake_id,sku_id,count,baseline,ledger_id,counted_at) VALUES(?,?,?,?,?,?) ON CONFLICT(stocktake_id,sku_id) DO UPDATE SET count=excluded.count,baseline=excluded.baseline,ledger_id=excluded.ledger_id,counted_at=excluded.counted_at',(id,s['id'],count,s['stock'],ledger,now()))
    return {'id':id}

def confirm_stocktake(conn,id,p):
    st=row(conn,'stocktakes',id); require(st['state']=='open','盘点已确认')
    items=conn.execute('SELECT * FROM stocktake_items WHERE stocktake_id=?',(id,)).fetchall(); require(bool(items),'尚未记录实盘数量')
    reason=text(p.get('reason','盘点差异'),'原因',True)
    for i in items:
        delta=i['count']-i['baseline']; s=row(conn,'skus',i['sku_id'])
        if delta>0:
            cost=s['avg_cost'] if s['cost_known'] else integer(p.get('estimates',{}).get(str(s['id'])),'盘盈单位成本')
            receive_stock(conn,s['id'],delta,cost,'stocktake',f'stocktake:{id}',reason)
            profit(conn,'inventory_gain',delta*cost,f'stocktake:{id}')
        elif delta<0:
            estimate=p.get('estimates',{}).get(str(s['id']))
            cost,shortage,unit=issue_stock(conn,s['id'],-delta,'stocktake',f'stocktake:{id}',reason,estimate,bool(p.get('force')))
            if shortage: insert(conn,'inventory_shortages',sku_id=s['id'],qty=shortage,remaining=shortage,estimate=unit,source=f'stocktake:{id}',created_at=now())
            profit(conn,'inventory_loss',-cost,f'stocktake:{id}')
    conn.execute("UPDATE stocktakes SET state='confirmed',confirmed_at=? WHERE id=?",(now(),id))
    history(conn,'stocktake',id,'确认盘点',st,{'items':[dict(i) for i in items]},reason)
    return {'id':id}

def scrap(conn,p):
    reason=text(p.get('reason',''),'报废原因',True)
    qty=integer(p.get('qty'),'报废数量',1)
    cost,_,_=issue_stock(conn,p['sku_id'],qty,'scrap','scrap',reason)
    profit(conn,'inventory_loss',-cost,'scrap')
    history(conn,'sku',p['sku_id'],'报废',None,{'qty':qty,'cost':cost},reason)
    return {'cost':cost}

def order_detail(conn,id):
    o=row(conn,'orders',id)
    o['party']=row(conn,'parties',o['party_id']) if o['party_id'] else None
    o['lines']=[dict(r) for r in conn.execute('SELECT l.*,s.stock,s.avg_cost,s.cost_known,s.color,s.size,p.code,p.name FROM order_lines l JOIN skus s ON s.id=l.sku_id JOIN products p ON p.id=s.product_id WHERE order_id=?',(id,))]
    for l in o['lines']: l['available']=available(conn,l['sku_id'])
    o['fulfillments']=[dict(r) for r in conn.execute('SELECT f.*,l.description,COALESCE((SELECT SUM(amount) FROM cost_adjustments c WHERE c.fulfillment_id=f.id),0) cost_adjustment FROM fulfillments f JOIN order_lines l ON l.id=f.line_id WHERE f.order_id=? ORDER BY f.id',(id,))]
    for table in ('returns','debts','credits','funds'):
        o[table]=[dict(r) for r in conn.execute(f'SELECT * FROM {table} WHERE order_id=? ORDER BY id',(id,))]
    for d in o['debts']: d['balance']=debt_balance(conn,d['id'])
    for c in o['credits']: c['balance']=credit_balance(conn,c['id'])
    o['history']=[dict(r) for r in conn.execute("SELECT * FROM history WHERE entity='order' AND entity_id=? ORDER BY id DESC",(id,))]
    o['reservations']=[dict(r) for r in conn.execute('SELECT r.* FROM reservation_events r JOIN order_lines l ON l.id=r.line_id WHERE l.order_id=? ORDER BY r.id',(id,))]
    o['cost_adjustments']=[dict(r) for r in conn.execute('SELECT c.* FROM cost_adjustments c JOIN fulfillments f ON f.id=c.fulfillment_id WHERE f.order_id=?',(id,))]
    return o
