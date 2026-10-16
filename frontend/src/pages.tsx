import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from "antd";
import {
  ArrowRightOutlined,
  DownloadOutlined,
  FileAddOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { Line } from "@ant-design/charts";
import { useNavigate, useSearchParams } from "react-router-dom";
import dayjs from "dayjs";
import { api, cents, ledgerLabel, money, Row, upload, when } from "./api";
import {
  AllocationModal,
  EmptyState,
  ErrorAlert,
  FundModal,
  MoneyInput,
  PageTitle,
  Search,
  Status,
  useLoad,
} from "./shared";

export function Dashboard() {
  const { data: d, loading, error, reload } = useLoad("/dashboard");
  const n = useNavigate();
  const todos = [
    ["待交付订单", d?.todos.delivery, "/sales"],
    ["销售欠货订单", d?.todos.shortage, "/sales"],
    ["待收货采购", d?.todos.receipt, "/purchases"],
    ["低库存 SKU", d?.todos.low, "/inventory?alert=low"],
    ["负库存 SKU", d?.todos.negative, "/inventory?alert=negative"],
  ];
  return (
    <>
      <PageTitle
        title="经营总览"
        description="查看今日经营与待处理事项"
        extra={
          <>
            <Button icon={<ReloadOutlined />} onClick={reload}>
              刷新
            </Button>
            <Button onClick={() => n("/purchases/new")}>采购开单</Button>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => n("/sales/new")}
            >
              销售开单
            </Button>
          </>
        }
      />
      <ErrorAlert error={error} />
      <div className="summary-strip">
        {[
          ["今日销售净额", d?.today.revenue, "按实际交付及退货"],
          ["今日销售毛利", d?.today.gross_profit, "含当日成本调整"],
          ["客户未结应收", d?.balances.customer, "履约后未核销债项"],
          ["供应商未结应付", d?.balances.supplier, "收货后未核销债项"],
        ].map(([label, value, desc]) => (
          <div key={String(label)}>
            <span>{label}</span>
            <strong>{loading ? "—" : "¥ " + money(Number(value))}</strong>
            <small>{desc}</small>
          </div>
        ))}
      </div>
      <div className="home-columns">
        <section className="panel">
          <div className="section-heading">
            <h2>待处理事项</h2>
            <Tag>实时业务数据</Tag>
          </div>
          <div className="todo-list">
            {todos.map(([label, value, path]) => (
              <button key={String(label)} onClick={() => n(String(path))}>
                <span>{label}</span>
                <b className={Number(value) > 0 ? "attention" : ""}>
                  {value ?? "—"}
                </b>
                <ArrowRightOutlined />
              </button>
            ))}
          </div>
          <div className="inline-note">
            补货入库后，历史欠货需由您手动分配。
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>库存概况</h2>
            <Button type="link" onClick={() => n("/inventory")}>
              查看库存 <ArrowRightOutlined />
            </Button>
          </div>
          <dl className="stock-summary">
            <div>
              <dt>在管 SKU</dt>
              <dd>
                {d?.stock.sku_count ?? "—"} <small>个</small>
              </dd>
            </div>
            <div>
              <dt>账面库存合计</dt>
              <dd>
                {d?.stock.qty ?? "—"} <small>件</small>
              </dd>
            </div>
            <div>
              <dt>正库存价值</dt>
              <dd>¥ {money(d?.stock.value)}</dd>
            </div>
          </dl>
        </section>
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>最近销售订单</h2>
          <Button type="link" onClick={() => n("/sales")}>
            全部销售 <ArrowRightOutlined />
          </Button>
        </div>
        <Table
          loading={loading}
          rowKey="id"
          size="small"
          dataSource={d?.recent_orders}
          pagination={false}
          locale={{
            emptyText: (
              <EmptyState text="还没有销售订单。添加商品与客户后，即可开出第一张单。" />
            ),
          }}
          columns={[
            {
              title: "单据编号",
              dataIndex: "number",
              render: (v: string) => (
                <Button type="link" onClick={() => n("/sales")}>
                  {v}
                </Button>
              ),
            },
            { title: "客户", dataIndex: "party_name" },
            { title: "开单时间", dataIndex: "created_at", render: when },
            {
              title: "履约状态",
              render: (_: any, r: Row) => (
                <Status value={r.state} terminated={r.remaining_terminated} />
              ),
            },
            {
              title: "合同金额",
              dataIndex: "total",
              align: "right",
              render: money,
            },
            {
              title: "当前应收",
              dataIndex: "debt",
              align: "right",
              render: money,
            },
          ]}
        />
      </section>
    </>
  );
}

