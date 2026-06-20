// [2026-06-20 fix#业务-P3-4] ETag/If-Match 单元测试
// 直接调 db 层逻辑模拟 GET/PUT 流程,不启 HTTP server
// 验证:
//   - GET 后返回的 ETag 格式正确
//   - PUT 时带正确 If-Match → 200
//   - PUT 时带错误 If-Match → 412 模拟
//   - PUT 时不带 If-Match → 200 (向后兼容)
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const dbModule = require('../db.js')

let testDb
before(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE production_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop_id INTEGER NOT NULL,
      line_name TEXT NOT NULL,
      status TEXT DEFAULT '空闲',
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE production_line_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      event_type TEXT,
      old_status TEXT,
      new_status TEXT,
      remark TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      table_name TEXT,
      action TEXT,
      record_id INTEGER,
      record_name TEXT,
      detail TEXT,
      ip TEXT,
      ua TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `)
  testDb.prepare('INSERT INTO production_lines (workshop_id, line_name, status, sort_order) VALUES (?, ?, ?, ?)')
    .run(1, '1班', '空闲', 1)
  dbModule._setDbForTest(testDb)
})

after(() => {
  testDb.close()
})

// 模拟 GET 返回的 etag 计算(从 server.js 复制)
function computeLineEtag(lineId) {
  const r = testDb.prepare('SELECT MAX(id) as mid FROM production_line_events WHERE line_id = ?').get(lineId)
  return `"v${(r && r.mid) || 0}"`
}

// 模拟 PUT 事务(简化版,无 broadcast)
function putLineStatus(lineId, newStatus, ifMatch) {
  const txn = testDb.transaction(() => {
    const existing = testDb.prepare('SELECT * FROM production_lines WHERE id = ?').get(lineId)
    if (!existing) return { ok: false, status: 404 }
    const currentEtag = computeLineEtag(lineId)
    if (ifMatch !== undefined && ifMatch !== currentEtag) {
      return { ok: false, status: 412, currentEtag }
    }
    if (existing.status !== newStatus) {
      testDb.prepare('UPDATE production_lines SET status = ? WHERE id = ?').run(newStatus, lineId)
      testDb.prepare('INSERT INTO production_line_events (line_id, event_type, old_status, new_status) VALUES (?, ?, ?, ?)')
        .run(lineId, 'status_change', existing.status, newStatus)
    }
    return { ok: true, etag: currentEtag }
  })
  return txn()
}

test('GET - 初始 ETag 为 "v0" (无 event)', () => {
  assert.equal(computeLineEtag(1), '"v0"')
})

test('PUT - 不带 If-Match → 200 (向后兼容)', () => {
  const r = putLineStatus(1, '生产中', undefined)
  assert.equal(r.ok, true)
  assert.equal(r.etag, '"v0"')  // 写入前算的
})

test('PUT 后 ETag 升级为 "v1"', () => {
  assert.equal(computeLineEtag(1), '"v1"')
})

test('PUT - 带过期 If-Match (old "v0") → 412', () => {
  const r = putLineStatus(1, '故障', '"v0"')
  assert.equal(r.ok, false)
  assert.equal(r.status, 412)
  assert.equal(r.currentEtag, '"v1"')
})

test('PUT - 带正确 If-Match (current "v1") → 200', () => {
  const r = putLineStatus(1, '换线中', '"v1"')
  assert.equal(r.ok, true)
  assert.equal(r.etag, '"v1"')
})

test('PUT - 同 status 重复写入 → 200 但不增 event', () => {
  // 当前 status=换线中
  const r = putLineStatus(1, '换线中', undefined)
  assert.equal(r.ok, true)
  // event 数量应该仍是 2 (生产中 + 换线中),不是 3
  const cnt = testDb.prepare('SELECT COUNT(*) as c FROM production_line_events WHERE line_id = 1').get().c
  assert.equal(cnt, 2)
})

test('PUT - 不存在的 line id → 404', () => {
  const r = putLineStatus(999, '生产中', undefined)
  assert.equal(r.ok, false)
  assert.equal(r.status, 404)
})

test('PUT - 通配 If-Match "*" 不应匹配 (当前实现严格要求)', () => {
  // 当前实现:ifMatch !== currentEtag 则 412,通配符未实现
  // 这是一个已知限制:完整 RFC 7232 应支持 * 表示"任意版本"
  const r = putLineStatus(1, '空闲', '*')
  assert.equal(r.ok, false)
  assert.equal(r.status, 412)
})