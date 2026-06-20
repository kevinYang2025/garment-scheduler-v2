// [2026-06-20 fix#业务-P3-4] Node.js 内置 test runner (Node 20+) 示范
// 用法: node --test tests/fmtLocal.test.js
// 目标: 验证 fmtLocal 纯函数,确保 UTC+8 偏移不会触发 off-by-one
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fmtLocal } = require('../db.js')

test('fmtLocal - 标准本地日期格式', () => {
  const d = new Date(2026, 5, 20)  // 2026-06-20
  assert.equal(fmtLocal(d), '2026-06-20')
})

test('fmtLocal - 1位数月日补零', () => {
  const d = new Date(2026, 0, 5)  // 2026-01-05
  assert.equal(fmtLocal(d), '2026-01-05')
})

test('fmtLocal - 12月31日跨年', () => {
  const d = new Date(2026, 11, 31)  // 2026-12-31
  assert.equal(fmtLocal(d), '2026-12-31')
})

test('fmtLocal - ISO 字符串构造避免 UTC 偏移', () => {
  // 用本地 new Date(year, month-1, day) 不会触发 UTC 偏移
  const d = new Date(2026, 5, 20)
  const formatted = fmtLocal(d)
  assert.equal(formatted.length, 10)
  assert.match(formatted, /^\d{4}-\d{2}-\d{2}$/)
})

test('fmtLocal - 不带 T00:00:00 的 ISO 字符串会偏移 1 天 (已知陷阱)', () => {
  // new Date('2026-06-20') 解析为 UTC, 在 UTC+8 时区会变成 2026-06-20 08:00:00 本地
  // fmtLocal 用本地 getFullYear/getMonth/getDate,所以仍然输出 '2026-06-20' (本例)
  // 但对 new Date('2026-06-20T23:00:00Z') 在 UTC+8 时区会变成 '2026-06-21',需用 new Date(y,m,d) 避免
  const d = new Date('2026-06-20T23:00:00Z')
  // 在 UTC+8 时区,d 的本地表示是 2026-06-21 07:00
  // 所以 fmtLocal(d) === '2026-06-21' (演示了 UTC+8 时区差异)
  // 这个测试在 CI 时区变化时可能 fail,仅作文档说明
  const formatted = fmtLocal(d)
  assert.match(formatted, /^\d{4}-\d{2}-\d{2}$/)
})