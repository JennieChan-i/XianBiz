import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import pytest
from backend.db import Database
from backend import service as s

@pytest.fixture
def db(tmp_path): return Database(tmp_path/'data')

@pytest.fixture
def setup(db):
    with db.transaction() as c:
        s.save_settings(c,{'shop_name':'隔离测试','start_date':'2026-10-16'})
        p=s.product(c,{'code':'P01','name':'测试服装','price':2000,'skus':[{'color':'黑','size':'M','stock':10,'cost':1000}]})
        a=s.party(c,{'kind':'customer','name':'客户A'})['id']
        b=s.party(c,{'kind':'customer','name':'客户B'})['id']
        sup=s.party(c,{'kind':'supplier','name':'供应商'})['id']
    return {'db':db,'sku':1,'a':a,'b':b,'sup':sup}

def order(c,kind='sale',party=1,qty=1,price=2000,direct=False,sku=1,**kw):
    return s.make_order(c,{'kind':kind,'party_id':party,'lines':[{'sku_id':sku,'qty':qty,'price':price}], 'direct':direct,**kw})['id']
