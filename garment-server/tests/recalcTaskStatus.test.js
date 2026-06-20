// [2026-06-20 fix#业务-P3-4] recalcTaskStatus 单元测试
// 段52 加了 __recalcLocks 重入锁,段60 加了 secondary 回流
// 测试: 状态计算、重入锁、secondary 100% 完成回流 main_plan
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const dbModule = require('../db.js')

let testDb
before(() => {
  testDb = new Database(':memory:')
  // 用生产环境同 schema (简化版,只覆盖 recalc 关心的字段)
  testDb.exec(`
    CREATE TABLE schedule_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_type TEXT NOT NULL,
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      secondary_type TEXT DEFAULT '',
      task_status TEXT DEFAULT 'PENDING',
      progress_pct REAL DEFAULT 0,
      first_inspection_completed_at TEXT DEFAULT '',
      second_inspection_completed_at TEXT DEFAULT ''
    );
    CREATE TABLE schedule_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id INTEGER NOT NULL,
      schedule_date TEXT NOT NULL,
      row_type TEXT NOT NULL,
      qty INTEGER DEFAULT 0,
      UNIQUE(master_id, schedule_date, row_type)
    );
    CREATE TABLE actual_production (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_type TEXT DEFAULT '',
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      production_date TEXT NOT NULL,
      completed_qty INTEGER DEFAULT 0,
      defect_qty INTEGER DEFAULT 0,
      secondary_type TEXT DEFAULT '',
      is_second_inspection INTEGER DEFAULT 0,
      workshop TEXT DEFAULT '',
      line_team TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      worker_name TEXT DEFAULT '',
      start_time TEXT DEFAULT '',
      end_time TEXT DEFAULT '',
      is_second_inspection2 INTEGER DEFAULT 0,
      source_type TEXT DEFAULT ''
    );
    CREATE TABLE main_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      cutting_start TEXT,
      cutting_end TEXT,
      secondary_start TEXT,
      secondary_end TEXT,
      printing_start TEXT,
      printing_end TEXT,
      embroidery_start TEXT,
      embroidery_end TEXT,
      template_start TEXT,
      template_end TEXT,
      sewing_remind_date TEXT,
      sewing_start TEXT,
      sewing_end TEXT,
      ironing_start TEXT,
      ironing_end TEXT,
      due_date TEXT
    );
  `)
  dbModule._setDbForTest(testDb)
})

after(() => {
  testDb.close()
})

// helpers
function makeMaster(overrides = {}) {
  const defaults = {
    schedule_type: 'sewing',
    style_id: 100,
    style_no: 'ST001',
    color: 'RED',
    size_spec: 'M',
    plan_qty: 100
  }
  return testDb.prepare(`
    INSERT INTO schedule_master (schedule_type, style_id, style_no, color, size_spec, plan_qty, secondary_type)
    VALUES (@schedule_type, @style_id, @style_no, @color, @size_spec, @plan_qty, @secondary_type)
  `).run({ ...defaults, secondary_type: '', ...overrides })
}

function addDaily(masterId, rowType, qty) {
  testDb.prepare('INSERT INTO schedule_daily (master_id, schedule_date, row_type, qty) VALUES (?, ?, ?, ?)')
    .run(masterId, '2026-06-20', rowType, qty)
}

function getMaster(id) {
  return testDb.prepare('SELECT * FROM schedule_master WHERE id = ?').get(id)
}

test('recalcTaskStatus - 0 实际 → PENDING', () => {
  const m = makeMaster({ plan_qty: 100 })
  const r = dbModule.recalcTaskStatus(m.lastInsertRowid)
  assert.equal(r.ok, true)
  const row = getMaster(m.lastInsertRowid)
  assert.equal(row.task_status, 'PENDING')
  assert.equal(row.progress_pct, 0)
})

test('recalcTaskStatus - 部分实际 → IN_PROGRESS', () => {
  const m = makeMaster({ plan_qty: 100 })
  addDaily(m.lastInsertRowid, 'ACTUAL', 30)
  dbModule.recalcTaskStatus(m.lastInsertRowid)
  const row = getMaster(m.lastInsertRowid)
  assert.equal(row.task_status, 'IN_PROGRESS')
  assert.equal(row.progress_pct, 30)
})

test('recalcTaskStatus - 100% 实际 → COMPLETED', () => {
  const m = makeMaster({ plan_qty: 100 })
  addDaily(m.lastInsertRowid, 'ACTUAL', 100)
  dbModule.recalcTaskStatus(m.lastInsertRowid)
  const row = getMaster(m.lastInsertRowid)
  assert.equal(row.task_status, 'COMPLETED')
  assert.equal(row.progress_pct, 100)
})

