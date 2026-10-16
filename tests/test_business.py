import json
from concurrent.futures import ThreadPoolExecutor
import pytest
from backend import service as s, queries as q
from backend.db import BusinessError, insert, row
from conftest import order

def line(c,id): return c.execute('SELECT * FROM order_lines WHERE order_id=?',(id,)).fetchone()['id']
def fulfil(c,id,qty,**kw): return s.fulfill(c,id,{'lines':[{'line_id':line(c,id),'qty':qty}],**kw})
def returned(c,id,qty,sellable=True):
    fid=c.execute('SELECT id FROM fulfillments WHERE order_id=? ORDER BY id',(id,)).fetchone()[0]
    return s.return_goods(c,id,{'lines':[{'fulfillment_id':fid,'qty':qty,'sellable':sellable}],'reason':'退货'})

def test_empty_database(db):
    with db.connect() as c:
        d=q.dashboard(c)
        assert d['stock']['sku_count']==0 and d['today']['revenue']==0 and d['settings']=={}
        assert c.execute('PRAGMA foreign_keys').fetchone()[0]==1

def test_advance_only_becomes_income_after_fulfillment(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=5,price=100000,payments=[{'channel':'微信','amount':200000}])
        assert q.report(c)['revenue']==0
        b=q.balances(c,1); assert (b['outstanding'],b['advance'])==(0,200000)
        fulfil(c,id,3)
        b=q.balances(c,1); assert (b['outstanding'],b['advance'])==(100000,0)
        assert q.report(c)['revenue']==300000
        assert row(c,'skus',1)['stock']==7
        assert c.execute('SELECT COUNT(*) FROM funds').fetchone()[0]==1
        assert c.execute('SELECT kind FROM allocations').fetchone()[0]=='order_advance'

def test_reservations_forced_reallocation_negative_and_manual_replenishment(setup):
    with setup['db'].transaction() as c:
        a=order(c,qty=10); b=order(c,party=2,qty=15)
        assert row(c,'order_lines',line(c,a))['reserved']==10
        with pytest.raises(BusinessError): fulfil(c,b,10)
        fulfil(c,b,10,force=True,reason='老板确认挪用')
        assert row(c,'order_lines',line(c,a))['reserved']==0
        fulfil(c,b,5,force=True,reason='老板确认负库存')
        assert row(c,'skus',1)['stock']==-5
        purchase=order(c,kind='purchase',party=3,qty=8,price=1200,direct=True)
        assert row(c,'skus',1)['stock']==3
        assert row(c,'order_lines',line(c,a))['reserved']==0
        assert c.execute('SELECT SUM(amount) FROM cost_adjustments').fetchone()[0]==1000
        s.manual_reserve(c,a,{'lines':[{'line_id':line(c,a),'qty':3}]})
        assert row(c,'order_lines',line(c,a))['reserved']==3
        assert c.execute("SELECT COUNT(*) FROM history WHERE action='预留被挪用'").fetchone()[0]==1

def test_multilot_negative_settlement_fifo(setup):
    with setup['db'].transaction() as c:
        a=order(c,qty=14,direct=True,force=True,reason='确认')
        b=order(c,qty=3,direct=True,force=True,reason='确认')
        order(c,kind='purchase',party=3,qty=5,price=1200,direct=True)
        order(c,kind='purchase',party=3,qty=6,price=1500,direct=True)
        assert row(c,'skus',1)['stock']==4 and row(c,'skus',1)['value']==6000
        assert c.execute('SELECT SUM(remaining) FROM negative_lots').fetchone()[0]==0
        adjustments=[r[0] for r in c.execute('SELECT amount FROM cost_adjustments ORDER BY id')]
        assert adjustments==[800,200,1000]
        assert q.report(c)['original_cost']==17000
        assert q.report(c)['cost_adjustment']==2000

def test_unknown_cost_requires_manual_estimate(db):
    with db.transaction() as c:
        s.product(c,{'code':'X','name':'X','price':300,'skus':[{'color':'X','size':'X','stock':0}]})
        s.party(c,{'kind':'customer','name':'A'})
        id=order(c,qty=2)
        with pytest.raises(BusinessError,match='暂估'): fulfil(c,id,2,force=True,reason='确认')
    # Failure above was deliberately caught inside a transaction: production command
    # wraps the whole callback and rolls back. Use a fresh transaction to test that path.

