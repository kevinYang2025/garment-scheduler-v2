import { fmtLocal, fmtLocalDateTime, todayLocal } from './fmt-local.util';

describe('fmtLocal', () => {
  it('标准本地日期格式', () => {
    const d = new Date(2026, 5, 20); // 2026-06-20
    expect(fmtLocal(d)).toBe('2026-06-20');
  });

  it('1位数月日补零', () => {
    const d = new Date(2026, 0, 5); // 2026-01-05
    expect(fmtLocal(d)).toBe('2026-01-05');
  });

  it('12月31日跨年', () => {
    const d = new Date(2026, 11, 31); // 2026-12-31
    expect(fmtLocal(d)).toBe('2026-12-31');
  });

  it('返回 10 字符 YYYY-MM-DD', () => {
    const d = new Date(2026, 5, 20);
    expect(fmtLocal(d)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('todayLocal 返回 10 字符', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('fmtLocalDateTime 包含日期和时间', () => {
    const d = new Date(2026, 5, 20, 14, 30, 45);
    expect(fmtLocalDateTime(d)).toBe('2026-06-20 14:30:45');
  });
});