test('recalcTaskStatus - 超额 (120%) 仍算 COMPLETED 100%', () => {
  const m = makeMaster({ plan_qty: 100 })
  addDaily(m.lastInsertRowid, 'ACTUAL', 120)
  dbModule.recalcTaskStatus(m.lastInsertRowid)
  const row = getMaster(m.lastInsertRowid)
  assert.equal(row.task_status, 'COMPLETED')
  assert.equal(row.progress_pct, 100)  // Math.min(..., 100)
})

test('recalcTaskStatus - plan_qty=0 时 progress=0', () => {
  const m = makeMaster({ plan_qty: 0 })
  addDaily(m.lastInsertRowid, 'ACTUAL', 10)
  dbModule.recalcTaskStatus(m.lastInsertRowid)
  const row = getMaster(m.lastInsertRowid)
  assert.equal(row.task_status, 'IN_PROGRESS')  // 实际 > 0
  assert.equal(row.progress_pct, 0)  // plan=0 时除零保护
})

test('recalcTaskStatus - 不存在的 masterId → 返回 error', () => {
  const r = dbModule.recalcTaskStatus(99999)
  assert.equal(r.ok, false)
  assert.match(r.error, /not found/)
})

test('recalcTaskStatus - 重入锁: 同 masterId 连续调用两次都成功 (Node 单线程)', () => {
  // 注:__recalcLocks 防的是递归调用(同 tick 内 recalc 又调 recalc)
  // Node.js 单线程,顺序调两次不会触发锁,但都能正常返回 ok
  // 真正的并发场景需要 Promise/setImmediate 插入,但 recalc 是同步函数,无法交错
  const m = makeMaster({ plan_qty: 100 })
  addDaily(m.lastInsertRowid, 'ACTUAL', 50)
  const r1 = dbModule.recalcTaskStatus(m.lastInsertRowid)
  const r2 = dbModule.recalcTaskStatus(m.lastInsertRowid)
  assert.equal(r1.ok, true)
  assert.equal(r2.ok, true)
})

test('recalcTaskStatus - secondary 完成回流 main_plan.<type>_end (printing)', () => {
  // 准备 main_plan, id=200 对应 secondary master.style_id=200
  testDb.prepare(`
    INSERT INTO main_plan (id, style_id, style_no, plan_qty, printing_start, printing_end)
    VALUES (200, 200, 'ST002', 50, '2026-06-15', '2026-06-25')
  `).run()

  const m = testDb.prepare(`
    INSERT INTO schedule_master (schedule_type, style_id, style_no, color, size_spec, plan_qty, secondary_type)
    VALUES ('secondary', 200, 'ST002', 'BLUE', 'L', 50, 'printing')
  `).run().lastInsertRowid

  // 100% 完成 + actual 记录
  addDaily(m, 'ACTUAL', 50)
  testDb.prepare(`INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty, secondary_type) VALUES ('secondary', 200, 'ST002', 'BLUE', 'L', '2026-06-22', 50, 'printing')`).run()

  const r = dbModule.recalcTaskStatus(m)
  assert.equal(r.ok, true, `recalc failed: ${r.error}`)
  const row = getMaster(m)
  assert.equal(row.task_status, 'COMPLETED')

  // main_plan.printing_end 应被更新为 max(actual.production_date) = 2026-06-22
  const main = testDb.prepare('SELECT * FROM main_plan WHERE id = 200').get()
  assert.equal(main.printing_end, '2026-06-22', `printing_end was ${main.printing_end}`)
})

test('recalcTaskStatus - secondary 未完成不回流 main_plan', () => {
  const mainId = testDb.prepare(`
    INSERT INTO main_plan (style_id, style_no, plan_qty, embroidery_end)
    VALUES (?, ?, ?, ?)
  `).run(300, 'ST003', 100, '2026-06-30').lastInsertRowid

  const m = testDb.prepare(`
    INSERT INTO schedule_master (schedule_type, style_id, style_no, color, size_spec, plan_qty, secondary_type)
    VALUES ('secondary', ?, 'ST003', '', '', 100, 'embroidery')
  `).run(300).lastInsertRowid
  addDaily(m, 'ACTUAL', 30)  // 只完成 30%

  dbModule.recalcTaskStatus(m)
  const main = testDb.prepare('SELECT * FROM main_plan WHERE id = ?').get(mainId)
  assert.equal(main.embroidery_end, '2026-06-30')  // 未变
})

test('recalcTaskStatus - cutting 一检完成检测', () => {
  const m = makeMaster({ schedule_type: 'cutting', style_no: 'CUT001', color: 'X', size_spec: 'Y', plan_qty: 50 })
  // 一检完成 50 件
  testDb.prepare(`
    INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty, is_second_inspection)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('cutting', 0, 'CUT001', 'X', 'Y', '2026-06-20', 50, 0)

  dbModule.recalcTaskStatus(m.lastInsertRowid)
  const row = getMaster(m.lastInsertRowid)
  assert.match(row.first_inspection_completed_at, /^2026-06-20 \d{2}:\d{2}:\d{2}$/)
})