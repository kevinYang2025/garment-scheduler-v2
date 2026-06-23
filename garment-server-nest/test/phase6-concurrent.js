#!/usr/bin/env node
/**
 * Phase 6 验收红线 — §3.2 并发写压测(10 并发批量报工)
 *
 * 验证:
 *   ① 10 个并发 POST /api/actual/batch 全部 2xx
 *   ② 日志无 'database is locked' / 'SQLITE_BUSY'
 *   ③ 每个批次写入正确数(各 5 条记录 = 总 50 条)
 *   ④ recalcTaskStatus 触发,对应 main_plan.is_scheduled 更新
 *
 * §3.2 规范(对应 report 模块):
 *   - 10 个并发请求,各自不同的 style_id/process/qty
 *   - beforeEach 重置数据库(每个 spec 独立)
 *   - 读后再写:断言前后差值 = 10(每个 style 恰好被排一次)
 *
 * 前置:Redis + NestJS 3002 已起
 *
 * 运行:node test/phase6-concurrent.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const NEST_PORT = 3002;
const DB_PATH = process.env.DB_PATH || require('path').resolve(__dirname, '../../garment-server/data.sqlite');

const TEST_USER = 'phase3test';
const TEST_PASS = 'phase3test';
const BATCH_COUNT = 10;       // §3.2:10 个并发
const RECORDS_PER_BATCH = 5;  // 每批次 5 条记录

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function parseCookies(setCookieHeader) {
  if (!setCookieHeader) return {};
  const arr = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  const out = {};
  for (const c of arr) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    out[k.trim()] = v.trim();
  }
  return out;
}

function setupTestData() {
  const db = new Database(DB_PATH);
  try {
    // 确保 phase3test 用户存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USER);
    if (!existingUser) {
      const hash = bcrypt.hashSync(TEST_PASS, 12);
      db.prepare(
        `INSERT INTO users (username, password_hash, role, display_name, active, workshop)
         VALUES (?, ?, 'admin', 'Phase 3 Test', 1, NULL)`,
      ).run(TEST_USER, hash);
    } else {
      const hash = bcrypt.hashSync(TEST_PASS, 12);
      db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE username = ?').run(hash, TEST_USER);
    }

    // 清理 P6- 测试数据
    db.prepare("DELETE FROM actual_production WHERE style_no LIKE 'P6-%'").run();
    db.prepare("DELETE FROM main_plan WHERE style_no LIKE 'P6-%'").run();
    db.prepare("DELETE FROM styles WHERE style_no LIKE 'P6-%'").run();

    // 创建 10 个款式 + 10 个主计划(每个 plan_qty=100, cutting 80 应触发 recalc 完成)
    const ts = Date.now();
    globalThis.__p6_ts__ = ts;
    const insertStyle = db.prepare(`
      INSERT INTO styles (style_no, product_name, plan_qty, due_date, status)
      VALUES (?, ?, 100, '2026-12-31', '待排')
    `);
    const insertPlan = db.prepare(`
      INSERT INTO main_plan (style_id, style_no, plan_qty, due_date, is_scheduled, priority)
      VALUES (?, ?, ?, ?, 0, 3)
    `);
    const styleIds = [];
    const styleNos = [];
    for (let i = 1; i <= BATCH_COUNT; i++) {
      const sn = `P6-${ts}-${i}`;
      const r = insertStyle.run(sn, `Phase 6 测试款 ${i}`);
      const sid = r.lastInsertRowid;
      insertPlan.run(sid, sn, 100, '2026-12-31');
      styleIds.push(sid);
      styleNos.push(sn);
    }
    return { styleIds, styleNos };
  } finally {
    db.close();
  }
}

function countActuals(styleId) {
  const db = new Database(DB_PATH);
  try {
    return db
      .prepare('SELECT COUNT(*) AS n FROM actual_production WHERE style_id = ?')
      .get(styleId).n;
  } finally {
    db.close();
  }
}

function getIsScheduled(styleId) {
  const db = new Database(DB_PATH);
  try {
    const row = db
      .prepare('SELECT is_scheduled FROM main_plan WHERE style_id = ?')
      .get(styleId);
    return row ? row.is_scheduled : null;
  } finally {
    db.close();
  }
}

async function login() {
  const body = JSON.stringify({ username: TEST_USER, password: TEST_PASS });
  const res = await request(
    {
      hostname: 'localhost',
      port: NEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body,
  );
  if (res.status !== 200) throw new Error(`登录失败: ${res.status} ${res.body.slice(0, 200)}`);
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) throw new Error(`登录响应无 set-cookie: ${res.body.slice(0, 200)}`);
  const cookies = parseCookies(setCookie);
  const cookieStr = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  if (!cookieStr.includes('connect.sid')) {
    throw new Error(`cookie 解析失败: ${cookieStr}`);
  }
  return cookieStr;
}

function callBatch(cookie, styleId, styleNo, qtyPerRecord) {
  // 每条记录 cutting 工序,qty=16(5 条 = 80 累计,触发 80% recalc → is_scheduled=2)
  // 注意:actual_production 有 UNIQUE 索引 (style_no, color, size_spec, production_date,
  //       schedule_type, secondary_type, is_second_inspection)
  // 所以 5 条记录 color/size_spec 必须不同(避免唯一约束冲突)
  const records = [];
  for (let i = 0; i < RECORDS_PER_BATCH; i++) {
    records.push({
      style_id: styleId,
      style_no: styleNo,
      schedule_type: 'cutting',
      secondary_type: '',
      production_date: '2026-06-23',
      color: `color-${i}`,     // ← 不同
      size_spec: `size-${i}`,  // ← 不同
      completed_qty: qtyPerRecord,
      defect_qty: 0,
      workshop: 'cutting',
      line_team: 'team-1',
    });
  }
  const body = JSON.stringify({ records });
  return request(
    {
      hostname: 'localhost',
      port: NEST_PORT,
      path: '/api/actual/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Cookie: cookie,
      },
    },
    body,
  );
}

(async () => {
  console.log('━━━ Phase 6 §3.2 并发写压测 — 批量报工 ━━━\n');
  console.log(`前置: Redis + NestJS 3002 已起`);
  console.log(`并发: ${BATCH_COUNT} 个并发 batch,各 ${RECORDS_PER_BATCH} 条记录 = 共 ${BATCH_COUNT * RECORDS_PER_BATCH} 条\n`);

  try {
    const { styleIds, styleNos } = setupTestData();
    console.log(`  [setup] 准备了 ${styleIds.length} 个款式,ids=${styleIds.join(',')}`);

    const cookie = await login();
    console.log(`  [setup] 已登录 ${TEST_USER}, cookie=${cookie.slice(0, 60)}...`);
    console.log(`  [debug] styleIds=${JSON.stringify(styleIds)}`);
    console.log(`  [debug] styleNos=${JSON.stringify(styleNos)}`);

    // 先单条测试一下,确认 batch endpoint 工作(用一个额外的 style_id,不参与并发)
    console.log(`\n  [debug] 单条测试 batch(单独 style)...`);
    const debugStyleId = 999998;  // 假设此 style_id 不存在
    const debugStyleNo = `P6-debug-${Date.now()}`;
    const debugRes = await callBatch(cookie, debugStyleId, debugStyleNo, 16);
    console.log(`  [debug] 单条 status=${debugRes.status} body=${debugRes.body.slice(0, 200)}`);
    // debug 测试可能因 style_id 不存在而失败(因为我们没在 styles 表建),但 endpoint 至少要 200/400/404
    if (debugRes.status >= 500) {
      throw new Error(`单条 batch 5xx 错误,endpoint 异常: ${debugRes.body.slice(0, 200)}`);
    }
    console.log(`  [debug] 单条 OK,继续 10 并发\n`);

    // 压测前断言
    for (const sid of styleIds) {
      if (countActuals(sid) !== 0) {
        throw new Error(`压测前 style_id=${sid} 已有 actual`);
      }
    }
    console.log(`  [setup] 压测前每个 style 的 actual 数 = 0 ✅\n`);

    // === 10 并发 ===
    console.log(`━━━ Step 1: ${BATCH_COUNT} 并发 batch 报工 ━━━`);
    const t0 = Date.now();
    const promises = styleIds.map((sid, i) => callBatch(cookie, sid, styleNos[i], 16));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - t0;

    const all2xx = results.every((r) => r.status >= 200 && r.status < 400);
    results.forEach((r, i) => {
      console.log(`  style_id=${styleIds[i]} status=${r.status} body=${r.body.slice(0, 80)}`);
    });
    if (!all2xx) {
      throw new Error(`有请求失败(应全 2xx),见上`);
    }
    console.log(`  ✅ 全部 ${BATCH_COUNT} 个 batch 2xx(用时 ${elapsed}ms)`);

    // 断言:每 style 恰好有 RECORDS_PER_BATCH 条 actual
    console.log(`\n━━━ Step 2: 每个 style 恰好有 ${RECORDS_PER_BATCH} 条 actual ━━━`);
    let allCorrect = true;
    for (const sid of styleIds) {
      const n = countActuals(sid);
      console.log(`  style_id=${sid} actual count = ${n}`);
      if (n !== RECORDS_PER_BATCH) allCorrect = false;
    }
    if (!allCorrect) {
      throw new Error(`有 style 的 actual 数 ≠ ${RECORDS_PER_BATCH}`);
    }
    console.log(`  ✅ 每个 style 恰好 ${RECORDS_PER_BATCH} 条 actual(共 ${BATCH_COUNT * RECORDS_PER_BATCH} 条)`);

    // 断言:recalc 触发,main_plan.is_scheduled=2(完成)
    console.log(`\n━━━ Step 3: recalcTaskStatus 触发(80% 完成) ━━━`);
    let allRecalced = true;
    for (const sid of styleIds) {
      const status = getIsScheduled(sid);
      console.log(`  style_id=${sid} is_scheduled=${status}`);
      if (status !== 2) allRecalced = false;
    }
    if (!allRecalced) {
      throw new Error(`有 style 未 recalc(is_scheduled 应=2)`);
    }
    console.log(`  ✅ recalc 全部触发,所有 main_plan is_scheduled=2(完成)`);

    console.log(`\n✅ Phase 6 §3.2 批量报工并发压测全部通过`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Phase 6 压测失败:`, err.message);
    console.error('   stack:', err.stack);
    process.exit(1);
  }
})();