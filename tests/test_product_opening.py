import io
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from backend import service as s, files
from backend.app import create_app
from backend.db import BusinessError, row
from conftest import order


@pytest.mark.parametrize('value',[None,'',-1,1.5,True])
def test_new_sku_requires_explicit_nonnegative_integer_stock(db,value):
    with pytest.raises(BusinessError):
        db.command('invalid-opening-'+str(value),{'stock':value},lambda c:s.product(c,{'code':'X','name':'X','price':100,'skus':[{'color':'黑','size':'M','stock':value}]}))
    with db.connect() as c:
        assert c.execute('SELECT COUNT(*) FROM products').fetchone()[0]==0
        assert c.execute('SELECT COUNT(*) FROM inventory_ledger').fetchone()[0]==0


def test_missing_stock_is_not_silently_zero(db):
    with pytest.raises(BusinessError,match='请填写期初件数'):
        db.command('missing-opening-stock',{},lambda c:s.product(c,{'code':'X','name':'X','skus':[{'color':'黑','size':'M'}]}))


def test_explicit_zero_stock_is_valid_and_correctable(db):
    with db.transaction() as c:
        s.product(c,{'code':'X','name':'X','skus':[{'color':'黑','size':'M','stock':0}]})
        sku=row(c,'skus',1)
        assert sku['stock']==0 and s.opening_editable(c,1)
        s.correct_opening(c,1,{'qty':3,'cost':500,'reason':'补录期初','expected_stock':0,'expected_value':0,'expected_cost':0})
        assert row(c,'skus',1)['stock']==3 and row(c,'skus',1)['value']==1500


def correction(c,**overrides):
    sku=row(c,'skus',1)
    return {'qty':8,'cost':1200,'reason':'期初件数和成本录错','expected_stock':sku['stock'],'expected_value':sku['value'],'expected_cost':sku['avg_cost'],**overrides}


def test_opening_correction_appends_exact_difference_without_profit(setup):
    with setup['db'].transaction() as c:
        original=dict(c.execute('SELECT * FROM inventory_ledger').fetchone())
        result=s.correct_opening(c,1,correction(c))
        assert (result['stock'],result['value'],result['avg_cost'])==(8,9600,1200)
        assert dict(c.execute('SELECT * FROM inventory_ledger WHERE id=1').fetchone())==original
        last=dict(c.execute('SELECT * FROM inventory_ledger ORDER BY id DESC LIMIT 1').fetchone())
        assert (last['kind'],last['qty'],last['amount'])==('opening_correction',-2,-400)
        assert c.execute('SELECT COUNT(*) FROM profit_ledger').fetchone()[0]==0
        assert c.execute("SELECT COUNT(*) FROM history WHERE entity='sku' AND action='期初更正'").fetchone()[0]==1
        assert s.opening_editable(c,1)
        s.correct_opening(c,1,correction(c,qty=0,cost=0))
        assert row(c,'skus',1)['value']==0


@pytest.mark.parametrize('activity',['reservation','purchase_order','fulfillment','count'])
def test_opening_correction_blocks_subsequent_business(setup,activity):
    db=setup['db']
    with db.transaction() as c:
        payload=correction(c)
        if activity=='reservation': order(c,qty=2)
        elif activity=='purchase_order': order(c,kind='purchase',party=3,qty=2,price=1000)
        elif activity=='fulfillment': order(c,qty=2,direct=True)
        else:
            st=s.create_stocktake(c,{})['id']
            s.count_stock(c,st,{'items':[{'sku_id':1,'count':9}]})
        expected=row(c,'skus',1)
        assert not s.opening_editable(c,1)
    with pytest.raises(BusinessError,match='后续业务'):
        db.command('opening-after-'+activity,payload,lambda c:s.correct_opening(c,1,payload))
    with db.connect() as c: assert row(c,'skus',1)==expected


def test_opening_allows_unconfirmed_draft_but_rejects_stale_snapshot(setup):
    with setup['db'].transaction() as c:
        order(c,qty=2,draft=True)
        assert s.opening_editable(c,1)
        stale=correction(c)
        s.correct_opening(c,1,correction(c,qty=9))
        with pytest.raises(BusinessError,match='已变化'): s.correct_opening(c,1,stale)
        with pytest.raises(BusinessError,match='原因'): s.correct_opening(c,1,correction(c,reason=' '))


def test_opening_endpoint_idempotent_and_eligibility_visible(tmp_path):
    client=TestClient(create_app(tmp_path/'api'),base_url='http://127.0.0.1:8001')
    token=client.get('/api/session').json()['token']
    h={'X-XianBiz-Token':token,'X-Operation-Id':'create-opening-api'}
    p={'code':'X','name':'X','price':1000,'skus':[{'color':'黑','size':'M','stock':5,'cost':300}]}
    assert client.post('/api/products',json=p,headers=h).status_code==200
    sku=client.get('/api/products/1').json()['skus'][0]
    assert sku['opening_editable'] is True
    payload={'qty':7,'cost':400,'reason':'更正','expected_stock':5,'expected_value':1500,'expected_cost':300}
    h['X-Operation-Id']='correct-opening-api'
    a=client.post('/api/skus/1/opening',json=payload,headers=h)
    b=client.post('/api/skus/1/opening',json=payload,headers=h)
    assert a.status_code==b.status_code==200 and a.json()==b.json()
    assert a.json()['stock']==7 and a.json()['value']==2800


def test_excel_blank_initial_stock_rejected(db):
    wb=load_workbook(io.BytesIO(files.template('products')))
    wb.worksheets[0].append(['X','服装','黑','M','',1000,None,300,5,'','',''])
    with db.transaction() as c:
        preview=files.preview_import(c,'products',files.excel_bytes(wb))
        assert len(preview['errors'])==1 and '期初件数为必填' in preview['errors'][0]['error']