export function Reports() {
  const [range, setRange] = useState([dayjs().startOf("month"), dayjs()]);
  const start = range[0].format("YYYY-MM-DD"),
    end = range[1].format("YYYY-MM-DD");
  const {
    data: d,
    loading,
    error,
  } = useLoad(`/reports?start=${start}&end=${end}`);
  const series =
    d?.trend.flatMap((r: Row) => [
      { day: r.day, amount: r.revenue / 100, series: "销售净额" },
      { day: r.day, amount: r.profit / 100, series: "简化经营利润" },
    ]) || [];
  return (
    <>
      <PageTitle
        title="经营报表"
        description="按业务实际发生日统计；后续退货与成本校正在调整当日列示"
        extra={
          <Button
            icon={<DownloadOutlined />}
            href={`/api/export?report=true&start=${start}&end=${end}`}
          >
            导出报表 Excel
          </Button>
        }
      />
      <div className="toolbar">
        <span>统计日期</span>
        <DatePicker.RangePicker
          value={range as any}
          allowClear={false}
          onChange={(v) => v && setRange(v as any)}
        />
        <Button onClick={() => setRange([dayjs(), dayjs()])}>今日</Button>
        <Button onClick={() => setRange([dayjs().startOf("month"), dayjs()])}>
          本月
        </Button>
      </div>
      <ErrorAlert error={error} />
      <div className="report-values">
        {[
          ["销售净额", "revenue"],
          ["销售成本", "original_cost"],
          ["成本校正", "cost_adjustment"],
          ["销售毛利", "gross_profit"],
          ["库存损益", "inventory_profit"],
          ["经营费用", "expenses"],
          ["简化经营利润", "profit"],
          ["采购净额", "purchase"],
        ].map(([label, key]) => (
          <div key={key}>
            <span>{label}</span>
            <b>¥ {money(d?.[key])}</b>
          </div>
        ))}
      </div>
      <section className="panel">
        <div className="section-heading">
          <h2>经营趋势</h2>
          <span className="subtle">金额单位：元</span>
        </div>
        {series.length ? (
          <Line
            data={series}
            xField="day"
            yField="amount"
            colorField="series"
            height={260}
            scale={{ color: { range: ["#245b87", "#4a8265"] } }}
            axis={{ y: { title: false } }}
            legend={{ color: { position: "top" } }}
            tooltip={{ title: "day" }}
          />
        ) : (
          <EmptyState text="所选日期暂无损益流水，完成实际交付后会在这里显示。" />
        )}
      </section>
      <section className="panel">
        <Tabs
          items={[
            {
              key: "ranking",
              label: "商品销量排行",
              children: (
                <Table
                  loading={loading}
                  rowKey={(r: Row) => r.code + r.color + r.size}
                  dataSource={d?.ranking}
                  columns={[
                    { title: "款号", dataIndex: "code" },
                    { title: "商品", dataIndex: "name" },
                    { title: "颜色", dataIndex: "color" },
                    { title: "尺码", dataIndex: "size" },
                    {
                      title: "净销量（件）",
                      dataIndex: "qty",
                      sorter: (a: Row, b: Row) => a.qty - b.qty,
                    },
                    { title: "销售净额", dataIndex: "amount", render: money },
                  ]}
                  size="small"
                />
              ),
            },
            {
              key: "details",
              label: "损益流水明细",
              children: (
                <Table
                  loading={loading}
                  rowKey="id"
                  dataSource={d?.details}
                  size="small"
                  columns={[
                    {
                      title: "发生时间",
                      dataIndex: "created_at",
                      render: when,
                    },
                    { title: "类别", dataIndex: "kind", render: ledgerLabel },
                    { title: "来源", dataIndex: "source" },
                    { title: "关联订单", dataIndex: "order_id" },
                    {
                      title: "利润影响",
                      dataIndex: "amount",
                      align: "right",
                      render: (v: number) => (
                        <span className={v < 0 ? "negative" : ""}>
                          {money(v)}
                        </span>
                      ),
                    },
                  ]}
                  pagination={{ pageSize: 20, showSizeChanger: true }}
                />
              ),
            },
          ]}
        />
      </section>
      <p className="subtle">
        简化经营利润 = 销售净额 − 销售成本 − 成本校正 + 库存损益 −
        经营费用，为管理口径。采购货款记入存货；采购运费记入费用。
      </p>
    </>
  );
}

