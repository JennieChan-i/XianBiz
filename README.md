# XianBiz 纤商

Windows 单机离线服装批发进销存。无账号及登录；React + TypeScript + Vite + Ant Design / Charts；FastAPI + 原生 sqlite3；openpyxl；浏览器 A4 打印另存 PDF。

支持商品颜色尺码、首次采购建档及后续补货、销售与预订、分批收发货、客户供应商往来、混合收付款、退换货、盘点、费用、经营报表及手动完整备份。

本仓库为源码及文档，不包含已编译程序、安装包或本机经营数据。最近验证：94项自动化测试通过，采购内新增商品、收货、补货和期初库存分离已完成隔离浏览器走查。当前仍为待统一人工验收的开发版本。

## 项目结构

| 路径 | 内容 |
|---|---|
| `frontend/` | React / TypeScript 页面、样式与锁定依赖 |
| `backend/` | FastAPI 接口、SQLite 模型与业务规则 |
| `desktop/` | Windows 本地启动器及 PyInstaller 配置 |
| `installer/` | Inno Setup 安装脚本 |
| `scripts/` | 开发启动、完整构建及打包验证 |
| `tests/` | 业务、成本、导入导出、接口及性能测试 |
| `docs/` | 需求、设计、操作手册、验收记录与界面截图 |

原始交接需求保存在 `docs/01_requirements_71.md`、`docs/02_rule_consistency_review.md` 和 `docs/03_codex_start_prompt.md`，不再重复存放第二份。仅用于原工作区的临时部署脚本与历史文档生成脚本不纳入此仓库。

## 启动

首次克隆后，先按下方步骤安装依赖并构建前端，再双击 `启动纤商.bat`。自行打包后，桌面程序位于 `dist/XianBiz/XianBiz.exe`，默认自动打开浏览器并使用动态端口；安装包位于 `artifacts/XianBiz-Setup-1.0.0.exe`。退出请使用页面右上角“安全退出”。

正式数据库首次为空，进入店铺启用向导。持久化目录：`%LOCALAPPDATA%/XianBiz`。不要把测试目录恢复到正式环境。完整备份由用户在设置里手动创建。

## 开发与构建

依赖：Windows x64、Python 3.12、Node.js 24；安装后的桌面程序不需要预装 Python 或 Node。

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt
cd frontend
npm ci
npm run build
cd ..
.venv/Scripts/python -m pytest -q
.venv/Scripts/python desktop/launcher.py
```

开发运行也由后端同源提供构建文件。Vite 单独启动只用于静态界面开发；安全中间件不放开跨域。可设置 `XIANBIZ_DATA_DIR` 指向隔离目录，或启动器传 `--data-dir`。

执行 `scripts/build.ps1` 完成前端构建、测试、PyInstaller 和 Inno Setup。安装包编译器可在 PATH 中，或位于 `.tools/InnoSetup/ISCC.exe`。本次使用 Inno Setup 6.4.3，官方该版本许可允许商业应用使用；工具本体不随产品发布。升级编译器时须自行核对对应版本许可。

```powershell
.venv/Scripts/python scripts/smoke_packaged.py --exe dist/XianBiz/XianBiz.exe
```

打包验证仅在 `.runtime/packaged-smoke` 创建隔离数据。业务测试均使用 pytest 临时目录；生产没有预置客户、商品、订单或经营指标。

## 文档及状态

- `docs/01_requirements_71.md`：71 项唯一需求基线。
- `docs/PRD_V1.0.md`：架构与逐项功能 / 页面 / API / 模型 / 验收映射。
- `docs/业务规则与状态机.md`：六项 P0 解释及其他跨模块约束。
- `docs/技术设计与数据模型.md`、`docs/验收测试矩阵.md`、`docs/实施任务清单.md`。
- `docs/离线帮助.md`：可在程序内离线阅读。
- `docs/全流程简要操作手册.md`：使用独立验收数据走查经营流程。
- `docs/验证记录.md`：真实验证结果与尚未完成的验收。

当前为待统一人工验收的 V1.0 开发构建，不等同于完成商业交付验收。完整范围没有调整为 MVP。请先按照验收矩阵使用隔离数据完成验收，再承载正式经营。

首次进货：采购开单 → 选择供应商 → 新增商品并采购 → 填写件数和采购单价 → 确认收货入库。后续补货选择已有商品；普通商品建档不增加库存，开始使用软件前已有的存货通过明确勾选期初库存录入处理。