def test_transaction_failure_rolls_back_whole_order(setup):
    db=setup['db']
    with pytest.raises(BusinessError):
        db.command('failure-operation',{'x':1},lambda c:order(c,party=None,qty=20,direct=True))
    with db.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM orders').fetchone()[0]==0
        assert row(c,'skus',1)['stock']==10

def test_idempotency_and_payload_conflict(setup):
    db=setup['db']; payload={'qty':2}
    first=db.command('operation-unique',payload,lambda c:{'id':order(c,qty=2,direct=True)})
    second=db.command('operation-unique',payload,lambda c:pytest.fail('must not call'))
    assert first==second
    with pytest.raises(BusinessError,match='不同内容'):
        db.command('operation-unique',{'qty':3},lambda c:{})
    with db.connect() as c: assert row(c,'skus',1)['stock']==8

def test_concurrent_double_submit(setup):
    db=setup['db']
    def go(_): return db.command('concurrent-operation',{'qty':1},lambda c:{'id':order(c,qty=1,direct=True)})
    with ThreadPoolExecutor(max_workers=4) as ex: results=list(ex.map(go,range(8)))
    assert len({r['id'] for r in results})==1
    with db.connect() as c: assert row(c,'skus',1)['stock']==9

def test_partial_purchase_termination_preserves_received_and_advance(setup):
    with setup['db'].transaction() as c:
        id=order(c,kind='purchase',party=3,qty=10,price=1000,payments=[{'channel':'现金','amount':8000}])
        assert q.balances(c,3)['outstanding']==0
        fulfil(c,id,4)
        s.terminate(c,id,{'reason':'余量不要了'})
        o=s.order_detail(c,id)
        assert o['state']=='partial' and o['remaining_terminated']==1
        assert o['lines'][0]['fulfilled']==4 and o['lines'][0]['terminated']==6
        assert q.balances(c,3)['advance']==4000
        assert row(c,'skus',1)['stock']==14
        with pytest.raises(BusinessError): fulfil(c,id,1)

def test_cancel_unfulfilled_releases_stock(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=4); s.terminate(c,id,{'reason':'取消'})
        assert row(c,'orders',id)['state']=='cancelled'
        assert s.reserved(c,1)==0 and row(c,'skus',1)['stock']==10

def test_inventory_snapshot_does_not_overwrite_later_sale(setup):
    with setup['db'].transaction() as c:
        s.receive_stock(c,1,90,1000,'opening','test')
        st=s.create_stocktake(c,{})['id']
        s.count_stock(c,st,{'items':[{'sku_id':1,'count':96}]})
        order(c,qty=10,direct=True)
        s.confirm_stocktake(c,st,{'reason':'盘亏'})
        assert row(c,'skus',1)['stock']==86
        assert q.report(c)['inventory_profit']==-4000

def test_stocktake_rejects_stale_count_basis(setup):
    with setup['db'].transaction() as c:
        st=s.create_stocktake(c,{})['id']; old=q.skus(c)['items'][0]['ledger_id']
        order(c,qty=1,direct=True)
        with pytest.raises(BusinessError,match='重新清点'):
            s.count_stock(c,st,{'items':[{'sku_id':1,'count':8,'expected_ledger_id':old}]})

def test_one_payment_many_orders_and_opening_debt(setup):
    with setup['db'].transaction() as c:
        a=order(c,qty=2,direct=True); b=order(c,qty=3,direct=True)
        opening=insert(c,'debts',party_id=1,amount=1000,source='期初',created_at=s.now())
        debts=[dict(r) for r in c.execute('SELECT * FROM debts')]
        result=s.fund(c,{'party_id':1,'channels':[{'channel':'微信','amount':6000},{'channel':'现金','amount':5000}],'allocations':[{'debt_id':d['id'],'amount':d['amount']} for d in debts]})
        assert q.balances(c,1)['outstanding']==0 and q.balances(c,1)['advance']==0
        assert c.execute('SELECT COUNT(*) FROM funds').fetchone()[0]==1
        assert c.execute('SELECT COUNT(*) FROM allocations').fetchone()[0]==3

def test_bad_allocation_rolls_back_payment(setup):
    db=setup['db']
    with db.transaction() as c: order(c,qty=1,direct=True)
    with pytest.raises(BusinessError):
        db.command('bad-allocation-key',{},lambda c:s.fund(c,{'party_id':1,'channels':[{'channel':'现金','amount':1000}],'allocations':[{'debt_id':1,'amount':2000}]}))
    with db.connect() as c: assert c.execute('SELECT COUNT(*) FROM funds').fetchone()[0]==0

