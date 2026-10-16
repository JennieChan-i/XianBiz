import React, { useEffect, useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, cents, ledgerLabel, money, Row, upload, when } from "./api";
import {
  EmptyState,
  ErrorAlert,
  MoneyInput,
  PageTitle,
  Search,
  SkuSelect,
  useLoad,
} from "./shared";

function OpeningCorrection({
  sku,
  onClose,
  onDone,
}: {
  sku: Row;
  onClose: () => void;
  onDone: (updated: Row) => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { message } = App.useApp();
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const values = await form.validateFields();
      const updated = await api(`/skus/${sku.id}/opening`, {
        qty: values.qty,
        cost: cents(values.yuan),
        reason: values.reason,
        expected_stock: sku.stock,
        expected_value: sku.value,
        expected_cost: sku.avg_cost,
      });
      message.success("期初已更正，原始记录与本次更正均已保留");
      onDone(updated);
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
      title={`期初更正 · ${sku.color} / ${sku.size}`}
      onCancel={onClose}
      onOk={save}
      okText="确认更正"
      confirmLoading={busy}
    >
      <Alert
        type="info"
        showIcon
        message="仅限尚未发生后续业务的SKU"
        description="填写正确的期初件数、单位成本及原因。系统保留原始流水，追加本次更正，不计入经营损益。"
        style={{ marginBottom: 16 }}
      />
      <ErrorAlert error={error} />
      <Form
        name="opening-correction"
        form={form}
        layout="vertical"
        initialValues={{ qty: sku.stock, yuan: sku.avg_cost / 100 }}
      >
        <Form.Item
          name="qty"
          label="更正后期初件数"
          rules={[{ required: true, message: "请填写期初件数，无库存请填0" }]}
        >
          <InputNumber min={0} precision={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item
          name="yuan"
          label="更正后期初单位成本（元）"
          rules={[{ required: true, message: "请填写单位成本" }]}
        >
          <MoneyInput />
        </Form.Item>
        <Form.Item
          name="reason"
          label="更正原因"
          rules={[
            { required: true, whitespace: true, message: "请填写更正原因" },
          ]}
        >
          <Input.TextArea rows={2} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function ProductForm({
  id,
  onClose,
  onDone,
  purchase = false,
  onCreated,
}: {
  id?: number;
  onClose: () => void;
  onDone: () => void;
  purchase?: boolean;
  onCreated?: (rows: Row[]) => void;
}) {
  const { data: storeSettings } = useLoad("/settings");
  const [form] = Form.useForm();
  const [colors, setColors] = useState("");
  const [sizes, setSizes] = useState("");
  const [skus, setSkus] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stockErrors, setStockErrors] = useState<Record<string, string>>({});
  const [opening, setOpening] = useState<Row>();
  const [withOpening, setWithOpening] = useState(false);
  const { message } = App.useApp();
  useEffect(() => {
    if (id)
      api("/products/" + id)
        .then((p) => {
          form.setFieldsValue({
            ...p,
            yuan: p.price / 100,
            active: !!p.active,
          });
          setSkus(p.skus);
        })
        .catch((e) => setError(e.message));
  }, [id]);
  const generate = () => {
    const cs = colors
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const ss = sizes
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!cs.length) {
      message.warning("至少填写一种颜色");
      return;
    }
    const next = [...skus];
    for (const color of cs)
      for (const size of ss.length ? ss : ["无尺码"])
        if (!next.some((s) => s.color === color && s.size === size))
          next.push({
            color,
            size,
            barcode: "",
            stock: null,
            cost: 0,
            purchase_qty: null,
            purchase_yuan: null,
            threshold: storeSettings?.default_threshold ?? 5,
            active: 1,
          });
    setSkus(next);
  };
  const set = (i: number, k: string, v: any) => {
    setSkus(skus.map((s, j) => (i === j ? { ...s, [k]: v } : s)));
    if (k === "purchase_qty" || k === "purchase_yuan") {
      setStockErrors((previous) => {
        const next = { ...previous };
        delete next[
          `${skus[i].color}|${skus[i].size}|${k === "purchase_qty" ? "qty" : "price"}`
        ];
        return next;
      });
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const p = await form.validateFields();
      if (!skus.length) throw new Error("请先生成至少一个颜色尺码SKU");
      const errors: Record<string, string> = {};
      for (const sku of skus) {
        if (
          !sku.id &&
          withOpening &&
          !purchase &&
          (sku.stock === null ||
            sku.stock === undefined ||
            !Number.isInteger(sku.stock) ||
            sku.stock < 0)
        ) {
          errors[`${sku.color}|${sku.size}`] = "请填写期初件数，无库存请填0";
        }
        if (
          purchase &&
          (!Number.isInteger(sku.purchase_qty) || sku.purchase_qty < 1)
        )
          errors[`${sku.color}|${sku.size}|qty`] = "请填写采购件数，至少1件";
        if (
          purchase &&
          (sku.purchase_yuan === null ||
            sku.purchase_yuan === undefined ||
            !Number.isFinite(sku.purchase_yuan) ||
            sku.purchase_yuan < 0)
        )
          errors[`${sku.color}|${sku.size}|price`] =
            "请填写本次采购单价，0为有效值";
      }
      setStockErrors(errors);
      if (Object.keys(errors).length)
        throw new Error(
          purchase
            ? "请补全各颜色尺码的采购件数和采购单价。"
            : "请补全每个新SKU的期初件数；无库存请明确填写0。",
        );
      const result = await api(
        "/products" + (id ? "/" + id : ""),
        {
          ...p,
          inventory_mode: withOpening && !purchase ? "opening" : "catalogue",
          price: cents(p.yuan),
          skus: skus.map((s) => ({
            color: s.color,
            size: s.size,
            barcode: s.barcode,
            active: s.active,
            threshold: s.threshold,
            stock: withOpening && !purchase ? s.stock : 0,
            cost:
              withOpening && !purchase
                ? s.cost_yuan !== undefined
                  ? cents(s.cost_yuan)
                  : s.cost || 0
                : 0,
          })),
        },
        id ? "PUT" : "POST",
      );
      if (purchase && onCreated)
        onCreated(
          result.skus.map((s: Row) => {
            const input = skus.find(
              (r) => r.color === s.color && r.size === s.size,
            )!;
            return {
              ...s,
              qty: input.purchase_qty,
              price: cents(input.purchase_yuan),
            };
          }),
        );
      message.success(
        purchase
          ? "商品已建档并加入采购单，确认收货后增加库存"
          : "商品资料已保存",
      );
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
      title={id ? "编辑商品资料" : purchase ? "新增商品并采购" : "新增商品"}
      width={1040}
      onCancel={onClose}
      onOk={save}
      confirmLoading={busy}
      okText={purchase ? "保存并加入采购单" : "保存商品"}
      destroyOnHidden
    >
      <ErrorAlert error={error} />
      <Form
        layout="vertical"
        form={form}
        initialValues={{ active: true, yuan: 0 }}
      >
        <div className="form-grid">
          <Form.Item
            name="code"
            label="款号"
            rules={[{ required: true, message: "请填写款号" }]}
          >
            <Input autoFocus />
          </Form.Item>
          <Form.Item
            name="name"
            label="商品名称"
            rules={[{ required: true, message: "请填写商品名称" }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="yuan"
            label="默认批发价（元）"
            rules={[{ required: true }]}
          >
            <MoneyInput />
          </Form.Item>
          <Form.Item name="category" label="分类">
            <Input />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input />
          </Form.Item>
          <Form.Item name="season" label="季节">
            <Select
              allowClear
              options={["春", "夏", "秋", "冬", "四季"].map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          {!purchase && (
            <Form.Item name="active" label="商品状态">
              <Select
                options={[
                  { value: true, label: "启用" },
                  { value: false, label: "停用（保留历史）" },
                ]}
              />
            </Form.Item>
          )}
          <Form.Item
            name="note"
            label="文字备注"
            style={{ gridColumn: "span 2" }}
          >
            <Input />
          </Form.Item>
        </div>
      </Form>
      {purchase ? (
        <Alert
          type="info"
          showIcon
          message="填写本次采购件数和进价，保存后加入当前采购单。建档不增加库存，实际收货才入库。"
          style={{ marginBottom: 16 }}
        />
      ) : (
        <div style={{ marginBottom: 16 }}>
          <Checkbox
            checked={withOpening}
            onChange={(e) => {
              setWithOpening(e.target.checked);
              setStockErrors({});
            }}
          >
            同时录入期初库存（开始使用软件前已有的存货）
          </Checkbox>
          <div className="subtle">
            普通建档不增加库存。新进货请在采购开单中登记；期初库存只对新SKU生效。
          </div>
        </div>
      )}
      <div className="matrix-toolbar">
        <Input
          placeholder="颜色，如：黑色,白色"
          value={colors}
          onChange={(e) => setColors(e.target.value)}
        />
        <Input
          placeholder="尺码，如：S,M,L；留空为无尺码"
          value={sizes}
          onChange={(e) => setSizes(e.target.value)}
        />
        <Button onClick={generate}>生成颜色 × 尺码矩阵</Button>
      </div>
      <Table
        className="product-sku-table"
        tableLayout="fixed"
        rowKey={(r: Row) => r.color + "|" + r.size}
        size="small"
        dataSource={skus}
        pagination={false}
        scroll={{ x: purchase || id || withOpening ? 930 : 610, y: 320 }}
        columns={[
          { title: "颜色", dataIndex: "color", width: 80 },
          { title: "尺码", dataIndex: "size", width: 70 },
          {
            title: "条码（可空）",
            width: 140,
            render: (_: any, r: Row, i: number) => (
              <Input
                value={r.barcode}
                onChange={(e) => set(i, "barcode", e.target.value)}
                aria-label={`${r.color} ${r.size} 条码`}
                style={{ width: "100%" }}
              />
            ),
          },
          ...(purchase
            ? [
                {
                  title: (
                    <span>
                      采购件数<span className="required-star"> *</span>
                    </span>
                  ),
                  width: 175,
                  render: (_: any, r: Row, i: number) => (
                    <div>
                      <InputNumber
                        min={1}
                        precision={0}
                        value={r.purchase_qty}
                        placeholder="本次采购件数"
                        aria-label={`${r.color} ${r.size} 采购件数`}
                        aria-required="true"
                        status={
                          stockErrors[`${r.color}|${r.size}|qty`]
                            ? "error"
                            : undefined
                        }
                        onChange={(v) => set(i, "purchase_qty", v)}
                      />
                      {stockErrors[`${r.color}|${r.size}|qty`] && (
                        <div className="field-error" role="alert">
                          {stockErrors[`${r.color}|${r.size}|qty`]}
                        </div>
                      )}
                    </div>
                  ),
                },
                {
                  title: (
                    <span>
                      采购单价（元）<span className="required-star"> *</span>
                    </span>
                  ),
                  width: 145,
                  render: (_: any, r: Row, i: number) => (
                    <div>
                      <InputNumber
                        min={0}
                        precision={2}
                        value={r.purchase_yuan}
                        placeholder="本次进价"
                        aria-label={`${r.color} ${r.size} 采购单价`}
                        aria-required="true"
                        status={
                          stockErrors[`${r.color}|${r.size}|price`]
                            ? "error"
                            : undefined
                        }
                        onChange={(v) => set(i, "purchase_yuan", v)}
                      />
                      {stockErrors[`${r.color}|${r.size}|price`] && (
                        <div className="field-error" role="alert">
                          {stockErrors[`${r.color}|${r.size}|price`]}
                        </div>
                      )}
                    </div>
                  ),
                },
              ]
            : id || withOpening
              ? [
                  {
                    title: (
                      <span>
                        库存 / 期初件数
                        {withOpening && skus.some((s) => !s.id) && (
                          <span className="required-star"> *</span>
                        )}
                      </span>
                    ),
                    width: 175,
                    render: (_: any, r: Row, i: number) =>
                      r.id ? (
                        <b>{r.stock}</b>
                      ) : !withOpening ? (
                        <span className="subtle">建档后为0</span>
                      ) : (
                        <div className="sku-field">
                          <InputNumber
                            min={0}
                            precision={0}
                            value={r.stock}
                            placeholder="必填，无库存填0"
                            aria-label={`${r.color} ${r.size} 期初件数`}
                            aria-required="true"
                            aria-invalid={!!stockErrors[`${r.color}|${r.size}`]}
                            aria-describedby={
                              stockErrors[`${r.color}|${r.size}`]
                                ? `sku-stock-error-${i}`
                                : undefined
                            }
                            status={
                              stockErrors[`${r.color}|${r.size}`]
                                ? "error"
                                : undefined
                            }
                            style={{ width: "100%" }}
                            onChange={(v) => {
                              set(i, "stock", v);
                              setStockErrors((previous) => {
                                const next = { ...previous };
                                delete next[`${r.color}|${r.size}`];
                                return next;
                              });
                            }}
                          />
                          {stockErrors[`${r.color}|${r.size}`] && (
                            <div
                              className="field-error"
                              id={`sku-stock-error-${i}`}
                              role="alert"
                            >
                              {stockErrors[`${r.color}|${r.size}`]}
                            </div>
                          )}
                        </div>
                      ),
                  },
                  {
                    title: "成本 / 期初单价",
                    width: 145,
                    render: (_: any, r: Row, i: number) =>
                      r.id ? (
                        "¥ " + money(r.avg_cost)
                      ) : !withOpening ? (
                        <span className="subtle">采购收货后计算</span>
                      ) : (
                        <MoneyInput
                          value={r.cost_yuan || 0}
                          onChange={(v: number) => set(i, "cost_yuan", v)}
                        />
                      ),
                  },
                ]
              : []),
          {
            title: "低库存阈值",
            width: 125,
            render: (_: any, r: Row, i: number) => (
              <InputNumber
                min={0}
                precision={0}
                value={r.threshold}
                onChange={(v) => set(i, "threshold", v || 0)}
              />
            ),
          },
          {
            title: "启用",
            width: 65,
            render: (_: any, r: Row, i: number) => (
              <Switch
                checked={!!r.active}
                disabled={purchase}
                onChange={(v) => set(i, "active", v ? 1 : 0)}
                size="small"
              />
            ),
          },
          {
            title: "操作",
            width: 130,
            render: (_: any, r: Row, i: number) =>
              !r.id ? (
                <Button
                  type="text"
                  danger
                  onClick={() => setSkus(skus.filter((_, j) => j !== i))}
                >
                  移除
                </Button>
              ) : r.opening_editable ? (
                <Button type="link" onClick={() => setOpening(r)}>
                  期初更正
                </Button>
              ) : (
                <Tooltip title="已有后续业务，请通过采购、销售或盘点调整库存">
                  <span className="subtle">期初已锁定</span>
                </Tooltip>
              ),
          },
        ]}
      />
      <p className="subtle">
        {purchase
          ? "取消当前采购单不会删除已保存的商品档案；未收货不形成库存和应付。商品图片可在商品资料中上传。"
          : withOpening
            ? "新SKU的期初件数为空白必填，无库存填0。请勿把本次采购数量重复录为期初库存。"
            : "商品图片在保存后进入详情上传。已保存SKU的库存通过采购、销售或盘点调整；初始录入错误可在发生业务前使用期初更正。"}
      </p>
      {opening && (
        <OpeningCorrection
          sku={opening}
          onClose={() => setOpening(undefined)}
          onDone={(updated) => {
            setSkus((previous) =>
              previous.map((s) =>
                s.id === updated.id
                  ? {
                      ...s,
                      stock: updated.stock,
                      value: updated.value,
                      avg_cost: updated.avg_cost,
                      cost_known: updated.cost_known,
                      opening_editable: updated.opening_editable,
                    }
                  : s,
              ),
            );
            onDone();
          }}
        />
      )}
    </Modal>
  );
}

export function Products() {
  const [qs, setQs] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<number | null>();
  const [detail, setDetail] = useState<number>();
  const { message } = App.useApp();
  const { data, loading, error, reload } = useLoad(
    `/products?qs=${encodeURIComponent(qs)}&page=${page}`,
  );
  const p = useLoad(detail ? "/products/" + detail : "/products?page_size=1");
  const image = async (file: File) => {
    try {
      await upload(`/products/${detail}/images`, file);
      message.success("图片已压缩保存");
      p.reload();
      reload();
    } catch (e: any) {
      message.error(e.message);
    }
    return false;
  };
  return (
    <>
      <PageTitle
        title="商品资料"
        description="按款号管理商品，颜色与尺码组成独立 SKU，统一按件计量"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setEdit(null)}
          >
            新增商品
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
          placeholder="搜索款号或商品名称"
        />
        <Button icon={<ReloadOutlined />} onClick={reload}>
          刷新
        </Button>
      </div>
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
            showTotal: (v) => `共 ${v} 款商品`,
          }}
          locale={{
            emptyText: (
              <EmptyState text="还没有商品。新增商品或在系统设置中导入 Excel 期初资料。" />
            ),
          }}
          columns={[
            {
              title: "主图",
              dataIndex: "image",
              width: 65,
              render: (v: string) =>
                v ? (
                  <Image
                    width={40}
                    height={40}
                    style={{ objectFit: "cover" }}
                    src={"/images/thumb_" + v}
                  />
                ) : (
                  <div className="image-empty">无图</div>
                ),
            },
            {
              title: "款号",
              dataIndex: "code",
              render: (v: string, r: Row) => (
                <Button type="link" onClick={() => setDetail(r.id)}>
                  {v}
                </Button>
              ),
            },
            { title: "商品名称", dataIndex: "name" },
            { title: "分类", dataIndex: "category" },
            {
              title: "品牌 / 季节",
              render: (_: any, r: Row) => (
                <span>
                  {r.brand || "—"} / {r.season || "—"}
                </span>
              ),
            },
            {
              title: "默认批发价",
              dataIndex: "price",
              align: "right",
              render: money,
            },
            { title: "SKU", dataIndex: "sku_count", align: "right" },
            { title: "账面库存", dataIndex: "stock", align: "right" },
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
                  <Button type="link" onClick={() => setEdit(r.id)}>
                    编辑
                  </Button>
                  <Button type="link" onClick={() => setDetail(r.id)}>
                    详情 / 图片
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </section>
      <Drawer
        open={!!detail}
        title={p.data?.name || "商品详情"}
        width={850}
        onClose={() => setDetail(undefined)}
      >
        <ErrorAlert error={p.error} />
        {p.data?.skus && (
          <>
            <Descriptions
              column={2}
              bordered
              size="small"
              items={[
                { key: "code", label: "款号", children: p.data.code },
                {
                  key: "price",
                  label: "默认批发价",
                  children: "¥ " + money(p.data.price),
                },
                {
                  key: "category",
                  label: "分类",
                  children: p.data.category || "—",
                },
                {
                  key: "brand",
                  label: "品牌 / 季节",
                  children:
                    (p.data.brand || "—") + " / " + (p.data.season || "—"),
                },
              ]}
            />
            <div className="section-heading" style={{ marginTop: 20 }}>
              <h2>商品图片</h2>
              <Upload
                accept="image/*"
                showUploadList={false}
                beforeUpload={image}
              >
                <Button icon={<UploadOutlined />}>上传图片</Button>
              </Upload>
            </div>
            <div className="image-list">
              {p.data.images.length === 0 ? (
                <p className="subtle">
                  尚无图片。支持一张主图和多张附图，随完整备份迁移。
                </p>
              ) : (
                p.data.images.map((im: Row, i: number) => (
                  <div key={im.id}>
                    <Image
                      src={"/images/" + im.filename}
                      width={130}
                      height={130}
                      style={{ objectFit: "cover" }}
                    />
                    <div>
                      {i === 0 ? (
                        <Tag color="blue">主图</Tag>
                      ) : (
                        <Button
                          type="link"
                          onClick={async () => {
                            await api("/images/" + im.id + "/primary", {});
                            p.reload();
                            reload();
                          }}
                        >
                          设为主图
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            <h2>颜色尺码库存</h2>
            <Table
              size="small"
              rowKey="id"
              dataSource={p.data.skus}
              pagination={false}
              columns={[
                { title: "颜色", dataIndex: "color" },
                { title: "尺码", dataIndex: "size" },
                { title: "条码", dataIndex: "barcode" },
                { title: "库存（件）", dataIndex: "stock" },
                { title: "最近单位成本", dataIndex: "avg_cost", render: money },
                { title: "预警阈值", dataIndex: "threshold" },
              ]}
            />
          </>
        )}
      </Drawer>
      {edit !== undefined && (
        <ProductForm
          id={edit || undefined}
          onClose={() => setEdit(undefined)}
          onDone={() => {
            reload();
            p.reload();
          }}
        />
      )}
    </>
  );
}

export function Inventory() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState("stock");
  const [qs, setQs] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState({ sort: "code", direction: "asc" });
  const alert = params.get("alert") || "";
  const { message, modal } = App.useApp();
  const n = useNavigate();
  const [scrap, setScrap] = useState(false);
  const [form] = Form.useForm();
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const path =
    tab === "stock"
      ? `/skus?q=${encodeURIComponent(qs)}&alert=${alert}&page=${page}&sort=${sort.sort}&direction=${sort.direction}`
      : tab === "ledger"
        ? "/inventory/ledger?page=" + page
        : "/stocktakes?page=" + page;
  const { data, loading, error, reload } = useLoad(path);
  const create = async () => {
    try {
      const r = await api("/stocktakes", {});
      n("/stocktake/" + r.id);
    } catch (e: any) {
      message.error(e.message);
    }
  };
  const doScrap = async () => {
    setBusy(true);
    try {
      await api("/inventory/scrap", await form.validateFields());
      message.success("报废已登记并计入库存损益");
      setScrap(false);
      form.resetFields();
      reload();
    } catch (e: any) {
      if (e.message) setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const columns: any =
    tab === "stock"
      ? [
          { title: "款号", dataIndex: "code", sorter: true },
          { title: "商品名称", dataIndex: "name" },
          { title: "颜色", dataIndex: "color" },
          { title: "尺码", dataIndex: "size" },
          { title: "条码", dataIndex: "barcode" },
          {
            title: "账面库存",
            dataIndex: "stock",
            sorter: true,
            align: "right",
            render: (v: number) => (
              <b className={v < 0 ? "negative" : ""}>{v}</b>
            ),
          },
          { title: "已预留", dataIndex: "reserved", align: "right" },
          { title: "可分配", dataIndex: "available", align: "right" },
          {
            title: "库存价值",
            dataIndex: "value",
            sorter: true,
            align: "right",
            render: money,
          },
          {
            title: "最近均价",
            dataIndex: "avg_cost",
            align: "right",
            render: money,
          },
          {
            title: "预警",
            render: (_: any, r: Row) =>
              r.stock < 0 ? (
                <Tag color="red">负库存</Tag>
              ) : r.stock <= r.threshold ? (
                <Tag color="gold">低于 {r.threshold} 件</Tag>
              ) : (
                <span className="subtle">正常</span>
              ),
          },
        ]
      : tab === "ledger"
        ? [
            { title: "时间", dataIndex: "created_at", render: when },
            { title: "款号", dataIndex: "code" },
            {
              title: "商品 / 颜色 / 尺码",
              render: (_: any, r: Row) => `${r.name} / ${r.color} / ${r.size}`,
            },
            { title: "类型", dataIndex: "kind", render: ledgerLabel },
            { title: "数量变化", dataIndex: "qty", align: "right" },
            { title: "账面结存", dataIndex: "stock_after", align: "right" },
            { title: "成本金额", dataIndex: "amount", render: money },
            { title: "来源", dataIndex: "source" },
            { title: "原因", dataIndex: "reason" },
          ]
        : [
            {
              title: "盘点单号",
              dataIndex: "number",
              render: (v: string, r: Row) => (
                <Button type="link" onClick={() => n("/stocktake/" + r.id)}>
                  {v}
                </Button>
              ),
            },
            { title: "创建时间", dataIndex: "created_at", render: when },
            {
              title: "状态",
              dataIndex: "state",
              render: (v: string) => (
                <Tag color={v === "confirmed" ? "green" : "gold"}>
                  {v === "confirmed" ? "已确认" : "盘点中"}
                </Tag>
              ),
            },
            { title: "确认时间", dataIndex: "confirmed_at", render: when },
            { title: "备注", dataIndex: "note" },
          ];
  return (
    <>
      <PageTitle
        title="库存管理"
        description="账面库存、订单预留与可分配数量分开管理；补货后手动分配历史欠货"
        extra={
          <>
            <Button
              danger
              onClick={() => {
                setScrap(true);
                setActionError("");
              }}
            >
              登记报废
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={create}>
              新建盘点
            </Button>
          </>
        }
      />
      <section className="panel table-panel">
        <Tabs
          activeKey={tab}
          onChange={(v) => {
            setTab(v);
            setPage(1);
          }}
          items={[
            { key: "stock", label: "SKU 库存" },
            { key: "ledger", label: "库存流水" },
            { key: "stocktakes", label: "盘点记录" },
          ]}
        />
        <div className="toolbar inline">
          {tab === "stock" && (
            <>
              <Search
                value={qs}
                onChange={(v) => {
                  setQs(v);
                  setPage(1);
                }}
                placeholder="搜索款号、名称、颜色、尺码、条码"
              />
              <Select
                value={alert}
                onChange={(v) => {
                  setParams(v ? { alert: v } : {});
                  setPage(1);
                }}
                style={{ width: 155 }}
                options={[
                  { value: "", label: "全部库存" },
                  { value: "low", label: "低库存预警" },
                  { value: "negative", label: "负库存" },
                ]}
              />
            </>
          )}
          <Button icon={<ReloadOutlined />} onClick={reload}>
            刷新
          </Button>
        </div>
        <ErrorAlert error={error} />
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={columns}
          dataSource={data?.items}
          scroll={{ x: 1000 }}
          pagination={{
            current: page,
            total: data?.total,
            pageSize: 30,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (v) => `共 ${v} 条`,
          }}
          onChange={(_, __, s: any) => {
            if (s.field)
              setSort({
                sort: s.field,
                direction: s.order === "descend" ? "desc" : "asc",
              });
          }}
        />
      </section>
      <Modal
        open={scrap}
        title="登记库存报废"
        onCancel={() => setScrap(false)}
        onOk={doScrap}
        confirmLoading={busy}
        okText="确认报废"
        okButtonProps={{ danger: true }}
      >
        <Alert
          type="warning"
          showIcon
          message="报废计入库存损失，不再重复登记为经营费用。"
        />
        <ErrorAlert error={actionError} />
        <Form layout="vertical" form={form} style={{ marginTop: 12 }}>
          <Form.Item
            name="sku_id"
            label="商品 SKU"
            rules={[{ required: true }]}
          >
            <SkuSelect />
          </Form.Item>
          <Form.Item name="qty" label="报废件数" rules={[{ required: true }]}>
            <InputNumber min={1} precision={0} />
          </Form.Item>
          <Form.Item name="reason" label="原因" rules={[{ required: true }]}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

export function Stocktake() {
  const { id } = useParams();
  const { data, loading, error, reload } = useLoad("/stocktakes/" + id);
  const [sku, setSku] = useState<Row>();
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const { message, modal } = App.useApp();
  const n = useNavigate();
  const record = async () => {
    if (!sku || count === null) {
      message.warning("请选择 SKU 并填写实盘数量");
      return;
    }
    setBusy(true);
    try {
      await api("/stocktakes/" + id + "/count", {
        items: [{ sku_id: sku.id, count, expected_ledger_id: sku.ledger_id }],
      });
      message.success("实盘数量与本次账面基准已记录");
      setSku(undefined);
      setCount(null);
      reload();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const confirm = () => {
    let reason = "盘点差异";
    let force = false;
    const estimates: Row = {};
    modal.confirm({
      title: "确认盘点差异",
      content: (
        <>
          <p>只调整已记录 SKU 的差额。记录实盘之后的正常出入库会完整保留。</p>
          <Input.TextArea
            defaultValue={reason}
            onChange={(e) => {
              reason = e.target.value;
            }}
          />
          <Checkbox
            style={{ marginTop: 12 }}
            onChange={(e) => {
              force = e.target.checked;
            }}
          >
            确认风险：必要时减少订单预留并形成负库存差额
          </Checkbox>
          {data?.items
            .filter((r: Row) => !r.cost_known)
            .map((r: Row) => (
              <div key={r.sku_id} style={{ marginTop: 10 }}>
                {r.code} / {r.color} / {r.size} 暂估成本
                <MoneyInput
                  onChange={(v: number) => {
                    estimates[String(r.sku_id)] = cents(v);
                  }}
                />
              </div>
            ))}
        </>
      ),
      okText: "确认并调整库存",
      onOk: async () => {
        try {
          await api("/stocktakes/" + id + "/confirm", {
            reason,
            force,
            estimates,
          });
          message.success("盘点差异已生效");
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
        title={data?.number || "库存盘点"}
        description="逐 SKU 清点后立即记录实数；实点与记录之间若发生实物移动，请重新清点"
        extra={
          <>
            <Button onClick={() => n("/inventory")}>返回库存</Button>
            {data?.state === "open" && (
              <Button type="primary" onClick={confirm}>
                确认盘点差异
              </Button>
            )}
          </>
        }
      />
      <ErrorAlert error={error || actionError} />
      {data?.state === "open" && (
        <section className="panel">
          <h2>记录当前 SKU 实盘数量</h2>
          <Space align="start" wrap>
            <SkuSelect
              key={sku?.id || 0}
              value={sku?.id}
              onChange={(_, s) => {
                setSku(s);
                setCount(null);
              }}
            />
            <InputNumber
              aria-label="实盘数量"
              min={0}
              precision={0}
              placeholder="实盘件数"
              value={count}
              onChange={setCount}
            />
            <Button type="primary" loading={busy} onClick={record}>
              立即记录实数与时点
            </Button>
          </Space>
          {sku && (
            <p className="subtle">
              当前显示账面 {sku.stock}{" "}
              件；如果这期间已有新流水，记录将被拒绝，请重新选择并清点。
            </p>
          )}
          <Alert
            style={{ marginTop: 14 }}
            type="info"
            showIcon
            message="盘点期间可以正常营业。未记录的 SKU 不会按零库存处理。"
          />
        </section>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>已记录的实盘明细</h2>
          <Tag color={data?.state === "confirmed" ? "green" : "gold"}>
            {data?.state === "confirmed" ? "已生效" : "盘点中"}
          </Tag>
        </div>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={data?.items}
          size="small"
          pagination={false}
          columns={[
            { title: "款号", dataIndex: "code" },
            { title: "商品", dataIndex: "name" },
            {
              title: "颜色 / 尺码",
              render: (_: any, r: Row) => r.color + " / " + r.size,
            },
            { title: "记录时点", dataIndex: "counted_at", render: when },
            { title: "当时账面", dataIndex: "baseline", align: "right" },
            { title: "当时实盘", dataIndex: "count", align: "right" },
            {
              title: "调整差额",
              align: "right",
              render: (_: any, r: Row) => (
                <b className={r.count - r.baseline < 0 ? "negative" : ""}>
                  {r.count - r.baseline}
                </b>
              ),
            },
            { title: "当前账面", dataIndex: "current_stock", align: "right" },
          ]}
        />
      </section>
    </>
  );
}
