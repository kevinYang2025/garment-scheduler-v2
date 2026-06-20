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

// [2026-06-20 段6 M-3] 日期算术 helper
// 返回新 Date,不修改入参
export function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

// [2026-06-20 段6 M-3] 连续日期列表 [start, end] 含两端
// start/end 可为 'YYYY-MM-DD' 或 Date
export function dateRange(start, end) {
  const s = new Date((typeof start === 'string' ? start : formatLocal(start)) + 'T00:00:00');
  const e = new Date((typeof end === 'string' ? end : formatLocal(end)) + 'T00:00:00');
  const out = [];
  const cur = new Date(s);
  while (cur <= e) {
    out.push(formatLocal(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// [2026-06-20 段6 M-3] 视图窗口:从 today 起 [-beforeDays, +afterDays],offset 是绝对天数偏移
export function viewWindow(today, beforeDays, afterDays, offset = 0) {
  const start = addDays(today, -beforeDays + offset);
  const end = addDays(today, afterDays + offset);
  return dateRange(start, end);
}

// [2026-06-20 段6 M-3] 视图边界:返回 [startYMD, endYMD] 用于 filter 已有日期列表
export function viewBounds(today, beforeDays, afterDays, offset = 0) {
  return [formatLocal(addDays(today, -beforeDays + offset)), formatLocal(addDays(today, afterDays + offset))];
}
