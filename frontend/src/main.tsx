import React from "react";
import ReactDOM from "react-dom/client";
import { ConfigProvider, App as AntApp } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter } from "react-router-dom";
import App from "./shell";
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      componentSize="small"
      theme={{
        token: {
          colorPrimary: "#245b87",
          colorInfo: "#245b87",
          borderRadius: 3,
          fontSize: 13,
          fontFamily:
            '"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif',
          colorText: "#243746",
          colorTextSecondary: "#526574",
          controlHeight: 30,
        },
        components: {
          Table: { cellPaddingBlockSM: 9, headerBg: "#eef2f6" },
          Menu: { itemHeight: 40, itemBorderRadius: 2 },
          Layout: { siderBg: "#203b52" },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
