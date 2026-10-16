import pytest
from fastapi.testclient import TestClient
from backend import service as s
from backend.app import create_app
from backend.db import BusinessError, row


def catalogue(**overrides):
    return {'code':'NEW01','name':'首次进货商品','price':8000,'inventory_mode':'catalogue',
            'skus':[{'color':'黑','size':'M'},{'color':'白','size':'L'}],**overrides}


def test_catalogue_has_no_opening_stock_cost_debt_or_cash(db):
    with db.transaction() as c:
        result=s.product(c,catalogue())
        assert len(result['skus'])==2
        for sku in result['skus']:
            assert sku['code']=='NEW01' and sku['name']=='首次进货商品'
            assert (sku['stock'],sku['value'],sku['avg_cost'],sku['cost_known'],sku['available'])==(0,0,0,0,0)
        for table in ('inventory_ledger','debts','funds','orders'):
            assert c.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]==0


@pytest.mark.parametrize('sku',[{'stock':3},{'cost':1000}])
def test_catalogue_rejects_accidental_opening_stock_and_cost(db,sku):
    with pytest.raises(BusinessError,match='普通建档不能录入'):
        with db.transaction() as c:
            s.product(c,catalogue(skus=[{'color':'黑','size':'M',**sku}]))
    with db.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM products').fetchone()[0]==0


def test_catalogue_new_variant_preserves_existing_stock_and_cost(setup):
    with setup['db'].transaction() as c:
        before=row(c,'skus',1)
        result=s.product(c,{'code':'P01','name':'测试服装','inventory_mode':'catalogue',
                            'skus':[{'color':'黑','size':'M','stock':0,'cost':0},{'color':'白','size':'M'}]},1)
        after=row(c,'skus',1)
        assert (after['stock'],after['value'],after['avg_cost'])==(before['stock'],before['value'],before['avg_cost'])
        assert result['skus'][1]['stock']==0
        assert c.execute('SELECT COUNT(*) FROM inventory_ledger').fetchone()[0]==1


def test_first_purchase_then_restock_records_only_received_units(db):
    with db.transaction() as c:
        sku=s.product(c,catalogue())['skus'][0]
        supplier=s.party(c,{'kind':'supplier','name':'供货商甲'})['id']
        payload={'kind':'purchase','party_id':supplier,'lines':[{'sku_id':sku['id'],'qty':10,'price':3000}],'direct':False}
        oid=s.make_order(c,payload)['id']
        assert row(c,'skus',sku['id'])['stock']==0
        assert c.execute('SELECT COUNT(*) FROM debts').fetchone()[0]==0
        line=c.execute('SELECT id FROM order_lines WHERE order_id=?',(oid,)).fetchone()[0]
        s.fulfill(c,oid,{'lines':[{'line_id':line,'qty':4}]})
        assert row(c,'skus',sku['id'])['stock']==4
        s.fulfill(c,oid,{'lines':[{'line_id':line,'qty':6}]})
        s.make_order(c,{**payload,'direct':True,'lines':[{'sku_id':sku['id'],'qty':5,'price':3600}]})
        current=row(c,'skus',sku['id'])
        assert (current['stock'],current['value'],current['avg_cost'])==(15,48000,3200)
        assert c.execute('SELECT COUNT(*) FROM products').fetchone()[0]==1
        assert c.execute("SELECT COUNT(*) FROM inventory_ledger WHERE kind='opening'").fetchone()[0]==0
        assert c.execute("SELECT SUM(qty) FROM inventory_ledger WHERE kind='purchase'").fetchone()[0]==15
        assert c.execute('SELECT SUM(amount) FROM debts').fetchone()[0]==48000
        assert c.execute('SELECT COUNT(*) FROM funds').fetchone()[0]==0


def test_catalogue_and_direct_purchase_api_are_idempotent(tmp_path):
    client=TestClient(create_app(tmp_path/'api'),base_url='http://127.0.0.1:8001')
    h={'X-XianBiz-Token':client.get('/api/session').json()['token'],'X-Operation-Id':'new-catalogue'}
    a=client.post('/api/products',json=catalogue(),headers=h)
    b=client.post('/api/products',json=catalogue(),headers=h)
    assert a.status_code==b.status_code==200 and a.json()==b.json()
    sku=a.json()['skus'][0]
    h['X-Operation-Id']='supplier'
    supplier=client.post('/api/parties',json={'kind':'supplier','name':'新供应商'},headers=h).json()['id']
    h['X-Operation-Id']='first-receipt'
    payload={'kind':'purchase','party_id':supplier,'direct':True,'lines':[{'sku_id':sku['id'],'qty':10,'price':3000}]}
    a=client.post('/api/orders',json=payload,headers=h)
    b=client.post('/api/orders',json=payload,headers=h)
    assert a.status_code==b.status_code==200 and a.json()==b.json()
    skus=client.get('/api/products/1').json()['skus']
    assert [r['stock'] for r in skus]==[10,0]
    assert skus[0]['value']==30000 and skus[0]['opening_editable'] is False


def test_explicit_opening_mode_still_requires_quantity(db):
    with pytest.raises(BusinessError,match='请填写期初件数'):
        with db.transaction() as c: s.product(c,catalogue(inventory_mode='opening'))
    with db.transaction() as c:
        result=s.product(c,catalogue(inventory_mode='opening',skus=[{'color':'黑','size':'M','stock':7,'cost':3000}]))
        assert result['skus'][0]['stock']==7
        assert c.execute("SELECT SUM(qty) FROM inventory_ledger WHERE kind='opening'").fetchone()[0]==7
