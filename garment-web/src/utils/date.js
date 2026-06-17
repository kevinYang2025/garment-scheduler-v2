// 本地日期工具 (F-01 fix)
// 不用 new Date().toISOString().slice(0,10) — 在 UTC+7 晚上会变成"明天"
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatLocal(d) {
  if (typeof d === 'string') return d.slice(0, 10);
  if (!(d instanceof Date)) d = new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
