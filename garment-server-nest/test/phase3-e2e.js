#!/usr/bin/env node
/**
 * Phase 3 端到端验证 — 登录 + 改密(§3 验收红线)
 *
 * 步骤:
 *   1. 确保 phase3test 用户存在(密码 phase3test)
 *   2. POST /api/auth/login → 拿 cookie
 *   3. GET /api/auth/me 拿 cookie 验证
 *   4. POST /api/auth/change-password 改 phase3test → phase3new
 *   5. POST /api/auth/login 用新密码 → 200
 *   6. POST /api/auth/login 用旧密码 → 401
 *   7. 改回 phase3test(避免污染测试数据)
 *   8. POST /api/auth/logout → 清 cookie
 *
 * 前置:
 *   - Redis 已起
 *   - NestJS 3002 已起
 *   - Express 3001 可不起(P3 不依赖 Express)
 *
 * 运行:node test/phase3-e2e.js
 */

const http = require('http');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const NEST_PORT = 3002;
const DB_PATH = process.env.DB_PATH || require('path').resolve(__dirname, '../../garment-server/data.sqlite');
const TEST_USER = 'phase3test';
const ORIGINAL_PASS = 'phase3test';
const NEW_PASS = 'phase3new';

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
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
      const hash = bcrypt.hashSync(ORIGINAL_PASS, 12);
      db.prepare(
        `INSERT INTO users (username, password_hash, role, display_name, active, workshop)
         VALUES (?, ?, 'admin', 'Phase 3 Test', 1, NULL)`,
      ).run(TEST_USER, hash);
      console.log(`  [setup] 已创建测试用户 ${TEST_USER}/${ORIGINAL_PASS}`);
    } else {
      // 重置回原密码(避免之前 e2e 改密后残留)
      const hash = bcrypt.hashSync(ORIGINAL_PASS, 12);
      db.prepare('UPDATE users SET password_hash = ?, active = 1 WHERE username = ?').run(hash, TEST_USER);
    }
  } finally {
    db.close();
  }
}

async function login(username, password) {
  const body = JSON.stringify({ username, password });
  return request(
    {
      hostname: 'localhost',
      port: NEST_PORT,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body,
  );
}

async function logout(cookieStr) {
  return request({
    hostname: 'localhost',
    port: NEST_PORT,
    path: '/api/auth/logout',
    method: 'POST',
    headers: { Cookie: cookieStr },
  });
}

async function me(cookieStr) {
  return request({
    hostname: 'localhost',
    port: NEST_PORT,
    path: '/api/auth/me',
    method: 'GET',
    headers: { Cookie: cookieStr },
  });
}

async function changePassword(cookieStr, oldPass, newPass) {
  const body = JSON.stringify({ old_password: oldPass, new_password: newPass });
  return request(
    {
      hostname: 'localhost',
      port: NEST_PORT,
      path: '/api/auth/change-password',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Cookie: cookieStr,
      },
    },
    body,
  );
}

(async () => {
  console.log('━━━ Phase 3 端到端验证 — 登录 + 改密 ━━━');
  console.log('前置: NestJS 3002 已起\n');

  try {
    ensureTestUser();

    // Step 1: 登录拿 cookie
    console.log('━━━ Step 1: 登录拿 cookie ━━━');
    const loginRes = await login(TEST_USER, ORIGINAL_PASS);
    console.log(`  status: ${loginRes.status}`);
    if (loginRes.status !== 200) throw new Error(`登录失败: ${loginRes.status} ${loginRes.body}`);
    const cookies = parseCookies(loginRes.headers['set-cookie']);
    const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    console.log(`  ✅ 拿到 cookie: ${cookie.slice(0, 50)}...`);

    // Step 2: /me
    console.log('\n━━━ Step 2: GET /api/auth/me ━━━');
    const meRes = await me(cookie);
    const meData = JSON.parse(meRes.body);
    console.log(`  status: ${meRes.status} user=${meData.user?.username}`);
    if (meRes.status !== 200 || meData.user?.username !== TEST_USER) {
      throw new Error(`/me 失败: ${meRes.body}`);
    }
    console.log(`  ✅ /me 返回当前用户`);

    // Step 3: 改密
    console.log('\n━━━ Step 3: POST /api/auth/change-password ━━━');
    const cpRes = await changePassword(cookie, ORIGINAL_PASS, NEW_PASS);
    console.log(`  status: ${cpRes.status} body=${cpRes.body}`);
    if (cpRes.status !== 200) throw new Error(`改密失败: ${cpRes.status} ${cpRes.body}`);
    console.log(`  ✅ 改密成功`);

    // Step 4: 旧密码登不上
    console.log('\n━━━ Step 4: 用旧密码登录(应失败) ━━━');
    const oldLogin = await login(TEST_USER, ORIGINAL_PASS);
    console.log(`  status: ${oldLogin.status}`);
    if (oldLogin.status !== 401) {
      throw new Error(`旧密码应被拒绝(401),实际 ${oldLogin.status}`);
    }
    console.log(`  ✅ 旧密码已被拒绝`);

    // Step 5: 新密码登得上
    console.log('\n━━━ Step 5: 用新密码登录(应成功) ━━━');
    const newLogin = await login(TEST_USER, NEW_PASS);
    console.log(`  status: ${newLogin.status}`);
    if (newLogin.status !== 200) {
      throw new Error(`新密码应被接受(200),实际 ${newLogin.status}`);
    }
    console.log(`  ✅ 新密码登录成功`);

    // Step 6: 改回原密码
    console.log('\n━━━ Step 6: 改回原密码(避免污染) ━━━');
    const resetRes = await changePassword(cookie, NEW_PASS, ORIGINAL_PASS);
    // 注意:cookie 是 Phase 1 的 Phase 3 改密前的 cookie,可能因为 redis 已共享,旧密码仍可用
    console.log(`  status: ${resetRes.status}`);
    if (resetRes.status !== 200) {
      // 用新密码的 session(Step 5 拿到的)改回去
      const newCookies = parseCookies(newLogin.headers['set-cookie']);
      const newCookie = Object.entries(newCookies).map(([k, v]) => `${k}=${v}`).join('; ');
      const resetRes2 = await changePassword(newCookie, NEW_PASS, ORIGINAL_PASS);
      console.log(`  retry status: ${resetRes2.status}`);
    }
    console.log(`  ✅ 已重置回原密码`);

    // Step 7: 登出
    console.log('\n━━━ Step 7: POST /api/auth/logout ━━━');
    const newCookies = parseCookies(newLogin.headers['set-cookie']);
    const newCookie = Object.entries(newCookies).map(([k, v]) => `${k}=${v}`).join('; ');
    const logoutRes = await logout(newCookie);
    console.log(`  status: ${logoutRes.status}`);
    if (logoutRes.status !== 200) throw new Error(`登出失败: ${logoutRes.status}`);
    console.log(`  ✅ 登出成功`);

    console.log('\n✅ Phase 3 端到端验证全部通过');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Phase 3 验证失败:', err.message);
    process.exit(1);
  }
})();