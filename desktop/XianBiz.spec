from pathlib import Path
root = Path(SPECPATH).parent
a = Analysis([str(root/'desktop/launcher.py')], pathex=[str(root)], binaries=[],
    datas=[(str(root/'backend/schema.sql'),'backend'),(str(root/'frontend/dist'),'frontend/dist'),(str(root/'docs'),'docs')],
    hiddenimports=['uvicorn.logging','uvicorn.loops.auto','uvicorn.protocols.http.auto','uvicorn.protocols.websockets.auto','uvicorn.lifespan.on'], hookspath=[],runtime_hooks=[],excludes=['pytest','tkinter'])
pyz = PYZ(a.pure)
exe = EXE(pyz,a.scripts,[],exclude_binaries=True,name='XianBiz',debug=False,strip=False,upx=False,console=False)
coll = COLLECT(exe,a.binaries,a.datas,strip=False,upx=False,name='XianBiz')
