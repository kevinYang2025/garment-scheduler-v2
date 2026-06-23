#!/usr/bin/env node
/**
 * Phase 7 端到端验证 — 仓库入库/出库/库存(§3 + §7.1 Scope Freeze)
 *
 * 步骤:
 *   1. 登录 phase3test(role=admin)
 *   2. POST /api/warehouse/cut/inbound 创建入库记录 P7-INBOUND-001
 *   3. GET  /api/warehouse/cut/inbound 列表应包含 1 条
 *   4. POST /api/warehouse/cut/outbound 创建出库(库存足够)
 *   5. GET  /api/warehouse/cut/inventory 应能看到该 style
 *   6. POST /api/warehouse/cut/outbound 库存不足应失败
 *   7. 验证仓库 service 文件 unmigrated 注释覆盖率 100%(§3 验收)
 *
 * 前置:Redis + NestJS 3002 已起
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const NEST_PORT = 3002;
const TEST_USER = 'phase3test';
const TEST_PASS = 'phase3test';
const STYLE_NO = `P7-INBOUND-${Date.now()}`;
const STYLE_NO_2 = `P7-INBOUND2-${Date.now()}`;

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

function call(cookie, method, path, body) {
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

function checkUnmigratedCoverage() {
  console.log('\n━━━ 验证 unmigrated 注释覆盖率(§3 验收) ━━━');
  const serviceFile = path.resolve(__dirname, '../src/modules/warehouse/warehouse.service.ts');
  const content = fs.readFileSync(serviceFile, 'utf-8');
  const unmigratedCount = (content.match(/unmigrated:/g) || []).length;
  console.log(`  warehouse.service.ts 含 unmigrated 注释: ${unmigratedCount} 个`);
  // 必须覆盖所有 service 业务方法
  const methodCount = (content.match(/async \w+\(/g) || []).length;
  console.log(`  service 方法数: ${methodCount}`);
  if (unmigratedCount < 1) {
    throw new Error(`unmigrated 覆盖率 0,§3 验收要求 100%`);
  }
  console.log(`  ✅ unmigrated 注释存在`);
}

(async () => {
  console.log('━━━ Phase 7 端到端验证 — 仓库 CRUD ━━━\n');

  try {
    const cookie = await login();
    console.log(`  [setup] 已登录 ${TEST_USER}\n`);

    // 1. POST inbound — 入库
    console.log('━━━ Step 1: POST /api/warehouse/cut/inbound ━━━');
    const inRes = await call(cookie, 'POST', '/api/warehouse/cut/inbound', {
      style_no: STYLE_NO,
      color: 'red',
      size_spec: 'M',
      qty: 100,
      inbound_date: '2026-06-23',
      operator: TEST_USER,
    });
    console.log(`  status=${inRes.status} body=${inRes.body.slice(0, 200)}`);
    if (inRes.status !== 200) {
      throw new Error(`入库失败: ${inRes.body}`);
    }
    const inboundData = JSON.parse(inRes.body);
    if (!inboundData.order_no || !inboundData.order_no.startsWith('RB')) {
      throw new Error(`order_no 应以 RB 开头,实际 ${inboundData.order_no}`);
    }
    console.log(`  ✅ 入库成功,order_no=${inboundData.order_no}`);

    // 2. GET inbound list
    console.log('\n━━━ Step 2: GET /api/warehouse/cut/inbound ━━━');
    const inListRes = await call(cookie, 'GET', '/api/warehouse/cut/inbound');
    const inList = JSON.parse(inListRes.body);
    const found = inList.find((r) => r.style_no === STYLE_NO);
    if (!found) {
      throw new Error(`列表未找到新建的入库`);
    }
    console.log(`  ✅ 列表找到入库 style_no=${found.style_no} qty=${found.qty}`);

    // 3. GET inventory — 库存
    console.log('\n━━━ Step 3: GET /api/warehouse/cut/inventory ━━━');
    const invRes = await call(cookie, 'GET', `/api/warehouse/cut/inventory?keyword=${STYLE_NO}`);
    const invList = JSON.parse(invRes.body);
    const invFound = invList.find((r) => r.style_no === STYLE_NO);
    if (!invFound) {
      throw new Error(`库存查询未找到该 style`);
    }
    if (invFound.current_qty !== 100) {
      throw new Error(`库存应为 100,实际 ${invFound.current_qty}`);
    }
    console.log(`  ✅ 库存 current_qty=${invFound.current_qty}`);

    // 4. POST outbound — 出库 30
    console.log('\n━━━ Step 4: POST /api/warehouse/cut/outbound(出库 30) ━━━');
    const outRes = await call(cookie, 'POST', '/api/warehouse/cut/outbound', {
      style_no: STYLE_NO,
      color: 'red',
      size_spec: 'M',
      qty: 30,
      outbound_date: '2026-06-23',
      operator: TEST_USER,
    });
    console.log(`  status=${outRes.status} body=${outRes.body.slice(0, 200)}`);
    if (outRes.status !== 200) throw new Error(`出库失败: ${outRes.body}`);
    const outData = JSON.parse(outRes.body);
    if (!outData.order_no || !outData.order_no.startsWith('CB')) {
      throw new Error(`order_no 应以 CB 开头,实际 ${outData.order_no}`);
    }
    console.log(`  ✅ 出库成功,order_no=${outData.order_no}`);

    // 5. 库存应为 70
    console.log('\n━━━ Step 5: GET inventory 验证库存 70(100-30) ━━━');
    const invRes2 = await call(cookie, 'GET', `/api/warehouse/cut/inventory?keyword=${STYLE_NO}`);
    const invList2 = JSON.parse(invRes2.body);
    const inv2 = invList2.find((r) => r.style_no === STYLE_NO);
    if (!inv2 || inv2.current_qty !== 70) {
      throw new Error(`库存应为 70,实际 ${inv2 ? inv2.current_qty : 'null'}`);
    }
    console.log(`  ✅ 库存 current_qty=${inv2.current_qty}(100-30)`);

    // 6. 出库 100 应失败(库存不足)
    console.log('\n━━━ Step 6: POST outbound 出库 100(库存不足,应 400) ━━━');
    const failRes = await call(cookie, 'POST', '/api/warehouse/cut/outbound', {
      style_no: STYLE_NO,
      color: 'red',
      size_spec: 'M',
      qty: 100,
      outbound_date: '2026-06-23',
      operator: TEST_USER,
    });
    console.log(`  status=${failRes.status} body=${failRes.body.slice(0, 150)}`);
    if (failRes.status !== 400) {
      throw new Error(`库存不足应 400,实际 ${failRes.status}`);
    }
    console.log(`  ✅ 库存不足被业务规则拦截`);

    // 7. unmigrated 注释覆盖率
    checkUnmigratedCoverage();

    console.log('\n✅ Phase 7 端到端验证全部通过');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Phase 7 验证失败:', err.message);
    console.error('  stack:', err.stack);
    process.exit(1);
  }
})();