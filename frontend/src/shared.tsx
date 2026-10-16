import React, { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  SearchOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { api, cents, money, Row, stateLabel } from "./api";

export function useLoad<T = any>(path: string, deps: any[] = []) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, version, ...deps]);
  return { data, loading, error, reload: () => refresh((v) => v + 1), setData };
}
export function PageTitle({
  title,
  description,
  extra,
}: {
  title: string;
  description?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      <Space wrap>{extra}</Space>
    </div>
  );
}
export function ErrorAlert({ error }: { error?: string }) {
  return error ? (
    <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />
  ) : null;
}
export function Search({
  value,
  onChange,
  placeholder = "输入关键词搜索",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <Input
      prefix={<SearchOutlined />}
      value={value}
      allowClear
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: 280 }}
    />
  );
}
export function EmptyState({
  text = "暂无记录，请先新增资料或业务单据",
}: {
  text?: string;
}) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={text} />;
}
export function Status({
  value,
  kind,
  terminated,
}: {
  value: string;
  kind?: string;
  terminated?: boolean;
}) {
  return (
    <Space size={4}>
      <Tag
        color={
          value === "completed"
            ? "green"
            : value === "partial"
              ? "blue"
              : value === "cancelled"
                ? "default"
                : "gold"
        }
      >
        {stateLabel(value, kind)}
      </Tag>
      {!!terminated && value !== "cancelled" && <Tag>剩余终止</Tag>}
    </Space>
  );
}
export const MoneyInput = ({ value, onChange, ...props }: any) => (
  <InputNumber
    min={0}
    precision={2}
    prefix="¥"
    value={value}
    onChange={onChange}
    controls={false}
    style={{ width: "100%" }}
    {...props}
  />
);
export function PartySelect({
  kind,
  value,
  onChange,
  allowClear = true,
}: {
  kind: string;
  value?: number;
  onChange?: (id: any) => void;
  allowClear?: boolean;
}) {
  const [search, setSearch] = useState("");
  const { data } = useLoad(
    "/parties?kind=" +
      kind +
      "&page_size=1000&qs=" +
      encodeURIComponent(search),
  );
  return (
    <Select
      showSearch
      allowClear={allowClear}
      filterOption={false}
      placeholder={kind === "customer" ? "选择客户；留空为散客" : "选择供应商"}
      value={value}
      onChange={onChange}
      onSearch={setSearch}
      options={data?.items.map((p: Row) => ({
        value: p.id,
        label: p.name + (p.phone ? " · " + p.phone : ""),
      }))}
      style={{ minWidth: 240, width: "100%" }}
    />
  );
}
export function SkuSelect({
  value,
  onChange,
}: {
  value?: number;
  onChange?: (id: number, sku: Row) => void;
}) {
  const [search, setSearch] = useState("");
  const { data } = useLoad(
    "/skus?page_size=100&q=" + encodeURIComponent(search),
  );
  return (
    <Select
      value={value}
      showSearch
      filterOption={false}
      onSearch={setSearch}
      placeholder="搜索款号、名称或条码"
      style={{ width: "100%", minWidth: 220 }}
      options={data?.items
        .filter((s: Row) => s.active && s.product_active)
        .map((s: Row) => ({
          value: s.id,
          label: `${s.code} ${s.name} / ${s.color} / ${s.size}（可用${s.available}）`,
          sku: s,
        }))}
      onChange={(v, o: any) => onChange?.(v, o.sku)}
    />
  );
}
export function ChannelEditor({
  value = [],
  onChange,
}: {
  value?: Row[];
  onChange?: (v: Row[]) => void;
}) {
  const set = (idx: number, k: string, v: any) =>
    onChange?.(value.map((x, i) => (i === idx ? { ...x, [k]: v } : x)));
  return (
    <div className="channels">
      {value.map((r, i) => (
        <Space key={i} style={{ marginBottom: 6 }}>
          <Select
            aria-label="支付渠道"
            value={r.channel}
            style={{ width: 118 }}
            options={["现金", "微信", "支付宝", "银行转账", "其他"].map(
              (s) => ({ value: s, label: s }),
            )}
            onChange={(v) => set(i, "channel", v)}
          />
          <MoneyInput
            aria-label="收付款金额"
            value={r.yuan}
            onChange={(v: any) => set(i, "yuan", v)}
          />
          <Button
            danger
            type="text"
            onClick={() => onChange?.(value.filter((_, j) => j !== i))}
          >
            移除
          </Button>
        </Space>
      ))}
      <Button
        type="dashed"
        icon={<PlusOutlined />}
        onClick={() => onChange?.([...value, { channel: "现金", yuan: 0 }])}
      >
        添加付款渠道
      </Button>
    </div>
  );
}

