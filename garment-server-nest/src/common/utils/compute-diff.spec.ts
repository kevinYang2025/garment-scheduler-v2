import { computeDiff, formatDiff } from './compute-diff.util';

describe('computeDiff', () => {
  it('空对象返回空数组', () => {
    expect(computeDiff(null, { a: 1 })).toEqual([]);
    expect(computeDiff({ a: 1 }, null)).toEqual([]);
  });

  it('完全相同对象返回空数组', () => {
    expect(computeDiff({ a: 1, b: 2 }, { a: 1, b: 2 })).toEqual([]);
  });

  it('指定字段对比', () => {
    const before = { qty: 10, status: 'pending', other: 'x' };
    const after = { qty: 20, status: 'pending', other: 'y' };
    const diffs = computeDiff(before, after, ['qty', 'status']);
    expect(diffs).toEqual([{ field: 'qty', before: '10', after: '20' }]);
  });

  it('不指定字段则对比 after 全部 keys', () => {
    const before = { qty: 10 };
    const after = { qty: 20, status: 'new' };
    const diffs = computeDiff(before, after);
    expect(diffs).toContainEqual({ field: 'qty', before: '10', after: '20' });
    // before 没有 status,经 ?? '' 兜底为空串
    expect(diffs).toContainEqual({ field: 'status', before: '', after: 'new' });
  });

  it('undefined 和 null 字符串化', () => {
    const diffs = computeDiff({ a: 1, b: null }, { a: 2, b: undefined });
    expect(diffs).toContainEqual({ field: 'a', before: '1', after: '2' });
    expect(diffs).toContainEqual({ field: 'b', before: '', after: '' });
  });
});

describe('formatDiff', () => {
  it('空数组返回空字符串', () => {
    expect(formatDiff([])).toBe('');
    expect(formatDiff(null as any)).toBe('');
  });

  it('单个差异格式化', () => {
    expect(formatDiff([{ field: 'qty', before: '10', after: '20' }])).toBe(
      ' [diff=qty:10→20]',
    );
  });

  it('多个差异逗号分隔', () => {
    const diffs = [
      { field: 'qty', before: '10', after: '20' },
      { field: 'status', before: 'pending', after: 'done' },
    ];
    expect(formatDiff(diffs)).toBe(' [diff=qty:10→20,status:pending→done]');
  });

  it('超过 10 个差异截断', () => {
    const diffs = Array.from({ length: 15 }, (_, i) => ({
      field: `f${i}`,
      before: 'a',
      after: 'b',
    }));
    const result = formatDiff(diffs);
    expect(result).toContain('+5more');
  });
});