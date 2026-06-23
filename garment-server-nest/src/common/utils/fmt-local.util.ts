/**
 * 本地日期格式化(YYYY-MM-DD,无 UTC 偏移)
 *
 * 替代 Date.prototype.toISOString() — 后者强制 UTC,在 UTC+8 时区凌晨会偏移 1 天
 *
 * 与 garment-server/db.js fmtLocal 行为完全一致(测试 100% 复用)
 */
export function fmtLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 当前时间的本地日期字符串(快捷方法)
 */
export function todayLocal(): string {
  return fmtLocal(new Date());
}

/**
 * 本地日期时间格式(YYYY-MM-DD HH:mm:ss)
 */
export function fmtLocalDateTime(d: Date): string {
  const date = fmtLocal(d);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${date} ${hh}:${mm}:${ss}`;
}