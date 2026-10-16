"""Windows entry point: per-user single instance, loopback dynamic port, clean exit."""
import argparse
import json
import logging
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

if not getattr(sys,'frozen',False):
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import uvicorn
from backend.app import create_app

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--no-browser',action='store_true'); parser.add_argument('--port',type=int,default=0); parser.add_argument('--data-dir')
    args=parser.parse_args()
    directory=Path(args.data_dir or os.environ.get('XIANBIZ_DATA_DIR') or Path(os.getenv('LOCALAPPDATA',str(Path.home())))/'XianBiz')
    directory.mkdir(parents=True,exist_ok=True)
    lock=open(directory/'instance.lock','a+b')
    try:
        if os.name=='nt':
            import msvcrt
            lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
            msvcrt.locking(lock.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError:
        try:
            info=json.loads((directory/'runtime.json').read_text())
            with urllib.request.urlopen(info['url']+'/api/health',timeout=3) as response:
                if json.load(response).get('app')=='XianBiz':
                    if not args.no_browser: webbrowser.open(info['url'])
                    return
        except Exception: pass
        return
    logging.basicConfig(filename=directory/'xianbiz.log',encoding='utf-8',level=logging.INFO,format='%(asctime)s %(levelname)s %(message)s')
    app=create_app(directory)
    sock=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
    sock.bind(('127.0.0.1',args.port)); port=sock.getsockname()[1]
    url=f'http://127.0.0.1:{port}'
    (directory/'runtime.json').write_text(json.dumps({'url':url,'pid':os.getpid()}))
    config=uvicorn.Config(app,host='127.0.0.1',port=port,log_config=None,access_log=False)
    server=uvicorn.Server(config); app.state.shutdown=lambda:setattr(server,'should_exit',True)
    def open_ready():
        for _ in range(300):
            if server.started:
                if not args.no_browser: webbrowser.open(url)
                return
            time.sleep(0.1)
    threading.Thread(target=open_ready,daemon=True).start()
    try: server.run(sockets=[sock])
    finally:
        (directory/'runtime.json').unlink(missing_ok=True)
        sock.close(); lock.close()

if __name__=='__main__':
    try: main()
    except Exception:
        logging.exception('启动失败')
        if os.name=='nt':
            import ctypes
            ctypes.windll.user32.MessageBoxW(0,'纤商启动失败，请查看用户数据目录内的 xianbiz.log。','纤商',16)
        raise
