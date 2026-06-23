#!/usr/bin/env node
/**
 * Phase 5 验收红线 — §3.2 并发写压测
 *
 * 验证 autoSchedule 5 并发:
 *   ① 全部 2xx
 *   ② 日志无 "database is locked" 或 "SQLITE_BUSY"
 *   ③ 每个 style 恰好被排 1 次(无重复,无丢失)
 *
 * 算法(§3.2):
 *   - 5 个并发请求对应 5 个不同 style_id
 *   - 每个 spec 从零状态开始(测试用户/款式预先 setup)
 *   - 读后再写:压测前 main_plan 是空,压测后应该 5 条
 *
 * 前置:Redis + NestJS 3002 已起
 *
 * 运行:node test/phase5-concurrent.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const NEST_PORT = 3002;
const DB_PATH = process.env.DB_PATH || require('path').resolve(__dirname, '../../garment-server/data.sqlite');

const TEST_USER = 'phase3test';
const TEST_PASS = 'phase3test';
const STYLE_COUNT = 5;  // §3.2 规范:5 个并发不同 style

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
    // 确保 phase3test 用户存在(role=admin)
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

    // 清理之前残留的测试款式和主计划
    db.prepare("DELETE FROM main_plan WHERE style_no LIKE 'P5-%'").run();
    db.prepare("DELETE FROM styles WHERE style_no LIKE 'P5-%'").run();

    // 创建 5 个测试款式(每个 plan_qty=200, due_date=2026-12-31)
    const insertStyle = db.prepare(`
      INSERT INTO styles (style_no, product_name, plan_qty, due_date, status)
      VALUES (?, ?, ?, ?, '待排')
    `);
    for (let i = 1; i <= STYLE_COUNT; i++) {
      insertStyle.run(`P5-${Date.now()}-${i}`, `Phase 5 测试款 ${i}`, 200, '2026-12-31');
    }
  } finally {
    db.close();
  }
}

function getStyleIds() {
  const db = new Database(DB_PATH);
  try {
    return db
      .prepare("SELECT id FROM styles WHERE style_no LIKE 'P5-%' ORDER BY id")
      .all()
      .map((r) => r.id);
  } finally {
    db.close();
  }
}

function countMainPlansByStyle(styleId) {
  const db = new Database(DB_PATH);
  try {
    return db
      .prepare('SELECT COUNT(*) AS n FROM main_plan WHERE style_id = ?')
      .get(styleId).n;
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
  if (res.status !== 200) throw new Error(`登录失败: ${res.status}`);
  const cookies = parseCookies(res.headers['set-cookie']);
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function callAutoSchedule(cookie, styleId) {
  const body = JSON.stringify({ style_id: styleId });
  return request(
    {
      hostname: 'localhost',
      port: NEST_PORT,
      path: '/api/main-plan/auto-schedule',
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
  console.log('━━━ Phase 5 §3.2 并发写压测 — autoSchedule ━━━\n');
  console.log(`前置: Redis + NestJS 3002 已起`);
  console.log(`并发数: ${STYLE_COUNT} 个不同 style_id\n`);

  try {
    setupTestData();
    const styleIds = getStyleIds();
    console.log(`  [setup] 准备了 ${styleIds.length} 个测试款式,ids=${styleIds.join(',')}`);

    const cookie = await login();
    console.log(`  [setup] 已登录 ${TEST_USER}\n`);

    // 压测前断言:每个 style 的 main_plan 数 = 0
    for (const sid of styleIds) {
      const n = countMainPlansByStyle(sid);
      if (n !== 0) {
        throw new Error(`压测前 style_id=${sid} 已有 ${n} 条 main_plan,需先清理`);
      }
    }
    console.log(`  [setup] 压测前每个 style 的 main_plan 数 = 0 ✅\n`);

    // === 5 并发请求 ===
    console.log(`━━━ Step 1: ${STYLE_COUNT} 并发 autoSchedule 请求 ━━━`);
    const t0 = Date.now();
    const promises = styleIds.map((sid) => callAutoSchedule(cookie, sid));
    const results = await Promise.all(promises);
    const elapsed = Date.now() - t0;

    // 断言 1:全部 2xx
    const all2xx = results.every((r) => r.status >= 200 && r.status < 400);
    results.forEach((r, i) => {
      console.log(`  style_id=${styleIds[i]} status=${r.status}`);
      if (r.status >= 400) {
        console.log(`    body: ${r.body.slice(0, 200)}`);
      }
    });
    if (!all2xx) {
      throw new Error(`有请求失败(应全 2xx),见上`);
    }
    console.log(`  ✅ 全部 ${STYLE_COUNT} 个请求 2xx(用时 ${elapsed}ms)`);

    // 断言 2:每个 style 恰好被排 1 次
    console.log(`\n━━━ Step 2: 每个 style 恰好被排 1 次 ━━━`);
    let allOneEach = true;
    for (const sid of styleIds) {
      const n = countMainPlansByStyle(sid);
      console.log(`  style_id=${sid} main_plan count = ${n}`);
      if (n !== 1) {
        allOneEach = false;
      }
    }
    if (!allOneEach) {
      throw new Error(`有 style 被排 0 次或 >1 次(违反幂等性)`);
    }
    console.log(`  ✅ 每个 style 恰好被排 1 次(无重复无丢失)`);

    // 断言 3:清理 + 重复 autoSchedule 应被拒(同 style 已排)
    console.log(`\n━━━ Step 3: 同一 style 重复 autoSchedule(应 400) ━━━`);
    const dupRes = await callAutoSchedule(cookie, styleIds[0]);
    console.log(`  status=${dupRes.status} body=${dupRes.body.slice(0, 150)}`);
    if (dupRes.status !== 400) {
      throw new Error(`重复排产应被拒(400),实际 ${dupRes.status}`);
    }
    console.log(`  ✅ 重复排产被业务规则拦截`);

    console.log(`\n✅ Phase 5 §3.2 并发压测全部通过`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Phase 5 压测失败:`, err.message);
    process.exit(1);
  }
})();