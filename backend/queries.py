from datetime import date, timedelta
from .db import integer, require, row
from .service import credit_balance, debt_balance, settings

def records(conn,sql,args=()):
    return [dict(r) for r in conn.execute(sql,args)]

def paginate(conn,sql,args,page=1,page_size=30,order='id DESC'):
    page=integer(page,'页码',1); size=integer(page_size,'每页条数',1)
    require(size<=1000,'每页最多1000条')
    total=conn.execute(f'SELECT COUNT(*) FROM ({sql})',args).fetchone()[0]
    return {'items':records(conn,f'{sql} ORDER BY {order} LIMIT ? OFFSET ?',(*args,size,(page-1)*size)),'total':total,'page':page,'page_size':size}

def skus(conn,q='',page=1,page_size=30,alert='',sort='code',direction='asc'):
    filters=['1=1']; args=[]
    if q:
        filters.append("(p.name LIKE ? OR p.code LIKE ? OR s.barcode=? OR s.color LIKE ? OR s.size LIKE ?)")
        args.extend([f'%{q}%',f'%{q}%',q,f'%{q}%',f'%{q}%'])
    if alert=='low': filters.append('s.stock<=s.threshold')
    elif alert=='negative': filters.append('s.stock<0')
    sql='''SELECT s.*,p.code,p.name,p.price,p.category,p.brand,p.season,p.active product_active,
      COALESCE((SELECT SUM(l.reserved) FROM order_lines l WHERE l.sku_id=s.id),0) reserved,
      MAX(0,s.stock-COALESCE((SELECT SUM(l.reserved) FROM order_lines l WHERE l.sku_id=s.id),0)) available,
      (SELECT filename FROM images i WHERE i.product_id=p.id ORDER BY position,id LIMIT 1) image,
      (SELECT COALESCE(MAX(il.id),0) FROM inventory_ledger il WHERE il.sku_id=s.id) ledger_id
      FROM skus s JOIN products p ON p.id=s.product_id WHERE '''+' AND '.join(filters)
    allowed={'code':'p.code','stock':'s.stock','price':'p.price','id':'s.id','value':'s.value'}
    return paginate(conn,sql,args,page,page_size,allowed.get(sort,'p.code')+(' DESC' if direction=='desc' else ' ASC')+',s.id')

def orders(conn,kind='sale',q='',state='',start='',end='',party_id=None,page=1,page_size=30):
    require(kind in ('sale','purchase'),'类型无效')
    filters=['o.kind=?']; args=[kind]
    if q: filters.append('(o.number LIKE ? OR p.name LIKE ?)'); args.extend([f'%{q}%']*2)
    if state: filters.append('o.state=?'); args.append(state)
    if start: filters.append('substr(o.created_at,1,10)>=?'); args.append(start)
    if end: filters.append('substr(o.created_at,1,10)<=?'); args.append(end)
    if party_id: filters.append('o.party_id=?'); args.append(party_id)
    sql='''SELECT o.*,CASE WHEN p.name='__anonymous__' THEN '散客' ELSE COALESCE(p.name,'散客') END party_name,
     (SELECT SUM(qty*price) FROM order_lines l WHERE l.order_id=o.id) total,
     (SELECT SUM(qty) FROM order_lines l WHERE l.order_id=o.id) qty,
     (SELECT SUM(fulfilled) FROM order_lines l WHERE l.order_id=o.id) fulfilled,
     (SELECT SUM(reserved) FROM order_lines l WHERE l.order_id=o.id) reserved,
     (SELECT SUM(qty-fulfilled-terminated-reserved) FROM order_lines l WHERE l.order_id=o.id) shortage,
     COALESCE((SELECT SUM(amount) FROM debts d WHERE d.order_id=o.id),0)-COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN debts d ON d.id=a.debt_id WHERE d.order_id=o.id),0) debt
     FROM orders o LEFT JOIN parties p ON p.id=o.party_id WHERE '''+' AND '.join(filters)
    return paginate(conn,sql,args,page,page_size,'o.id DESC')

def balances(conn,pid):
    p=row(conn,'parties',pid)
    p['debts']=records(conn,'SELECT * FROM debts WHERE party_id=? ORDER BY id',(pid,))
    p['credits']=records(conn,'SELECT * FROM credits WHERE party_id=? ORDER BY id',(pid,))
    for d in p['debts']: d['balance']=debt_balance(conn,d['id'])
    for c in p['credits']: c['balance']=credit_balance(conn,c['id'])
    p['outstanding']=sum(d['balance'] for d in p['debts'])
    p['advance']=sum(c['balance'] for c in p['credits'])
    p['funds']=records(conn,'SELECT * FROM funds WHERE party_id=? ORDER BY id DESC',(pid,))
    p['allocations']=records(conn,'SELECT a.* FROM allocations a JOIN debts d ON d.id=a.debt_id WHERE d.party_id=? ORDER BY a.id DESC',(pid,))
    return p

