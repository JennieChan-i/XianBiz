import pytest
from backend import service as s, queries as q
from backend.app import create_app
from backend.db import row
from fastapi.testclient import TestClient
from conftest import order

def test_refund_reversal_restores_credit_without_new_credit(setup):
    with setup['db'].transaction() as c:
        payment=s.fund(c,{'party_id':1,'channels':[{'channel':'现金','amount':5000}]})
        refund=s.fund(c,{'party_id':1,'refund':True,'channels':[{'channel':'现金','amount':3000}],'refund_credits':[{'credit_id':payment['credit_id'],'amount':3000}]})
        s.reverse_fund(c,refund['id'],{'reason':'退款录错'})
        assert q.balances(c,1)['advance']==5000
        assert c.execute('SELECT COUNT(*) FROM credits').fetchone()[0]==1
        assert c.execute('SELECT SUM(amount) FROM funds').fetchone()[0]==5000

def test_return_ranking_uses_return_date_not_original_sale_date(setup,monkeypatch):
    with setup['db'].transaction() as c:
        monkeypatch.setattr(s,'now',lambda:'2026-09-30T12:00:00+08:00')
        id=order(c,qty=2,direct=True)
        fid=c.execute('SELECT id FROM fulfillments WHERE order_id=?',(id,)).fetchone()[0]
        monkeypatch.setattr(s,'now',lambda:'2026-10-16T12:00:00+08:00')
        s.return_goods(c,id,{'reason':'跨期退货','lines':[{'fulfillment_id':fid,'qty':1}]})
        sept=q.report(c,'2026-09-01','2026-09-30')['ranking'][0]
        oct=q.report(c,'2026-10-01','2026-10-31')['ranking'][0]
        assert sept['qty']==2 and sept['amount']==4000
        assert oct['qty']==-1 and oct['amount']==-2000

def test_disk_draft_no_business_effect_and_cleared_on_submit(tmp_path):
    app=create_app(tmp_path/'disk'); client=TestClient(app,base_url='http://127.0.0.1:8001')
    token=client.get('/api/session').json()['token']
    h={'X-XianBiz-Token':token,'X-Operation-Id':'save-draft-key'}
    p={'lines':[{'sku_id':1,'qty':2}],'updated':1234}
    assert client.put('/api/drafts/sale',json=p,headers=h).status_code==200
    # Simulate new process/port; no business documents were created.
    other=TestClient(create_app(tmp_path/'disk'),base_url='http://127.0.0.1:8002')
    assert other.get('/api/drafts/sale').json()==p
    assert other.get('/api/orders').json()['total']==0

def test_purchase_never_has_fifth_draft_status(setup):
    with pytest.raises(s.BusinessError,match='四种'):
        setup['db'].command('purchase-draft-test',{},lambda c:order(c,kind='purchase',party=3,draft=True))

def test_edit_draft_then_confirm_is_atomic(setup):
    with setup['db'].transaction() as c:
        id=order(c,qty=2,draft=True)
        original_number=row(c,'orders',id)['number']
        s.update_draft(c,id,{'party_id':1,'draft':True,'lines':[{'sku_id':1,'qty':3,'price':2500}],'note':'改草稿'})
        assert s.reserved(c,1)==0
        s.update_draft(c,id,{'party_id':1,'direct':True,'lines':[{'sku_id':1,'qty':3,'price':2500}],'payments':[{'channel':'现金','amount':7500}]})
        assert row(c,'orders',id)['number']==original_number and row(c,'orders',id)['state']=='completed'
        assert row(c,'skus',1)['stock']==7 and q.balances(c,1)['outstanding']==0
        with pytest.raises(s.BusinessError): s.update_draft(c,id,{'party_id':1,'lines':[]})

def test_stocktake_negative_after_intervening_sale_settles_as_inventory_loss(setup):
    with setup['db'].transaction() as c:
        id=s.create_stocktake(c,{})['id'];s.count_stock(c,id,{'items':[{'sku_id':1,'count':6}]})
        order(c,qty=10,direct=True)
        s.confirm_stocktake(c,id,{'reason':'盘亏，已确认期间销售','force':True})
        assert row(c,'skus',1)['stock']==-4
        order(c,kind='purchase',party=3,qty=6,price=1200,direct=True)
        assert row(c,'skus',1)['stock']==2 and row(c,'skus',1)['value']==2400
        assert q.report(c)['inventory_profit']==-4800
        assert c.execute('SELECT SUM(remaining) FROM inventory_shortages').fetchone()[0]==0

def test_anonymous_return_must_settle_refund_atomically(setup):
    db=setup['db']
    with db.transaction() as c:
        id=order(c,party=None,qty=2,direct=True,payments=[{'channel':'现金','amount':4000}])
        fid=c.execute('SELECT id FROM fulfillments WHERE order_id=?',(id,)).fetchone()[0]
    with pytest.raises(s.BusinessError,match='当场结清'):
        db.command('anonymous-unsettled',{},lambda c:s.return_goods(c,id,{'reason':'退货','lines':[{'fulfillment_id':fid,'qty':1}]}))
    with db.transaction() as c:
        s.return_goods(c,id,{'reason':'退货','lines':[{'fulfillment_id':fid,'qty':1}],'settlement_channels':[{'channel':'现金','amount':2000}]})
        p=q.balances(c,row(c,'orders',id)['party_id'])
        assert p['outstanding']==p['advance']==0
        assert c.execute('SELECT SUM(amount) FROM funds').fetchone()[0]==2000

def test_anonymous_exchange_with_price_difference_fully_settled(setup):
    with setup['db'].transaction() as c:
        id=order(c,party=None,qty=1,direct=True,payments=[{'channel':'现金','amount':2000}])
        fid=c.execute('SELECT id FROM fulfillments WHERE order_id=?',(id,)).fetchone()[0]
        result=s.return_goods(c,id,{'reason':'换货','lines':[{'fulfillment_id':fid,'qty':1}],'exchange':{'lines':[{'sku_id':1,'qty':1,'price':2500}]},'settlement_channels':[{'channel':'微信','amount':500}]})
        assert row(c,'orders',result['exchange_order_id'])['state']=='completed'
        p=q.balances(c,row(c,'orders',id)['party_id']);assert p['outstanding']==p['advance']==0
        assert c.execute('SELECT SUM(amount) FROM funds').fetchone()[0]==2500

def test_expenses_in_unified_actual_cash_ledger(setup):
    with setup['db'].transaction() as c:
        s.fund(c,{'party_id':1,'channels':[{'channel':'现金','amount':5000}]})
        eid=s.expense(c,{'category':'租金','amount':1000,'business_date':'2026-01-01','channel':'现金'})['id']
        items=[dict(r) for r in c.execute('SELECT * FROM cash_ledger ORDER BY created_at')]
        assert len(items)==2 and sum(r['cash_amount'] for r in items)==4000
        assert items[1]['created_at'][:10]==s.now()[:10]
        s.reverse_expense(c,eid,{'reason':'误记'})
        assert c.execute('SELECT SUM(cash_amount) FROM cash_ledger').fetchone()[0]==5000
