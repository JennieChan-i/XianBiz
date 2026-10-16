import time
from backend import service as s,queries as q
from backend.db import insert,now

def test_1000_skus_10000_orders(db):
    with db.transaction() as c:
        s.party(c,{'name':'压力测试客户','kind':'customer'})
        s.product(c,{'code':'LOAD','name':'隔离压力商品','price':2000,'skus':[{'color':f'C{i}','size':'M','stock':100,'cost':1000} for i in range(1000)]})
        timestamp=now()
        c.executemany("INSERT INTO orders(number,kind,party_id,state,created_at,confirmed_at) VALUES(?,'sale',1,'confirmed',?,?)",[(f'T{i}',timestamp,timestamp) for i in range(10000)])
        c.executemany("INSERT INTO order_lines(order_id,sku_id,description,qty,price) VALUES(?,?,'压力',1,2000)",[(i+1,i%1000+1) for i in range(10000)])
        c.execute("UPDATE orders SET state='completed'")
        c.execute('UPDATE order_lines SET fulfilled=1')
        c.executemany('INSERT INTO fulfillments(order_id,line_id,qty,amount,cost,created_at) VALUES(?,?,1,2000,1000,?)',[(i+1,i+1,timestamp) for i in range(10000)])
        c.executemany("INSERT INTO debts(party_id,order_id,fulfillment_id,amount,source,created_at) VALUES(1,?,?,2000,'压力',?)",[(i+1,i+1,timestamp) for i in range(10000)])
        c.executemany("INSERT INTO profit_ledger(kind,amount,source,order_id,created_at) VALUES('revenue',2000,'压力',?,?)",[(i+1,timestamp) for i in range(10000)])
        c.executemany("INSERT INTO profit_ledger(kind,amount,source,order_id,created_at) VALUES('sale_cost',-1000,'压力',?,?)",[(i+1,timestamp) for i in range(10000)])
        c.execute('UPDATE skus SET stock=90,value=90000')
    with db.connect() as c:
        times={}
        for name,fn in [('orders',lambda:q.orders(c)),('skus',lambda:q.skus(c)),('dashboard',lambda:q.dashboard(c)),('report',lambda:q.report(c))]:
            start=time.perf_counter();result=fn();times[name]=time.perf_counter()-start
            assert times[name]<3.0, (name,times[name])
        assert q.orders(c)['total']==10000 and q.skus(c)['total']==1000
        print('PERFORMANCE_SECONDS',times)
