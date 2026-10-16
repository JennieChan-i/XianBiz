import json
import logging
import secrets
import sqlite3
import re
from pathlib import Path
from urllib.parse import urlsplit
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from .db import Database, BusinessError, encode, history, integer, require, row
from . import service as s, queries as q, files

ROOT=Path(__file__).resolve().parents[1]

def create_app(data_dir=None):
    db=Database(data_dir)
    app=FastAPI(title='XianBiz 本地经营服务',docs_url=None,redoc_url=None,openapi_url=None)
    app.state.db=db; app.state.token=secrets.token_urlsafe(32); app.state.shutdown=None

    @app.middleware('http')
    async def local_guard(request,call_next):
        host=request.headers.get('host','')
        if not re.fullmatch(r'127\.0\.0\.1(?::\d{1,5})?',host): return JSONResponse({'error':'仅允许本机回环访问','code':403},403)
        origin=request.headers.get('origin')
        if origin and origin!='http://'+host: return JSONResponse({'error':'请求来源不匹配','code':403},403)
        if request.headers.get('sec-fetch-site')=='cross-site': return JSONResponse({'error':'拒绝跨站请求','code':403},403)
        if request.method not in ('GET','HEAD','OPTIONS'):
            token=request.headers.get('x-xianbiz-token','')
            if not secrets.compare_digest(token,app.state.token): return JSONResponse({'error':'页面已失效，请刷新后重试','code':403},403)
        response=await call_next(request)
        response.headers.update({'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
        if request.url.path.startswith('/api/'): response.headers['Cache-Control']='no-store'
        return response

    @app.exception_handler(BusinessError)
    async def business_error(request,error): return JSONResponse({'error':error.message,'code':error.code},error.code)

    @app.exception_handler(sqlite3.IntegrityError)
    async def integrity_error(request,error):
        logging.warning('Integrity check failed: %s',error)
        return JSONResponse({'error':'资料重复、关联不正确或数量约束冲突；本次操作已全部回滚','code':409},409)

    @app.exception_handler(Exception)
    async def unexpected(request,error):
        logging.exception('请求处理失败',exc_info=error)
        return JSONResponse({'error':'操作未完成，请保留输入并重试。详细错误已写入本地日志。','code':500},500)

    def command(request,payload,callback):
        return db.command(request.headers.get('x-operation-id'),{'path':request.url.path,'body':payload},callback)

    @app.get('/api/session')
    def session():
        with db.connect() as conn:
            return {'token':app.state.token,'settings':s.settings(conn),'version':'1.0.0','data_dir':str(db.directory)}

    @app.get('/api/health')
    def health(): return {'status':'ok','app':'XianBiz','version':'1.0.0'}

    @app.get('/api/settings')
    def read_settings():
        with db.connect() as conn: return s.settings(conn)

    @app.put('/api/settings')
    def write_settings(request:Request,p:dict): return command(request,p,lambda c:s.save_settings(c,p))

    @app.get('/api/drafts/{kind}')
    def read_draft(kind:str):
        require(kind in ('sale','purchase'),'草稿类型无效')
        with db.connect() as conn:
            r=conn.execute('SELECT payload FROM drafts WHERE kind=?',(kind,)).fetchone()
            return json.loads(r['payload']) if r else {}

    @app.put('/api/drafts/{kind}')
    def save_draft(kind:str,request:Request,p:dict):
        require(kind in ('sale','purchase'),'草稿类型无效')
        require(len(encode(p))<=2_000_000,'暂存内容过大')
        def apply(c):
            c.execute('INSERT INTO drafts VALUES(?,?,?) ON CONFLICT(kind) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',(kind,encode(p),s.now()))
            return {'saved':True}
        return command(request,p,apply)

    @app.get('/api/dashboard')
    def dashboard():
        with db.connect() as conn: return q.dashboard(conn)

    @app.get('/api/skus')
    def skus(qs:str='',q:str='',page:int=1,page_size:int=30,alert:str='',sort:str='code',direction:str='asc'):
        with db.connect() as conn: return globals()['q'].skus(conn,q or qs,page,page_size,alert,sort,direction)

    @app.get('/api/products')
    def products(qs:str='',page:int=1,page_size:int=30):
        with db.connect() as conn:
            return q.paginate(conn,"SELECT p.*,(SELECT COUNT(*) FROM skus s WHERE s.product_id=p.id) sku_count,(SELECT SUM(stock) FROM skus s WHERE s.product_id=p.id) stock,(SELECT filename FROM images i WHERE i.product_id=p.id ORDER BY position,id LIMIT 1) image FROM products p WHERE code LIKE ? OR name LIKE ?",(f'%{qs}%',f'%{qs}%'),page,page_size,'p.id DESC')

    @app.get('/api/products/{id}')
    def get_product(id:int):
        with db.connect() as conn:
            p=row(conn,'products',id)
            p['skus']=q.records(conn,'SELECT * FROM skus WHERE product_id=? ORDER BY id',(id,))
            for sku in p['skus']: sku['opening_editable']=s.opening_editable(conn,sku['id'])
            p['images']=q.records(conn,'SELECT * FROM images WHERE product_id=? ORDER BY position,id',(id,))
            return p

    @app.post('/api/products')
    def create_product(request:Request,p:dict): return command(request,p,lambda c:s.product(c,p))

    @app.put('/api/products/{id}')
    def update_product(id:int,request:Request,p:dict): return command(request,p,lambda c:s.product(c,p,id))

    @app.post('/api/skus/{id}/opening')
    def correct_opening(id:int,request:Request,p:dict): return command(request,p,lambda c:s.correct_opening(c,id,p))

    @app.post('/api/products/{id}/images')
    async def upload_image(id:int,file:UploadFile=File(...)):
        content=await file.read(15*1024*1024+1)
        return files.save_image(db,id,content)

    @app.post('/api/images/{id}/primary')
    def primary_image(id:int,request:Request,p:dict):
        def apply(c):
            image=row(c,'images',id)
            c.execute('UPDATE images SET position=position+1 WHERE product_id=?',(image['product_id'],))
            c.execute('UPDATE images SET position=0 WHERE id=?',(id,))
            return {'id':id}
        return command(request,p,apply)

    @app.get('/api/parties')
    def parties(kind:str='customer',qs:str='',page:int=1,page_size:int=30):
        with db.connect() as conn: return q.parties(conn,kind,qs,page,page_size)

    @app.get('/api/parties/{id}')
    def get_party(id:int):
        with db.connect() as conn: return q.balances(conn,id)

    @app.post('/api/parties')
    def create_party(request:Request,p:dict): return command(request,p,lambda c:s.party(c,p))

    @app.put('/api/parties/{id}')
    def update_party(id:int,request:Request,p:dict): return command(request,p,lambda c:s.party(c,p,id))

    @app.get('/api/orders')
    def orders(kind:str='sale',qs:str='',state:str='',start:str='',end:str='',party_id:int|None=None,page:int=1,page_size:int=30):
        with db.connect() as conn: return q.orders(conn,kind,qs,state,start,end,party_id,page,page_size)

    @app.get('/api/orders/{id}')
    def order_detail(id:int):
        with db.connect() as conn: return s.order_detail(conn,id)

    @app.put('/api/orders/{id}')
    def update_draft(id:int,request:Request,p:dict): return command(request,p,lambda c:s.update_draft(c,id,p))

    @app.post('/api/orders')
    def new_order(request:Request,p:dict): return command(request,p,lambda c:s.make_order(c,p))

    @app.post('/api/orders/{id}/{action}')
    def order_action(id:int,action:str,request:Request,p:dict):
        actions={'confirm':s.confirm_draft,'fulfill':s.fulfill,'terminate':s.terminate,'reserve':s.manual_reserve,'returns':s.return_goods,'reverse':s.reverse_order}
        require(action in actions,'不支持的订单操作',404)
        return command(request,p,lambda c:actions[action](c,id,p))

    @app.get('/api/funds')
    def funds(kind:str='',start:str='',end:str='',page:int=1,page_size:int=30):
        filters=['1=1']; args=[]
        if kind: filters.append('f.kind=?'); args.append(kind)
        if start: filters.append('substr(f.created_at,1,10)>=?'); args.append(start)
        if end: filters.append('substr(f.created_at,1,10)<=?'); args.append(end)
        with db.connect() as conn:
            return q.paginate(conn,'SELECT f.* FROM cash_ledger f WHERE '+' AND '.join(filters),args,page,page_size,'f.created_at DESC,f.row_key DESC')

    @app.post('/api/funds')
    def add_fund(request:Request,p:dict): return command(request,p,lambda c:s.fund(c,p))

    @app.post('/api/funds/{id}/reverse')
    def reverse_fund(id:int,request:Request,p:dict): return command(request,p,lambda c:s.reverse_fund(c,id,p))

    @app.post('/api/allocations')
    def allocate(request:Request,p:dict): return command(request,p,lambda c:s.allocations(c,p))

    @app.get('/api/expenses')
    def expenses(start:str='',end:str='',page:int=1,page_size:int=30):
        with db.connect() as conn:
            return q.paginate(conn,"SELECT * FROM expenses WHERE business_date BETWEEN ? AND ?",(start or '0001-01-01',end or '9999-12-31'),page,page_size)

    @app.post('/api/expenses')
    def add_expense(request:Request,p:dict): return command(request,p,lambda c:s.expense(c,p))

    @app.post('/api/expenses/{id}/reverse')
    def reverse_expense(id:int,request:Request,p:dict): return command(request,p,lambda c:s.reverse_expense(c,id,p))

    @app.get('/api/inventory/ledger')
    def ledger(sku_id:int|None=None,page:int=1,page_size:int=30):
        with db.connect() as conn:
            return q.paginate(conn,'SELECT l.*,p.code,p.name,s.color,s.size FROM inventory_ledger l JOIN skus s ON s.id=l.sku_id JOIN products p ON p.id=s.product_id'+(' WHERE sku_id=?' if sku_id else ''),(sku_id,) if sku_id else (),page,page_size,'l.id DESC')

    @app.post('/api/inventory/scrap')
    def scrap(request:Request,p:dict): return command(request,p,lambda c:s.scrap(c,p))

    @app.get('/api/stocktakes')
    def stocktakes(page:int=1,page_size:int=30):
        with db.connect() as conn: return q.paginate(conn,'SELECT * FROM stocktakes',(),page,page_size)

    @app.get('/api/stocktakes/{id}')
    def stocktake(id:int):
        with db.connect() as conn:
            st=row(conn,'stocktakes',id)
            st['items']=q.records(conn,'SELECT i.*,p.code,p.name,s.color,s.size,s.stock current_stock,s.avg_cost,s.cost_known FROM stocktake_items i JOIN skus s ON s.id=i.sku_id JOIN products p ON p.id=s.product_id WHERE stocktake_id=?',(id,))
            return st

    @app.post('/api/stocktakes')
    def new_stocktake(request:Request,p:dict): return command(request,p,lambda c:s.create_stocktake(c,p))

    @app.post('/api/stocktakes/{id}/{action}')
    def stocktake_action(id:int,action:str,request:Request,p:dict):
        actions={'count':s.count_stock,'confirm':s.confirm_stocktake}; require(action in actions,'盘点操作无效')
        return command(request,p,lambda c:actions[action](c,id,p))

    @app.get('/api/reports')
    def reports(start:str='',end:str=''):
        with db.connect() as conn: return q.report(conn,start,end)

    def download(content,name,media):
        return Response(content,media_type=media,headers={'Content-Disposition':f'attachment; filename="{name}"'})

    @app.get('/api/export')
    def export(start:str='',end:str='',report:bool=False):
        with db.lock,db.connect() as conn:
            data=files.export_report(conn,start,end) if report else files.export_all(conn)
        return download(data,'XianBiz.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    @app.get('/api/import/template/{kind}')
    def template(kind:str): return download(files.template(kind),'XianBiz_'+kind+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    @app.post('/api/import/preview/{kind}')
    async def import_preview(kind:str,file:UploadFile=File(...)):
        content=await file.read(15*1024*1024+1)
        with db.transaction() as conn: return files.preview_import(conn,kind,content)

    @app.post('/api/import/{id}/apply')
    def apply_import(id:str,request:Request,p:dict): return command(request,p,lambda c:files.apply_import(c,id))

    @app.get('/api/backup')
    def backup(): return download(files.backup(db),'XianBiz-full.zip','application/zip')

    @app.post('/api/restore')
    async def restore(file:UploadFile=File(...),confirmed:bool=Form(False)):
        content=await file.read(500*1024*1024+1)
        return files.restore(db,content,confirmed)

    @app.get('/api/help')
    def help():
        path=ROOT/'docs/离线帮助.md'
        return {'content':path.read_text(encoding='utf-8') if path.exists() else '请查看随软件安装的 docs 文档。'}

    @app.post('/api/shutdown')
    def shutdown(request:Request,p:dict):
        if app.state.shutdown: app.state.shutdown()
        return {'stopping':True}

    app.mount('/images',StaticFiles(directory=db.directory/'images'),name='images')
    dist=ROOT/'frontend/dist'
    if (dist/'index.html').is_file() and (dist/'assets').is_dir():
        app.mount('/assets',StaticFiles(directory=dist/'assets'),name='assets')
        @app.get('/{path:path}')
        def index(path:str):
            require(not path.startswith('api/'),'API不存在',404)
            return FileResponse(dist/'index.html')
    else:
        @app.get('/')
        def missing_frontend(): return HTMLResponse('前端资源尚未构建，请在 frontend 执行 npm run build。',503)
    return app
