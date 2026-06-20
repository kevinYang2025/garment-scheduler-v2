// [2026-06-20 fix#业务-P3-4] genCode 单号生成器单元测试
// genCode 从 server.js 抽出到 db.js,支持任意 prefix + tableName + padLen
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const dbModule = require('../db.js')

let testDb
before(() => {
  testDb = new Database(':memory:')
  testDb.exec(`
    CREATE TABLE asn_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asn_code TEXT UNIQUE
    );
    CREATE TABLE dn_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dn_code TEXT UNIQUE
    );
  `)
  dbModule._setDbForTest(testDb)
})

after(() => {
  testDb.close()
})

test('genCode - 空表首次生成 001', () => {
  const code = dbModule.genCode('ASN', 'asn_list', 'asn_code', 3)
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  assert.equal(code, `ASN${dateStr}001`)
})

test('genCode - 表中有 1 条当日记录 → 002', () => {
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  testDb.prepare('INSERT INTO asn_list (asn_code) VALUES (?)').run(`ASN${dateStr}001`)
  const code = dbModule.genCode('ASN', 'asn_list', 'asn_code', 3)
  assert.equal(code, `ASN${dateStr}002`)
})

test('genCode - 不同前缀独立计数', () => {
  const code = dbModule.genCode('DN', 'dn_list', 'dn_code', 3)
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  assert.equal(code, `DN${dateStr}001`)  // dn_list 是空的
})

test('genCode - 自定义 padLen=5 → 00001', () => {
  // 用新 prefix 'PO' 查 asn_list, LIKE 'PO${date}%' → 0 条 → 00001
  // (asn_list 里有 ASN 开头记录,不影响 PO 计数)
  const code = dbModule.genCode('PO', 'asn_list', 'asn_code', 5)
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  assert.equal(code, `PO${dateStr}00001`)
})

test('genCode - 默认 padLen=3', () => {
  const code = dbModule.genCode('X', 'asn_list', 'asn_code')
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}`
  // 跳过 today 之前的记录,只算 today 的(因为 LIKE ASN20260620%)
  // 但这里 prefix 是 'X',所以查的是 X20260620%,返回 0 个 → 001
  assert.match(code, /^X\d{8}001$/)
})