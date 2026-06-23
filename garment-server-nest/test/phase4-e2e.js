#!/usr/bin/env node
/**
 * Phase 4 端到端验证 — 款式 CRUD(§3 验收红线)
 *
 * 步骤:
 *   1. 用 phase3test 用户登录(Phase 3 已创建,role=admin)
 *   2. POST /api/styles 创建样式 P4-XXX-001
 *   3. GET /api/styles/:id 验证创建成功
 *   4. PUT /api/styles/:id 修改 plan_qty
 *   5. GET /api/styles/:id 验证修改
 *   6. GET /api/styles?q=P4 搜索
 *   7. DELETE /api/styles/:id 删除
 *   8. GET /api/styles/:id 应 404
 *   9. 验证未登录访问 POST 应 401
 *
 * 前置:Redis 已起,NestJS 3002 已起
 *
 * 运行:node test/phase4-e2e.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const NEST_PORT = 3002;
const DB_PATH = process.env.DB_PATH || require('path').resolve(__dirname, '../../garment-server/data.sqlite');
const TEST_USER = 'phase3test';
const TEST_PASS = 'phase3test';
const TEST_STYLE_NO = `P4-${Date.now()}-001`;

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

function ensureTestUser() {
  const db = new Database(DB_PATH);
  try {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(TEST_USER);
    if (!existing) {
      const hash = bcrypt.hashSync(TEST_PASS, 12);
      db.prepare(
        `INSERT INTO users (username, password_hash, role, display_name, active, workshop)
         VALUES (?, ?, 'admin', 'Phase 3 Test', 1, NULL)`,
      ).run(TEST_USER, hash);
    } else {
      // 重置密码防 Phase 3 e2e 改了密没改回
      const hash = bcrypt.hashSync(TEST_PASS, 12);
      db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE username = ?').run(hash, TEST_USER);
    }
    // 清理之前残留的 phase4 测试款式
    db.prepare("DELETE FROM styles WHERE style_no LIKE 'P4-%'").run();
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
  if (res.status !== 200) throw new Error(`登录失败: ${res.status} ${res.body}`);
  const cookies = parseCookies(res.headers['set-cookie']);
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function call(method, path, cookie, body) {
  const opts = {
    hostname: 'localhost',
    port: NEST_PORT,
    path,
    method,
    headers: cookie ? { Cookie: cookie } : {},
  };
  if (body) {
    const data = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['Content-Length'] = Buffer.byteLength(data);
    return request(opts, data);
  }
  return request(opts);
}

(async () => {
  console.log('━━━ Phase 4 端到端验证 — 款式 CRUD ━━━');
  console.log('前置: NestJS 3002 已起\n');

  try {
    ensureTestUser();

    // 登录拿 cookie
    const cookie = await login();
    console.log(`  [setup] 已登录 ${TEST_USER}`);

    // Step 1: 未登录 POST 应 401
    console.log('\n━━━ Step 1: 未登录 POST /api/styles(应 401) ━━━');
    const noAuthRes = await call('POST', '/api/styles', null, {
      style_no: TEST_STYLE_NO,
      plan_qty: 100,
    });
    console.log(`  status: ${noAuthRes.status}`);
    if (noAuthRes.status !== 401) throw new Error(`未登录应被拒,实际 ${noAuthRes.status}`);
    console.log(`  ✅ 未登录请求被拒`);

    // Step 2: 创建
    console.log('\n━━━ Step 2: POST /api/styles(创建) ━━━');
    const createRes = await call('POST', '/api/styles', cookie, {
      style_no: TEST_STYLE_NO,
      product_name: 'Phase 4 测试款式',
      style_category: 'T-shirt',
      fabric_code: 'FAB-001',
      plan_qty: 100,
      due_date: '2026-07-01',
      order_date: '2026-06-23',
      embroidery: '是',
      embroidery_daily_output: 50,
      target_daily_output: 200,
      remarks: 'e2e test',
    });
    console.log(`  status: ${createRes.status} body=${createRes.body.slice(0, 200)}`);
    if (createRes.status !== 200) throw new Error(`创建失败: ${createRes.body}`);
    const created = JSON.parse(createRes.body);
    const styleId = created.id;
    console.log(`  ✅ 创建成功 id=${styleId} style_no=${created.style_no}`);

    // Step 3: GET by id
    console.log('\n━━━ Step 3: GET /api/styles/:id ━━━');
    const getRes = await call('GET', `/api/styles/${styleId}`, cookie);
    const got = JSON.parse(getRes.body);
    console.log(`  status: ${getRes.status} style_no=${got.style_no} plan_qty=${got.plan_qty}`);
    if (getRes.status !== 200 || got.style_no !== TEST_STYLE_NO || got.plan_qty !== 100) {
      throw new Error(`GET 验证失败: ${getRes.body}`);
    }
    console.log(`  ✅ GET 返回正确数据`);

    // Step 4: PUT 修改
    console.log('\n━━━ Step 4: PUT /api/styles/:id(修改 plan_qty=250) ━━━');
    const putRes = await call('PUT', `/api/styles/${styleId}`, cookie, {
      style_no: TEST_STYLE_NO,
      product_name: 'Phase 4 测试款式 (已改)',
      plan_qty: 250,
      due_date: '2026-07-15',
    });
    console.log(`  status: ${putRes.status}`);
    if (putRes.status !== 200) throw new Error(`更新失败: ${putRes.body}`);
    console.log(`  ✅ 更新成功`);

    // Step 5: GET 验证修改
    console.log('\n━━━ Step 5: GET 验证 plan_qty 已改为 250 ━━━');
    const getRes2 = await call('GET', `/api/styles/${styleId}`, cookie);
    const got2 = JSON.parse(getRes2.body);
    console.log(`  plan_qty=${got2.plan_qty} product_name=${got2.product_name}`);
    if (got2.plan_qty !== 250) throw new Error(`plan_qty 未更新`);
    console.log(`  ✅ 修改生效`);

    // Step 6: 搜索
    console.log('\n━━━ Step 6: GET /api/styles?q=P4 ━━━');
    const searchRes = await call('GET', '/api/styles?q=P4', cookie);
    const list = JSON.parse(searchRes.body);
    console.log(`  搜索结果数: ${Array.isArray(list) ? list.length : 'not array'}`);
    if (!Array.isArray(list) || !list.find((s) => Number(s.id) === Number(styleId))) {
      throw new Error(`搜索未找到新建款式`);
    }
    console.log(`  ✅ 搜索找到款式`);

    // Step 7: DELETE
    console.log('\n━━━ Step 7: DELETE /api/styles/:id ━━━');
    const delRes = await call('DELETE', `/api/styles/${styleId}`, cookie);
    console.log(`  status: ${delRes.status}`);
    if (delRes.status !== 200) throw new Error(`删除失败: ${delRes.body}`);
    console.log(`  ✅ 删除成功`);

    // Step 8: GET 应 404
    console.log('\n━━━ Step 8: GET 已删除款式(应 404) ━━━');
    const getRes3 = await call('GET', `/api/styles/${styleId}`, cookie);
    console.log(`  status: ${getRes3.status}`);
    if (getRes3.status !== 404) throw new Error(`已删除款式应 404,实际 ${getRes3.status}`);
    console.log(`  ✅ 已删除款式返回 404`);

    console.log('\n✅ Phase 4 端到端 CRUD 验证全部通过');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Phase 4 验证失败:', err.message);
    process.exit(1);
  }
})();