"""Reproducible mixed-operation scenarios verify conservation of inventory value."""
import random
import pytest
from backend import service as s, queries as q
from backend.db import row
from conftest import order

@pytest.mark.parametrize('seed',range(6))
def test_mixed_negative_cost_and_returns_conserve_value(setup,seed):
    rng=random.Random(seed); db=setup['db']; acquisitions=10000; purchase_returns=0
    with db.transaction() as c:
        for step in range(45):
            action=rng.choice(['sale','sale','purchase','return','return','scrap'])
            if action=='sale':
                order(c,qty=rng.randint(1,7),direct=True,force=True,reason='隔离随机场景')
            elif action=='purchase':
                qty=rng.randint(1,9); cost=rng.randint(600,1800)
                order(c,kind='purchase',party=3,qty=qty,price=cost,direct=True)
                acquisitions+=qty*cost
            elif action=='return':
                candidates=c.execute("SELECT f.* FROM fulfillments f JOIN orders o ON o.id=f.order_id WHERE o.kind='sale' AND f.qty>f.returned").fetchall()
                if candidates:
                    f=rng.choice(candidates); n=rng.randint(1,f['qty']-f['returned'])
                    s.return_goods(c,f['order_id'],{'reason':'隔离退货','lines':[{'fulfillment_id':f['id'],'qty':n,'sellable':rng.choice([True,False])}]})
            elif action=='scrap' and s.available(c,1)>0:
                s.scrap(c,{'sku_id':1,'qty':1,'reason':'隔离损耗'})
            stock=row(c,'skus',1); r=q.report(c)
            accounted=stock['value']+r['original_cost']+r['cost_adjustment']-r['inventory_profit']
            estimated_liability=c.execute('SELECT COALESCE(SUM(remaining*estimate),0) FROM negative_lots').fetchone()[0]
            assert accounted==acquisitions-purchase_returns+estimated_liability,(seed,step,action,stock,r['original_cost'],r['cost_adjustment'],r['inventory_profit'],accounted,acquisitions,estimated_liability)
            unsettled=c.execute('SELECT COALESCE(SUM(remaining),0) FROM negative_lots').fetchone()[0]
            assert unsettled==max(0,-stock['stock'])
