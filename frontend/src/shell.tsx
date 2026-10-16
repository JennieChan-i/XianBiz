import React, { useEffect, useState } from "react";
import {
  App as AntApp,
  Button,
  Form,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Space,
  Tag,
  Tooltip,
} from "antd";
import {
  AppstoreOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DollarOutlined,
  ExportOutlined,
  FileTextOutlined,
  SettingOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  TeamOutlined,
  ToolOutlined,
  PoweroffOutlined,
} from "@ant-design/icons";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, setToken } from "./api";
import { ErrorAlert } from "./shared";
import {
  Dashboard,
  Reports,
  Settings,
  Expenses,
  Funds,
  Parties,
} from "./pages";
import { Products, Inventory, Stocktake } from "./stock";
import { Orders, OrderEditor } from "./orders";

declare global {
  interface Window {
    xianbizDirty?: boolean;
  }
}
const nav = [
  ["/", "经营总览", DashboardOutlined],
  ["/sales", "销售管理", FileTextOutlined],
  ["/purchases", "采购管理", ShoppingCartOutlined],
  ["/products", "商品资料", AppstoreOutlined],
  ["/inventory", "库存管理", DatabaseOutlined],
  ["/customers", "客户往来", TeamOutlined],
  ["/suppliers", "供应商往来", ShopOutlined],
  ["/funds", "收付款流水", DollarOutlined],
  ["/expenses", "经营费用", ToolOutlined],
  ["/reports", "经营报表", BarChartOutlined],
] as const;

export default function App() {
  const [session, setSession] = useState<any>();
  const [error, setError] = useState("");
  const { modal, message } = AntApp.useApp();
  const navigate = useNavigate();
  const loc = useLocation();
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const load = () =>
    api("/session")
      .then((r) => {
        setToken(r.token);
        setSession(r);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  const go = (path: string) => {
    if (window.xianbizDirty) {
      modal.confirm({
        title: "开单内容尚未提交",
        content: "内容已在本机暂存，离开后可返回恢复。",
        okText: "离开并保留暂存",
        cancelText: "继续开单",
        onOk: () => navigate(path),
      });
    } else navigate(path);
  };
  const setup = async () => {
    setBusy(true);
    try {
      const v = await form.validateFields();
      await api("/settings", v, "PUT");
      message.success("店铺已启用");
      load();
    } catch (e: any) {
      if (e.message) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const selected = loc.pathname.startsWith("/sales")
    ? "/sales"
    : loc.pathname.startsWith("/purchases")
      ? "/purchases"
      : loc.pathname.startsWith("/stocktake")
        ? "/inventory"
        : loc.pathname;
  const shutdown = () =>
    modal.confirm({
      title: "安全退出纤商",
      content:
        "确认后将停止本地服务。已生效的数据已保存，未提交开单会保留本机暂存。",
      okText: "退出并停止服务",
      onOk: async () => {
        await api("/shutdown", {});
        modal.info({
          title: "纤商服务已停止",
          content: "可以关闭此页面。下次请双击纤商桌面图标启动。",
          okText: "知道了",
        });
      },
    });
  if (!session)
    return (
      <div className="boot">
        <h1>纤商</h1>
        <p>正在打开本地经营数据…</p>
        <ErrorAlert error={error} />
        {error && <Button onClick={load}>重新连接</Button>}
      </div>
    );
  return (
    <>
      <Layout className="app-shell">
        <Layout.Sider width={196} className="sidebar">
          <div className="brand">
            <span className="brand-mark">纤</span>
            <div>
              <strong>纤商</strong>
              <small>XianBiz · 经营管理</small>
            </div>
          </div>
          <div className="nav-label">业务工作台</div>
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[selected]}
            onClick={(e) => go(e.key)}
            items={nav.map(([key, label, Icon]) => ({
              key,
              label,
              icon: <Icon />,
            }))}
          />
          <div className="sidebar-bottom">
            <Menu
              theme="dark"
              selectedKeys={[selected]}
              onClick={(e) => go(e.key)}
              items={[
                {
                  key: "/settings",
                  label: "系统设置",
                  icon: <SettingOutlined />,
                },
              ]}
            />
          </div>
        </Layout.Sider>
        <Layout>
          <Layout.Header className="topbar">
            <Space>
              <ShopOutlined />
              <strong>{session.settings.shop_name || "我的档口"}</strong>
              <span className="top-divider" />
              <span className="subtle">经营工作台</span>
            </Space>
            <Space size={18}>
              <span className="subtle">
                {new Date().toLocaleDateString("zh-CN", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </span>
              <Tooltip title="Excel 导出为业务数据；迁移请使用完整备份">
                <Button
                  type="text"
                  icon={<ExportOutlined />}
                  href="/api/export"
                >
                  导出数据
                </Button>
              </Tooltip>
              <Button
                type="text"
                icon={<PoweroffOutlined />}
                onClick={shutdown}
              >
                安全退出
              </Button>
            </Space>
          </Layout.Header>
          <Layout.Content className="workspace">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<Orders kind="sale" />} />
              <Route path="/purchases" element={<Orders kind="purchase" />} />
              <Route path="/sales/new" element={<OrderEditor kind="sale" />} />
              <Route
                path="/purchases/new"
                element={<OrderEditor kind="purchase" />}
              />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/stocktake/:id" element={<Stocktake />} />
              <Route path="/customers" element={<Parties kind="customer" />} />
              <Route path="/suppliers" element={<Parties kind="supplier" />} />
              <Route path="/funds" element={<Funds />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/help" element={<Navigate to="/settings?tab=help" replace />} />
              <Route
                path="/settings"
                element={<Settings session={session} onUpdated={load} />}
              />
              <Route
                path="*"
                element={
                  <div className="panel">
                    <h1>页面不存在</h1>
                    <Button onClick={() => go("/")}>返回经营总览</Button>
                  </div>
                }
              />
            </Routes>
          </Layout.Content>
        </Layout>
      </Layout>
      <Modal
        open={!session.settings.shop_name}
        title="欢迎使用纤商 · 启用店铺"
        closable={false}
        maskClosable={false}
        onOk={setup}
        confirmLoading={busy}
        okText="启用并进入工作台"
        cancelButtonProps={{ style: { display: "none" } }}
      >
        <p className="subtle">
          设置店铺后即可开单。您可以从空白数据开始，也可以稍后在设置中导入期初资料。
        </p>
        <ErrorAlert error={error} />
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            start_date: new Date().toLocaleDateString("en-CA"),
            default_threshold: 5,
          }}
        >
          <Form.Item
            label="店铺名称"
            name="shop_name"
            rules={[{ required: true, message: "请填写店铺名称" }]}
          >
            <Input autoFocus maxLength={80} placeholder="填写档口或店铺名称" />
          </Form.Item>
          <Form.Item
            label="启用日期（启用后不可直接回改）"
            name="start_date"
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item label="默认低库存阈值（件）" name="default_threshold">
            <InputNumber min={0} precision={0} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
