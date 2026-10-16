CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts(kind TEXT PRIMARY KEY CHECK(kind IN('sale','purchase')),payload TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS refund_allocations(id INTEGER PRIMARY KEY,fund_id INTEGER NOT NULL REFERENCES funds(id),credit_id INTEGER NOT NULL REFERENCES credits(id),amount INTEGER NOT NULL CHECK(amount>0));
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
 category TEXT NOT NULL DEFAULT '',brand TEXT NOT NULL DEFAULT '',season TEXT NOT NULL DEFAULT '',
 price INTEGER NOT NULL CHECK(price>=0), active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS skus(
 id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),color TEXT NOT NULL,size TEXT NOT NULL,
 barcode TEXT UNIQUE,stock INTEGER NOT NULL DEFAULT 0,value INTEGER NOT NULL DEFAULT 0 CHECK(value>=0),
 avg_cost INTEGER NOT NULL DEFAULT 0 CHECK(avg_cost>=0),cost_known INTEGER NOT NULL DEFAULT 0,
 threshold INTEGER NOT NULL DEFAULT 5 CHECK(threshold>=0),active INTEGER NOT NULL DEFAULT 1,
 UNIQUE(product_id,color,size),CHECK(stock>0 OR value=0)
);
CREATE TABLE IF NOT EXISTS images(id INTEGER PRIMARY KEY,product_id INTEGER NOT NULL REFERENCES products(id),filename TEXT NOT NULL UNIQUE,thumbnail TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS parties(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN('customer','supplier')),name TEXT NOT NULL,phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',active INTEGER NOT NULL DEFAULT 1,UNIQUE(kind,name));
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('sale','purchase')),
 party_id INTEGER REFERENCES parties(id),state TEXT NOT NULL,remaining_terminated INTEGER NOT NULL DEFAULT 0,
 note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS order_lines(
 id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),sku_id INTEGER NOT NULL REFERENCES skus(id),
 description TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),price INTEGER NOT NULL CHECK(price>=0),
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),fulfilled INTEGER NOT NULL DEFAULT 0 CHECK(fulfilled>=0),
 returned INTEGER NOT NULL DEFAULT 0 CHECK(returned>=0),terminated INTEGER NOT NULL DEFAULT 0 CHECK(terminated>=0),
 CHECK(fulfilled+terminated<=qty),CHECK(returned<=fulfilled),CHECK(reserved<=qty-fulfilled-terminated)
);
CREATE TABLE IF NOT EXISTS fulfillments(
 id INTEGER PRIMARY KEY,order_id INTEGER NOT NULL REFERENCES orders(id),line_id INTEGER NOT NULL REFERENCES order_lines(id),
 qty INTEGER NOT NULL CHECK(qty>0),amount INTEGER NOT NULL CHECK(amount>=0),cost INTEGER NOT NULL,
 returned INTEGER NOT NULL DEFAULT 0 CHECK(returned>=0),created_at TEXT NOT NULL,CHECK(returned<=qty)
);
CREATE TABLE IF NOT EXISTS negative_lots(
 id INTEGER PRIMARY KEY,sku_id INTEGER NOT NULL REFERENCES skus(id),fulfillment_id INTEGER NOT NULL REFERENCES fulfillments(id),
 qty INTEGER NOT NULL CHECK(qty>0),remaining INTEGER NOT NULL CHECK(remaining>=0),estimate INTEGER NOT NULL CHECK(estimate>=0)
);
CREATE TABLE IF NOT EXISTS cost_adjustments(id INTEGER PRIMARY KEY,fulfillment_id INTEGER NOT NULL REFERENCES fulfillments(id),source TEXT NOT NULL,qty INTEGER NOT NULL,amount INTEGER NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_shortages(id INTEGER PRIMARY KEY,sku_id INTEGER NOT NULL REFERENCES skus(id),qty INTEGER NOT NULL CHECK(qty>0),remaining INTEGER NOT NULL CHECK(remaining>=0),estimate INTEGER NOT NULL CHECK(estimate>=0),source TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inventory_ledger(
 id INTEGER PRIMARY KEY,sku_id INTEGER NOT NULL REFERENCES skus(id),qty INTEGER NOT NULL,amount INTEGER NOT NULL,
 stock_after INTEGER NOT NULL,kind TEXT NOT NULL,source TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reservation_events(id INTEGER PRIMARY KEY,line_id INTEGER NOT NULL REFERENCES order_lines(id),qty INTEGER NOT NULL,source TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS debts(
 id INTEGER PRIMARY KEY,party_id INTEGER NOT NULL REFERENCES parties(id),order_id INTEGER REFERENCES orders(id),
 fulfillment_id INTEGER REFERENCES fulfillments(id),amount INTEGER NOT NULL CHECK(amount>=0),source TEXT NOT NULL,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS funds(
 id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,party_id INTEGER NOT NULL REFERENCES parties(id),order_id INTEGER REFERENCES orders(id),
 amount INTEGER NOT NULL CHECK(amount!=0),note TEXT NOT NULL DEFAULT '',reversal_of INTEGER UNIQUE REFERENCES funds(id),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fund_channels(id INTEGER PRIMARY KEY,fund_id INTEGER NOT NULL REFERENCES funds(id),channel TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0));
CREATE TABLE IF NOT EXISTS credits(
 id INTEGER PRIMARY KEY,party_id INTEGER NOT NULL REFERENCES parties(id),order_id INTEGER REFERENCES orders(id),
 fund_id INTEGER REFERENCES funds(id),amount INTEGER NOT NULL CHECK(amount>=0),refunded INTEGER NOT NULL DEFAULT 0 CHECK(refunded>=0),
 source TEXT NOT NULL,created_at TEXT NOT NULL,CHECK(refunded<=amount)
);
CREATE TABLE IF NOT EXISTS allocations(id INTEGER PRIMARY KEY,credit_id INTEGER NOT NULL REFERENCES credits(id),debt_id INTEGER NOT NULL REFERENCES debts(id),amount INTEGER NOT NULL CHECK(amount>0),kind TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS returns(
 id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,order_id INTEGER NOT NULL REFERENCES orders(id),fulfillment_id INTEGER NOT NULL REFERENCES fulfillments(id),
 qty INTEGER NOT NULL CHECK(qty>0),amount INTEGER NOT NULL CHECK(amount>=0),cost INTEGER NOT NULL,sellable INTEGER NOT NULL,
 reason TEXT NOT NULL,exchange_order_id INTEGER REFERENCES orders(id),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses(id INTEGER PRIMARY KEY,category TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),business_date TEXT NOT NULL,channel TEXT NOT NULL,note TEXT NOT NULL DEFAULT '',reversal_of INTEGER UNIQUE REFERENCES expenses(id),is_reversal INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profit_ledger(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,amount INTEGER NOT NULL,source TEXT NOT NULL,order_id INTEGER REFERENCES orders(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS stocktakes(id INTEGER PRIMARY KEY,number TEXT NOT NULL UNIQUE,state TEXT NOT NULL CHECK(state IN('open','confirmed')),note TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,confirmed_at TEXT);
CREATE TABLE IF NOT EXISTS stocktake_items(id INTEGER PRIMARY KEY,stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id),sku_id INTEGER NOT NULL REFERENCES skus(id),count INTEGER NOT NULL CHECK(count>=0),baseline INTEGER NOT NULL,ledger_id INTEGER NOT NULL,counted_at TEXT NOT NULL,UNIQUE(stocktake_id,sku_id));
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,entity TEXT NOT NULL,entity_id INTEGER NOT NULL,action TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations(key TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_jobs(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,errors TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_lines_sku ON order_lines(sku_id,reserved);
CREATE INDEX IF NOT EXISTS idx_order_kind ON orders(kind,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_party ON orders(party_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_line ON fulfillments(line_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_order ON fulfillments(order_id);
CREATE INDEX IF NOT EXISTS idx_debt_party ON debts(party_id);
CREATE INDEX IF NOT EXISTS idx_debt_order ON debts(order_id);
CREATE INDEX IF NOT EXISTS idx_credit_party ON credits(party_id);
CREATE INDEX IF NOT EXISTS idx_credit_order ON credits(order_id);
CREATE INDEX IF NOT EXISTS idx_funds_order ON funds(order_id);
CREATE INDEX IF NOT EXISTS idx_order_page ON orders(kind,id DESC);
CREATE INDEX IF NOT EXISTS idx_alloc_debt ON allocations(debt_id);
CREATE INDEX IF NOT EXISTS idx_alloc_credit ON allocations(credit_id);
CREATE INDEX IF NOT EXISTS idx_inv_sku ON inventory_ledger(sku_id,id);
CREATE INDEX IF NOT EXISTS idx_profit_date ON profit_ledger(created_at,kind);
CREATE INDEX IF NOT EXISTS idx_lots_sku ON negative_lots(sku_id,remaining);
CREATE INDEX IF NOT EXISTS idx_inventory_shortages ON inventory_shortages(sku_id,remaining);
CREATE INDEX IF NOT EXISTS idx_return_fulfill ON returns(fulfillment_id);
CREATE VIEW IF NOT EXISTS cash_ledger AS
 SELECT 'fund:'||f.id row_key,'fund' record_type,f.id,f.number,f.party_id,f.order_id,f.amount,f.note,f.reversal_of,f.created_at,
 CASE WHEN p.name='__anonymous__' THEN '散客' ELSE p.name END party_name,p.kind,
 (SELECT GROUP_CONCAT(channel||':'||amount,' / ') FROM fund_channels fc WHERE fc.fund_id=f.id) channels,
 CASE WHEN (p.kind='customer' AND f.amount>0) OR (p.kind='supplier' AND f.amount<0) THEN ABS(f.amount) ELSE -ABS(f.amount) END cash_amount
 FROM funds f JOIN parties p ON p.id=f.party_id
 UNION ALL
 SELECT 'expense:'||e.id,'expense',e.id,'FY-'||printf('%06d',e.id),NULL,NULL,
 CASE WHEN e.is_reversal=1 THEN -e.amount ELSE e.amount END,e.note,e.reversal_of,e.created_at,
 e.category,'expense',e.channel||':'||e.amount,
 CASE WHEN e.is_reversal=1 THEN e.amount ELSE -e.amount END FROM expenses e;