export function FundModal({
  party,
  orderId,
  onClose,
  onDone,
}: {
  party?: Row;
  orderId?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const { message } = App.useApp();
  const [pid, setPid] = useState<number | undefined>(party?.id);
  const [kind, setKind] = useState(party?.kind || "customer");
  const [channels, setChannels] = useState<Row[]>([
    { channel: "现金", yuan: 0 },
  ]);
  const [refund, setRefund] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data } = useLoad(pid ? "/parties/" + pid : "/parties?kind=" + kind);
  const total = channels.reduce((a, r) => a + cents(r.yuan), 0);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const chosen = Object.entries(amounts)
        .filter(([, a]) => a > 0)
        .map(([id, a]) => ({
          [refund ? "credit_id" : "debt_id"]: Number(id),
          amount: cents(a),
        }));
      await api("/funds", {
        party_id: pid,
        order_id: orderId,
        channels: channels
          .filter((r) => cents(r.yuan) > 0)
          .map((r) => ({ channel: r.channel, amount: cents(r.yuan) })),
        note,
        refund,
        [refund ? "refund_credits" : "allocations"]: chosen,
      });
      message.success("资金流水已登记");
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const list =
    (refund ? data?.credits : data?.debts)?.filter((r: Row) => r.balance > 0) ||
    [];
  return (
    <Modal
      open
      title={refund ? "登记退款" : "登记收付款"}
      width={760}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText="确认登记"
      destroyOnHidden
    >
      <ErrorAlert error={error} />
      <Space style={{ marginBottom: 14 }}>
        <Select
          value={kind}
          disabled={!!party}
          options={[
            { value: "customer", label: "客户收款" },
            { value: "supplier", label: "供应商付款" },
          ]}
          onChange={(v) => {
            setKind(v);
            setPid(undefined);
            setAmounts({});
          }}
        />
        <PartySelect
          kind={kind}
          value={pid}
          onChange={(v) => {
            setPid(v);
            setAmounts({});
          }}
        />
        <Select
          value={refund}
          options={[
            { value: false, label: "正常收付" },
            { value: true, label: "退回预收付 / 退货退款" },
          ]}
          onChange={(v) => {
            setRefund(v);
            setAmounts({});
          }}
        />
      </Space>
      <ChannelEditor value={channels} onChange={setChannels} />
      <div className="total-line">
        本次实际金额 <b>¥ {money(total)}</b>
      </div>
      <Alert
        type="info"
        showIcon
        message={
          refund
            ? "明确选择可退贷项，分配合计必须等于退款额。"
            : "可手动核销多笔欠款；未核销部分保留为预收 / 预付款。"
        }
        style={{ margin: "12px 0" }}
      />
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={list}
        columns={[
          { title: refund ? "可用贷项" : "待核销债项", dataIndex: "source" },
          { title: "余额", dataIndex: "balance", render: money },
          {
            title: refund ? "本次退款" : "本次核销",
            render: (_: any, r: Row) => (
              <MoneyInput
                value={amounts[r.id]}
                max={r.balance / 100}
                onChange={(v: number) => setAmounts({ ...amounts, [r.id]: v })}
              />
            ),
          },
        ]}
        locale={{
          emptyText: (
            <EmptyState text={pid ? "暂无未结余额" : "请先选择往来单位"} />
          ),
        }}
      />
      <Input.TextArea
        placeholder="文字备注"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ marginTop: 12 }}
      />
    </Modal>
  );
}

export function AllocationModal({
  party,
  onClose,
  onDone,
}: {
  party: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const [cid, setCid] = useState<number>();
  const [amounts, setAmounts] = useState<Row>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const { data } = useLoad("/parties/" + party.id);
  const submit = async () => {
    setBusy(true);
    try {
      await api("/allocations", {
        items: Object.entries(amounts)
          .filter(([, v]) => Number(v) > 0)
          .map(([id, v]) => ({
            credit_id: cid,
            debt_id: Number(id),
            amount: cents(v),
          })),
      });
      message.success("核销完成，资金未重复记账");
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="手动核销往来欠款"
      width={680}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText="确认核销"
    >
      <ErrorAlert error={error} />
      <Select
        placeholder="选择预收 / 预付 / 退货贷项"
        style={{ width: "100%", marginBottom: 16 }}
        value={cid}
        onChange={setCid}
        options={data?.credits
          .filter((r: Row) => r.balance > 0)
          .map((r: Row) => ({
            value: r.id,
            label: `#${r.id} ${r.source} · 可用 ¥${money(r.balance)}`,
          }))}
      />
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={data?.debts.filter((r: Row) => r.balance > 0)}
        columns={[
          { title: "债项", dataIndex: "source" },
          { title: "未结金额", dataIndex: "balance", render: money },
          {
            title: "分配金额",
            render: (_: any, r: Row) => (
              <MoneyInput
                max={r.balance / 100}
                value={amounts[r.id]}
                onChange={(v: number) => setAmounts({ ...amounts, [r.id]: v })}
              />
            ),
          },
        ]}
      />
    </Modal>
  );
}