def parties(conn,kind='customer',q='',page=1,page_size=30):
    sql='''SELECT p.*,
    COALESCE((SELECT SUM(amount) FROM debts d WHERE d.party_id=p.id),0)-COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN debts d ON d.id=a.debt_id WHERE d.party_id=p.id),0) outstanding,
    COALESCE((SELECT SUM(amount-refunded) FROM credits c WHERE c.party_id=p.id),0)-COALESCE((SELECT SUM(a.amount) FROM allocations a JOIN credits c ON c.id=a.credit_id WHERE c.party_id=p.id),0) advance
    FROM parties p WHERE kind=? AND name!='__anonymous__' AND (name LIKE ? OR phone LIKE ?)'''
    return paginate(conn,sql,(kind,f'%{q}%',f'%{q}%'),page,page_size,'p.id DESC')

def report(conn,start='',end=''):
    start=start or str(date.today().replace(day=1)); end=end or str(date.today())
    filters='substr(created_at,1,10) BETWEEN ? AND ?'
    args=(start,end)
    groups=records(conn,f'SELECT kind,SUM(amount) amount FROM profit_ledger WHERE {filters} GROUP BY kind',args)
    amounts={r['kind']:r['amount'] for r in groups}
    revenue=amounts.get('revenue',0)+amounts.get('return_revenue',0)
    cost=amounts.get('sale_cost',0)+amounts.get('return_cost',0)
    adjustment=amounts.get('cost_adjustment',0)
    inventory=amounts.get('inventory_gain',0)+amounts.get('inventory_loss',0)
    expenses=amounts.get('expense',0)
    trend=records(conn,f'''SELECT substr(created_at,1,10) day,
      SUM(CASE WHEN kind IN('revenue','return_revenue') THEN amount ELSE 0 END) revenue,
      SUM(amount) profit FROM profit_ledger WHERE {filters} GROUP BY day ORDER BY day''',args)
    ranking=records(conn,'''WITH events AS (
      SELECT l.sku_id,f.qty qty,f.amount amount FROM fulfillments f JOIN orders o ON o.id=f.order_id JOIN order_lines l ON l.id=f.line_id
      WHERE o.kind='sale' AND substr(f.created_at,1,10) BETWEEN ? AND ?
      UNION ALL
      SELECT l.sku_id,-r.qty,-r.amount FROM returns r JOIN orders o ON o.id=r.order_id JOIN fulfillments f ON f.id=r.fulfillment_id JOIN order_lines l ON l.id=f.line_id
      WHERE o.kind='sale' AND substr(r.created_at,1,10) BETWEEN ? AND ?)
      SELECT p.code,p.name,s.color,s.size,SUM(e.qty) qty,SUM(e.amount) amount FROM events e JOIN skus s ON s.id=e.sku_id JOIN products p ON p.id=s.product_id GROUP BY s.id ORDER BY qty DESC LIMIT 50''',(*args,*args))
    purchases=conn.execute("SELECT COALESCE(SUM(f.amount),0) FROM fulfillments f JOIN orders o ON o.id=f.order_id WHERE o.kind='purchase' AND substr(f.created_at,1,10) BETWEEN ? AND ?",args).fetchone()[0]
    purchase_returns=conn.execute("SELECT COALESCE(SUM(r.amount),0) FROM returns r JOIN orders o ON o.id=r.order_id WHERE o.kind='purchase' AND substr(r.created_at,1,10) BETWEEN ? AND ?",args).fetchone()[0]
    return {'start':start,'end':end,'revenue':revenue,'original_cost':-cost,'cost_adjustment':-adjustment,'gross_profit':revenue+cost+adjustment,'inventory_profit':inventory,'expenses':-expenses,'profit':sum(amounts.values()),'purchase':purchases-purchase_returns,'trend':trend,'ranking':ranking,'breakdown':groups,'details':records(conn,f'SELECT * FROM profit_ledger WHERE {filters} ORDER BY id DESC',args)}

def dashboard(conn):
    r=report(conn,str(date.today()),str(date.today()))
    todos={
      'low':conn.execute('SELECT COUNT(*) FROM skus WHERE active=1 AND stock<=threshold').fetchone()[0],
      'negative':conn.execute('SELECT COUNT(*) FROM skus WHERE stock<0').fetchone()[0],
      'shortage':conn.execute("SELECT COUNT(DISTINCT l.order_id) FROM order_lines l JOIN orders o ON o.id=l.order_id WHERE o.kind='sale' AND o.state IN('confirmed','partial') AND qty-fulfilled-terminated-reserved>0").fetchone()[0],
      'delivery':conn.execute("SELECT COUNT(*) FROM orders WHERE kind='sale' AND state IN('confirmed','partial') AND remaining_terminated=0").fetchone()[0],
      'receipt':conn.execute("SELECT COUNT(*) FROM orders WHERE kind='purchase' AND state IN('confirmed','partial') AND remaining_terminated=0").fetchone()[0],
    }
    debt=records(conn,'''SELECT p.kind,SUM(d.amount-COALESCE((SELECT SUM(a.amount) FROM allocations a WHERE a.debt_id=d.id),0)) amount FROM debts d JOIN parties p ON p.id=d.party_id GROUP BY p.kind''')
    return {'today':r,'todos':todos,'balances':{x['kind']:x['amount'] for x in debt},'stock':dict(conn.execute('SELECT COUNT(*) sku_count,COALESCE(SUM(stock),0) qty,COALESCE(SUM(value),0) value FROM skus').fetchone()),'recent_orders':orders(conn,page_size=8)['items'],'settings':settings(conn)}
