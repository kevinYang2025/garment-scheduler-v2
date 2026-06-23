/**
 * 字段变更 diff(纯函数)
 *
 * 与 garment-server/server.js computeDiff + formatDiff 完全一致
 *
 * 用法:
 *   const diffs = computeDiff(existing, updated, ['qty', 'status']);
 *   const str = formatDiff(diffs);  // "[diff=qty:10→20,status:pending→done]"
 *   await opLog.log({ ..., detail: { msg: '', diff: diffs } });
 */

export interface FieldDiff {
  field: string;
  before: string;
  after: string;
}

/**
 * 计算两个对象的字段差异
 * @param before 修改前对象
 * @param after  修改后对象
 * @param fields 指定对比字段;不传则对比 after 全部 keys
 * @returns 差异数组(按 fields 顺序或 after 顺序)
 */
export function computeDiff(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  fields?: string[],
): FieldDiff[] {
  if (!before || !after) return [];
  const keys = fields || Object.keys(after);
  return keys
    .filter((k) => before[k] !== after[k])
    .map((k) => ({
      field: k,
      before: String(before[k] ?? ''),
      after: String(after[k] ?? ''),
    }));
}

/**
 * 把 diff 数组格式化成日志字符串
 *
 * - 超过 10 个字段只显示前 10 个 + "+N more"
 * - 空数组返回 ""
 *
 * 例:[diff=qty:10→20,status:pending→done]
 */
export function formatDiff(diffs: FieldDiff[]): string {
  if (!diffs || !diffs.length) return '';
  const parts = diffs.slice(0, 10).map((d) => `${d.field}:${d.before}→${d.after}`);
  if (diffs.length > 10) parts.push(`+${diffs.length - 10}more`);
  return ` [diff=${parts.join(',')}]`;
}