def test_cannot_allocate_between_parties(setup):
    with setup['db'].transaction() as c:
        order(c,party=2,direct=True)
        r=s.fund(c,{'party_id':1,'channels':[{'channel':'现金','amount':2000}]})
        with pytest.raises(BusinessError,match='跨往来'): s.allocate(c,r['credit_id'],1,100)

def test_sellable_return_restores_original_cost(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=4,direct=True); returned(c,id,2)
        assert row(c,'skus',1)['stock']==8 and row(c,'skus',1)['value']==8000
        assert q.report(c)['revenue']==4000 and q.report(c)['gross_profit']==2000
        assert q.balances(c,1)['outstanding']==4000

def test_unsellable_return_loss_not_duplicated_as_expense(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=4,direct=True); returned(c,id,2,False)
        r=q.report(c)
        assert row(c,'skus',1)['stock']==6
        assert r['revenue']==4000 and r['gross_profit']==2000 and r['inventory_profit']==-2000 and r['profit']==0
        assert c.execute('SELECT COUNT(*) FROM expenses').fetchone()[0]==0

def test_cost_settlement_then_return_uses_final_cost(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=12,direct=True,force=True,reason='确认')
        order(c,kind='purchase',party=3,qty=5,price=1600,direct=True)
        returned(c,id,3)
        f=c.execute('SELECT * FROM fulfillments WHERE order_id=?',(id,)).fetchone()
        r=c.execute('SELECT * FROM returns WHERE order_id=?',(id,)).fetchone()
        assert r['cost']==3300 # 13200 * 3/12
        assert row(c,'skus',1)['stock']==6 and row(c,'skus',1)['value']==8100

def test_return_before_restocks_all_value_conserved(setup):
    with setup['db'].transaction() as c:
        order(c,qty=10,direct=True)
        a=order(c,qty=5,direct=True,force=True,reason='确认')
        returned(c,a,2)
        order(c,kind='purchase',party=3,qty=5,price=1200,direct=True)
        r=q.report(c); inv=row(c,'skus',1)
        assert inv['stock']==2 and inv['value']==2400
        # opening inventory 10000 + purchases 6000 = remaining stock + effective COGS.
        assert r['original_cost']+r['cost_adjustment']-r['inventory_profit']+inv['value']==16000

def test_purchase_return_difference_inventory_gain(setup):
    with setup['db'].transaction() as c:
        id=order(c,kind='purchase',party=3,qty=10,price=1400,direct=True)
        returned(c,id,2)
        assert row(c,'skus',1)['stock']==18
        assert q.report(c)['inventory_profit']==400 # credit 2800 - current inventory cost 2400
        assert q.balances(c,3)['outstanding']==11200

def test_exchange_atomic_and_linked(setup):
    with setup['db'].transaction() as c:
        s.product(c,{'code':'P02','name':'换货款','price':3000,'skus':[{'color':'白','size':'L','stock':4,'cost':2000}]})
        id=order(c,qty=2,direct=True)
        fid=c.execute('SELECT id FROM fulfillments WHERE order_id=?',(id,)).fetchone()[0]
        result=s.return_goods(c,id,{'reason':'换款','lines':[{'fulfillment_id':fid,'qty':1}],'exchange':{'direct':True,'lines':[{'sku_id':2,'qty':1,'price':3000}]}})
        assert result['exchange_order_id']
        assert c.execute('SELECT exchange_order_id FROM returns').fetchone()[0]==result['exchange_order_id']
        assert row(c,'skus',1)['stock']==9 and row(c,'skus',2)['stock']==3

def test_refund_only_explicit_available_credit(setup):
    with setup['db'].transaction() as c:
        result=s.fund(c,{'party_id':1,'channels':[{'channel':'微信','amount':5000}]})
        s.fund(c,{'party_id':1,'refund':True,'channels':[{'channel':'现金','amount':3000}],'refund_credits':[{'credit_id':result['credit_id'],'amount':3000}]})
        assert q.balances(c,1)['advance']==2000
        assert c.execute('SELECT SUM(amount) FROM funds').fetchone()[0]==2000

def test_fund_reversal_reopens_debt_preserves_allocations(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=2,direct=True)
        r=s.fund(c,{'party_id':1,'channels':[{'channel':'现金','amount':5000}],'allocations':[{'debt_id':1,'amount':4000}]})
        original=row(c,'funds',r['id'])
        s.reverse_fund(c,r['id'],{'reason':'误收'})
        assert q.balances(c,1)['outstanding']==4000 and q.balances(c,1)['advance']==0
        assert row(c,'funds',r['id'])==original
        assert c.execute('SELECT COUNT(*) FROM allocations').fetchone()[0]==1

