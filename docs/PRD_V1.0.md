# XianBiz 纤商 V1.0 PRD

基线：docs/01_requirements_71.md 为唯一范围权威；当前目录初始仅包含三份交接文档。完整 V1.0 为最终目标，阶段实现不代表缩减产品范围。

## 总体架构

Windows 桌面启动器 → 动态 127.0.0.1 端口 → FastAPI 同源静态资源及 REST → Python 业务服务 → 原生 sqlite3 / 图片目录。React + TypeScript + Vite；Ant Design 紧凑企业主题；Ant Design Charts 离线图表；openpyxl 导入导出；浏览器 A4 打印另存 PDF。无账号、云服务、CDN、联网自动更新及自动备份。

## 页面与工作流

首次店铺设置 → 商品与往来期初资料 → 销售/采购一页开单 → 分批履约 → 收付款/手工核销 → 退换货与冲正 → 盘点与库存损益 → 报表核对 → 手动备份恢复。侧栏提供经营总览、销售、采购、商品、库存、往来、资金、费用、报表、帮助和设置。全新数据库无经营数据；空状态提供实际可用操作入口。

## 全部 71 项覆盖矩阵

| 决策 | 最终要求 | 功能 / 页面 | API | 模型 | 验收 |
|---|---|---|---|---|---|
| 01 | 真实可交付的商业软件；正式环境空白真实数据；不得有 Demo、测试环境字样、预置虚构经营数据、假按钮或硬编码指标。测试数据隔离。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A01 |
| 02 | 现货销售 + 预订欠货 + 分批交付；区分订购量、已预留、已交付和待补数量；真实交付才出库。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A02 |
| 03 | 直接采购入库 + 预订采购 + 分批收货；未到货不增加库存；实际收货按 SKU 记录入库。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A03 |
| 04 | 单店统一库存；不区分档口、仓库、多门店；每个颜色尺码 SKU 独立库存。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A04 |
| 05 | 销售确认自动预留当时可用库存；不足部分列为欠货；交付才扣库存；撤销未履约部分释放预留。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A05 |
| 06 | 销售全款、定金、分次收款、赊账；销售相关应收、已收、未收和收款流水均可追溯；与 69 的确认时点联合解释。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A06 |
| 07 | 采购全款、定金、分次付款、欠款；采购相关应付、已付、未付、供应商往来查询；与 69 联合解释。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A07 |
| 08 | 销售整单/部分退货和跨颜色、尺码、款式换货；处理出入库、价差、退款、补款、欠款抵扣及记录关联。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A08 |
| 09 | 标准服装商品管理；分类、款号、图片、品牌、季节、自定义颜色尺码、无尺码、SKU、可选条码、矩阵批量录入；默认价格可改。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A09 |
| 10 | 默认批发价 + 销售时手动改价；不开发客户等级价、阶梯价、专用折扣系统；历史成交价格快照固定。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A10 |
| 11 | 采购整单/部分退货和供应商换货；跨颜色尺码款式；正确处理库存、退款、补款、应付抵扣。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A11 |
| 12 | SKU 级移动加权平均成本；出库冻结成本快照；历史退换货及负库存成本须可追溯校正。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A12 |
| 13 | 首页 + 实用经营报表；销售、采购、商品销量排行、库存预警、客户欠款、毛利；日期筛选、明细与 Excel 导出。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A13 |
| 14 | 快速搜索 + 款色码矩阵 + USB 扫码枪开单；条码非必填；无条码可用名称或款号搜索。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A14 |
| 15 | Excel 期初数据导入；商品、SKU、期初库存与成本、客户、供应商、期初应收应付；模板、预览、去重及错误校验；不导入完整历史交易。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A15 |
| 16 | 库存盘点、矩阵、盘盈盘亏、SKU 级预警；盘点确认生成库存/成本调整及流水；SKU 独立低库存阈值与补货提醒。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A16 |
| 17 | 初始选择“单一老板账号，不设店员”；**已被第 22 项最新明确要求“完全不接入账号功能”覆盖**；最终无账号、无登录。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A17 |
| 18 | 仅 PC 网页端，可离线；不做手机适配、原生手机 App；所有核心操作断网可用。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A18 |
| 19 | 单机本地部署；浏览器访问本地服务、本地数据库，不做多电脑同步。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A19 |
| 20 | **仅手动**完整备份、导出与恢复；不做定时自动备份；恢复需完整性校验、明确确认，数据库与图片都要包含。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A20 |
| 21 | Windows 安装程序 + 桌面图标一键启动；自动启动本地服务与默认浏览器；无需命令行；安全退出。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A21 |
| 22 | 首次设置店铺名称、启用日期、可选 Excel 导入；**无账号体系**；首次向导允许从零开始；以后无注册、无登录、无账号密码。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A22 |
| 23 | 单据自动唯一编号、明细、A4 打印、PDF 导出；不做 58/80mm 热敏小票；PDF 按第 57 项使用浏览器打印另存。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A23 |
| 24 | 客户/供应商基础档案；名称、电话、地址、备注、关联订单历史；不引入复杂 CRM。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A24 |
| 25 | 多付款渠道、混合付款、统一资金流水；现金、微信、支付宝、银行转账等人工登记；关联业务单据；不做独立资金账户及真实支付接口。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A25 |
| 26 | 简单经营费用 + 简化经营利润；类别、金额、日期、支付方式、备注、明细统计；非专业会计系统。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A26 |
| 27 | 标准销售订单状态；草稿、已确认待交付、部分交付、已完成、已取消；安全修改及历史追溯；交付状态独立于收款状态。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A27 |
| 28 | **简化**采购订单状态；待收货、部分收货、已收齐、已取消；直接入库可一步完成；分批收货；部分收货后终止剩余量不得删除历史。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A28 |
| 29 | **补货不自动分配给历史欠货单**；老板手动将补货的可用库存预留给指定欠货客户；区别于确认新销售单时的自动预留。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A29 |
| 30 | 允许匿名散客现货开单；散客必须当场交付并结清；预订、分批交付、赊账必须关联客户档案。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A30 |
| 31 | 交付只记录 SKU、数量及时间；不记录配送方式、快递、物流单号。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A31 |
| 32 | 已生效业务标准纠错和冲正；原记录与纠错原因保留；库存、成本、资金同步；不得直接删除生效流水；防重提交。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A32 |
| 33 | 基础搜索、筛选、排序和分页；商品/条码/款号、订单编号/日期/状态、SKU 库存；逐条业务管理，不加入复杂批量操作。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A33 |
| 34 | 商品一主图 + 多附图、本地压缩及缩略图；商品图片本地存储，随完整备份/恢复；不需每个 SKU 单独配图。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A34 |
| 35 | 全部按“件”计量；不设置包、箱单位换算及组合混码包。 | 商品资料：商品 / 库存 | `/api/products, /api/skus` | `products, skus, images` | A35 |
| 36 | 允许老板确认警告后**强制负库存出库**；默认警告，记录原因和操作流水；后续入库补负数；见 62 成本规则。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A36 |
| 37 | 允许**边营业边盘点**；不锁住正在盘点的 SKU；需要盘点实数时间和期间库存流水核对，避免直接覆盖交易。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A37 |
| 38 | 首页提醒 + 简洁待办中心；低库存、负库存、欠货、待交付、客户/供应商欠款；动态更新，跳转业务；不做任务管理。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A38 |
| 39 | 业务单据**只支持文字备注**；不上传图片、合同或 PDF 业务附件；商品图片属于商品资料功能，与此不冲突。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A39 |
| 40 | 极简系统设置；店铺信息、默认库存阈值、手动备份恢复；不开放复杂编号/业务规则配置。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A40 |
| 41 | 左侧业务导航 + 右侧工作区 + 首页快捷操作；二级菜单清晰，聚合经营数据与待办。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A41 |
| 42 | 传统企业管理软件视觉；蓝灰色、信息密度高、紧凑表格，重实用而非时髦 SaaS 装饰。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A42 |
| 43 | 复杂业务独立页面、简单操作弹窗、详情抽屉；操作效率优先；离开未保存表单提示。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A43 |
| 44 | 一页式销售/采购开单；客户/供应商、矩阵搜索、扫码、数量、价格、收付款集中操作，支持直接履约和预订。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A44 |
| 45 | 实用键盘操作 + 连续开单；扫码定位、Enter、Tab、保存并新建下一单；不可绕过风险校验。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A45 |
| 46 | 未提交的开单表单自动本地暂存；意外退出恢复；暂存不产生正式订单、不改变库存资金；提交成功清理。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A46 |
| 47 | 清晰校验、风险确认、失败保护；字段级说明、负库存/冲正/恢复确认；事务回滚、保留输入、防重复提交。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A47 |
| 48 | 关键业务操作历史记录；时间、修改前后、原因及关联单据；订单、库存调整、负库存、资金冲正等；不建全局审计后台。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A48 |
| 49 | 小型档口基础性能；目标覆盖约 1,000 SKU、10,000 历史订单，核心操作稳定流畅；不是硬性记录数量上限。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A49 |
| 50 | 简单手动安装升级；程序与用户数据分离，新版安装保留数据；不做联网自动更新；不能无视结构兼容。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A50 |
| 51 | 界面提示 + 离线帮助中心；商品、采购、销售、库存、收付款、备份核心操作说明；不做交互式演示教程。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A51 |
| 52 | 全量经营数据 Excel 导出 + 备份迁移；商品、SKU、库存、采购销售、收付款、客户供应商、费用；新电脑用完整备份恢复，不做历史 Excel 双向导入。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A52 |
| 53 | 人工业务验收 + 关键逻辑自动化测试；覆盖跨模块、负库存成本、资金、退换货、冲正、备份恢复，测试正式数据隔离。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A53 |
| 54 | **一次性完整开发，最终统一验收**；V1.0 纳入全部已确认需求，不砍为简易 MVP；不等于禁止开发中自测、提交与修复。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A54 |
| 55 | React + TypeScript + Vite / FastAPI / SQLite；PyInstaller 等打包 Windows 可安装、桌面一键启动、离线运行。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A55 |
| 56 | Ant Design UI；蓝灰色企业主题、紧凑高密度表格/表单/弹窗/抽屉/分页，资源本地打包。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A56 |
| 57 | **Ant Design Charts + openpyxl + 浏览器打印另存 PDF**；不采用 ECharts + ReportLab 的早期推荐组合；A4 浏览器打印版式。 | 经营分析：经营总览 / 待办 / 报表 | `/api/dashboard, /api/reports` | `inventory_ledger, profit_ledger, debts, credits` | A57 |
| 58 | **Python sqlite3 原生 SQL + 手动事务管理**；不采用 SQLAlchemy/Alembic 的早期推荐；启用外键、索引、唯一约束和 SQL 迁移脚本。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A58 |
| 59 | 程序/数据目录分离；程序在 Windows 标准安装目录；数据在 `%LOCALAPPDATA%\\XianBiz`；导出/备份文件用户选保存位置。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A59 |
| 60 | 单实例本地安全服务；仅绑定 `127.0.0.1`；动态可用端口、自动打开浏览器、来源/请求安全校验、安全退出；无登录与后台常驻。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A60 |
| 61 | **基础 REST API**；一致数据格式、错误提示、事务、防重复提交；不建设企业级开放 API。 | 本地交付：首次设置 / 设置 / 帮助 | `/api/settings, /api/backup, /api/restore, /api/import, /api/export` | `settings, operations, schema_version; local images` | A61 |
| 62 | 负库存暂估成本、补货后自动校正；优先最近有效平均成本，无历史价时手动填暂估；补货补平时核算差异并生成关联原销售的调整流水。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A62 |
| 63 | 销售退货区分可售与不可售；可售恢复库存；不可售记录损耗不进可售库存；使用原销售最终结算成本，并处理负库存调整关联。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A63 |
| 64 | 库存盘盈盘亏、报废纳入简化经营利润；库存损益与销售成本、经营费用独立核算，避免重复计入。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A64 |
| 65 | 销售按实际交付日、资金按实际收付日；经营费用按归属日、库存损益按调整确认日；退货和成本校正记录原单据关联与调整时间。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A65 |
| 66 | **不设置欠款到期日与逾期提醒**；只管理未结清应收、应付，不做账龄和逾期催款逻辑。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A66 |
| 67 | 一笔实际收付款**手动核销多笔欠款**；一笔真实资金流水、多条核销分配明细；可关联多销售/采购单与期初欠款，不自动分配。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A67 |
| 68 | 采购运费作为**经营费用**；不分摊进 SKU 库存成本；避免同时进入采购成本及费用造成重复扣除。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A68 |
| 69 | **实际交付/实际收货后形成应收/应付**；订单确认尚未履约不形成相应应收应付；提前收付单独登记预收/预付，并于履约时核销。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A69 |
| 70 | 可确认警告后强制出库、**挪用其他订单预留量**；必须显式记录受影响订单的预留减少和欠货增加，标记待处理；不可悄悄消失预留。 | 销售采购：销售 / 采购 / 开单 / 详情 | `/api/orders, /api/orders/{id}/fulfill, terminate, reserve, returns` | `orders, order_lines, fulfillments, returns, reservations` | A70 |
| 71 | 已生效库存/资金业务时间**不得直接回改**；误操作经关联冲正或调整记录纠错；保留原始时间与纠错时间。 | 资金核算：往来 / 收付款 / 费用 | `/api/parties, /api/funds, /api/allocations, /api/expenses` | `parties, debts, credits, allocations, funds, fund_channels, expenses` | A71 |

## 六项冲突

详见 [业务规则与状态机](业务规则与状态机.md)，按 P0-01 至 P0-06 逐项编码并验收。
