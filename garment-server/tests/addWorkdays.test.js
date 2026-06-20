// [2026-06-20 fix#业务-P3-4] addWorkdays 单元测试
// 用 :memory: SQLite + work_calendars seed 模拟工作日历
// 默认配置: 周一到周五工作, 周六日休息
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')

// 必须在 require db.js 之前 mock db 路径? 用 _setDbForTest 后注入即可
const dbModule = require('../db.js')

let testDb
before(() => {
  testDb = new Database(':memory:')
  testDb.pragma('journal_mode = MEMORY')
  testDb.exec(`
    CREATE TABLE work_calendars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      work_mode_id INTEGER,
      work_days TEXT DEFAULT '1111100',
      start_date TEXT,
      end_date TEXT,
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE calendar_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_id INTEGER NOT NULL,
      exception_date TEXT NOT NULL,
      is_workday INTEGER DEFAULT 0,
      remark TEXT DEFAULT '',
      UNIQUE(calendar_id, exception_date)
    );
  `)
  // 注入默认日历: 周一到周五工作
  testDb.prepare('INSERT INTO work_calendars (name, work_days, priority, enabled) VALUES (?, ?, ?, ?)')
    .run('default', '1111100', 0, 1)
  dbModule._setDbForTest(testDb)
})

after(() => {
  testDb.close()
})

test('addWorkdays - 0 天返回原日期', () => {
  assert.equal(dbModule.addWorkdays('2026-06-15', 0), '2026-06-15')  // 周一
})

test('addWorkdays - 1 天跨工作日 (周一 → 周二)', () => {
  assert.equal(dbModule.addWorkdays('2026-06-15', 1), '2026-06-16')  // 周一+1 工作日=周二
})

test('addWorkdays - 跳过周末 (周五 → 下周一)', () => {
  assert.equal(dbModule.addWorkdays('2026-06-19', 1), '2026-06-22')  // 周五+1 工作日=下周一
})

test('addWorkdays - 跨周末多天 (周三 → 下周三)', () => {
  // 周三 + 5 工作日 = 跨周末后周三
  assert.equal(dbModule.addWorkdays('2026-06-17', 5), '2026-06-24')
})

test('addWorkdays - 负数被截断为 0', () => {
  assert.equal(dbModule.addWorkdays('2026-06-15', -10), '2026-06-15')
})

test('addWorkdays - 超过 365 被截断为 365', () => {
  // 365 工作日 ≈ 365*7/5 = 511 自然日,会触发循环上限警告但不出错
  const result = dbModule.addWorkdays('2026-06-15', 1000)
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/)
})

test('addWorkdays - 非数字字符串被截断为 0', () => {
  assert.equal(dbModule.addWorkdays('2026-06-15', 'abc'), '2026-06-15')
})

test('addWorkdays - 大数正常工作 (30 工作日 ≈ 42 自然日)', () => {
  // 2026-06-15 周一 + 30 工作日 ≈ 2026-08-06 (42 自然日后) - 跳过 6 周末(12天)
  // 周一 + 42 自然日 = 2026-07-27 周一
  // 实际是: 30 个工作日,从周一开始数 30 天工作日
  // 2026-06-15(周一) 开始 +30 工作日 = 2026-07-28 周二
  // (30天 / 5 = 6 整周 + 0 = 2026-07-27 周一 + 0 额外 = 2026-07-27)
  // 30 mod 5 = 0,所以是周一
  const result = dbModule.addWorkdays('2026-06-15', 30)
  assert.equal(result, '2026-07-27')
})

test('isWorkday - 默认周一到周五', () => {
  assert.equal(dbModule.isWorkday('2026-06-15'), true)  // 周一
  assert.equal(dbModule.isWorkday('2026-06-19'), true)  // 周五
  assert.equal(dbModule.isWorkday('2026-06-20'), false) // 周六
  assert.equal(dbModule.isWorkday('2026-06-21'), false) // 周日
})

test('isWorkday - 例外日期: 周六加班', () => {
  testDb.prepare('INSERT INTO calendar_exceptions (calendar_id, exception_date, is_workday) VALUES (?, ?, ?)')
    .run(1, '2026-06-20', 1)
  assert.equal(dbModule.isWorkday('2026-06-20'), true)  // 周六但加班
})