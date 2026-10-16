"""Runs only against a disposable named data directory; never touches production data."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import uuid

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser();parser.add_argument('--exe',required=True);parser.add_argument('--data-dir',default='.runtime/packaged-smoke');args=parser.parse_args()
data=(ROOT/args.data_dir).resolve(); assert data.is_relative_to(ROOT/'.runtime')
data.mkdir(parents=True,exist_ok=True)
exe=(ROOT/args.exe).resolve()
process=subprocess.Popen([str(exe),'--no-browser','--data-dir',str(data)],creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
def read(path):
    with urllib.request.urlopen(url+path,timeout=10) as r:return r.read()
def post(path,p):
    request=urllib.request.Request(url+path,json.dumps(p).encode(),{'Content-Type':'application/json','X-XianBiz-Token':token,'X-Operation-Id':str(uuid.uuid4())})
    with urllib.request.urlopen(request,timeout=10) as r:return json.load(r)
try:
    for _ in range(150):
        runtime=data/'runtime.json'
        if runtime.exists():
            try:
                info=json.loads(runtime.read_text());url=info['url'];health=json.loads(read('/api/health'))
                if health['app']=='XianBiz':break
            except Exception:pass
        if process.poll() is not None: raise RuntimeError('打包程序提前退出')
        time.sleep(.2)
    else:raise RuntimeError('打包程序未就绪')
    token=json.loads(read('/api/session'))['token']
    html=read('/').decode(); assets=re.findall(r'(?:src|href)="(/assets/[^\"]+)"',html)
    assert assets and all(len(read(a))>100 for a in assets)
    assert json.loads(read('/api/help'))['content'].startswith('# 纤商')
    before=json.loads(read('/api/products'))['total']
    post('/api/products',{'code':'SMOKE-'+uuid.uuid4().hex[:8],'name':'打包隔离验证','price':2500,'skus':[{'color':'黑','size':'M','stock':3,'cost':1000}]})
    assert json.loads(read('/api/products'))['total']==before+1
    assert read('/api/backup')[:2]==b'PK' and read('/api/export')[:2]==b'PK'
    second=subprocess.run([str(exe),'--no-browser','--data-dir',str(data)],timeout=12,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    assert second.returncode==0 and json.loads(runtime.read_text())['pid']==info['pid']
    result={'packaged_start':True,'loopback_url':url,'asset_count':len(assets),'help':True,'persisted_product_count':before+1,'backup':True,'excel':True,'single_instance':True}
    post('/api/shutdown',{});process.wait(timeout=15)
    assert process.returncode==0 and not runtime.exists()
    result['safe_shutdown']=True
    (ROOT/'.runtime/packaged-smoke-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))
finally:
    if process.poll() is None:process.terminate();process.wait(timeout=10)