function PartyForm({
  kind,
  value,
  onClose,
  onDone,
}: {
  kind: string;
  value?: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const submit = async () => {
    setBusy(true);
    try {
      const p = await form.validateFields();
      await api(
        "/parties" + (value ? "/" + value.id : ""),
        { ...p, kind, opening: cents(p.opening) },
        value ? "PUT" : "POST",
      );
      message.success("往来档案已保存");
      onDone();
      onClose();
    } catch (e: any) {
      if (e.message) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={
        (value ? "编辑" : "新增") + (kind === "customer" ? "客户" : "供应商")
      }
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText="保存"
    >
      <ErrorAlert error={error} />
      <Form
        form={form}
        layout="vertical"
        initialValues={value || { active: true, opening: 0 }}
      >
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: "请填写名称" }]}
        >
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item name="phone" label="电话">
          <Input />
        </Form.Item>
        <Form.Item name="address" label="地址">
          <Input />
        </Form.Item>
        <Form.Item name="note" label="备注">
          <Input.TextArea rows={2} />
        </Form.Item>
        {!value && (
          <Form.Item
            name="opening"
            label={kind === "customer" ? "期初应收欠款" : "期初应付欠款"}
          >
            <MoneyInput />
          </Form.Item>
        )}
        <Form.Item name="active" label="状态">
          <Select
            options={[
              { value: true, label: "启用" },
              { value: false, label: "停用（历史记录保留）" },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function Parties({ kind }: { kind: string }) {
  const [qs, setQs] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Row | null>();
  const [detail, setDetail] = useState<number>();
  const [fund, setFund] = useState<Row>();
  const [allocation, setAllocation] = useState<Row>();
  const n = useNavigate();
  const { data, loading, error, reload } = useLoad(
    `/parties?kind=${kind}&qs=${encodeURIComponent(qs)}&page=${page}`,
  );
  const party = useLoad(
    detail ? "/parties/" + detail : "/parties?kind=" + kind,
  );
  const name = kind === "customer" ? "客户" : "供应商";
  const history = useLoad(
    detail
      ? `/orders?kind=${kind === "customer" ? "sale" : "purchase"}&party_id=${detail}&page_size=100`
      : "/orders?page_size=1",
  );
  useEffect(() => {
    setDetail(undefined);
    setPage(1);
    setQs("");
  }, [kind]);
  const refresh = () => {
    reload();
    party.reload();
    history.reload();
  };
  return (
    <>
      <PageTitle
        title={name + "往来"}
        description="应收应付与预收预付分开列示，支持一笔款手动核销多笔债项"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setEdit(null)}
          >
            新增{name}
          </Button>
        }
      />
      <div className="toolbar">
        <Search
          value={qs}
          onChange={(v) => {
            setQs(v);
            setPage(1);
          }}
          placeholder="搜索名称或电话"
        />
        <Button icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
      </div>
      <ErrorAlert error={error} />
      <div className="panel table-panel">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.items}
          size="small"
          pagination={{
            current: page,
            total: data?.total,
            pageSize: 30,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (v) => `共 ${v} 位${name}`,
          }}
          columns={[
            {
              title: name + "名称",
              dataIndex: "name",
              render: (v: string, r: Row) => (
                <Button type="link" onClick={() => setDetail(r.id)}>
                  {v}
                </Button>
              ),
            },
            { title: "电话", dataIndex: "phone" },
            { title: "地址", dataIndex: "address", ellipsis: true },
            {
              title: kind === "customer" ? "未结应收" : "未结应付",
              dataIndex: "outstanding",
              align: "right",
              render: money,
            },
            {
              title:
                kind === "customer" ? "可用预收 / 贷项" : "可用预付 / 贷项",
              dataIndex: "advance",
              align: "right",
              render: money,
            },
            {
              title: "状态",
              dataIndex: "active",
              render: (v: number) => (
                <Tag color={v ? "green" : "default"}>{v ? "启用" : "停用"}</Tag>
              ),
            },
            {
              title: "操作",
              render: (_: any, r: Row) => (
                <Space>
                  <Button
                    type="link"
                    onClick={() => setEdit({ ...r, active: !!r.active })}
                  >
                    编辑
                  </Button>
                  <Button type="link" onClick={() => setFund(r)}>
                    收付
                  </Button>
                  <Button type="link" onClick={() => setAllocation(r)}>
                    核销
                  </Button>
                </Space>
              ),
            },
          ]}
          locale={{
            emptyText: (
              <EmptyState
                text={`还没有${name}档案，可新增或在系统设置中导入期初资料。`}
              />
            ),
          }}
        />
      </div>
      <Drawer
        open={!!detail}
        width={920}
        title={party.data?.name || name + "详情"}
        onClose={() => setDetail(undefined)}
        extra={<Button onClick={() => setFund(party.data)}>登记收付</Button>}
      >
        <ErrorAlert error={party.error} />
        {party.data?.debts && (
          <>
            <Descriptions
              bordered
              size="small"
              column={2}
              items={[
                {
                  key: "phone",
                  label: "电话",
                  children: party.data.phone || "—",
                },
                {
                  key: "address",
                  label: "地址",
                  children: party.data.address || "—",
                },
                {
                  key: "debt",
                  label: "未结债项",
                  children: "¥ " + money(party.data.outstanding),
                },
                {
                  key: "advance",
                  label: "可用预收付 / 贷项",
                  children: "¥ " + money(party.data.advance),
                },
              ]}
            />
            <Tabs
              items={[
                {
                  key: "debts",
                  label: "债项明细",
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={party.data.debts}
                      columns={[
                        { title: "来源", dataIndex: "source" },
                        {
                          title: "发生时间",
                          dataIndex: "created_at",
                          render: when,
                        },
                        { title: "原金额", dataIndex: "amount", render: money },
                        {
                          title: "未结金额",
                          dataIndex: "balance",
                          render: money,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "credits",
                  label: "预收付与贷项",
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={party.data.credits}
                      columns={[
                        { title: "来源", dataIndex: "source" },
                        { title: "原金额", dataIndex: "amount", render: money },
                        {
                          title: "已退款 / 冲正占用",
                          dataIndex: "refunded",
                          render: money,
                        },
                        {
                          title: "可用金额",
                          dataIndex: "balance",
                          render: money,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "allocations",
                  label: "核销记录",
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={party.data.allocations}
                      columns={[
                        { title: "贷项ID", dataIndex: "credit_id" },
                        { title: "债项ID", dataIndex: "debt_id" },
                        { title: "类型", dataIndex: "kind" },
                        { title: "金额", dataIndex: "amount", render: money },
                        {
                          title: "时间",
                          dataIndex: "created_at",
                          render: when,
                        },
                      ]}
                    />
                  ),
                },
                {
                  key: "orders",
                  label: "关联订单",
                  children: (
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={history.data?.items}
                      columns={[
                        { title: "单据", dataIndex: "number" },
                        {
                          title: "时间",
                          dataIndex: "created_at",
                          render: when,
                        },
                        {
                          title: "合同金额",
                          dataIndex: "total",
                          render: money,
                        },
                        {
                          title: "履约状态",
                          render: (_: any, r: Row) => (
                            <Status
                              value={r.state}
                              kind={r.kind}
                              terminated={r.remaining_terminated}
                            />
                          ),
                        },
                      ]}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      {edit !== undefined && (
        <PartyForm
          kind={kind}
          value={edit || undefined}
          onClose={() => setEdit(undefined)}
          onDone={refresh}
        />
      )}{" "}
      {fund && (
        <FundModal
          party={fund}
          onClose={() => setFund(undefined)}
          onDone={refresh}
        />
      )}{" "}
      {allocation && (
        <AllocationModal
          party={allocation}
          onClose={() => setAllocation(undefined)}
          onDone={refresh}
        />
      )}
    </>
  );
}

export function Funds() {
  const [kind, setKind] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [reverse, setReverse] = useState<Row>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const { message } = App.useApp();
  const { data, loading, error, reload } = useLoad(
    `/funds?kind=${kind}&page=${page}&start=${range?.[0]?.format("YYYY-MM-DD") || ""}&end=${range?.[1]?.format("YYYY-MM-DD") || ""}`,
  );
  const doReverse = async () => {
    setBusy(true);
    try {
      await api((reverse?.record_type==='expense'?'/expenses/':'/funds/') + reverse?.id + "/reverse", { reason });
      message.success("已追加资金冲正流水");
      setReverse(undefined);
      reload();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle
        title="收付款流水"
        description="按实际收付时间记账，核销不会重复登记现金"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            登记收付款
          </Button>
        }
      />
      <div className="toolbar">
        <Select
          value={kind}
          style={{ width: 150 }}
          onChange={(v) => {
            setKind(v);
            setPage(1);
          }}
          options={[
            { value: "", label: "全部往来" },
            { value: "customer", label: "客户收款 / 退款" },
            { value: "supplier", label: "供应商付款 / 退款" },
            { value: "expense", label: "经营费用 / 冲正" },
          ]}
        />
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v);
            setPage(1);
          }}
        />
        <Button icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
      </div>
      <ErrorAlert error={error} />
      <section className="panel table-panel">
        <Table
          loading={loading}
          rowKey="row_key"
          dataSource={data?.items}
          pagination={{
            current: page,
            total: data?.total,
            pageSize: 30,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            { title: "资金单号", dataIndex: "number" },
            { title: "实际时间", dataIndex: "created_at", render: when },
            { title: "往来单位", dataIndex: "party_name" },
            {
              title: "类型",
              render: (_: any, r: Row) => (
                <Tag>
                  {r.kind === "expense" ? (r.amount>0?'经营费用支出':'费用冲正入账') : r.kind === "customer"
                    ? r.amount > 0
                      ? "客户收款"
                      : "退客户款"
                    : r.amount > 0
                      ? "支付供应商"
                      : "供应商退款"}
                </Tag>
              ),
            },
            {
              title: "实际金额",
              dataIndex: "amount",
              align: "right",
              render: (v: number) => money(Math.abs(v)),
            },
            { title: "渠道与金额（分）", dataIndex: "channels" },
            { title: "备注", dataIndex: "note", ellipsis: true },
            {
              title: "操作",
              render: (_: any, r: Row) =>
                !r.reversal_of ? (
                  <Button
                    type="link"
                    danger
                    onClick={() => {
                      setReverse(r);
                      setReason("");
                      setActionError("");
                    }}
                  >
                    冲正
                  </Button>
                ) : (
                  <span className="subtle">已关联调整</span>
                ),
            },
          ]}
        />
      </section>
      {open && <FundModal onClose={() => setOpen(false)} onDone={reload} />}
      <Modal
        open={!!reverse}
        title="冲正资金流水"
        onCancel={() => setReverse(undefined)}
        onOk={doReverse}
        confirmLoading={busy}
        okText="确认冲正"
        okButtonProps={{ danger: true }}
      >
        <Alert
          type="warning"
          showIcon
          message="保留原流水，并在当前时间追加反向资金及关联债项。"
        />
        <ErrorAlert error={actionError} />
        <Input.TextArea
          style={{ marginTop: 12 }}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="必须填写冲正原因"
        />
      </Modal>
    </>
  );
}

export function Expenses() {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad("/expenses?page=" + page);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const { message, modal } = App.useApp();
  const submit = async () => {
    setBusy(true);
    try {
      const p = await form.validateFields();
      await api("/expenses", { ...p, amount: cents(p.yuan) });
      message.success("费用已登记");
      setOpen(false);
      form.resetFields();
      reload();
    } catch (e: any) {
      if (e.message) setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const reverse = (r: Row) => {
    let reason = "";
    modal.confirm({
      title: "冲正经营费用",
      content: (
        <Input.TextArea
          placeholder="必须填写原因"
          onChange={(e) => {
            reason = e.target.value;
          }}
        />
      ),
      okText: "确认冲正",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`/expenses/${r.id}/reverse`, { reason });
          reload();
        } catch (e: any) {
          message.error(e.message);
          throw e;
        }
      },
    });
  };
  return (
    <>
      <PageTitle
        title="经营费用"
        description="采购货款不登记为费用；采购运费、租金等按归属日计入经营利润"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setOpen(true);
              setActionError("");
            }}
          >
            登记费用
          </Button>
        }
      />
      <ErrorAlert error={error} />
      <section className="panel table-panel">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.items}
          pagination={{
            current: page,
            total: data?.total,
            pageSize: 30,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            { title: "归属日期", dataIndex: "business_date" },
            { title: "费用类别", dataIndex: "category" },
            {
              title: "金额",
              dataIndex: "amount",
              align: "right",
              render: (v: number, r: Row) =>
                `${r.is_reversal ? "-" : ""}${money(v)}`,
            },
            { title: "支付渠道", dataIndex: "channel" },
            { title: "备注", dataIndex: "note" },
            { title: "登记时间", dataIndex: "created_at", render: when },
            {
              title: "操作",
              render: (_: any, r: Row) =>
                r.is_reversal ? (
                  <Tag>冲正流水</Tag>
                ) : (
                  <Button type="link" danger onClick={() => reverse(r)}>
                    冲正
                  </Button>
                ),
            },
          ]}
        />
      </section>
      <Modal
        open={open}
        title="登记经营费用"
        onCancel={() => setOpen(false)}
        onOk={submit}
        confirmLoading={busy}
        okText="确认登记"
      >
        <ErrorAlert error={actionError} />
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            category: "租金",
            business_date: dayjs().format("YYYY-MM-DD"),
            channel: "现金",
          }}
        >
          <Form.Item
            name="category"
            label="费用类别"
            rules={[{ required: true }]}
          >
            <Select
              options={["租金", "人工", "水电", "采购运费", "办公", "其他"].map(
                (v) => ({ value: v, label: v }),
              )}
            />
          </Form.Item>
          <Form.Item
            name="yuan"
            label="金额（元）"
            rules={[{ required: true }]}
          >
            <MoneyInput />
          </Form.Item>
          <Form.Item
            name="business_date"
            label="归属日期"
            rules={[{ required: true }]}
          >
            <Input type="date" />
          </Form.Item>
          <Form.Item name="channel" label="支付渠道">
            <Select
              options={["现金", "微信", "支付宝", "银行转账", "其他"].map(
                (v) => ({ value: v, label: v }),
              )}
            />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function ImportPanel() {
  const [kind, setKind] = useState("products");
  const [preview, setPreview] = useState<Row>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const read = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      setPreview(await upload("/import/preview/" + kind, file));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
    return false;
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await api("/import/" + preview?.id + "/apply", {});
      message.success(`已导入 ${r.count} 行期初资料`);
      setPreview(undefined);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>
        下载模板填写后预览。金额单位为整数分，数量为整数件；不会导入完整历史订单。
      </p>
      <Space wrap>
        <Select
          value={kind}
          onChange={(v) => {
            setKind(v);
            setPreview(undefined);
          }}
          options={[
            { value: "products", label: "商品 / SKU / 期初库存" },
            { value: "customer", label: "客户 / 期初应收" },
            { value: "supplier", label: "供应商 / 期初应付" },
          ]}
          style={{ width: 230 }}
        />
        <Button
          icon={<DownloadOutlined />}
          href={"/api/import/template/" + kind}
        >
          下载空白模板
        </Button>
        <Upload accept=".xlsx" showUploadList={false} beforeUpload={read}>
          <Button loading={busy} icon={<UploadOutlined />}>
            选择 Excel 并预览
          </Button>
        </Upload>
      </Space>
      <ErrorAlert error={error} />
      {preview && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type={preview.errors.length ? "error" : "success"}
            showIcon
            message={`有效 ${preview.total} 行，错误 ${preview.errors.length} 行（最多预览200行）`}
            description={preview.errors.slice(0, 20).map((r: Row) => (
              <div key={r.row}>
                第{r.row}行：{r.error}
              </div>
            ))}
          />
          <Table
            size="small"
            style={{ margin: "12px 0" }}
            scroll={{ x: 1200 }}
            rowKey={(_: any, i?: number) => i!}
            dataSource={preview.rows}
            columns={Object.keys(preview.rows[0] || {}).map((k) => ({
              title: k,
              dataIndex: k,
            }))}
            pagination={{ pageSize: 10 }}
          />
          <Button
            type="primary"
            disabled={preview.errors.length > 0}
            loading={busy}
            onClick={apply}
          >
            确认导入全部有效资料
          </Button>
        </div>
      )}
    </>
  );
}

export function Settings({
  session,
  onUpdated,
}: {
  session: Row;
  onUpdated: () => void;
}) {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "shop";
  const activeTab = ["shop", "import", "backup", "help"].includes(tab) ? tab : "shop";
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message, modal } = App.useApp();
  const save = async () => {
    setBusy(true);
    try {
      const p = await form.validateFields();
      await api("/settings", p, "PUT");
      message.success("设置已保存");
      onUpdated();
    } catch (e: any) {
      if (e.message) setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const restore = (file: File) => {
    modal.confirm({
      title: "确认恢复完整备份",
      content:
        "恢复将替换当前数据库、商品图片与配置。系统会先校验文件并保存恢复前保护副本。请确认已选择正确的经营备份。",
      okText: "确认替换并恢复",
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          const r = await upload("/restore", file, true);
          message.success("恢复成功；保护副本：" + r.protection, 8);
          onUpdated();
          form.resetFields();
        } catch (e: any) {
          setError(e.message);
        } finally {
          setBusy(false);
        }
      },
    });
    return false;
  };
  return (
    <>
      <PageTitle
        title="系统设置"
        description="店铺信息、期初资料、备份与使用帮助"
      />
      <ErrorAlert error={error} />
      <section className="panel">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setParams({ tab: key })}
          items={[
            {
              key: "shop",
              label: "店铺信息",
              children: (
                <Form
                  form={form}
                  initialValues={session.settings}
                  layout="vertical"
                  style={{ maxWidth: 480 }}
                >
                  <Form.Item
                    name="shop_name"
                    label="店铺名称"
                    rules={[{ required: true }]}
                  >
                    <Input maxLength={80} />
                  </Form.Item>
                  <Form.Item name="start_date" label="启用日期">
                    <Input disabled />
                  </Form.Item>
                  <Form.Item
                    name="default_threshold"
                    label="新增 SKU 默认库存预警阈值（件）"
                  >
                    <InputNumber min={0} precision={0} />
                  </Form.Item>
                  <Button type="primary" loading={busy} onClick={save}>
                    保存店铺设置
                  </Button>
                </Form>
              ),
            },
            {
              key: "import",
              label: "Excel 期初导入",
              children: <ImportPanel />,
            },
            {
              key: "backup",
              label: "备份与恢复",
              children: (
                <>
                  <Alert
                    type="info"
                    showIcon
                    message="数据只保存在这台电脑"
                    description="更换电脑、重装系统前，请先手动创建完整备份，并另存到其他磁盘或移动存储设备。"
                  />
                  <div className="setting-row">
                    <div>
                      <h3>完整备份</h3>
                      <p>
                        包含数据库、商品图片、店铺配置和完整性校验清单，可用于新电脑迁移。
                      </p>
                    </div>
                    <Button
                      type="primary"
                      href="/api/backup"
                      icon={<DownloadOutlined />}
                    >
                      创建并下载完整备份
                    </Button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>从完整备份恢复</h3>
                      <p>校验通过后替换本机数据，并保存恢复前保护副本。</p>
                    </div>
                    <Upload
                      accept=".zip"
                      showUploadList={false}
                      beforeUpload={restore}
                    >
                      <Button danger loading={busy} icon={<UploadOutlined />}>
                        选择备份并恢复
                      </Button>
                    </Upload>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>全量经营数据 Excel</h3>
                      <p>
                        用于查阅与留存。Excel
                        不包含图片，完整迁移请使用完整备份。
                      </p>
                    </div>
                    <Button href="/api/export" icon={<DownloadOutlined />}>
                      导出全部经营数据
                    </Button>
                  </div>
                  <Descriptions
                    column={1}
                    bordered
                    size="small"
                    items={[
                      {
                        key: "path",
                        label: "本机数据目录",
                        children: <code>{session.data_dir}</code>,
                      },
                      {
                        key: "version",
                        label: "程序版本",
                        children: session.version,
                      },
                    ]}
                  />
                </>
              ),
            },
            {
              key: "help",
              label: "使用帮助",
              children: <Help embedded />,
            },
          ]}
        />
      </section>
    </>
  );
}

export function Help({ embedded = false }: { embedded?: boolean }) {
  const { data, error } = useLoad("/help");
  return (
    <>
      {!embedded && <PageTitle
        title="使用帮助"
        description="核心业务操作说明，断网后仍可查阅"
      />}
      <ErrorAlert error={error} />
      <article className={embedded ? "help-text help-embedded" : "panel help-text"}>
        {data?.content
          .split("\n")
          .map((line: string, i: number) =>
            line.startsWith("# ") ? (
              <h1 key={i}>{line.slice(2)}</h1>
            ) : line.startsWith("## ") ? (
              <h2 key={i}>{line.slice(3)}</h2>
            ) : line.startsWith("### ") ? (
              <h3 key={i}>{line.slice(4)}</h3>
            ) : (
              <p key={i}>{line}</p>
            ),
          )}
      </article>
    </>
  );
}
