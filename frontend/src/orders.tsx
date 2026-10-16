import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import {
  BarcodeOutlined,
  PlusOutlined,
  PrinterOutlined,
  ReloadOutlined,
  SaveOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, cents, money, Row, stateLabel, when } from "./api";
import { ProductForm } from "./stock";
import {
  ChannelEditor,
  EmptyState,
  ErrorAlert,
  FundModal,
  MoneyInput,
  PageTitle,
  PartySelect,
  Search,
  SkuSelect,
  Status,
  useLoad,
} from "./shared";

function MatrixPicker({
  onAdd,
  onClose,
  kind,
}: {
  onAdd: (r: Row[]) => void;
  onClose: () => void;
  kind: string;
}) {
  const [search, setSearch] = useState("");
  const { data, loading } = useLoad(
    "/skus?page_size=1000&q=" + encodeURIComponent(search),
  );
  const [selected, setSelected] = useState<number>();
  const [qty, setQty] = useState<Row>({});
  const products = Array.from(
    new Map(
      (data?.items || [])
        .filter((s: Row) => s.active && s.product_active)
        .map((s: Row) => [s.product_id, s]),
    ).values(),
  ) as Row[];
  const skus = (data?.items || []).filter(
    (s: Row) => s.product_id === selected,
  );
  const sizes = [...new Set(skus.map((s: Row) => s.size))] as string[];
  const colors = [...new Set(skus.map((s: Row) => s.color))] as string[];
  return (
    <Modal
      open
      title="颜色尺码矩阵选货"
      width={950}
      onCancel={onClose}
      okText="加入开单明细"
      onOk={() => {
        onAdd(
          skus
            .filter((s: Row) => qty[s.id] > 0)
            .map((s: Row) => ({
              ...s,
              qty: qty[s.id],
              price: kind === "sale" ? s.price : s.avg_cost,
            })),
        );
        onClose();
      }}
    >
      <Search
        value={search}
        onChange={setSearch}
        placeholder="搜索款号、名称、条码"
      />
      <div className="matrix-picker">
        <div className="matrix-products">
          {products.map((p) => (
            <button
              key={p.product_id}
              className={selected === p.product_id ? "selected" : ""}
              onClick={() => {
                setSelected(p.product_id);
                setQty({});
              }}
            >
              <b>{p.code}</b>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="matrix-grid">
          {selected ? (
            <>
              <h3>{products.find((p) => p.product_id === selected)?.name}</h3>
              <Table
                rowKey="color"
                size="small"
                bordered
                pagination={false}
                dataSource={colors.map((color) => ({ color }))}
                columns={[
                  { title: "颜色 / 尺码", dataIndex: "color", width: 100 },
                  ...sizes.map((size) => ({
                    title: size,
                    render: (_: any, r: Row) => {
                      const s = skus.find(
                        (s: Row) => s.color === r.color && s.size === size,
                      );
                      return s ? (
                        <div className="matrix-cell">
                          <span className="subtle">可用 {s.available}</span>
                          <InputNumber
                            aria-label={r.color + size + "件数"}
                            min={0}
                            precision={0}
                            value={qty[s.id]}
                            onChange={(v) => setQty({ ...qty, [s.id]: v || 0 })}
                            style={{ width: 80 }}
                          />
                        </div>
                      ) : (
                        "—"
                      );
                    },
                  })),
                ]}
              />
            </>
          ) : (
            <EmptyState text="先选择左侧商品，再填写颜色尺码数量。" />
          )}
        </div>
      </div>
    </Modal>
  );
}

export function OrderEditor({ kind }: { kind: string }) {
  const n = useNavigate();
  const [query] = useSearchParams();
  const editId = query.get("draft");
  const { message, modal } = App.useApp();
  const key = "xianbiz.draft." + kind;
  const [party, setParty] = useState<number>();
  const [lines, setLines] = useState<Row[]>([]);
  const [note, setNote] = useState("");
  const [direct, setDirect] = useState(true);
  const [payments, setPayments] = useState<Row[]>([]);
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [matrix, setMatrix] = useState(false);
  const [newProduct, setNewProduct] = useState(false);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState("");
  const [freight, setFreight] = useState(0);
  useEffect(() => {
    let active = true;
    setReady(false);
    setLines([]);
    setParty(undefined);
    setNote("");
    setPayments([]);
    setError("");
    (editId
      ? api("/orders/" + editId).then((o) => {
          if (o.state !== "draft") throw new Error("只有草稿可以编辑");
          return {
            party: o.party_id,
            lines: o.lines.map((l: Row) => ({ ...l, id: l.sku_id })),
            note: o.note,
            direct: false,
          };
        })
      : api("/drafts/" + kind)
    )
      .then((server) => {
        if (!active) return;
        let r = server;
        const value = localStorage.getItem(key);
        if (value && !editId) {
          try {
            const local = JSON.parse(value);
            if ((local.updated || 0) > (r.updated || 0)) r = local;
          } catch {
            localStorage.removeItem(key);
          }
        }
        if (r.lines?.length || r.note || r.payments?.length) {
          setParty(r.party);
          setLines(r.lines || []);
          setNote(r.note || "");
          setDirect(r.direct ?? true);
          setPayments(r.payments || []);
          message.info("已恢复本机尚未提交的开单内容");
        }
        setReady(true);
      })
      .catch((e) => {
        if (active) {
          setError("暂存读取失败：" + e.message);
          setReady(true);
        }
      });
    return () => {
      active = false;
      window.xianbizDirty = false;
    };
  }, [kind, editId]);
  useEffect(() => {
    if (!ready) return;
    const dirty = lines.length > 0 || !!note || payments.length > 0;
    window.xianbizDirty = dirty;
    const draft = { party, lines, note, direct, payments, updated: Date.now() };
    if (dirty) {
      try {
        localStorage.setItem(key, JSON.stringify(draft));
        setSaved(new Date().toLocaleTimeString("zh-CN"));
      } catch {
        setError("浏览器暂存失败，请及时提交或复制单据内容。");
      }
    } else localStorage.removeItem(key);
    const timer = window.setTimeout(
      () =>
        api("/drafts/" + kind, draft, "PUT").catch((e) =>
          setError("磁盘暂存失败：" + e.message),
        ),
      250,
    );
    return () => clearTimeout(timer);
  }, [party, lines, note, direct, payments, ready]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (window.xianbizDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, []);
  const add = (incoming: Row[]) =>
    setLines((old) => {
      const next = [...old];
      for (const r of incoming) {
        const i = next.findIndex((l) => l.id === r.id);
        if (i >= 0) next[i] = { ...next[i], qty: next[i].qty + r.qty };
        else next.push({ ...r, price: r.price ?? 0 });
      }
      return next;
    });
  const scan = async () => {
    if (!search.trim()) return;
    try {
      const result = await api(
        "/skus?q=" + encodeURIComponent(search) + "&page_size=100",
      );
      const exact = result.items.find(
        (s: Row) => s.barcode === search || s.code === search,
      );
      if (exact) {
        add([
          {
            ...exact,
            qty: 1,
            price: kind === "sale" ? exact.price : exact.avg_cost,
          },
        ]);
        setSearch("");
      } else if (result.items.length === 1) {
        const s = result.items[0];
        add([{ ...s, qty: 1, price: kind === "sale" ? s.price : s.avg_cost }]);
        setSearch("");
      } else {
        message.info("找到多款或未找到精确商品，请使用矩阵选货");
        setMatrix(true);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };
  const update = (idx: number, k: string, v: any) =>
    setLines(lines.map((r, i) => (i === idx ? { ...r, [k]: v } : r)));
  const total = lines.reduce((t, r) => t + r.qty * r.price, 0);
  const payment = payments.reduce((t, p) => t + cents(p.yuan), 0);
  const risk =
    kind === "sale" && direct && lines.some((r) => r.qty > r.available);
  const submit = async (draft = false, next = false) => {
    setBusy(true);
    setError("");
    try {
      if (!lines.length) throw new Error("请先添加商品");
      if (risk && !force && !draft)
        throw new Error(
          "库存不足或存在预留。请选择预订，或确认强制出库风险并填写原因。",
        );
      const payload = {
        kind,
        party_id: party,
        lines: lines.map((r) => ({
          sku_id: r.id,
          qty: r.qty,
          price: r.price,
          estimate: r.estimate !== undefined ? cents(r.estimate) : undefined,
        })),
        note,
        direct,
        force,
        reason,
        draft,
        payments: payments
          .filter((r) => cents(r.yuan) > 0)
          .map((r) => ({ channel: r.channel, amount: cents(r.yuan) })),
        freight: cents(freight),
      };
      const r = await api(
        "/orders" + (editId ? "/" + editId : ""),
        payload,
        editId ? "PUT" : "POST",
      );
      localStorage.removeItem(key);
      window.xianbizDirty = false;
      setLines([]);
      setPayments([]);
      setNote("");
      setForce(false);
      setReason("");
      setSaved("");
      message.success(draft ? "草稿已保存，尚未记账" : "订单已确认");
      r.warnings?.forEach((w: string) => message.warning(w, 8));
      if (!next) n(kind === "sale" ? "/sales" : "/purchases");
      else if (editId) n("/sales/new");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const confirmSubmit = (draft = false, next = false) => {
    if (force && !draft) {
      modal.confirm({
        title: "确认强制出库",
        content:
          "此操作可能挪用其他客户的预留，并形成负账面库存。受影响订单将重新欠货，后续补货仍需手动分配。",
        okText: "确认风险并提交",
        okButtonProps: { danger: true },
        onOk: () => submit(draft, next),
      });
    } else submit(draft, next);
  };
  return (
    <>
      <PageTitle
        title={kind === "sale" ? "销售开单" : "采购开单"}
        description={
          kind === "sale"
            ? "先选客户与商品，再选择直接交付或预订；实际交付才形成收入和应收"
            : "实际收货才增加库存和形成应付，未到货可先登记预订与定金"
        }
        extra={
          <Button
            onClick={() => {
              if (window.xianbizDirty)
                modal.confirm({
                  title: "返回列表",
                  content: "尚未提交内容已暂存在本机。",
                  okText: "返回并保留暂存",
                  onOk: () => n(kind === "sale" ? "/sales" : "/purchases"),
                });
              else n(kind === "sale" ? "/sales" : "/purchases");
            }}
          >
            返回列表
          </Button>
        }
      />
      <ErrorAlert error={error} />
      <section className="panel order-top">
        <div>
          <label>{kind === "sale" ? "客户" : "供应商"}</label>
          <PartySelect
            kind={kind === "sale" ? "customer" : "supplier"}
            value={party}
            onChange={setParty}
          />
        </div>
        <div>
          <label>履约方式</label>
          <Radio.Group
            value={direct}
            onChange={(e) => setDirect(e.target.value)}
          >
            <Radio.Button value={true}>
              {kind === "sale" ? "直接交付" : "直接收货"}
            </Radio.Button>
            <Radio.Button value={false}>
              {kind === "sale" ? "预订 / 待交付" : "预订 / 待收货"}
            </Radio.Button>
          </Radio.Group>
        </div>
        <div className="subtle">
          {kind === "sale" && !party
            ? "散客必须直接全部交付并全额结清。"
            : "可以分批履约，收付款状态单独核算。"}
        </div>
      </section>
      <section className="panel table-panel">
        <div className="toolbar inline">
          <Input
            prefix={<BarcodeOutlined />}
            placeholder="扫码后按 Enter，或输入款号 / 名称"
            style={{ width: 360 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onPressEnter={scan}
            autoFocus
            aria-label="扫码或搜索商品"
          />
          <Button onClick={scan}>搜索加入</Button>
          <Button icon={<PlusOutlined />} onClick={() => setMatrix(true)}>
            颜色尺码矩阵选货
          </Button>
          {kind === "purchase" && (
            <Button icon={<PlusOutlined />} onClick={() => setNewProduct(true)}>
              新增商品并采购
            </Button>
          )}
          <span className="subtle">Tab 切换字段 · 支持连续开单</span>
        </div>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={lines}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: (
              <EmptyState
                text={
                  kind === "purchase"
                    ? "首次进货可直接新增商品并采购；补货请搜索已有商品或用矩阵选货。"
                    : "扫码快速加入商品，或打开颜色尺码矩阵批量填写件数。"
                }
              />
            ),
          }}
          columns={[
            {
              title: "款号 / 商品名称",
              width: 215,
              render: (_: any, r: Row) => (
                <>
                  <b>{r.code}</b>
                  <div className="subtle">{r.name}</div>
                </>
              ),
            },
            {
              title: "颜色 / 尺码",
              width: 130,
              render: (_: any, r: Row) => r.color + " / " + r.size,
            },
            {
              title: "可用 / 账面",
              width: 100,
              render: (_: any, r: Row) => (
                <span
                  className={
                    kind === "sale" && r.qty > r.available ? "warning" : ""
                  }
                >
                  {r.available} / {r.stock}
                </span>
              ),
            },
            {
              title: "件数",
              width: 100,
              render: (_: any, r: Row, i: number) => (
                <InputNumber
                  aria-label={r.code + "数量"}
                  min={1}
                  precision={0}
                  value={r.qty}
                  onChange={(v) => update(i, "qty", v || 1)}
                />
              ),
            },
            {
              title: kind === "purchase" ? "采购单价（元）" : "成交单价（元）",
              width: 140,
              render: (_: any, r: Row, i: number) => (
                <MoneyInput
                  aria-label={`${r.code} ${r.color} ${r.size} ${kind === "purchase" ? "采购单价" : "成交单价"}`}
                  value={r.price / 100}
                  onChange={(v: number) => update(i, "price", cents(v))}
                />
              ),
            },
            {
              title: "金额",
              width: 110,
              align: "right",
              render: (_: any, r: Row) => money(r.qty * r.price),
            },
            {
              title: "无历史价时暂估成本",
              width: 160,
              render: (_: any, r: Row, i: number) =>
                kind === "sale" && !r.cost_known ? (
                  <MoneyInput
                    value={r.estimate}
                    onChange={(v: number) => update(i, "estimate", v)}
                  />
                ) : (
                  <span className="subtle">最近成本 ¥{money(r.avg_cost)}</span>
                ),
            },
            {
              title: "操作",
              width: 70,
              render: (_: any, r: Row, i: number) => (
                <Button
                  type="text"
                  danger
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}
                >
                  移除
                </Button>
              ),
            },
          ]}
        />
      </section>
      <div className="order-bottom">
        <section className="panel">
          <h2>收付款登记</h2>
          <p className="subtle">
            可留空后续登记；提前收付款为预收 / 预付，履约时结转。
          </p>
          <ChannelEditor value={payments} onChange={setPayments} />
          {kind === "purchase" && (
            <div style={{ marginTop: 16 }}>
              <label>本次采购运费（单独记经营费用）</label>
              <MoneyInput value={freight} onChange={setFreight} />
            </div>
          )}
        </section>
        <section className="panel">
          <h2>单据备注与风险</h2>
          <Input.TextArea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="仅支持文字备注"
          />
          {kind === "sale" && direct && (
            <>
              <Checkbox
                style={{ marginTop: 14 }}
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
              >
                确认警告后强制出库（允许挪用预留 / 负库存）
              </Checkbox>
              {force && (
                <Input
                  style={{ marginTop: 8 }}
                  placeholder="必须填写强制出库原因"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              )}
            </>
          )}
          {risk && (
            <Alert
              style={{ marginTop: 12 }}
              type="warning"
              showIcon
              message="按上次查询库存，本单存在库存不足或预留占用，提交时将再次校验。"
            />
          )}
        </section>
      </div>
      <div className="order-submit">
        <span className="subtle">
          {saved ? "已本机暂存 " + saved : "未提交不产生库存或资金流水"}
        </span>
        <Space size={20}>
          <span>
            合计 <b>{lines.reduce((s, r) => s + r.qty, 0)}</b> 件
          </span>
          <span>
            合同金额 <strong>¥ {money(total)}</strong>
          </span>
          <span>
            本次收付 <b>¥ {money(payment)}</b>
          </span>
          {kind === "sale" ? (
            <Button
              icon={<SaveOutlined />}
              loading={busy}
              onClick={() => confirmSubmit(true)}
            >
              保存草稿
            </Button>
          ) : (
            <Button onClick={() => n("/purchases")}>暂存并返回</Button>
          )}
          <Button loading={busy} onClick={() => confirmSubmit(false, true)}>
            确认并新建下一单
          </Button>
          <Button type="primary" loading={busy} onClick={() => confirmSubmit()}>
            确认提交
          </Button>
        </Space>
      </div>
      {matrix && (
        <MatrixPicker
          kind={kind}
          onClose={() => setMatrix(false)}
          onAdd={add}
        />
      )}
      {newProduct && kind === "purchase" && (
        <ProductForm
          purchase
          onClose={() => setNewProduct(false)}
          onDone={() => {}}
          onCreated={add}
        />
      )}
    </>
  );
}

function FulfillModal({
  order,
  onClose,
  onDone,
  reserve = false,
}: {
  order: Row;
  onClose: () => void;
  onDone: () => void;
  reserve?: boolean;
}) {
  const [qty, setQty] = useState<Row>({});
  const [estimates, setEstimates] = useState<Row>({});
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState("");
  const [freight, setFreight] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message, modal } = App.useApp();
  const submit = async () => {
    setBusy(true);
    try {
      const lines = Object.entries(qty)
        .filter(([, v]) => Number(v) > 0)
        .map(([id, q]) => ({
          line_id: Number(id),
          qty: q,
          estimate:
            estimates[id] !== undefined ? cents(estimates[id]) : undefined,
        }));
      if (!lines.length) throw new Error("请填写至少一个 SKU 的本次数量");
      await api(`/orders/${order.id}/${reserve ? "reserve" : "fulfill"}`, {
        lines,
        force,
        reason,
        freight: cents(freight),
      });
      message.success(reserve ? "补货已手动分配" : "履约已确认");
      onDone();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const click = () =>
    force
      ? modal.confirm({
          title: "确认强制出库风险",
          content:
            "可能挪用其他客户预留及产生负库存，受影响订单会留有完整记录。",
          okText: "确认并出库",
          okButtonProps: { danger: true },
          onOk: submit,
        })
      : submit();
  return (
    <Modal
      open
      width={860}
      title={
        reserve
          ? "手动分配库存"
          : order.kind === "sale"
            ? "确认本次交付"
            : "确认本次收货"
      }
      onCancel={onClose}
      onOk={click}
      confirmLoading={busy}
      okText="确认本次操作"
    >
      <ErrorAlert error={error} />
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.lines.filter(
          (l: Row) => l.qty - l.fulfilled - l.terminated > 0,
        )}
        columns={[
          { title: "商品 SKU", dataIndex: "description" },
          {
            title: "待履约",
            render: (_: any, r: Row) => r.qty - r.fulfilled - r.terminated,
          },
          { title: "已预留", dataIndex: "reserved" },
          { title: "可分配", dataIndex: "available" },
          {
            title: "本次数量",
            render: (_: any, r: Row) => (
              <InputNumber
                min={0}
                precision={0}
                max={
                  reserve
                    ? r.qty - r.fulfilled - r.terminated - r.reserved
                    : r.qty - r.fulfilled - r.terminated
                }
                value={qty[r.id]}
                onChange={(v) => setQty({ ...qty, [r.id]: v || 0 })}
              />
            ),
          },
          ...(!reserve && order.kind === "sale"
            ? [
                {
                  title: "无历史成本时暂估",
                  render: (_: any, r: Row) =>
                    r.cost_known ? (
                      <span>¥{money(r.avg_cost)}</span>
                    ) : (
                      <MoneyInput
                        value={estimates[r.id]}
                        onChange={(v: number) =>
                          setEstimates({ ...estimates, [r.id]: v })
                        }
                      />
                    ),
                },
              ]
            : []),
        ]}
      />
      {!reserve && order.kind === "sale" && (
        <>
          <Checkbox
            checked={force}
            onChange={(e) => setForce(e.target.checked)}
            style={{ marginTop: 16 }}
          >
            确认风险后强制出库，允许挪用其他订单预留
          </Checkbox>
          {force && (
            <Input
              style={{ marginTop: 10 }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="必须填写原因"
            />
          )}
        </>
      )}
      {!reserve && order.kind === "purchase" && (
        <div style={{ marginTop: 12 }}>
          本次运费（经营费用）
          <MoneyInput value={freight} onChange={setFreight} />
        </div>
      )}
    </Modal>
  );
}

function ReturnModal({
  order,
  onClose,
  onDone,
}: {
  order: Row;
  onClose: () => void;
  onDone: () => void;
}) {
  const [qty, setQty] = useState<Row>({});
  const [sellable, setSellable] = useState<Row>({});
  const [reason, setReason] = useState("");
  const [settlement, setSettlement] = useState<Row[]>([]);
  const anonymous = order.party?.name === "__anonymous__";
  const [exchange, setExchange] = useState(false);
  const [lines, setLines] = useState<Row[]>([]);
  const [matrix, setMatrix] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const submit = async () => {
    setBusy(true);
    try {
      await api(`/orders/${order.id}/returns`, {
        reason,
        settlement_channels: settlement
          .filter((r) => cents(r.yuan) > 0)
          .map((r) => ({ channel: r.channel, amount: cents(r.yuan) })),
        lines: Object.entries(qty)
          .filter(([, q]) => Number(q) > 0)
          .map(([id, q]) => ({
            fulfillment_id: Number(id),
            qty: q,
            sellable: sellable[id] !== false,
          })),
        exchange: exchange
          ? {
              direct: true,
              lines: lines.map((r) => ({
                sku_id: r.id,
                qty: r.qty,
                price: r.price,
              })),
              note: "换货关联 " + order.number,
            }
          : undefined,
      });
      message.success("退换货已生效；剩余款项请在往来中核销或退款");
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
      title="退货 / 跨款色码换货"
      width={1000}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={busy}
      okText="确认退换货"
    >
      <ErrorAlert error={error} />
      <Alert
        type="info"
        message="退货先抵扣原单未结债项；余额可退款或手动核销换货新单。换货新单与退货在同一事务内提交。"
        showIcon
        style={{ marginBottom: 14 }}
      />
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={order.fulfillments.filter((f: Row) => f.qty > f.returned)}
        columns={[
          { title: "原履约商品", dataIndex: "description" },
          { title: "履约时间", dataIndex: "created_at", render: when },
          { title: "可退件数", render: (_: any, r: Row) => r.qty - r.returned },
          {
            title: "本次退货",
            render: (_: any, r: Row) => (
              <InputNumber
                min={0}
                precision={0}
                max={r.qty - r.returned}
                value={qty[r.id]}
                onChange={(v) => setQty({ ...qty, [r.id]: v || 0 })}
              />
            ),
          },
          ...(order.kind === "sale"
            ? [
                {
                  title: "退回商品",
                  render: (_: any, r: Row) => (
                    <Select
                      value={sellable[r.id] !== false}
                      style={{ width: 140 }}
                      options={[
                        { value: true, label: "可售，恢复库存" },
                        { value: false, label: "不可售，记损失" },
                      ]}
                      onChange={(v) => setSellable({ ...sellable, [r.id]: v })}
                    />
                  ),
                },
              ]
            : []),
        ]}
      />
      <Input.TextArea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="必须填写退换货原因"
        style={{ marginTop: 12 }}
      />
      <Checkbox
        checked={exchange}
        onChange={(e) => setExchange(e.target.checked)}
        style={{ margin: "16px 0" }}
      >
        同时换货（跨款式 / 颜色 / 尺码）
      </Checkbox>
      {exchange && (
        <>
          <Button icon={<PlusOutlined />} onClick={() => setMatrix(true)}>
            选择换入商品
          </Button>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={lines}
            columns={[
              {
                title: "换入SKU",
                render: (_: any, r: Row) =>
                  `${r.code} ${r.name} / ${r.color} / ${r.size}`,
              },
              {
                title: "件数",
                render: (_: any, r: Row, i: number) => (
                  <InputNumber
                    min={1}
                    precision={0}
                    value={r.qty}
                    onChange={(v) =>
                      setLines(
                        lines.map((l, j) =>
                          i === j ? { ...l, qty: v || 1 } : l,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "成交价（元）",
                render: (_: any, r: Row, i: number) => (
                  <MoneyInput
                    value={r.price / 100}
                    onChange={(v: number) =>
                      setLines(
                        lines.map((l, j) =>
                          i === j ? { ...l, price: cents(v) } : l,
                        ),
                      )
                    }
                  />
                ),
              },
              {
                title: "操作",
                render: (_: any, r: Row, i: number) => (
                  <Button
                    type="text"
                    danger
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    移除
                  </Button>
                ),
              },
            ]}
          />
        </>
      )}
      {matrix && (
        <MatrixPicker
          kind={order.kind}
          onClose={() => setMatrix(false)}
          onAdd={(r) => {
            const next = [...lines];
            for (const x of r) {
              const old = next.find((l) => l.id === x.id);
              if (old) old.qty += x.qty;
              else next.push(x);
            }
            setLines(next);
          }}
        />
      )}
      {anonymous && (
        <div style={{ marginTop: 16 }}>
          <Alert
            type="warning"
            showIcon
            message="散客退换货须当场结清。退货金额大于换入金额时登记退款，反之登记补款；等额换货无需资金流水。"
          />
          <div style={{ marginTop: 12 }}>
            <ChannelEditor value={settlement} onChange={setSettlement} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function OrderDetail({
  id,
  onClose,
  onUpdated,
}: {
  id: number;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const { data: o, error, reload } = useLoad("/orders/" + id);
  const [action, setAction] = useState("");
  const [fund, setFund] = useState(false);
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const refresh = () => {
    reload();
    onUpdated();
  };
  const command = (action: string, title: string) => {
    let reason = "";
    modal.confirm({
      title,
      content: (
        <>
          <p>此操作保留已有履约和所有历史流水，原生效日期不会改变。</p>
          <Input.TextArea
            placeholder="请填写原因"
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
        </>
      ),
      okText: "确认操作",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api(`/orders/${id}/${action}`, { reason });
          message.success("操作已完成");
          refresh();
        } catch (e: any) {
          message.error(e.message);
          throw e;
        }
      },
    });
  };
  const print = () => {
    if (!o) return;
    const el = document.getElementById("print-document");
    if (el) {
      el.innerHTML = "";
      const article = document.createElement("article");
      const add = (tag: string, value: string) => {
        const t = document.createElement(tag);
        t.textContent = value;
        article.appendChild(t);
      };
      add("h1", o.kind === "sale" ? "销售单" : "采购单");
      add(
        "p",
        o.number +
          "　" +
          (o.party?.name === "__anonymous__"
            ? "散客"
            : o.party?.name || "散客") +
          "　" +
          when(o.created_at),
      );
      const table = document.createElement("table");
      const tr = document.createElement("tr");
      for (const label of [
        "商品 / 款色码",
        "订购件数",
        "已履约",
        "成交单价",
        "合同金额",
      ]) {
        const th = document.createElement("th");
        th.textContent = label;
        tr.appendChild(th);
      }
      table.appendChild(tr);
      for (const l of o.lines) {
        const r = document.createElement("tr");
        for (const v of [
          l.description,
          l.qty,
          l.fulfilled,
          money(l.price),
          money(l.qty * l.price),
        ]) {
          const c = document.createElement("td");
          c.textContent = String(v);
          r.appendChild(c);
        }
        table.appendChild(r);
      }
      article.appendChild(table);
      add(
        "p",
        "合同合计：¥ " +
          money(o.lines.reduce((s: number, l: Row) => s + l.qty * l.price, 0)),
      );
      add(
        "p",
        "当前未结债项：¥ " +
          money(o.debts.reduce((s: number, d: Row) => s + d.balance, 0)),
      );
      add("p", "备注：" + o.note);
      add(
        "p",
        "签收：________________　　　　打印时间：" +
          new Date().toLocaleString("zh-CN"),
      );
      el.appendChild(article);
      window.print();
    }
  };
  return (
    <Drawer
      open
      title={o?.number || "订单详情"}
      width={1120}
      onClose={onClose}
      extra={
        <Button icon={<PrinterOutlined />} onClick={print}>
          A4 打印 / 保存 PDF
        </Button>
      }
    >
      <ErrorAlert error={error} />
      {o && (
        <>
          <div className="detail-actions">
            <Status
              value={o.state}
              kind={o.kind}
              terminated={o.remaining_terminated}
            />
            <Space wrap>
              {o.state === "draft" && (
                <Button
                  onClick={() => {
                    onClose();
                    navigate("/sales/new?draft=" + id);
                  }}
                >
                  编辑草稿
                </Button>
              )}
              {o.state === "draft" && (
                <Button
                  type="primary"
                  onClick={async () => {
                    try {
                      await api(`/orders/${id}/confirm`, {});
                      refresh();
                    } catch (e: any) {
                      message.error(e.message);
                    }
                  }}
                >
                  确认草稿
                </Button>
              )}
              {["confirmed", "partial"].includes(o.state) &&
                !o.remaining_terminated && (
                  <>
                    <Button type="primary" onClick={() => setAction("fulfill")}>
                      {o.kind === "sale" ? "登记本次交付" : "登记本次收货"}
                    </Button>
                    {o.kind === "sale" && (
                      <Button onClick={() => setAction("reserve")}>
                        手动分配补货
                      </Button>
                    )}
                    <Button
                      danger
                      onClick={() =>
                        command("terminate", "终止未履约的剩余数量")
                      }
                    >
                      终止剩余
                    </Button>
                  </>
                )}
              {o.fulfillments.some((f: Row) => f.qty > f.returned) && (
                <Button onClick={() => setAction("returns")}>
                  退货 / 换货
                </Button>
              )}
              {o.party_id && o.state !== "draft" && (
                <Button onClick={() => setFund(true)}>登记收付 / 退款</Button>
              )}
              <Button danger onClick={() => command("reverse", "整单纠错冲正")}>
                整单冲正
              </Button>
            </Space>
          </div>
          <Descriptions
            column={3}
            size="small"
            bordered
            items={[
              {
                key: "party",
                label: o.kind === "sale" ? "客户" : "供应商",
                children:
                  o.party?.name === "__anonymous__"
                    ? "散客"
                    : o.party?.name || "散客",
              },
              { key: "date", label: "创建时间", children: when(o.created_at) },
              {
                key: "amount",
                label: "合同金额",
                children:
                  "¥ " +
                  money(
                    o.lines.reduce(
                      (s: number, l: Row) => s + l.qty * l.price,
                      0,
                    ),
                  ),
              },
              {
                key: "debt",
                label: "当前未结债项",
                children:
                  "¥ " +
                  money(
                    o.debts.reduce((s: number, d: Row) => s + d.balance, 0),
                  ),
              },
              {
                key: "credit",
                label: "可用预收付 / 贷项",
                children:
                  "¥ " +
                  money(
                    o.credits.reduce((s: number, d: Row) => s + d.balance, 0),
                  ),
              },
              { key: "note", label: "备注", children: o.note || "—" },
            ]}
          />
          <Tabs
            items={[
              {
                key: "lines",
                label: "订单明细",
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    pagination={false}
                    dataSource={o.lines}
                    columns={[
                      { title: "商品 SKU", dataIndex: "description" },
                      { title: "单价", dataIndex: "price", render: money },
                      { title: "订购", dataIndex: "qty" },
                      { title: "预留", dataIndex: "reserved" },
                      { title: "已履约", dataIndex: "fulfilled" },
                      {
                        title: "待补 / 未到",
                        render: (_: any, l: Row) =>
                          l.qty - l.fulfilled - l.terminated - l.reserved,
                      },
                      { title: "已退", dataIndex: "returned" },
                      { title: "终止", dataIndex: "terminated" },
                    ]}
                  />
                ),
              },
              {
                key: "fulfill",
                label: "履约与成本",
                children: (
                  <>
                    <Table
                      rowKey="id"
                      size="small"
                      dataSource={o.fulfillments}
                      columns={[
                        { title: "ID", dataIndex: "id" },
                        { title: "商品", dataIndex: "description" },
                        {
                          title: "时间",
                          dataIndex: "created_at",
                          render: when,
                        },
                        { title: "件数", dataIndex: "qty" },
                        { title: "货款", dataIndex: "amount", render: money },
                        { title: "原始成本", dataIndex: "cost", render: money },
                        {
                          title: "后续校正",
                          dataIndex: "cost_adjustment",
                          render: money,
                        },
                        {
                          title: "结算后成本",
                          render: (_: any, r: Row) =>
                            money(r.cost + r.cost_adjustment),
                        },
                      ]}
                    />
                    <h3>成本校正流水</h3>
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={o.cost_adjustments}
                      columns={[
                        { title: "履约ID", dataIndex: "fulfillment_id" },
                        { title: "关联入库", dataIndex: "source" },
                        { title: "件数", dataIndex: "qty" },
                        { title: "差额", dataIndex: "amount", render: money },
                        {
                          title: "实际调整时间",
                          dataIndex: "created_at",
                          render: when,
                        },
                      ]}
                    />
                  </>
                ),
              },
              {
                key: "returns",
                label: "退换货",
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={o.returns}
                    columns={[
                      { title: "退货号", dataIndex: "number" },
                      { title: "时间", dataIndex: "created_at", render: when },
                      { title: "件数", dataIndex: "qty" },
                      { title: "金额", dataIndex: "amount", render: money },
                      {
                        title: "可售",
                        dataIndex: "sellable",
                        render: (v: number) => (v ? "可售" : "不可售"),
                      },
                      { title: "换货新单ID", dataIndex: "exchange_order_id" },
                      { title: "原因", dataIndex: "reason" },
                    ]}
                  />
                ),
              },
              {
                key: "funds",
                label: "资金记录",
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={o.funds}
                    columns={[
                      { title: "资金号", dataIndex: "number" },
                      { title: "时间", dataIndex: "created_at", render: when },
                      { title: "金额", dataIndex: "amount", render: money },
                      { title: "备注", dataIndex: "note" },
                    ]}
                  />
                ),
              },
              {
                key: "reservations",
                label: "预留变动",
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={o.reservations}
                    columns={[
                      { title: "时间", dataIndex: "created_at", render: when },
                      { title: "明细ID", dataIndex: "line_id" },
                      { title: "数量变化", dataIndex: "qty" },
                      { title: "关联来源", dataIndex: "source" },
                      { title: "原因", dataIndex: "reason" },
                    ]}
                  />
                ),
              },
              {
                key: "history",
                label: "操作历史",
                children: (
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={o.history}
                    columns={[
                      { title: "时间", dataIndex: "created_at", render: when },
                      { title: "操作", dataIndex: "action" },
                      { title: "原因", dataIndex: "reason" },
                      {
                        title: "前后记录",
                        render: (_: any, r: Row) => (
                          <details>
                            <summary>查看记录</summary>
                            <pre>{r.before_json}</pre>
                            <pre>{r.after_json}</pre>
                          </details>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
          {(action === "fulfill" || action === "reserve") && (
            <FulfillModal
              order={o}
              reserve={action === "reserve"}
              onClose={() => setAction("")}
              onDone={refresh}
            />
          )}{" "}
          {action === "returns" && (
            <ReturnModal
              order={o}
              onClose={() => setAction("")}
              onDone={refresh}
            />
          )}{" "}
          {fund && (
            <FundModal
              party={o.party}
              orderId={o.id}
              onClose={() => setFund(false)}
              onDone={refresh}
            />
          )}
        </>
      )}
      <div id="print-document" />
    </Drawer>
  );
}

export function Orders({ kind }: { kind: string }) {
  const [qs, setQs] = useState("");
  const [state, setState] = useState("");
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<any>(null);
  const [detail, setDetail] = useState<number>();
  const n = useNavigate();
  const { data, loading, error, reload } = useLoad(
    `/orders?kind=${kind}&qs=${encodeURIComponent(qs)}&state=${state}&page=${page}&start=${range?.[0]?.format("YYYY-MM-DD") || ""}&end=${range?.[1]?.format("YYYY-MM-DD") || ""}`,
  );
  useEffect(() => {
    setPage(1);
    setQs("");
    setState("");
    setDetail(undefined);
  }, [kind]);
  return (
    <>
      <PageTitle
        title={kind === "sale" ? "销售管理" : "采购管理"}
        description={
          kind === "sale"
            ? "预订、现货销售与分批交付；履约状态独立于收款状态"
            : "直接入库、预订采购与分批收货；已收部分终止剩余不抹去历史"
        }
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => n(kind === "sale" ? "/sales/new" : "/purchases/new")}
          >
            {kind === "sale" ? "销售开单" : "采购开单"}
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
          placeholder="搜索单号或往来名称"
        />
        <Select
          value={state}
          onChange={(v) => {
            setState(v);
            setPage(1);
          }}
          style={{ width: 140 }}
          options={[
            { value: "", label: "全部状态" },
            ...(kind === "sale"
              ? ["draft", "confirmed", "partial", "completed", "cancelled"]
              : ["confirmed", "partial", "completed", "cancelled"]
            ).map((value) => ({ value, label: stateLabel(value, kind) })),
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
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={data?.items}
          scroll={{ x: 1050 }}
          pagination={{
            current: page,
            total: data?.total,
            pageSize: 30,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (v) => `共 ${v} 张单据`,
          }}
          locale={{
            emptyText: (
              <EmptyState
                text={
                  kind === "sale"
                    ? "暂无销售单，点击销售开单开始。"
                    : "暂无采购单，可先录入供应商，再采购开单。"
                }
              />
            ),
          }}
          columns={[
            {
              title: "单据编号",
              dataIndex: "number",
              render: (v: string, r: Row) => (
                <Button type="link" onClick={() => setDetail(r.id)}>
                  {v}
                </Button>
              ),
            },
            {
              title: kind === "sale" ? "客户" : "供应商",
              dataIndex: "party_name",
            },
            { title: "开单时间", dataIndex: "created_at", render: when },
            {
              title: "履约状态",
              render: (_: any, r: Row) => (
                <Status
                  value={r.state}
                  kind={kind}
                  terminated={r.remaining_terminated}
                />
              ),
            },
            {
              title: "合同金额",
              dataIndex: "total",
              align: "right",
              render: money,
            },
            {
              title: "订购 / 已履约",
              align: "right",
              render: (_: any, r: Row) => r.qty + " / " + r.fulfilled,
            },
            {
              title: kind === "sale" ? "已预留 / 待补" : "未收件数",
              align: "right",
              render: (_: any, r: Row) =>
                kind === "sale"
                  ? r.reserved + " / " + r.shortage
                  : r.qty - r.fulfilled,
            },
            {
              title: kind === "sale" ? "当前应收" : "当前应付",
              dataIndex: "debt",
              align: "right",
              render: money,
            },
            {
              title: "操作",
              render: (_: any, r: Row) => (
                <Button type="link" onClick={() => setDetail(r.id)}>
                  查看 / 处理
                </Button>
              ),
            },
          ]}
        />
      </section>
      {detail && (
        <OrderDetail
          id={detail}
          onClose={() => setDetail(undefined)}
          onUpdated={reload}
        />
      )}
    </>
  );
}