def test_full_order_reversal_restores_stock_cash_and_balances(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=3,direct=True,payments=[{'channel':'现金','amount':6000}])
        s.reverse_order(c,id,{'reason':'重复开单'})
        assert row(c,'skus',1)['stock']==10
        assert c.execute('SELECT SUM(amount) FROM funds').fetchone()[0]==0
        assert q.balances(c,1)['outstanding']==0 and q.balances(c,1)['advance']==0
        assert q.report(c)['profit']==0

def test_anonymous_must_pay_and_deliver(setup):
    db=setup['db']
    with pytest.raises(BusinessError): db.command('anonymous-invalid',{},lambda c:order(c,party=None,qty=1))
    with db.transaction() as c:
        id=order(c,party=None,qty=1,direct=True,payments=[{'channel':'现金','amount':2000}])
        o=s.order_detail(c,id)
        assert o['state']=='completed' and sum(d['balance'] for d in o['debts'])==0
        assert q.parties(c)['total']==2 # internal clearing party hidden

def test_price_snapshot_and_disabled_master(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=1)
        p=row(c,'products',1); p.update(price=9999,active=False);s.product(c,p,1)
        assert s.order_detail(c,id)['lines'][0]['price']==2000
        with pytest.raises(BusinessError,match='停用'): order(c)

def test_draft_has_no_stock_money_or_ledger_effect(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=7,draft=True,payments=[{'channel':'现金','amount':1000}])
        assert s.reserved(c,1)==0 and row(c,'skus',1)['stock']==10
        assert c.execute('SELECT COUNT(*) FROM funds').fetchone()[0]==0
        s.confirm_draft(c,id,{})
        assert s.reserved(c,1)==7

def test_expense_freight_and_scrap_not_double_counted(setup):
    with setup['db'].transaction() as c:
        order(c,kind='purchase',party=3,qty=2,price=1000,direct=True,freight=300)
        assert row(c,'skus',1)['value']==12000
        assert q.report(c)['expenses']==300
        s.scrap(c,{'sku_id':1,'qty':1,'reason':'破损'})
        assert q.report(c)['inventory_profit']==-1000 and q.report(c)['profit']==-1300

def test_expense_reversal_append_only(setup):
    with setup['db'].transaction() as c:
        id=s.expense(c,{'category':'租金','amount':2000,'channel':'现金'})['id']
        s.reverse_expense(c,id,{'reason':'误填'})
        assert c.execute('SELECT COUNT(*) FROM expenses').fetchone()[0]==2
        assert q.report(c)['expenses']==0

def test_historical_timestamp_cannot_be_changed_via_request(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=1,direct=True,created_at='1999-01-01')
        original=row(c,'orders',id)['created_at']
        returned(c,id,1)
        assert row(c,'orders',id)['created_at']==original and not original.startswith('1999')

def test_cross_period_adjustment_does_not_overwrite_original(setup,monkeypatch):
    with setup['db'].transaction() as c:
        monkeypatch.setattr(s,'now',lambda:'2026-09-30T12:00:00+08:00')
        id=order(c,qty=12,direct=True,force=True,reason='确认')
        old=q.report(c,'2026-09-01','2026-09-30')
        monkeypatch.setattr(s,'now',lambda:'2026-10-16T12:00:00+08:00')
        order(c,kind='purchase',party=3,qty=3,price=1300,direct=True)
        previous=q.report(c,'2026-09-01','2026-09-30')
        assert old['gross_profit']==previous['gross_profit']
        assert q.report(c,'2026-10-01','2026-10-31')['cost_adjustment']==600

def test_integer_cost_tail_preserves_total(setup):
    with setup['db'].transaction() as c:
        order(c,qty=10,direct=True)
        s.receive_stock(c,1,2,101,'purchase','x');s.receive_stock(c,1,1,100,'purchase','y')
        for _ in range(3): order(c,qty=1,direct=True)
        assert row(c,'skus',1)['value']==0
        assert c.execute("SELECT SUM(cost) FROM fulfillments WHERE id>1").fetchone()[0]==302

@pytest.mark.parametrize('qty',[0,-1,1.2,True,'1'])
def test_invalid_quantity_rejected(setup,qty):
    with pytest.raises(BusinessError):
        setup['db'].command('invalid-quantity-'+str(qty),{'qty':qty},lambda c:order(c,qty=qty))
