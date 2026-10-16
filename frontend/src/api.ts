export type Row = Record<string, any>;
let token = "";
const pending = new Map<string, string>();
export const setToken = (value: string) => {
  token = value;
};
export async function api<T = any>(
  path: string,
  body?: any,
  method?: string,
  key?: string,
): Promise<T> {
  const signature = (method || "POST") + path + JSON.stringify(body);
  const operation = key || pending.get(signature) || crypto.randomUUID();
  if (body !== undefined) pending.set(signature, operation);
  const response = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            "X-XianBiz-Token": token,
            "X-Operation-Id": operation,
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  pending.delete(signature);
  if (!response.ok) throw new Error(result.error || "操作未完成，请重试");
  return result;
}
export async function upload(path: string, file: File, confirmed = false) {
  const data = new FormData();
  data.append("file", file);
  if (confirmed) data.append("confirmed", "true");
  const response = await fetch("/api" + path, {
    method: "POST",
    headers: { "X-XianBiz-Token": token },
    body: data,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "文件处理失败");
  return result;
}
export const money = (n: number | undefined) =>
  new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format((n || 0) / 100);
export const cents = (v: any) => Math.round(Number(v || 0) * 100);
export const when = (v: string) => (v ? v.slice(0, 19).replace("T", " ") : "—");
export const stateLabel = (v: string, kind = "sale") =>
  ({
    draft: "草稿",
    confirmed: kind === "sale" ? "待交付" : "待收货",
    partial: kind === "sale" ? "部分交付" : "部分收货",
    completed: kind === "sale" ? "已完成" : "已收齐",
    cancelled: "已取消",
  })[v] || v;
export const ledgerLabel = (v: string) =>
  ({
    sale: "销售出库",
    purchase: "采购入库",
    opening: "期初入库",
    opening_correction: "期初更正",
    sale_return: "销售退货",
    purchase_return: "采购退货",
    stocktake: "盘点调整",
    scrap: "报废",
    return_cost_adjustment: "退货成本校正",
    revenue: "销售收入",
    sale_cost: "销售成本",
    return_revenue: "退货销售额",
    return_cost: "退货成本转回",
    cost_adjustment: "成本校正",
    inventory_gain: "库存收益",
    inventory_loss: "库存损失",
    expense: "经营费用",
  })[v] || v;
