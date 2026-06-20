const express = require('express');
const { createServer } = require('http');
const { Server: SocketIO } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const ExcelJS = require('exceljs');

// [2026-06-18] 用户系统依赖
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SqliteStore = require('./session-store');

const PORT = process.env.PORT || 3001;
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const API_TOKEN = process.env.API_TOKEN || 'garment-dev-token';

// [2026-06-20 fix#后端-P1-7] 启动期安全检查:开启鉴权时禁止 CORS_ORIGINS=*
// 防止开发期调试用 * + 关 AUTH → 整个 API 裸奔
if (AUTH_ENABLED && (!process.env.CORS_ORIGINS || process.env.CORS_ORIGINS.split(',').includes('*'))) {
  console.error('[FATAL] AUTH_ENABLED=true 时 CORS_ORIGINS 不能是 * 或未设置,会与 withCredentials 冲突导致鉴权失效。');
  console.error('  请设置 CORS_ORIGINS=http://your-frontend-domain 之类具体值。');
  process.exit(1);
}

function fmtLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// [fix#NS-04] 统一错误响应:不返回 e.message(避免泄露数据库结构/文件路径),详情仅记录到服务端
function sendError(res, endpoint, err) {
  console.error(`[${endpoint}] error:`, err);
  if (!res.headersSent) {
    res.status(500).json({ error: '服务器内部错误' });
  }
}

// [2026-06-20 fix#业务-P1-9] dashboard 数据按用户 workshop 隔离
// admin 看全部,其他角色(req.user.workshop)只看本车间数据
// 用于 dashboard 路由(避免 supervisor 越权看全公司)
function dashboardWorkshopScope(req) {
  if (!req.user) return null;
  if (req.user.role === 'admin') return null;
  return req.user.workshop || null;
}

// [2026-06-20 批次1-业务-P0-6] 报工数据合理性校验
// 防御:负数 / NaN / 超 plan_qty*2 / 未来日期
// 用于 POST/PUT /api/actual(/batch),返回 null 表示通过,否则返回 {status, body}
function validateActualPayload(r, existing = null) {
  const qty = r.completed_qty != null ? Number(r.completed_qty) : 0;
  if (Number.isNaN(qty) || qty < 0) {
    return { status: 400, body: { error: 'completed_qty 必须是非负数' } };
  }
  const defect = r.defect_qty != null ? Number(r.defect_qty) : 0;
  if (Number.isNaN(defect) || defect < 0) {
    return { status: 400, body: { error: 'defect_qty 必须是非负数' } };
  }
  // 日期合理性:不晚于今天
  const date = r.production_date || (existing && existing.production_date);
  if (date) {
    const todayStr = (function () {
      const t = new Date();
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    })();
    if (date > todayStr) {
      return { status: 400, body: { error: `production_date ${date} 不能晚于今天 ${todayStr}` } };
    }
  }
  // 超量上限:completed_qty <= plan_qty * 2(防止 inventory_delta 暴涨)
  if (r.style_no && qty > 0) {
    try {
      const plan = db.get('SELECT plan_qty FROM main_plan WHERE style_no = ? ORDER BY id DESC LIMIT 1', [r.style_no]);
      const planQty = (plan && plan.plan_qty) || 0;
      if (planQty > 0 && qty > planQty * 2) {
        return { status: 400, body: { error: `completed_qty ${qty} 超过 plan_qty*2 (${planQty * 2})` } };
      }
    } catch (_) {
      // 表/列不存在或 db 未初始化时静默放行,不影响主路径
    }
  }
  return null;
}

// [2026-06-20 段7 C-1] system_config 内存缓存
// 减少 recalcMainPlanDates / auto-schedule 等热路径的重复 SELECT
// PUT /api/system-config/:key 和 /api/config/system/:key 后 invalidate
let _configCache = null;
function getSystemConfig() {
  if (!_configCache) {
    const rows = db.all('SELECT config_key, config_value FROM system_config');
    _configCache = {};
    for (const r of rows) _configCache[r.config_key] = r.config_value;
  }
  return _configCache;
}
function invalidateSystemConfig() { _configCache = null; }

// [2026-06-18] 日志 helper:从 req 自动取 user_id(替代直接调 db.logOperation)
// 替换 server.js 中所有 `db.logOperation(` → `logOp(req, ` 即可
// [2026-06-20 fix#业务-P2-1] 自动附加 IP + UA 到 detail(敏感操作如 PIN/密码重置 便于审计)
// [2026-06-20 fix#业务-P2-2] 支持 diff 字段:detail 传 {diff: [...]} 时自动转成可读字符串
function formatDiff(diffs) {
  if (!diffs || !diffs.length) return '';
  const parts = diffs.slice(0, 10).map(d => `${d.field}:${d.before}→${d.after}`);
  if (diffs.length > 10) parts.push(`+${diffs.length - 10}more`);
  return ` [diff=${parts.join(',')}]`;
}
function computeDiff(before, after, fields) {
  if (!before || !after) return [];
  return (fields || Object.keys(after))
    .filter(k => before[k] !== after[k])
    .map(k => ({ field: k, before: String(before[k] ?? ''), after: String(after[k] ?? '') }));
}
function logOp(req, module, action, targetId, targetName, detail) {
  const userId = (req && req.user && req.user.id) || null;
  // 敏感操作:在 detail 末尾追加 [ip=xxx ua=xxx]
  const SENSITIVE = ['reset_pin', 'reset_password', 'change_password'];
  let extra = '';
  if (SENSITIVE.includes(action) && req) {
    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const ua = (req.headers['user-agent'] || '').slice(0, 80);
    extra = ` [ip=${ip} ua=${ua}]`;
  }
  // detail 可以是字符串 或 {msg, diff}
  let detailStr;
  if (detail && typeof detail === 'object' && detail.diff) {
    detailStr = (detail.msg || '') + formatDiff(detail.diff);
  } else {
    detailStr = String(detail || '');
  }
  db.logOperation(module, action, targetId, targetName, detailStr + extra, userId);
}

// ============================================================
// INIT
// ============================================================
db.init();

if (!AUTH_ENABLED) {
  console.warn('⚠️  WARNING: Authentication is DISABLED. Set AUTH_ENABLED=true for production.');
  // [B-06 fix] 生产环境强制要求开启 auth,避免裸奔
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: AUTH_ENABLED must be true in production. Exiting.');
    process.exit(1);
  }
}
if (API_TOKEN === 'garment-dev-token') {
  console.warn('⚠️  WARNING: Using default API_TOKEN. Set API_TOKEN env var for production.');
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: API_TOKEN must be set in production. Exiting.');
    process.exit(1);
  }
}

// ============================================================
// EXPRESS SETUP
// ============================================================
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Gzip 全局压缩（Node 内置 zlib）— 896 行 JSON 压到 1/5，HTTP 耗时直降
const zlib = require('zlib');
app.use((req, res, next) => {
  const ae = req.headers['accept-encoding'] || '';
  if (!/\bgzip\b/.test(ae)) return next();
  const origJson = res.json.bind(res);
  res.json = function (body) {
    try {
      const gz = zlib.gzipSync(JSON.stringify(body));
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Length', gz.length);
      res.end(gz);
    } catch (e) {
      origJson(body);
    }
  };
  next();
});

// LIKE 通配符转义:用户输入 % _ \ 在 LIKE 中是通配符,直接拼会被当成通配匹配
function escapeLike(s) {
  return String(s || '').replace(/[\\%_]/g, '\\$&');
}

// dashboard 聚合接口的轻量内存缓存(60s)
const achievementCache = new Map();

// ============================================================
// [2026-06-18] 用户系统:session + 鉴权中间件
// ============================================================
const sessionStore = new SqliteStore(db.getDb());
const SESSION_SECRET = process.env.SESSION_SECRET || 'garment-session-dev-secret';
app.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,  // 每次请求刷新过期(保持 7 天活跃)
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // [fix 2026-06-20 S-2] secure 必须配合 HTTPS,否则 localhost HTTP 下不发 Set-Cookie
    // 之前 NODE_ENV=production 强制 secure=true → 浏览器/curl 都拿不到 cookie → API 全 401
    // 改用 HTTPS 环境变量判断(部署时设 HTTPS=true 即可)
    secure: process.env.HTTPS === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000  // 7 天免登
  }
}));

// ============================================================
// [2026-06-20 fix#S-06] 全局鉴权(必须在所有 /api 路由注册之前)
// 之前位置错(在 routes 后),导致 token 中间件对早期 routes 不生效
// ============================================================
// Simple token auth [fix#2]
// P0 安全: token 通过后必须设 req.user,否则下游 requireAuth 仍 401,token 形同虚设
if (AUTH_ENABLED) {
  app.use('/api', (req, res, next) => {
    if (req.path === '/health') return next();
    if (req.path === '/auth/login') return next();
    if (req.path === '/auth/me') return next();  // 自身判断登录态
    if (req.path.startsWith('/socket.io')) return next();
    if (req.session && req.session.user) return next();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || req.query.token;
    if (token !== API_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    // 注入 API token 身份,让下游 requireAuth/requireRole 也能识别
    req.user = { id: null, username: 'api-token', role: 'admin', workshop: null };
    if (!req.session) req.session = {};
    req.session.user = req.user;
    next();
  });
}

// [2026-06-18] 用户系统:全局 session 鉴权
// 拦截所有 /api/* 请求,要求已登录(session.user 存在)
// 排除 /api/auth/login /auth/me 和 /api/socket.io/(WebSocket 升级不能拦截)
app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path === '/auth/login') return next();
  if (req.path === '/auth/me') return next();  // 自身判断登录态
  if (req.path.startsWith('/socket.io')) return next();
  return requireAuth(req, res, next);
});

// 检查已登录
function requireAuth(req, res, next) {
  // 优先看 session(浏览器登录)
  if (req.session && req.session.user) {
    req.user = req.session.user;
    return next();
  }
  // 兼容 token 中间件已注入的 req.user(API token/CLI)
  if (req.user && req.user.role) {
    return next();
  }
  return res.status(401).json({ error: '未登录' });
}

// 检查角色(admin 自动有所有角色权限,kevin 2026-06-18 决定)
function requireRole(...roles) {
  return (req, res, next) => {
    const u = (req.session && req.session.user) || req.user;
    if (!u) return res.status(401).json({ error: '未登录' });
    if (u.role === 'admin') return next();  // admin bypass
    if (roles.includes(u.role)) return next();
    return res.status(403).json({ error: '权限不足' });
  };
}

// supervisor 限定本车间(supervisor 调用时,workshop 必须与 scheduleType 对应)
const SCHEDULE_TYPE_WORKSHOP = {
  cutting: 'cutting',
  printing: 'printing',
  embroidery: 'embroidery',
  template: 'template',
  ironing: 'ironing',
  sewing: 'sewing',
};

// [2026-06-20 fix#业务-P1-3] supervisor 跨车间权限检查
// 解决:一位 secondary 主任(workshop='secondary')管 3 个二次工序时,允许访问 printing/embroidery/template
// 同时保持:workshop 直接是 schedule_type 的 supervisor 仍然只能访问本工序
function userCanAccessWorkshop(user, targetWorkshop) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'supervisor') return false;
  if (!user.workshop) return false;
  if (user.workshop === targetWorkshop) return true;
  // secondary 主任管三个二次工序(printing/embroidery/template),但不管 ironing(独立)
  if (user.workshop === 'secondary' && ['printing', 'embroidery', 'template'].includes(targetWorkshop)) return true;
  return false;
}

// [2026-06-20 段15 LOW 清理] requireWorkshopMatch 死代码删除(全文件无引用,角色校验已 inline 在各端点)

// 启动时清一次过期 session
const _cleanedCount = sessionStore.cleanup();
if (_cleanedCount > 0) console.log(`✅ 清理 ${_cleanedCount} 个过期 session`);

// 每小时清一次过期 session,防内存增长
// [2026-06-20 fix#后端-P1-1] .unref() 防止阻塞 Node 优雅退出
setInterval(() => {
  const n = sessionStore.cleanup();
  if (n > 0) console.log(`🧹 定时清理 ${n} 个过期 session`);
}, 3600 * 1000).unref();

// 每 5 分钟清理 loginAttempts 中超过 1 分钟窗口的空闲 IP,防内存无限增长
// [2026-06-20 fix#后端-P1-1] .unref()
setInterval(() => {
  const now = Date.now();
  const windowMs = 60 * 1000;
  let removed = 0;
  for (const [ip, attempts] of loginAttempts) {
    const recent = attempts.filter(t => now - t < windowMs);
    if (recent.length === 0) { loginAttempts.delete(ip); removed++; }
    else loginAttempts.set(ip, recent);
  }
  if (removed > 0) console.log(`🧹 清理 ${removed} 个空闲 IP 的登录计数`);
}, 5 * 60 * 1000).unref();

// ============================================================
// [2026-06-18] 用户系统:auth 路由
// ============================================================

// 登录速率限制(5 次/分钟/IP，防暴力破解)
const loginAttempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 分钟窗口
  const maxAttempts = 5;

  if (!loginAttempts.has(ip)) {
    loginAttempts.set(ip, []);
  }
  const attempts = loginAttempts.get(ip).filter(t => now - t < windowMs);
  loginAttempts.set(ip, attempts);

  if (attempts.length >= maxAttempts) {
    return res.status(429).json({ error: '登录尝试过于频繁，请 1 分钟后再试' });
  }
  attempts.push(now);
  next();
}

// POST /api/auth/login
// 两种登录方式:
//   1. 账号+密码:admin / planner / planning_manager / supervisor
//   2. 工号+PIN:dispatcher
app.post('/api/auth/login', rateLimit, async (req, res) => {
  try {
    const { username, password, pin_no, pin } = req.body || {};

    let user = null;
    if (username && password) {
      user = db.get('SELECT * FROM users WHERE username = ? AND active = 1', [username]);
      if (!user) return res.status(401).json({ error: '账号或密码错误' });
      if (!user.password_hash) return res.status(401).json({ error: '该账号未设置密码' });
      // [2026-06-20 fix#后端-P1-3] bcrypt 异步,不阻塞事件循环
      if (!(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: '账号或密码错误' });
      }
    } else if (pin_no && pin) {
      user = db.get('SELECT * FROM users WHERE username = ? AND active = 1', [pin_no]);
      if (!user) return res.status(401).json({ error: '工号或 PIN 错误' });
      if (user.role !== 'dispatcher') {
        return res.status(401).json({ error: '该工号不可用 PIN 登录' });
      }
      if (!user.pin || !(await bcrypt.compare(pin, user.pin))) {
        return res.status(401).json({ error: '工号或 PIN 错误' });
      }
    } else {
      return res.status(400).json({ error: '请提供账号密码 或 工号+PIN' });
    }

    // 写 session(不存 password_hash / pin)
    // [fix 2026-06-20 S-1] regenerate 回调里必须显式 save,
    // 否则 res.json 触发的 end 不会自动持久化新 session,
    // 客户端拿不到 set-cookie,后续 API 401
    req.session.regenerate((regenErr) => {
      if (regenErr) return sendError(res, 'session.regenerate', regenErr);
      req.session.user = {
        id: user.id,
        username: user.username,
        username_km: user.username_km || null,
        display_name: user.display_name,
        display_name_km: user.display_name_km || null,
        role: user.role,
        workshop: user.workshop,
        avatar_url: user.avatar_url || ''
      };
      req.session.save((saveErr) => {
        if (saveErr) return sendError(res, 'session.save', saveErr);
        res.json({ ok: true, user: req.session.user });
      });
    });
  } catch (e) { sendError(res, 'POST /api/auth/login', e); }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.json({ ok: true });
    });
  } else {
    res.json({ ok: true });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ user: req.session.user });
  } else {
    res.status(401).json({ error: '未登录' });
  }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  try {
    const { old_password, new_password } = req.body || {};
    if (!old_password || !new_password) {
      return res.status(400).json({ error: '请提供旧密码和新密码' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
    if (!user || !user.password_hash) {
      return res.status(400).json({ error: '该账号未设置密码,无法自助改密' });
    }
    // [2026-06-20 fix#后端-P1-3] bcrypt 异步
    if (!(await bcrypt.compare(old_password, user.password_hash))) {
      return res.status(401).json({ error: '旧密码错误' });
    }
    const newHash = await bcrypt.hash(new_password, 12);
    db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      [newHash, req.session.user.id]);
    logOp(req, 'users', 'change_password', req.session.user.id, user.username, '');
    res.json({ ok: true });
  } catch (e) { sendError(res, 'POST /api/auth/change-password', e); }
});

// ============================================================
// [2026-06-18] 用户系统:users CRUD (admin only)
// ============================================================

app.get('/api/users', requireRole('admin'), (req, res) => {
  try {
    const { role, workshop, keyword } = req.query;
    let sql = 'SELECT id, username, username_km, display_name, display_name_km, role, workshop, active, created_at FROM users WHERE 1=1';
    const params = [];
    if (role) { sql += ' AND role = ?'; params.push(role); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    // [2026-06-20 段12 M-2] 关键字模糊,后端 SQL LIKE 替代 UserManagement .filter
    if (keyword) {
      sql += ` AND (username LIKE ? ESCAPE '\\' OR username_km LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\' OR display_name_km LIKE ? ESCAPE '\\')`;
      const k = `%${escapeLike(keyword)}%`;
      params.push(k, k, k, k);
    }
    sql += ' ORDER BY id ASC';
    res.json(db.all(sql, params));
  } catch (e) { sendError(res, 'GET /api/users', e); }
});

app.post('/api/users', requireRole('admin'), async (req, res) => {
  try {
    const { username, username_km, pin, password, display_name, display_name_km, role, workshop } = req.body || {};
    if (!username || !display_name || !role) {
      return res.status(400).json({ error: 'username/display_name/role 必填' });
    }
    if (!['admin','planning_manager','planner','dispatcher','supervisor'].includes(role)) {
      return res.status(400).json({ error: 'role 不合法' });
    }
    if (['dispatcher','supervisor'].includes(role) && !workshop) {
      return res.status(400).json({ error: 'dispatcher/supervisor 必须指定 workshop' });
    }
    if (workshop && !['cutting','printing','embroidery','template','ironing','sewing'].includes(workshop)) {
      return res.status(400).json({ error: 'workshop 不合法' });
    }
    if (role === 'dispatcher' && (!pin || !/^\d{4}$/.test(pin))) {
      return res.status(400).json({ error: 'dispatcher 必须设置 4 位数字 PIN' });
    }
    if (role !== 'dispatcher' && !password) {
      return res.status(400).json({ error: '非 dispatcher 账号必须设置密码' });
    }
    if (password && password.length < 6) {
      return res.status(400).json({ error: '密码至少 6 位' });
    }
    const existing = db.get('SELECT id FROM users WHERE username = ?', [username]);
    if (existing) return res.status(400).json({ error: '账号已存在' });

    // [2026-06-20 fix#后端-P1-3] bcrypt 异步
    const passwordHash = password ? await bcrypt.hash(password, 12) : null;
    const pinHash = pin ? await bcrypt.hash(pin, 12) : null;
    const r = db.run(`INSERT INTO users (username, username_km, pin, password_hash, display_name, display_name_km, role, workshop, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [username, username_km || null, pinHash, passwordHash, display_name, display_name_km || null, role, workshop || null]);

    logOp(req, 'users', 'create', r.lastInsertRowid, username, `role=${role}`);
    res.json({ ok: true, id: r.lastInsertRowid });
  } catch (e) { sendError(res, 'POST /api/users', e); }
});

app.put('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isSelf = req.session.user.id === Number(id);
    const isAdmin = req.session.user.role === 'admin';

    // 非 admin 只能改自己
    if (!isSelf && !isAdmin) {
      return res.status(403).json({ error: '权限不足' });
    }

    const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '用户不存在' });

    const { display_name, display_name_km, username_km, role, workshop, active, password, pin, avatar_url } = req.body || {};

    // 非 admin 只能改自己的姓名、头像、密码
    if (!isAdmin) {
      const hasRestrictedField = role !== undefined || workshop !== undefined || active !== undefined || pin !== undefined;
      if (hasRestrictedField) {
        return res.status(403).json({ error: '无权修改角色/车间/状态/PIN' });
      }
    }

    // [2026-06-20] 自残守卫:admin 不能停用自己 / 改自己角色(避免 confused deputy)
    if (isSelf && isAdmin) {
      if (active === 0 || active === false) {
        return res.status(403).json({ error: '不能停用自己' });
      }
      if (role !== undefined && role !== 'admin') {
        return res.status(403).json({ error: '不能修改自己的角色' });
      }
    }

    // [2026-06-20] 最后一人 admin 保护:停用最后一个 active admin 会锁死系统
    if (active === 0 || active === false) {
      if (existing.role === 'admin' && existing.active === 1) {
        const adminCount = db.get("SELECT COUNT(*) as c FROM users WHERE role = 'admin' AND active = 1", []).c;
        if (adminCount <= 1) {
          return res.status(403).json({ error: '至少保留一个 active admin' });
        }
      }
    }

    // 确定最终角色(用新角色或已有角色)
    const finalRole = role || existing.role;

    // 角色合法性校验
    if (role && !['admin','planning_manager','planner','dispatcher','supervisor'].includes(role)) {
      return res.status(400).json({ error: 'role 不合法' });
    }

    // workshop 合法性校验
    if (workshop !== undefined && workshop !== null && workshop !== '' &&
        !['cutting','printing','embroidery','template','ironing','sewing'].includes(workshop)) {
      return res.status(400).json({ error: 'workshop 不合法' });
    }

    // dispatcher/supervisor 必须有 workshop
    const finalWorkshop = workshop !== undefined ? (workshop || null) : existing.workshop;
    if (['dispatcher','supervisor'].includes(finalRole) && !finalWorkshop) {
      return res.status(400).json({ error: 'dispatcher/supervisor 必须指定 workshop' });
    }

    // PIN 只能给 dispatcher
    if (pin && finalRole !== 'dispatcher') {
      return res.status(400).json({ error: '只有 dispatcher 角色可以设置 PIN' });
    }

    // dispatcher 必须有 PIN
    if (finalRole === 'dispatcher' && !existing.pin && !pin) {
      return res.status(400).json({ error: 'dispatcher 必须设置 PIN' });
    }

    const fields = [];
    const params = [];
    if (display_name !== undefined) { fields.push('display_name = ?'); params.push(display_name); }
    if (role !== undefined) { fields.push('role = ?'); params.push(role); }
    if (workshop !== undefined) { fields.push('workshop = ?'); params.push(workshop || null); }
    if (active !== undefined) { fields.push('active = ?'); params.push(active ? 1 : 0); }
    // [2026-06-20 fix#后端-P1-3] bcrypt 异步
    if (password) {
      if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
      const passwordHash = await bcrypt.hash(password, 12);
      fields.push('password_hash = ?'); params.push(passwordHash);
    }
    if (pin) {
      if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'PIN 必须 4 位数字' });
      const pinHash = await bcrypt.hash(pin, 12);
      fields.push('pin = ?'); params.push(pinHash);
    }
    if (avatar_url !== undefined) {
      // [fix M-09] avatar_url 限制: 仅允许 data:image/(png|jpg|jpeg|webp) 前缀,长度 ≤ 5KB,避免 SVG XSS / base64 DoS
      const av = avatar_url || '';
      if (av && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(av)) {
        return res.status(400).json({ error: '头像格式仅支持 png/jpg/webp base64' });
      }
      if (av && av.length > 5120) {
        return res.status(400).json({ error: '头像文件过大(>5KB)' });
      }
      fields.push('avatar_url = ?'); params.push(av);
      // 更新 session 中的头像
      if (req.session?.user && req.session.user.id === Number(id)) {
        req.session.user.avatar_url = av;
      }
    }
    if (username_km !== undefined) { fields.push('username_km = ?'); params.push(username_km || null); }
    if (display_name_km !== undefined) { fields.push('display_name_km = ?'); params.push(display_name_km || null); }
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    // [2026-06-20] 同步 session(若是改自己)— 完整字段,不只是 i18n 字段,
    // 否则下次 requireRole 仍按旧 role 判断(短期 cookie 不变即可绕过刚做的降级)
    if (req.session?.user && req.session.user.id === Number(id)) {
      if (display_name !== undefined) req.session.user.display_name = display_name;
      if (username_km !== undefined) req.session.user.username_km = username_km || null;
      if (display_name_km !== undefined) req.session.user.display_name_km = display_name_km || null;
      if (role !== undefined) req.session.user.role = role;
      if (workshop !== undefined) req.session.user.workshop = workshop || null;
      if (active !== undefined) req.session.user.active = active ? 1 : 0;
    }
    logOp(req, 'users', 'update', id, existing.username, '');
    res.json({ ok: true });
  } catch (e) { sendError(res, 'PUT /api/users/:id', e); }
});

app.delete('/api/users/:id', requireRole('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '用户不存在' });
    if (existing.username === 'admin') {
      return res.status(400).json({ error: 'admin 账号不能删除' });
    }
    db.run("UPDATE users SET active = 0, updated_at = datetime('now','localtime') WHERE id = ?", [id]);
    logOp(req, 'users', 'delete', id, existing.username, 'soft delete');
    res.json({ ok: true });
  } catch (e) { sendError(res, 'DELETE /api/users/:id', e); }
});

app.post('/api/users/:id/reset-pin', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_pin } = req.body || {};
    if (!new_pin || !/^\d{4}$/.test(new_pin)) {
      return res.status(400).json({ error: 'new_pin 必须是 4 位数字' });
    }
    const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '用户不存在' });
    if (existing.role !== 'dispatcher') {
      return res.status(400).json({ error: '该功能仅用于 dispatcher' });
    }
    // [2026-06-20 fix#后端-P1-3] bcrypt 异步
    const pinHash = await bcrypt.hash(new_pin, 12);
    db.run("UPDATE users SET pin = ?, updated_at = datetime('now','localtime') WHERE id = ?", [pinHash, id]);
    logOp(req, 'users', 'reset_pin', id, existing.username, '');
    res.json({ ok: true });
  } catch (e) { sendError(res, 'POST /api/users/:id/reset-pin', e); }
});

// [M3] 管理员重置任意用户密码
app.post('/api/users/:id/reset-password', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body || {};
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: '新密码至少 6 位' });
    }
    const existing = db.get('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '用户不存在' });
    // [2026-06-20 fix#后端-P1-3] bcrypt 异步
    const passwordHash = await bcrypt.hash(new_password, 12);
    db.run("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      [passwordHash, id]);
    logOp(req, 'users', 'reset_password', id, existing.username, '');
    res.json({ ok: true });
  } catch (e) { sendError(res, 'POST /api/users/:id/reset-password', e); }
});

// CORS [fix#1]
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',');
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Request logging [fix#14]
app.use((req, res, next) => {
  if (req.method !== 'OPTIONS') {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (req.url.startsWith('/api')) {
        console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
      }
    });
  }
  next();
});

// ============================================================
// INPUT VALIDATION [fix#3]
// ============================================================
function validateStyle(s) {
  const errors = [];
  if (!s.style_no || !s.style_no.trim()) errors.push('款号不能为空');
  if (s.style_no && s.style_no.length > 50) errors.push('款号长度不能超过50');
  if (s.product_name && s.product_name.length > 100) errors.push('品名长度不能超过100');
  if (s.color && s.color.length > 30) errors.push('颜色长度不能超过30');
  if (s.size_spec && s.size_spec.length > 30) errors.push('规格长度不能超过30');
  if (s.customer && s.customer.length > 100) errors.push('客户名长度不能超过100');
  if (s.plan_qty !== undefined && (isNaN(s.plan_qty) || s.plan_qty < 0)) errors.push('计划数量必须为非负数');
  // [B-09 fix] 4 个日产量字段也校验
  const dailyFields = ['embroidery_daily_output', 'printing_daily_output', 'ironing_daily_output', 'template_daily_output', 'target_daily_output'];
  for (const f of dailyFields) {
    if (s[f] !== undefined && s[f] !== '' && (isNaN(s[f]) || Number(s[f]) < 0)) {
      errors.push(`${f} 必须为非负数`);
    }
  }
  return errors;
}

function validateMainPlan(p) {
  const errors = [];
  if (!p.style_no || !p.style_no.trim()) errors.push('款号不能为空');
  if (p.style_no && p.style_no.length > 50) errors.push('款号长度不能超过50');
  if (!p.due_date) errors.push('交期不能为空');
  if (p.plan_qty !== undefined && (isNaN(p.plan_qty) || p.plan_qty < 0)) errors.push('计划数量必须为非负数');
  // [2026-06-20 S-4] 日期逻辑校验:due_date 必须是有效日期
  if (p.due_date && !/^\d{4}-\d{2}-\d{2}/.test(String(p.due_date))) {
    errors.push('交期格式必须为 YYYY-MM-DD');
  }
  return errors;
}

// [2026-06-20 S-2] 后端统一日产量分配算法
// 输入: 开始/结束日期, 计划数量, 日产能
// 输出: [{ date, plan, actual, diff }] 数组
// 算法: 全天满载 + 最后一天余数(与 sewing-daily-plan 保持一致)
function computeDateData(start, end, planQty, dailyTarget) {
  if (!start || !end || !planQty || !dailyTarget) return [];
  const sd = new Date(start + 'T00:00:00');
  const ed = new Date(end + 'T00:00:00');
  if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || sd > ed) return [];
  const result = [];
  const fullDays = Math.floor(planQty / dailyTarget);
  const remainder = planQty % dailyTarget;
  const totalDays = remainder > 0 ? fullDays + 1 : fullDays;
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(sd);
    d.setDate(d.getDate() + i);
    let plan = 0;
    if (i < fullDays) plan = dailyTarget;
    else if (i === fullDays && remainder > 0) plan = remainder;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    result.push({ date: dateStr, plan, actual: 0, diff: -plan });
  }
  return result;
}

// [2026-06-20 S-1] 后端统一日期倒推算法,从 due_date 倒推
// 前端 autoCalcDates 同步采用此函数,不再各自实现
// 算法:
//   sewing_end    = due_date - SEWING_BUFFER
//   sewing_days   = ceil(plan_qty / sewing_capacity)
//   sewing_start  = sewing_end - sewing_days - line_change_days
//   secondary_end = sewing_start - 1
//   secondary_start = secondary_end - 3
//   cutting_end   = secondary_start - picking_days
//   cutting_days  = ceil(plan_qty / cutting_capacity)
//   cutting_start = cutting_end - cutting_days
//   ironing_start = sewing_end + 1, ironing_end = ironing_start + ironing_buffer
//   sewing_remind = sewing_start - 2
function recalcMainPlanDates(p) {
  if (!p.due_date) return p;
  const cfg = getSystemConfig();
  const SEWING_BUFFER = parseInt(cfg.shipping_buffer_days) || 5;
  const IRONING_BUFFER = parseInt(cfg.ironing_buffer_days) || 3;
  const SEWING_REMIND = parseInt(cfg.sewing_remind_days) || 2;
  const PICKING_DAYS = parseInt(cfg.picking_days) || 2;
  const LINE_CHANGE_DAYS = parseInt(cfg.line_change_days) || 1;
  const SEWING_CAP = parseInt(cfg.sewing_capacity) || 800;
  const CUTTING_CAP = parseInt(cfg.cutting_capacity) || 2000;

  const due = new Date(p.due_date + 'T00:00:00');
  if (isNaN(due.getTime())) return p;
  const qty = parseInt(p.plan_qty) || 0;

  function offset(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return fmtLocal(d);
  }

  const sewingEnd = offset(due, -SEWING_BUFFER);
  const sewingDays = Math.max(1, Math.ceil(qty / SEWING_CAP));
  const sewingStart = offset(new Date(sewingEnd + 'T00:00:00'), -(sewingDays - 1 + LINE_CHANGE_DAYS));
  const sewingRemind = offset(new Date(sewingStart + 'T00:00:00'), -SEWING_REMIND);
  const secondaryEnd = offset(new Date(sewingStart + 'T00:00:00'), -1);
  const secondaryStart = offset(new Date(secondaryEnd + 'T00:00:00'), -3);
  const cuttingEnd = offset(new Date(secondaryStart + 'T00:00:00'), -PICKING_DAYS);
  const cuttingDays = Math.max(1, Math.ceil(qty / CUTTING_CAP));
  const cuttingStart = offset(new Date(cuttingEnd + 'T00:00:00'), -(cuttingDays - 1));
  const ironingStart = offset(new Date(sewingEnd + 'T00:00:00'), 1);
  const ironingEnd = offset(new Date(ironingStart + 'T00:00:00'), IRONING_BUFFER - 1);

  p.sewing_remind_date = sewingRemind;
  p.cutting_start = cuttingStart;
  p.cutting_end = cuttingEnd;
  p.secondary_start = secondaryStart;
  p.secondary_end = secondaryEnd;
  p.sewing_start = sewingStart;
  p.sewing_end = sewingEnd;
  p.ironing_start = ironingStart;
  p.ironing_end = ironingEnd;
  return p;
}

function validateWarehouseRecord(r, type) {
  const errors = [];
  if (!r.style_no || !r.style_no.trim()) errors.push('款号不能为空');
  if (r.style_no && r.style_no.length > 50) errors.push('款号长度不能超过50');
  if (r.color && r.color.length > 30) errors.push('颜色长度不能超过30');
  if (r.size_spec && r.size_spec.length > 30) errors.push('规格长度不能超过30');
  if (r.operator && r.operator.length > 50) errors.push('操作人长度不能超过50');
  if (!r.qty || isNaN(r.qty) || r.qty <= 0) errors.push('数量必须为正数');
  if (!r.inbound_date && !r.outbound_date) errors.push('日期不能为空');
  return errors;
}

// [2026-06-20 fix#后端-P2-2] warehouse :type 白名单,避免 SQL 注入 + 未知类型查表
const ALLOWED_WAREHOUSE_TYPES = ['fabric', 'cutting_piece', 'accessory', 'finished'];
function warehouseTypeGuard(req, res, next) {
  if (!ALLOWED_WAREHOUSE_TYPES.includes(req.params.type)) {
    return res.status(400).json({ error: `warehouse_type 不合法,允许: ${ALLOWED_WAREHOUSE_TYPES.join(', ')}` });
  }
  next();
}

// Handle unique constraint violations with 409
function handleUniqueError(e, res) {
  if (e.message && e.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: '记录已存在（唯一约束冲突）' });
  }
  return res.status(500).json({ error: 'Internal server error' });
}

// ============================================================
// 二次加工类型配置 [B-03/B-04 fix]
// 4 个 daily-plan 端点共用同一套字段映射
// ============================================================
const SECONDARY_TYPES = {
  printing:   { sqlField: 'printing',   startField: 'printing_start',   endField: 'printing_end',   dailyField: 'printing_daily_output',   label: '印花' },
  embroidery: { sqlField: 'embroidery', startField: 'embroidery_start', endField: 'embroidery_end', dailyField: 'embroidery_daily_output', label: '刺绣' },
  ironing:    { sqlField: 'ironing_label', startField: 'ironing_start', endField: 'ironing_end', dailyField: 'ironing_daily_output', label: '烫标' },
  template:   { sqlField: 'template',   startField: 'template_start',   endField: 'template_end',   dailyField: 'template_daily_output',   label: '模板' },
};

// 日期范围:今天前后固定天数(所有 secondary 统一窗口,解决 B-04)
const SEC_DAILY_PLAN_WINDOW = { beforeDays: 7, afterDays: 21 };

// [B-10 fix] 通用 IN 查询 helper
function inQuery(column, values) {
  if (!values || values.length === 0) return { sql: '1=0', params: [] };
  const placeholders = values.map(() => '?').join(',');
  return { sql: `${column} IN (${placeholders})`, params: values };
}

// [B-12 fix] 产线名约定: production_lines.line_name 形如 "20班",
//              main_plan/schedule_master.line_team 是裸数字 "20"
//              用这个 helper 双向转换,避免各处散落的 .replace(/班$/, '')
function stripLineSuffix(name) {
  if (name == null) return '';
  return String(name).replace(/班$/, '').trim();
}
// 反向:给裸数字加 "班" 后缀,用于查 production_lines
function lineNameWithSuffix(num) {
  if (!num) return '';
  return /班$/.test(num) ? num : `${num}班`;
}

// ============================================================
// API ROUTES
// ============================================================

// ---------- 款式管理 ----------
app.get('/api/styles', (req, res) => {
  try {
    const { keyword } = req.query;
    const styles = db.searchStyles(keyword || '');
    res.json(styles);
  } catch (e) {
    console.error('GET /api/styles error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/styles/distinct', (req, res) => {
  try {
    res.json(db.getDistinctStyleNos());
  } catch (e) {
    console.error('GET /api/styles/distinct error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 款式导入导出 ----------
app.get('/api/styles/export', async (req, res) => {
  try {
    const styles = db.all('SELECT * FROM styles ORDER BY id');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('款式管理');
    ws.columns = [
      { header: '接单日期', key: 'order_date', width: 14 },
      { header: '款号', key: 'style_no', width: 25 },
      { header: '品名', key: 'product_name', width: 16 },
      { header: '款式分类', key: 'style_category', width: 12 },
      { header: '面料代号', key: 'fabric_code', width: 28 },
      { header: '成衣计划数量', key: 'plan_qty', width: 14 },
      { header: '交期', key: 'due_date', width: 14 },
      { header: '是否刺绣', key: 'embroidery', width: 10 },
      { header: '是否印花', key: 'printing', width: 10 },
      { header: '是否烫标', key: 'ironing_label', width: 10 },
      { header: '是否用模板', key: 'template', width: 10 },
      { header: 'TT时间', key: 'tt_time', width: 10 },
      { header: '目标日产量', key: 'target_daily_output', width: 12 },
      { header: '几条线生产', key: 'production_lines', width: 12 },
      { header: '备注', key: 'remarks', width: 20 },
      { header: '优先级', key: 'priority', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const s of styles) {
      ws.addRow({
        order_date: s.order_date || '', style_no: s.style_no || '',
        product_name: s.product_name || '', fabric_code: s.fabric_code || '',
        plan_qty: s.plan_qty || 0, due_date: s.due_date || '',
        embroidery: s.embroidery || '', printing: s.printing || '', ironing_label: s.ironing_label || '',
        template: s.template || '', tt_time: s.tt_time || '',
        target_daily_output: s.target_daily_output || 0, production_lines: s.production_lines || 0,
        remarks: s.remarks || '',
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=styles.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/styles/export error:', e);
    res.status(500).json({ error: '导出失败' });
  }
});

app.post('/api/styles/import', async (req, res) => {
  try {
    const { file } = req.body;
    if (!file) return res.status(400).json({ error: '请上传文件' });
    const buffer = Buffer.from(file, 'base64');
    // [2026-06-20 fix#后端-P3-10] magic bytes 校验: xlsx=PK, xls=D0CF11E0;拒绝其它类型避免恶意上传
    const magic = buffer.slice(0, 4);
    const isXlsx = magic[0] === 0x50 && magic[1] === 0x4B;       // 'PK'
    const isXls  = magic[0] === 0xD0 && magic[1] === 0xCF && magic[2] === 0x11 && magic[3] === 0xE0;
    if (!isXlsx && !isXls) {
      return res.status(400).json({ error: '文件格式不合法,仅支持 .xlsx / .xls' });
    }
    // 上限 10MB(对齐 express.json limit)
    if (buffer.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: '文件过大(>10MB)' });
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const ws = workbook.worksheets[0];
    if (!ws || ws.rowCount < 2) return res.status(400).json({ error: '文件为空' });
    const headerMap = {
      '接单日期': 'order_date', '款号': 'style_no', '品名': 'product_name', '款式分类': 'style_category',
      '面料代号': 'fabric_code', '成衣计划数量': 'plan_qty', '交期': 'due_date',
      '是否刺绣': 'embroidery', '刺绣日产量': 'embroidery_daily_output',
      '是否印花': 'printing', '印花日产量': 'printing_daily_output',
      '是否烫标': 'ironing_label', '烫标日产量': 'ironing_daily_output',
      '是否用模板': 'template', '模板日产量': 'template_daily_output',
      'TT时间': 'tt_time', '缝制目标日产量': 'target_daily_output', '备注': 'remarks',
    };
    const colMap = {};
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = headerMap[String(cell.value).trim()];
      if (key) colMap[colNumber] = key;
    });
    let imported = 0, skipped = 0;
    const txn = db.getDb().transaction(() => {
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const data = {};
        for (const [col, key] of Object.entries(colMap)) {
          let val = row.getCell(Number(col)).value;
          if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
          if (val instanceof Date) {
            data[key] = `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
          } else if (typeof val === 'number' && val > 40000) {
            const ms = (val - 25569) * 86400000;
            const d = new Date(ms);
            data[key] = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          } else {
            data[key] = val != null ? String(val).trim() : '';
          }
        }
        if (!data.style_no) { skipped++; continue; }
        data.plan_qty = parseInt(data.plan_qty) || 0;
        data.target_daily_output = parseInt(data.target_daily_output) || 0;
        data.embroidery_daily_output = parseInt(data.embroidery_daily_output) || 0;
        data.printing_daily_output = parseInt(data.printing_daily_output) || 0;
        data.ironing_daily_output = parseInt(data.ironing_daily_output) || 0;
        data.template_daily_output = parseInt(data.template_daily_output) || 0;
        // Handle Excel serial date for 接单日期
        if (data.order_date && !isNaN(Number(data.order_date)) && Number(data.order_date) > 40000) {
          const serial = Number(data.order_date);
          const ms = (serial - 25569) * 86400000;
          const d = new Date(ms);
          data.order_date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        }
        db.run(`INSERT INTO styles (style_no, product_name, fabric_code, plan_qty, due_date, order_date,
          embroidery, embroidery_daily_output, printing, printing_daily_output,
          ironing_label, ironing_daily_output, template, template_daily_output,
          tt_time, target_daily_output, remarks)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [data.style_no, data.product_name, data.fabric_code, data.plan_qty, data.due_date,
           data.order_date, data.embroidery, data.embroidery_daily_output,
           data.printing, data.printing_daily_output, data.ironing_label, data.ironing_daily_output,
           data.template, data.template_daily_output, data.tt_time, data.target_daily_output, data.remarks]);
        imported++;
      }
    });
    txn();
    broadcastSection('styles', db.all('SELECT * FROM styles ORDER BY id'));
    logOp(req, 'styles', 'import', null, `导入${imported}条`);
    res.json({ ok: true, imported, skipped });
  } catch (e) {
    sendError(res, 'POST /api/styles/import', e);
  }
});

app.get('/api/styles/:id', (req, res) => {
  try {
    const row = db.get('SELECT * FROM styles WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(row);
  } catch (e) {
    console.error('GET /api/styles/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// P0 安全: POST /styles 仅用于创建,id 由服务端生成,客户端不可篡改
app.post('/api/styles', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const s = req.body;
    const errors = validateStyle(s);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });
    if (s.id) return res.status(400).json({ error: '创建时不能携带 id,请使用 PUT /api/styles/:id 更新' });

    const result = db.run(`INSERT INTO styles (style_no, product_name, style_category, fabric_code, plan_qty, due_date, order_date, embroidery, embroidery_daily_output, printing, printing_daily_output, ironing_label, ironing_daily_output, template, template_daily_output, tt_time, target_daily_output, has_special_wash, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.style_no, s.product_name, s.style_category||'', s.fabric_code, s.plan_qty || 0, s.due_date, s.order_date||'', s.embroidery||'', s.embroidery_daily_output||0, s.printing||'', s.printing_daily_output||0, s.ironing_label||'', s.ironing_daily_output||0, s.template||'', s.template_daily_output||0, s.tt_time||'', s.target_daily_output||0, parseInt(s.has_special_wash) || 0, s.remarks||'']);
    broadcastSection('styles', db.searchStyles(''));
    logOp(req, 'styles', 'create', result.lastInsertRowid, s.style_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/styles error:', e);
    handleUniqueError(e, res);
  }
});

// P0 安全: 更新走 PUT,id 来自 URL 不可被 body 篡改
app.put('/api/styles/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'id 不合法' });
    const s = req.body;
    const errors = validateStyle(s);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });
    const existing = db.get('SELECT id FROM styles WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '款式不存在' });
    db.run(`UPDATE styles SET style_no=?,product_name=?,style_category=?,fabric_code=?,plan_qty=?,due_date=?,order_date=?,embroidery=?,embroidery_daily_output=?,printing=?,printing_daily_output=?,ironing_label=?,ironing_daily_output=?,template=?,template_daily_output=?,tt_time=?,target_daily_output=?,has_special_wash=?,remarks=? WHERE id=?`,
      [s.style_no, s.product_name, s.style_category||'', s.fabric_code, s.plan_qty, s.due_date, s.order_date||'', s.embroidery||'', s.embroidery_daily_output||0, s.printing||'', s.printing_daily_output||0, s.ironing_label||'', s.ironing_daily_output||0, s.template||'', s.template_daily_output||0, s.tt_time||'', s.target_daily_output||0, parseInt(s.has_special_wash) || 0, s.remarks||'', id]);
    broadcastSection('styles', db.searchStyles(''));
    logOp(req, 'styles', 'update', id, s.style_no);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('PUT /api/styles/:id error:', e);
    handleUniqueError(e, res);
  }
});

app.delete('/api/styles/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const existing = db.get('SELECT id FROM styles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM styles WHERE id = ?', [req.params.id]);
    broadcastSection('styles', db.searchStyles(''));
    logOp(req, 'styles', 'delete', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/styles error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 车间 & 产线 ----------
app.get('/api/workshops', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM workshops ORDER BY sort_order'));
  } catch (e) {
    console.error('GET /api/workshops error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/workshops/:id/lines', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM production_lines WHERE workshop_id = ? ORDER BY sort_order', [req.params.id]));
  } catch (e) {
    console.error('GET /api/workshops/:id/lines error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/production-lines', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM production_lines ORDER BY sort_order'));
  } catch (e) {
    console.error('GET /api/production-lines error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/production-lines/:id', (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['空闲', '生产中', '换线中', '故障'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效状态' });
    }
    const existing = db.get('SELECT * FROM production_lines WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const oldStatus = existing.status;
    if (oldStatus !== status) {
      db.run('UPDATE production_lines SET status = ? WHERE id = ?', [status, req.params.id]);
      db.run('INSERT INTO production_line_events (line_id, event_type, old_status, new_status, remark) VALUES (?,?,?,?,?)',
        [req.params.id, 'status_change', oldStatus, status, req.body.remark || '']);
      logOp(req, 'production_lines', 'status_change', req.params.id, existing.line_name, `${oldStatus}→${status}`);
    }
    broadcastSection('productionLines', db.all('SELECT * FROM production_lines ORDER BY sort_order'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/production-lines error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 产线事件历史 ----------
app.get('/api/production-lines/:id/events', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM production_line_events WHERE line_id = ? ORDER BY created_at DESC', [req.params.id]));
  } catch (e) {
    console.error('GET /api/production-lines/:id/events error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 缝制车间管理（三层树） ----------
app.get('/api/sewing-workshop-tree', (req, res) => {
  try {
    const workshops = db.all('SELECT * FROM workshops ORDER BY sort_order');
    const lines = db.all('SELECT * FROM production_lines ORDER BY sort_order');
    const categories = db.all('SELECT * FROM line_style_categories ORDER BY sort_order');
    const tree = workshops.map(w => ({
      id: w.id, name: w.name, type: 'workshop', sort_order: w.sort_order,
      children: lines.filter(l => l.workshop_id === w.id).map(l => ({
        id: l.id, name: l.line_name, type: 'team', workshop_id: l.workshop_id, sort_order: l.sort_order, status: l.status, daily_output: l.daily_output || 0,
        children: categories.filter(c => c.line_id === l.id).map(c => ({
          id: c.id, name: c.name, type: 'category', line_id: c.line_id, sort_order: c.sort_order
        }))
      }))
    }));
    res.json(tree);
  } catch (e) {
    console.error('GET /api/sewing-workshop-tree error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sewing-workshop-tree', (req, res) => {
  try {
    const { type, name, parent_id } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type和name必填' });
    if (type === 'workshop') {
      const max = db.get('SELECT MAX(sort_order) as m FROM workshops');
      const result = db.run('INSERT INTO workshops (name, sort_order) VALUES (?, ?)', [name, (max?.m || 0) + 1]);
      res.json({ id: result.lastInsertRowid });
    } else if (type === 'team') {
      if (!parent_id) return res.status(400).json({ error: '班组需要workshop_id' });
      const max = db.get('SELECT MAX(sort_order) as m FROM production_lines WHERE workshop_id = ?', [parent_id]);
      const result = db.run('INSERT INTO production_lines (workshop_id, line_name, sort_order) VALUES (?, ?, ?)', [parent_id, name, (max?.m || 0) + 1]);
      res.json({ id: result.lastInsertRowid });
    } else if (type === 'category') {
      if (!parent_id) return res.status(400).json({ error: '款式分类需要line_id' });
      const max = db.get('SELECT MAX(sort_order) as m FROM line_style_categories WHERE line_id = ?', [parent_id]);
      const result = db.run('INSERT INTO line_style_categories (line_id, name, sort_order) VALUES (?, ?, ?)', [parent_id, name, (max?.m || 0) + 1]);
      res.json({ id: result.lastInsertRowid });
    } else {
      return res.status(400).json({ error: '无效type' });
    }
  } catch (e) {
    console.error('POST /api/sewing-workshop-tree error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/sewing-workshop-tree/batch', (req, res) => {
  try {
    const { items } = req.body; // [{id, type, name}]
    if (!Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '参数错误' });
    }
    let updated = 0;
    const rawDb = db.getDb();
    const txn = rawDb.transaction(() => {
      for (const item of items) {
        if (!item.id || !item.type || !item.name) continue;
        if (item.type === 'workshop') {
          db.run('UPDATE workshops SET name = ? WHERE id = ?', [item.name, item.id]);
        } else if (item.type === 'team') {
          db.run('UPDATE production_lines SET line_name = ? WHERE id = ?', [item.name, item.id]);
        } else if (item.type === 'category') {
          db.run('UPDATE line_style_categories SET name = ? WHERE id = ?', [item.name, item.id]);
        }
        updated++;
      }
    });
    txn();
    res.json({ updated });
  } catch (e) {
    console.error('PUT /api/sewing-workshop-tree/batch error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/sewing-workshop-tree/:id', (req, res) => {
  try {
    const { type, name, daily_output } = req.body;
    if (!type || !name) return res.status(400).json({ error: 'type和name必填' });
    if (type === 'workshop') {
      db.run('UPDATE workshops SET name = ? WHERE id = ?', [name, req.params.id]);
    } else if (type === 'team') {
      db.run('UPDATE production_lines SET line_name = ?, daily_output = ? WHERE id = ?', [name, parseInt(daily_output) || 0, req.params.id]);
    } else if (type === 'category') {
      db.run('UPDATE line_style_categories SET name = ? WHERE id = ?', [name, req.params.id]);
    } else {
      return res.status(400).json({ error: '无效type' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/sewing-workshop-tree error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/sewing-workshop-tree/:id', (req, res) => {
  try {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: 'type必填' });
    if (type === 'workshop') {
      const lines = db.all('SELECT id FROM production_lines WHERE workshop_id = ?', [req.params.id]);
      for (const l of lines) {
        db.run('DELETE FROM line_style_categories WHERE line_id = ?', [l.id]);
      }
      db.run('DELETE FROM production_lines WHERE workshop_id = ?', [req.params.id]);
      db.run('DELETE FROM workshops WHERE id = ?', [req.params.id]);
    } else if (type === 'team') {
      db.run('DELETE FROM line_style_categories WHERE line_id = ?', [req.params.id]);
      db.run('DELETE FROM production_lines WHERE id = ?', [req.params.id]);
    } else if (type === 'category') {
      db.run('DELETE FROM line_style_categories WHERE id = ?', [req.params.id]);
    } else {
      return res.status(400).json({ error: '无效type' });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/sewing-workshop-tree error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 缝制车间：批量操作 ----------
app.post('/api/sewing-workshop-tree/batch', (req, res) => {
  try {
    const { type, items } = req.body; // type='category', items=[{line_id, name}]
    if (type !== 'category' || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '参数错误' });
    }
    let added = 0;
    const rawDb = db.getDb();
    const txn = rawDb.transaction(() => {
      for (const item of items) {
        if (!item.line_id || !item.name) continue;
        const max = db.get('SELECT MAX(sort_order) as m FROM line_style_categories WHERE line_id = ?', [item.line_id]);
        db.run('INSERT INTO line_style_categories (line_id, name, sort_order) VALUES (?, ?, ?)',
          [item.line_id, item.name, (max?.m || 0) + 1]);
        added++;
      }
    });
    txn();
    res.json({ added });
  } catch (e) {
    console.error('POST /api/sewing-workshop-tree/batch error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 缝制车间：导入导出 ----------
app.get('/api/sewing-workshop-tree/export', async (req, res) => {
  try {
    const workshops = db.all('SELECT * FROM workshops ORDER BY sort_order');
    const lines = db.all('SELECT * FROM production_lines ORDER BY sort_order');
    const categories = db.all('SELECT * FROM line_style_categories ORDER BY sort_order');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('车间班组款式分类');
    ws.columns = [
      { header: '车间', key: 'workshop', width: 15 },
      { header: '班组', key: 'team', width: 15 },
      { header: '日产量', key: 'daily_output', width: 12 },
      { header: '款式分类', key: 'category', width: 30 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const w of workshops) {
      const wLines = lines.filter(l => l.workshop_id === w.id);
      const wCats = categories.filter(c => wLines.some(l => l.id === c.line_id));
      if (wCats.length === 0) {
        for (const l of wLines) {
          ws.addRow({ workshop: w.name, team: l.line_name, daily_output: l.daily_output || 0, category: '' });
        }
      } else {
        for (const l of wLines) {
          const lCats = categories.filter(c => c.line_id === l.id);
          if (lCats.length === 0) {
            ws.addRow({ workshop: w.name, team: l.line_name, daily_output: l.daily_output || 0, category: '' });
          } else {
            for (const c of lCats) {
              ws.addRow({ workshop: w.name, team: l.line_name, daily_output: l.daily_output || 0, category: c.name });
            }
          }
        }
      }
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=workshop_tree.xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/sewing-workshop-tree/export error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/sewing-workshop-tree/import', async (req, res) => {
  try {
    const { file, mode } = req.body; // mode: 'append' (default) or 'replace'
    if (!file) return res.status(400).json({ error: '请上传文件' });
    const buffer = Buffer.from(file, 'base64');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws || ws.rowCount < 2) return res.status(400).json({ error: '文件为空' });

    if (mode === 'replace') {
      // 清空旧树，用 Excel 数据重建
      let workshopsCreated = 0, teamsCreated = 0, catsCreated = 0;
      const txn = db.getDb().transaction(() => {
        db.run('DELETE FROM line_style_categories');
        db.run('DELETE FROM production_lines');
        db.run('DELETE FROM workshops');
        const wsMap = {};
        const lineMap = {};
        for (let i = 2; i <= ws.rowCount; i++) {
          const row = ws.getRow(i);
          const workshopName = String(row.getCell(1).value || '').trim();
          const teamName = String(row.getCell(2).value || '').trim();
          const categoryName = String(row.getCell(3).value || '').trim();
          const dailyOutput = parseInt(row.getCell(4).value) || 0;
          if (!workshopName || !teamName) continue;
          if (!wsMap[workshopName]) {
            const r = db.run('INSERT INTO workshops (name, sort_order) VALUES (?, ?)', [workshopName, Object.keys(wsMap).length + 1]);
            wsMap[workshopName] = r.lastInsertRowid;
            workshopsCreated++;
          }
          const wsId = wsMap[workshopName];
          const lineKey = `${wsId}_${teamName}`;
          if (!lineMap[lineKey]) {
            const r = db.run('INSERT INTO production_lines (workshop_id, line_name, daily_output, sort_order) VALUES (?, ?, ?, ?)',
              [wsId, teamName, dailyOutput, teamsCreated + 1]);
            lineMap[lineKey] = r.lastInsertRowid;
            teamsCreated++;
          } else {
            db.run('UPDATE production_lines SET daily_output = ? WHERE id = ?', [dailyOutput, lineMap[lineKey]]);
          }
          if (categoryName) {
            db.run('INSERT INTO line_style_categories (line_id, name, sort_order) VALUES (?, ?, ?)',
              [lineMap[lineKey], categoryName, catsCreated + 1]);
            catsCreated++;
          }
        }
      });
      txn();
      res.json({ mode: 'replace', workshops: workshopsCreated, teams: teamsCreated, categories: catsCreated });
    } else {
      // 追加模式
      const workshops = db.all('SELECT * FROM workshops');
      const lines = db.all('SELECT * FROM production_lines');
      const wsMap = {};
      for (const w of workshops) wsMap[w.name] = w.id;
      const lineMap = {};
      for (const l of lines) lineMap[`${l.workshop_id}_${l.line_name}`] = l.id;

      let added = 0, skipped = 0;
      const txn = db.getDb().transaction(() => {
        for (let i = 2; i <= ws.rowCount; i++) {
          const row = ws.getRow(i);
          const workshopName = String(row.getCell(1).value || '').trim();
          const teamName = String(row.getCell(2).value || '').trim();
          const categoryName = String(row.getCell(3).value || '').trim();
          const dailyOutput = parseInt(row.getCell(4).value) || 0;
          if (!workshopName || !teamName || !categoryName) { skipped++; continue; }
          const wsId = wsMap[workshopName];
          if (!wsId) { skipped++; continue; }
          const lineId = lineMap[`${wsId}_${teamName}`];
          if (!lineId) { skipped++; continue; }
          if (dailyOutput > 0) {
            db.run('UPDATE production_lines SET daily_output = ? WHERE id = ?', [dailyOutput, lineId]);
          }
          const existing = db.get('SELECT id FROM line_style_categories WHERE line_id = ? AND name = ?', [lineId, categoryName]);
          if (existing) { skipped++; continue; }
          const max = db.get('SELECT MAX(sort_order) as m FROM line_style_categories WHERE line_id = ?', [lineId]);
          db.run('INSERT INTO line_style_categories (line_id, name, sort_order) VALUES (?, ?, ?)',
            [lineId, categoryName, (max?.m || 0) + 1]);
          added++;
        }
      });
      txn();
      res.json({ added, skipped });
    }
  } catch (e) {
    console.error('POST /api/sewing-workshop-tree/import error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ---------- 主计划 ----------
app.get('/api/main-plan', (req, res) => {
  try {
    // [2026-06-20 M-1] 支持 page/limit/sort/dir 简单分页参数
    // 不传 page/limit 时返回全部(向后兼容)
    // [fix 2026-06-20 S-3] 之前 Math.max(1, 0)=1 导致无参时也走分页且 limit=1,
    // 修复: 先判断是否有 query,再 parse
    const hasPaging = req.query.page !== undefined || req.query.limit !== undefined;
    if (!hasPaging) {
      return res.json(db.all('SELECT * FROM main_plan'));
    }
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const total = db.get('SELECT COUNT(*) as c FROM main_plan').c;
    const rows = db.all(`SELECT * FROM main_plan ORDER BY id DESC LIMIT ? OFFSET ?`, [limit, offset]);
    res.json({ rows, total, page, limit });
  } catch (e) {
    console.error('GET /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [2026-06-20] 裁片库入库：返回有裁剪计划的款式（供入库弹窗选择）
app.get('/api/main-plan/styles', (req, res) => {
  try {
    const { keyword } = req.query;
    let sql = `SELECT DISTINCT style_no, product_name, due_date, cutting_start, cutting_end
      FROM main_plan WHERE style_no IS NOT NULL AND style_no != ''`;
    const params = [];
    if (keyword) {
      sql += ` AND (style_no LIKE ? OR product_name LIKE ?)`;
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    sql += ' ORDER BY cutting_start DESC, style_no LIMIT 100';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/main-plan/styles error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 预排总计划甘特图数据
app.get('/api/main-plan/gantt', (req, res) => {
  try {
    const plans = db.all(`
      SELECT id, style_no, product_name, plan_qty, due_date,
        cutting_start, cutting_end,
        printing_start, printing_end,
        embroidery_start, embroidery_end,
        template_start, template_end,
        ironing_start, ironing_end,
        sewing_remind_date, sewing_start, sewing_end,
        workshop, line_team, pipeline_count, is_scheduled
      FROM main_plan
      WHERE cutting_start IS NOT NULL AND cutting_end IS NOT NULL
      ORDER BY cutting_start ASC, id ASC
    `);

    // 计算日期范围
    const allDates = plans.flatMap(p => [
      p.cutting_start, p.cutting_end,
      p.printing_start, p.printing_end,
      p.embroidery_start, p.embroidery_end,
      p.template_start, p.template_end,
      p.ironing_start, p.ironing_end,
      p.sewing_start, p.sewing_end, p.due_date
    ]).filter(Boolean);

    let dateRange = { start: '', end: '' };
    if (allDates.length > 0) {
      const min = new Date(Math.min(...allDates.map(d => new Date(d + 'T00:00:00'))));
      const max = new Date(Math.max(...allDates.map(d => new Date(d + 'T00:00:00'))));
      // 扩展到周一~周日
      min.setDate(min.getDate() - ((min.getDay() + 6) % 7)); // 回到周一
      max.setDate(max.getDate() + (7 - ((max.getDay() + 6) % 7)) - 1); // 到周日
      // 至少显示4周
      const diffDays = (max - min) / 86400000;
      if (diffDays < 28) max.setDate(max.getDate() + (28 - diffDays));
      dateRange = {
        start: fmtLocal(min),
        end: fmtLocal(max),
      };
    }

    res.json({ plans, dateRange });
  } catch (e) {
    console.error('GET /api/main-plan/gantt error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/main-plan', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const p = req.body;
    const errors = validateMainPlan(p);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    // [2026-06-20 S-1] 后端统一重算日期,不信任前端传的日期值
    recalcMainPlanDates(p);

    if (p.id) {
      const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [p.id]);
      if (!existing) return res.status(404).json({ error: '计划不存在' });
      db.run(`UPDATE main_plan SET style_id=?,style_no=?,product_name=?,plan_qty=?,due_date=?,arrival_date=?,cutting_start=?,cutting_end=?,secondary_start=?,secondary_end=?,printing_start=?,printing_end=?,embroidery_start=?,embroidery_end=?,template_start=?,template_end=?,sewing_remind_date=?,sewing_start=?,sewing_end=?,ironing_start=?,ironing_end=?,conflict_flag=?,pipeline_count=?,is_scheduled=?,workshop=?,line_team=?,line_count=?,line_index=?,expired=? WHERE id=?`,
        [p.style_id, p.style_no, p.product_name, p.plan_qty, p.due_date, p.arrival_date||'', p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.printing_start||'', p.printing_end||'', p.embroidery_start||'', p.embroidery_end||'', p.template_start||'', p.template_end||'', p.sewing_remind_date, p.sewing_start, p.sewing_end, p.ironing_start || '', p.ironing_end || '', p.conflict_flag || 0, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '', p.line_count || 1, p.line_index || 1, p.expired || 0, p.id]);
      broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
      logOp(req, 'main_plan', 'update', p.id, p.style_no);
      return res.json({ ok: true, id: p.id });
    }
    const result = db.run(`INSERT INTO main_plan (style_id,style_no,product_name,plan_qty,due_date,arrival_date,cutting_start,cutting_end,secondary_start,secondary_end,printing_start,printing_end,embroidery_start,embroidery_end,template_start,template_end,sewing_remind_date,sewing_start,sewing_end,ironing_start,ironing_end,conflict_flag,pipeline_count,is_scheduled,workshop,line_team,line_count,line_index,expired)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.style_id, p.style_no, p.product_name, p.plan_qty || 0, p.due_date, p.arrival_date||'', p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.printing_start||'', p.printing_end||'', p.embroidery_start||'', p.embroidery_end||'', p.template_start||'', p.template_end||'', p.sewing_remind_date, p.sewing_start, p.sewing_end, p.ironing_start || '', p.ironing_end || '', p.conflict_flag || 0, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '', p.line_count || 1, p.line_index || 1, p.expired || 0]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    logOp(req, 'main_plan', 'create', result.lastInsertRowid, p.style_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/main-plan/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const p = req.body;
    const id = req.params.id;
    const existing = db.get('SELECT * FROM main_plan WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '计划不存在' });
    // [2026-06-20 段4] PUT 同样走重算,确保 due_date/plan_qty 改动后 cutting/sewing 等日期同步
    const merged = {
      style_id: p.style_id ?? existing.style_id,
      style_no: p.style_no ?? existing.style_no,
      product_name: p.product_name ?? existing.product_name,
      plan_qty: p.plan_qty ?? existing.plan_qty,
      due_date: p.due_date ?? existing.due_date,
      arrival_date: p.arrival_date ?? existing.arrival_date ?? '',
    };
    if (p.due_date !== undefined || p.plan_qty !== undefined) {
      recalcMainPlanDates(merged);
    }
    const style_id = merged.style_id;
    const style_no = merged.style_no;
    const product_name = merged.product_name;
    const plan_qty = merged.plan_qty;
    const due_date = merged.due_date;
    const arrival_date = merged.arrival_date;
    const cutting_start = p.cutting_start ?? merged.cutting_start ?? existing.cutting_start;
    const cutting_end = p.cutting_end ?? merged.cutting_end ?? existing.cutting_end;
    const secondary_start = p.secondary_start ?? merged.secondary_start ?? existing.secondary_start;
    const secondary_end = p.secondary_end ?? merged.secondary_end ?? existing.secondary_end;
    const printing_start = p.printing_start ?? existing.printing_start ?? '';
    const printing_end = p.printing_end ?? existing.printing_end ?? '';
    const embroidery_start = p.embroidery_start ?? existing.embroidery_start ?? '';
    const embroidery_end = p.embroidery_end ?? existing.embroidery_end ?? '';
    const template_start = p.template_start ?? existing.template_start ?? '';
    const template_end = p.template_end ?? existing.template_end ?? '';
    const sewing_remind_date = p.sewing_remind_date ?? merged.sewing_remind_date ?? existing.sewing_remind_date;
    const sewing_start = p.sewing_start ?? merged.sewing_start ?? existing.sewing_start;
    const sewing_end = p.sewing_end ?? merged.sewing_end ?? existing.sewing_end;
    const ironing_start = p.ironing_start ?? existing.ironing_start ?? '';
    const ironing_end = p.ironing_end ?? existing.ironing_end ?? '';
    const conflict_flag = p.conflict_flag ?? existing.conflict_flag ?? 0;
    const pipeline_count = p.pipeline_count ?? existing.pipeline_count ?? 1;
    const is_scheduled = p.is_scheduled !== undefined ? (p.is_scheduled ? 1 : 0) : existing.is_scheduled;
    const workshop = p.workshop ?? existing.workshop ?? '';
    const line_team = p.line_team ?? existing.line_team ?? '';
    const line_count = p.line_count ?? existing.line_count ?? 1;
    const line_index = p.line_index ?? existing.line_index ?? 1;
    const expired = p.expired ?? existing.expired ?? 0;
    db.run(`UPDATE main_plan SET style_id=?,style_no=?,product_name=?,plan_qty=?,due_date=?,arrival_date=?,cutting_start=?,cutting_end=?,secondary_start=?,secondary_end=?,printing_start=?,printing_end=?,embroidery_start=?,embroidery_end=?,template_start=?,template_end=?,sewing_remind_date=?,sewing_start=?,sewing_end=?,ironing_start=?,ironing_end=?,conflict_flag=?,pipeline_count=?,is_scheduled=?,workshop=?,line_team=?,line_count=?,line_index=?,expired=? WHERE id=?`,
      [style_id, style_no, product_name, plan_qty, due_date, arrival_date, cutting_start, cutting_end, secondary_start, secondary_end, printing_start, printing_end, embroidery_start, embroidery_end, template_start, template_end, sewing_remind_date, sewing_start, sewing_end, ironing_start, ironing_end, conflict_flag, pipeline_count, is_scheduled, workshop, line_team, line_count, line_index, expired, id]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    // [2026-06-20 fix#业务-P2-2] 记录 main_plan 字段变更 diff
    const updated = db.get('SELECT * FROM main_plan WHERE id = ?', [id]);
    const mainPlanDiff = computeDiff(existing, updated, ['plan_qty', 'due_date', 'arrival_date', 'cutting_start', 'cutting_end', 'sewing_start', 'sewing_end', 'workshop', 'line_team', 'is_scheduled']);
    logOp(req, 'main_plan', 'update', id, style_no, { msg: '', diff: mainPlanDiff });
    res.json({ ok: true, id });
  } catch (e) {
    console.error('PUT /api/main-plan/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/main-plan/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    // [2026-06-20 fix#业务-P1-6] 级联删除:schedule_daily + schedule_master 同步清
    //   避免下游孤儿行(原 main_plan_id 找不到)
    const delTxn = db.getDb().transaction(() => {
      db.run('DELETE FROM schedule_daily WHERE master_id IN (SELECT id FROM schedule_master WHERE style_id = (SELECT style_id FROM main_plan WHERE id = ?))', [req.params.id]);
      db.run('DELETE FROM schedule_master WHERE style_id = (SELECT style_id FROM main_plan WHERE id = ?)', [req.params.id]);
      db.run('DELETE FROM main_plan WHERE id = ?', [req.params.id]);
    });
    delTxn();
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    logOp(req, 'main_plan', 'delete', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 系统参数 (system_config 读写)
// ============================================================
app.get('/api/system-config', requireRole('admin', 'planning_manager', 'planner', 'dispatcher', 'supervisor'), (req, res) => {
  try {
    res.json(db.all('SELECT config_key, config_value, description FROM system_config ORDER BY config_key'));
  } catch (e) { sendError(res, 'GET /api/system-config', e); }
});

app.put('/api/system-config/:key', requireRole('admin', 'planning_manager'), (req, res) => {
  try {
    const { key } = req.params;
    const { config_value } = req.body;
    if (config_value === undefined || config_value === null) {
      return res.status(400).json({ error: 'config_value 必填' });
    }
    const existing = db.get('SELECT config_key FROM system_config WHERE config_key = ?', [key]);
    if (!existing) return res.status(404).json({ error: '参数不存在' });
    db.run('UPDATE system_config SET config_value = ? WHERE config_key = ?', [String(config_value), key]);
    invalidateSystemConfig();  // [段7 C-1] 刷新缓存
    logOp(req, 'system_config', 'update', null, key, `value=${config_value}`);
    res.json({ ok: true, config_key: key, config_value: String(config_value) });
  } catch (e) { sendError(res, 'PUT /api/system-config/:key', e); }
});

// [2026-06-19] 通用系统参数(system_params, 区别于 system_config 排程常量)
app.get('/api/system-params', requireRole('admin', 'planning_manager', 'planner', 'dispatcher', 'supervisor'), (req, res) => {
  try { res.json(db.listSystemParams()); } catch (e) { sendError(res, 'GET /api/system-params', e); }
});

app.put('/api/system-params/:key', requireRole('admin', 'planning_manager'), (req, res) => {
  try {
    const { key } = req.params;
    const { value, remark } = req.body;
    if (value === undefined) return res.status(400).json({ error: 'value 必填' });
    db.setSystemParam(key, value, remark || '');
    logOp(req, 'system_params', 'update', null, key, `value=${value}`);
    res.json({ ok: true, key, value: String(value) });
  } catch (e) { sendError(res, 'PUT /api/system-params/:key', e); }
});

// ---------- 预排产算法 ----------
app.post('/api/main-plan/auto-schedule', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    // 0. 读 system_config 可调参数(带 fallback)
    const cfg = getSystemConfig();
    const LOADING_TO_ARRIVAL = parseInt(cfg.loading_to_arrival_days) || 15;
    const FABRIC_INSPECTION = parseInt(cfg.fabric_inspection_days) || 9;
    const SEWING_BUFFER = parseInt(cfg.sewing_buffer_days) || 15;
    const SEWING_REMIND = parseInt(cfg.sewing_remind_days) || 10;
    const IRONING_BUFFER = parseInt(cfg.ironing_buffer_days) || 3;
    const MAX_SEWING_LINES = parseInt(cfg.max_sewing_lines) || 49;
    const DEFAULT_DAILY_TARGET = parseInt(cfg.default_daily_target) || 500;
    // [2026-06-19] 删除 workshop_category_multiplier，直接用班组数作为上限
    // [2026-06-19] 特殊水洗前置天数 — 款式 has_special_wash=1 时裁剪提前 N 天
    const SPECIAL_WASH_DAYS = parseInt(db.getSystemParam('special_wash_days')) || 7;

    // [2026-06-20 批次2-业务-P0-5] 稳定排序种子
    // 同一份输入数据,每次 auto-schedule 都用同一个 runSeed 作打破平局字段
    // 避免不同进程/不同启动顺序导致的 plan_qty 分配不一致
    const runSeed = crypto.randomBytes(4).readUInt32BE(0);
    function styleHash(styleNo) {
      // FNV-1a 32-bit hash,salted with runSeed
      let h = (0x811c9dc5 ^ runSeed) >>> 0;
      for (let i = 0; i < styleNo.length; i++) {
        h ^= styleNo.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
      }
      return h;
    }

    // 1. 获取所有数据
    const loadingList = db.all('SELECT * FROM fabric_loading_list');
    const styles = db.all('SELECT * FROM styles');
    const capRows = db.all('SELECT * FROM capacity_config');
    const cap = {};
    for (const r of capRows) cap[r.process_type] = parseInt(r.daily_capacity) || 0;

    const styleMap = {};
    for (const s of styles) styleMap[s.style_no] = s;

    // 2. 按款式去重，只处理装柜清单中的款式
    const styleNos = [...new Set(loadingList.map(r => r.style_no).filter(Boolean).filter(sn => styleMap[sn]))];
    if (styleNos.length === 0) return res.json({ ok: true, count: 0, message: '装柜清单为空' });

    // 3. 按款式汇总装柜信息（取最早的装柜日期，累加 garment_qty）
    const loadingInfo = {};
    for (const row of loadingList) {
      const sn = row.style_no;
      if (!sn || !styleMap[sn]) continue;
      if (!loadingInfo[sn]) {
        loadingInfo[sn] = { loading_date: row.loading_date || '', garment_qty: 0 };
      }
      if (row.loading_date && (!loadingInfo[sn].loading_date || row.loading_date < loadingInfo[sn].loading_date)) {
        loadingInfo[sn].loading_date = row.loading_date;
      }
      loadingInfo[sn].garment_qty += parseFloat(row.garment_qty) || 0;
    }

    // 数量优先规则
    function getQty(sn) {
      const li = loadingInfo[sn];
      const st = styleMap[sn];
      if (li && li.garment_qty > 0) return li.garment_qty;
      if (st) return parseInt(st.plan_qty) || 0;
      return li ? li.garment_qty : 0;
    }

    // 日期工具
    function parseDate(val) {
      if (!val) return '';
      const s = String(val).trim();
      // Excel serial number
      if (/^\d{4,6}$/.test(s)) {
        const serial = parseInt(s);
        const ms = (serial - 25569) * 86400000;
        const d = new Date(ms);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      }
      // Already ISO date
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
      return '';
    }
    function addDays(dateStr, days) {
      const d = parseDate(dateStr);
      if (!d) return '';
      const dt = new Date(d + 'T00:00:00');
      dt.setDate(dt.getDate() + days);
      return fmtLocal(dt);
    }

    // ========== Step 1: 裁剪 ==========
    // [2026-06-19] 裁剪排序：同/近 cutting_start 时，二次加工 + 特殊水洗优先级高
    function cuttingPriority(sn) {
      const s = styleMap[sn];
      if (!s) return 0;
      const secondary = (s.printing || s.embroidery || s.template) ? 1 : 0;
      const specialWash = parseInt(s.has_special_wash) > 0 ? 1 : 0;
      return secondary + specialWash;  // 0=普通, 1=二次加工或特殊水洗, 2=两者都有
    }
    const cuttingItems = styleNos.map(sn => {
      const li = loadingInfo[sn];
      const s = styleMap[sn];
      const offset = s && parseInt(s.has_special_wash) > 0 ? -SPECIAL_WASH_DAYS : 0;
      return {
        style_no: sn,
        qty: getQty(sn),
        cutting_start: li ? addDays(li.loading_date, LOADING_TO_ARRIVAL + FABRIC_INSPECTION + offset) : '',
      };
    }).filter(item => item.cutting_start && item.qty > 0);

    cuttingItems.sort((a, b) => {
      const priDiff = cuttingPriority(b.style_no) - cuttingPriority(a.style_no);
      if (priDiff !== 0) return priDiff;
      const dateDiff = a.cutting_start.localeCompare(b.cutting_start);
      if (dateDiff !== 0) return dateDiff;
      // [2026-06-20 批次2-业务-P0-5] 稳定打破平局
      return styleHash(a.style_no) - styleHash(b.style_no);
    });

    const cuttingStandard = cap.cutting || 60000;
    let currentDay = '';
    let remaining = cuttingStandard;
    const cuttingResults = {};

    for (const item of cuttingItems) {
      if (!currentDay || item.cutting_start > currentDay) {
        currentDay = item.cutting_start;
        remaining = cuttingStandard;
      }
      let styleRemaining = item.qty;
      while (styleRemaining > 0) {
        if (styleRemaining <= remaining) {
          remaining -= styleRemaining;
          styleRemaining = 0;
          cuttingResults[item.style_no] = { cutting_start: item.cutting_start, cutting_end: currentDay };
        } else {
          styleRemaining -= remaining;
          currentDay = addDays(currentDay, 1);
          remaining = cuttingStandard;
          cuttingResults[item.style_no] = { cutting_start: item.cutting_start, cutting_end: currentDay };
        }
      }
    }

    // ========== Step 2: 二次加工（印花/刺绣/模板） ==========
    const secTypes = [
      { key: 'printing', flag: 'printing', dailyField: 'printing_daily_output', standard: cap.printing || 10000, prefix: 'printing' },
      { key: 'embroidery', flag: 'embroidery', dailyField: 'embroidery_daily_output', standard: cap.embroidery || 8000, prefix: 'embroidery' },
      { key: 'template', flag: 'template', dailyField: 'template_daily_output', standard: cap.template || 3000, prefix: 'template' },
    ];
    const secondaryResults = {}; // style_no -> { printing_start, printing_end, embroidery_start, ... }

    for (const sec of secTypes) {
      const items = styleNos
        .filter(sn => {
          const st = styleMap[sn];
          const cr = cuttingResults[sn];
          return cr && st[sec.flag] === '是' && parseInt(st[sec.dailyField]) > 0;
        })
        .map(sn => {
          const st = styleMap[sn];
          return {
            style_no: sn,
            qty: getQty(sn),
            style_max: parseInt(st[sec.dailyField]) || 0,
            start: addDays(cuttingResults[sn].cutting_end, 1),
          };
        });

      items.sort((a, b) => {
      const dateDiff = a.start.localeCompare(b.start);
      if (dateDiff !== 0) return dateDiff;
      // [2026-06-20 批次2-业务-P0-5] 稳定打破平局
      return styleHash(a.style_no) - styleHash(b.style_no);
    });

      let curDay = '';
      let remain = sec.standard;
      // [2026-06-20 fix#业务-P1-4 注释] curDay 在 for (sec) 循环内声明,
      //   三个 secondary 工序(printing/embroidery/template)各自独立 curDay → 已并行
      // 款式级 curDay 推进是模拟"机器共享":多个款式排队等同一台机器(产能 cap.standard)
      // 如果未来需要完全"每款式独立"模式,可加 ?parallelLines=true 参数
      for (const item of items) {
        if (!curDay || item.start > curDay) {
          curDay = item.start;
          remain = sec.standard;
        }
        const styleStart = curDay; // 记录该款式开工日
        let styleRemain = item.qty;
        while (styleRemain > 0) {
          const todayCap = Math.min(item.style_max, remain);
          if (todayCap <= 0) {
            curDay = addDays(curDay, 1);
            remain = sec.standard;
            continue;
          }
          const produce = Math.min(styleRemain, todayCap);
          styleRemain -= produce;
          remain -= produce;
          if (styleRemain === 0) {
            if (!secondaryResults[item.style_no]) secondaryResults[item.style_no] = {};
            secondaryResults[item.style_no][sec.prefix + '_start'] = styleStart;
            secondaryResults[item.style_no][sec.prefix + '_end'] = curDay;
          } else {
            curDay = addDays(curDay, 1);
            remain = sec.standard;
          }
        }
      }
    }

    // ========== Step 3: 缝制 + 烫标（单线倒推） ==========
    const today = fmtLocal(new Date());
    const baseResults = [];
    for (const sn of styleNos) {
      const st = styleMap[sn];
      const li = loadingInfo[sn];
      if (!st || !li) continue;
      const qty = getQty(sn);
      if (qty <= 0) continue;

      const cr = cuttingResults[sn] || {};
      const sr = secondaryResults[sn] || {};

      // 缝制倒推（单线）
      const sewingEnd = addDays(st.due_date, -SEWING_BUFFER);
      let dailyTarget = parseInt(st.target_daily_output) || 0;
      if (dailyTarget <= 0) {
        const pl = db.get("SELECT daily_output FROM production_lines WHERE line_name = ? AND daily_output > 0 LIMIT 1", [st.product_name || '']);
        if (pl) dailyTarget = parseInt(pl.daily_output) || 0;
      }
      if (dailyTarget <= 0) dailyTarget = DEFAULT_DAILY_TARGET;
      const sewingDays = Math.ceil(qty / dailyTarget) + 1;
      const sewingStart = addDays(sewingEnd, -(sewingDays - 1));

      // 烫标倒推（仅 ironing_label = '是'）
      // [2026-06-20 fix#业务-P1-1] 统一 ironing 公式与 recalcMainPlanDates 一致
      // 之前:auto-schedule 用"从 sewingStart 向前推"算出 ironingEnd,导致与 recalc 的
      //   "ironing_start = sewing_end + 1, ironing_end = ironing_start + BUFFER-1" 结果互换
      // 现在:烫标是缝制后工序,ironing_start = sewing_end + 1,ironing_end = sewing_end + IRONING_BUFFER
      let ironingStart = '', ironingEnd = '';
      if (st.ironing_label === '是') {
        ironingStart = addDays(sewingEnd, 1);
        ironingEnd = addDays(sewingEnd, IRONING_BUFFER);
      }

      let arrivalDate = li.loading_date ? addDays(li.loading_date, 21) : '';
      const secEnds = [sr.printing_end, sr.embroidery_end, sr.template_end].filter(Boolean);
      const maxSecEnd = secEnds.length > 0 ? secEnds.reduce((a, b) => a > b ? a : b) : '';

      baseResults.push({
        style_id: st.id, style_no: sn, product_name: st.product_name || '',
        plan_qty: qty, due_date: st.due_date || '', arrival_date: arrivalDate,
        cutting_start: cr.cutting_start || '', cutting_end: cr.cutting_end || '',
        secondary_start: cr.cutting_end ? addDays(cr.cutting_end, 1) : '', secondary_end: maxSecEnd,
        printing_start: sr.printing_start || '', printing_end: sr.printing_end || '',
        embroidery_start: sr.embroidery_start || '', embroidery_end: sr.embroidery_end || '',
        template_start: sr.template_start || '', template_end: sr.template_end || '',
        sewing_remind_date: addDays(sewingStart, -SEWING_REMIND), sewing_start: sewingStart, sewing_end: sewingEnd,
        ironing_start: ironingStart, ironing_end: ironingEnd,
        daily_target: dailyTarget,
      });
    }

    // ========== Step 4: 过期检测 ==========
    for (const r of baseResults) {
      r.expired = (r.due_date && r.due_date < today) ? 1 : 0;
    }

    // ========== Step 5: 多线分流 ==========
    const results = [];
    const categoryUsed = {};
    let totalLinesAssigned = 0;

    baseResults.sort((a, b) => {
      const dateDiff = (a.due_date || '').localeCompare(b.due_date || '');
      if (dateDiff !== 0) return dateDiff;
      // [2026-06-20 批次2-业务-P0-5] 稳定打破平局
      return styleHash(a.style_no) - styleHash(b.style_no);
    });

    for (const r of baseResults) {
      if (r.expired) { r.line_count = 1; r.line_index = 1; r.conflict_flag = 1; results.push(r); continue; }

      // 交期≤15天：不分流，基础排产+报警
      const dueInDays = r.due_date ? Math.ceil((new Date(r.due_date + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000) : 999;
      if (dueInDays <= 15) {
        r.line_count = 1; r.line_index = 1; r.conflict_flag = 1;
        results.push(r); continue;
      }

      // 前道工序最晚下线
      const secEnds = [r.printing_end, r.embroidery_end, r.template_end, r.ironing_end].filter(Boolean);
      const maxPreEnd = secEnds.length > 0 ? secEnds.reduce((a, b) => a > b ? a : b) : (r.cutting_end || '');

      // 分流尝试：逐步增加线数，直到缝制上线 > 前道下线
      let N = 1;
      const sewingEnd = r.sewing_end;
      const dailyTarget = r.daily_target;

      while (N < 49) {
        const sewingDays = Math.ceil(r.plan_qty / (N * dailyTarget)) + 1;
        const sewingStart = addDays(sewingEnd, -(sewingDays - 1));
        if (!maxPreEnd || sewingStart > maxPreEnd) break;
        N++;
      }

      // 班组分配：不能超过分类限制和全厂限制
      const styleCategory = (styleMap[r.style_no] || {}).style_category || '';
      const fullLimit = MAX_SEWING_LINES - totalLinesAssigned;
      let catLimit = fullLimit;
      if (styleCategory) {
        const catRows = db.all("SELECT id FROM line_style_categories WHERE name = ?", [styleCategory]);
        const totalCatSlots = catRows.length; // 直接用班组数，不乘倍率
        const catUsed = categoryUsed[styleCategory] || 0;
        catLimit = Math.min(totalCatSlots - catUsed, fullLimit);
      }
      if (catLimit <= 0) { N = 1; }
      else { N = Math.min(N, catLimit); }

      // 生成多行，每行独立重算 sewing_start 并检测冲突
      const perQty = Math.floor(r.plan_qty / N);
      const remainder = r.plan_qty - perQty * N;
      let hasConflict = false;

      for (let idx = 0; idx < N; idx++) {
        const lineQty = idx === 0 ? perQty + remainder : perQty;
        const perLineDays = Math.ceil(lineQty / dailyTarget) + 1;
        const perLineSewingStart = addDays(sewingEnd, -(perLineDays - 1));
        const perLineIroningEnd = r.ironing_start ? addDays(perLineSewingStart, -IRONING_BUFFER) : '';

        let lineConflict = 0;
        // 1) 缝制上线 <= 前道下线（倒推来不及）
        if (maxPreEnd && perLineSewingStart && perLineSewingStart <= maxPreEnd) lineConflict = 1;
        // 2) 烫标上线早于今天（倒推到过去）
        if (r.ironing_start && r.ironing_start < today) lineConflict = 1;
        if (lineConflict) hasConflict = true;

        results.push({
          ...r,
          plan_qty: lineQty,
          line_index: idx + 1,
          sewing_start: perLineSewingStart,
          sewing_remind_date: addDays(perLineSewingStart, -SEWING_REMIND),
          ironing_end: perLineIroningEnd || r.ironing_end,
          conflict_flag: lineConflict,
        });
      }

      r.line_count = N;
      totalLinesAssigned += N;
      if (styleCategory) categoryUsed[styleCategory] = (categoryUsed[styleCategory] || 0) + N;

      // 回填 line_count 到每行
      for (let i = results.length - N; i < results.length; i++) {
        results[i].line_count = N;
      }
    }

    // ========== Step 6: 写入主计划（事务保护） ==========
    const expiredCount = results.filter(r => r.expired).length;
    const conflictCount = results.filter(r => r.conflict_flag).length;

    const rawDb = db.getDb();
    const writeTxn = rawDb.transaction(() => {
      // [2026-06-20 批次2-业务-P0-1] 级联清理下游"未来计划"表,避免孤儿数据
      // 注意:actual_production(报工历史)和 schedule_plan_overrides(用户手动调整)不删,
      //       这两类是"历史事实",重新排产不应覆盖它们
      rawDb.prepare(`DELETE FROM schedule_daily WHERE master_id IN (SELECT id FROM schedule_master)`).run();
      rawDb.prepare(`DELETE FROM schedule_master`).run();
      rawDb.prepare('DELETE FROM main_plan').run();
      const stmt = rawDb.prepare(`INSERT INTO main_plan
        (style_id,style_no,product_name,plan_qty,due_date,arrival_date,
         cutting_start,cutting_end,secondary_start,secondary_end,
         printing_start,printing_end,embroidery_start,embroidery_end,
         template_start,template_end,
         sewing_remind_date,sewing_start,sewing_end,
         ironing_start,ironing_end,conflict_flag,
         pipeline_count,is_scheduled,workshop,line_team,
         line_count,line_index,expired)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      for (const r of results) {
        stmt.run(r.style_id, r.style_no, r.product_name, r.plan_qty, r.due_date, r.arrival_date,
          r.cutting_start, r.cutting_end, r.secondary_start, r.secondary_end,
          r.printing_start, r.printing_end, r.embroidery_start, r.embroidery_end,
          r.template_start, r.template_end,
          r.sewing_remind_date, r.sewing_start, r.sewing_end,
          r.ironing_start, r.ironing_end, r.conflict_flag,
          1, 0, '', '',
          r.line_count, r.line_index, r.expired);
      }
    });
    writeTxn();

    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    logOp(req, 'main_plan', 'auto_schedule', 0, `生成${results.length}条计划`);
    res.json({ ok: true, count: results.length, conflicts: conflictCount, expired: expiredCount, lines: totalLinesAssigned });
  } catch (e) {
    console.error('POST /api/main-plan/auto-schedule error:', e);
    res.status(500).json({ error: '主计划自动排产失败' });
  }
});

// ---------- 裁剪排程 ----------
// 数据源：fabric_loading_list (款式集合) ∩ style_color_size (颜色/尺码/原单量) + main_plan (裁剪起止时间) + actual_production (实际产量)
// 单次响应返回 rows + daily（按 row_id 索引），避免前端并发 N 个 daily 请求
app.get('/api/schedule/cutting', (req, res) => {
  try {
    // 用原始 better-sqlite3 实例，避开 db.all 包装层的参数 spread 问题（style_no 可能 >100 个）
    const rawDb = db.getDb();

    // 1. 一次性查所有款式 + 关联 main_plan（最新一条）的裁剪字段
    const plans = rawDb.prepare(`
      SELECT fl.style_no,
        (SELECT id FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as main_plan_id,
        (SELECT product_name FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as product_name,
        (SELECT plan_qty FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as plan_qty,
        (SELECT due_date FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as due_date,
        (SELECT cutting_start FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as cutting_start,
        (SELECT cutting_end FROM main_plan WHERE style_no = fl.style_no ORDER BY id DESC LIMIT 1) as cutting_end
      FROM (SELECT DISTINCT style_no FROM fabric_loading_list WHERE style_no IS NOT NULL AND style_no != '') fl
      ORDER BY fl.style_no
    `).all();

    if (plans.length === 0) {
      return res.json({ rows: [], daily: {}, dailyTarget: 30000 });
    }

    const styleNos = plans.map(p => p.style_no);
    const placeholders = styleNos.map(() => '?').join(',');

    // 2. 批量查分色分尺码（一次 SQL，IN 查询）
    const colorSizes = rawDb.prepare(
      `SELECT style_no, color, size_spec, plan_qty FROM style_color_size WHERE style_no IN (${placeholders}) ORDER BY style_no, color, size_spec`
    ).all(...styleNos);

    // 按 style_no 索引
    const csByStyle = {};
    for (const cs of colorSizes) {
      (csByStyle[cs.style_no] = csByStyle[cs.style_no] || []).push(cs);
    }

    // 3. 批量查实际产量（cutting 类型，一次 SQL）
    const actuals = rawDb.prepare(
      `SELECT style_no, IFNULL(color,'') as color, IFNULL(size_spec,'') as size_spec, production_date, SUM(completed_qty) as actual
       FROM actual_production
       WHERE schedule_type = 'cutting' AND style_no IN (${placeholders})
       GROUP BY style_no, color, size_spec, production_date`
    ).all(...styleNos);

    // 按 row_id 索引 daily
    const planByStyle = {};
    for (const p of plans) planByStyle[p.style_no] = p;
    const dailyMap = {};
    for (const a of actuals) {
      const mp = planByStyle[a.style_no];
      const key = `m${mp?.main_plan_id || 0}_${a.color}_${a.size_spec}`;
      (dailyMap[key] = dailyMap[key] || []).push({ date: a.production_date, actual: a.actual });
    }

    // 4. 取裁剪日产量
    const dailyTarget = rawDb.prepare("SELECT daily_capacity FROM capacity_config WHERE process_type = 'cutting'").get()?.daily_capacity || 30000;

    // 5. 装配 rows
    const rows = [];
    for (const p of plans) {
      const csList = csByStyle[p.style_no] || [];
      const base = {
        main_plan_id: p.main_plan_id,
        style_no: p.style_no,
        product_name: p.product_name || '',
        cutting_start: p.cutting_start || '',
        cutting_end: p.cutting_end || '',
        due_date: p.due_date || '',
        daily_target: dailyTarget,
      };
      // [2026-06-20 S-2] 后端算每日计划量,与 sewing-daily-plan 对齐
      const dateData = computeDateData(p.cutting_start, p.cutting_end, p.plan_qty || 0, dailyTarget);
      if (csList.length === 0) {
        rows.push({
          ...base,
          row_id: `m${p.main_plan_id || 0}_`,
          color: '', size_spec: '',
          plan_qty: p.plan_qty || 0,
          dateData,
        });
      } else {
        for (const cs of csList) {
          const csDateData = computeDateData(p.cutting_start, p.cutting_end, cs.plan_qty || 0, dailyTarget);
          rows.push({
            ...base,
            row_id: `m${p.main_plan_id || 0}_${cs.color || ''}_${cs.size_spec || ''}`,
            color: cs.color || '',
            size_spec: cs.size_spec || '',
            plan_qty: cs.plan_qty || 0,
            dateData: csDateData,
          });
        }
      }
    }

    // 排序
    rows.sort((a, b) => {
      const as = a.cutting_start || '9999-99-99';
      const bs = b.cutting_start || '9999-99-99';
      if (as !== bs) return as.localeCompare(bs);
      if (a.style_no !== b.style_no) return (a.style_no || '').localeCompare(b.style_no || '');
      if (a.color !== b.color) return (a.color || '').localeCompare(b.color || '');
      return (a.size_spec || '').localeCompare(b.size_spec || '');
    });

    res.json({ rows, daily: dailyMap, dailyTarget });
  } catch (e) {
    console.error('GET /api/schedule/cutting error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 更新 main_plan 的裁剪起止时间 ----------
app.put('/api/main-plan/:id/cutting', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const { cutting_start, cutting_end } = req.body;
    const id = req.params.id;
    const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '计划不存在' });
    db.run(
      'UPDATE main_plan SET cutting_start = ?, cutting_end = ? WHERE id = ?',
      [cutting_start || '', cutting_end || '', id]
    );
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    logOp(req, 'main_plan', 'update_cutting', id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/main-plan/:id/cutting error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/schedule/cutting/export', async (req, res) => {
  try {
    const plans = db.all("SELECT * FROM main_plan ORDER BY cutting_start, style_no");
    const rows = [];
    let minDate = null, maxDate = null;
    for (const p of plans) {
      if (!p.style_no) continue;
      const colorSizes = db.all(
        "SELECT color, size_spec, plan_qty FROM style_color_size WHERE style_no = ? ORDER BY color, size_spec",
        [p.style_no]
      );
      if (p.cutting_start && (!minDate || p.cutting_start < minDate)) minDate = p.cutting_start;
      if (p.cutting_end && (!maxDate || p.cutting_end > maxDate)) maxDate = p.cutting_end;
      if (colorSizes.length === 0) {
        rows.push({
          style_no: p.style_no, product_name: p.product_name || '',
          color: '', size_spec: '', plan_qty: p.plan_qty || 0,
          cutting_start: p.cutting_start || '', cutting_end: p.cutting_end || '',
          due_date: p.due_date || '',
        });
      } else {
        for (const cs of colorSizes) {
          rows.push({
            style_no: p.style_no, product_name: p.product_name || '',
            color: cs.color || '', size_spec: cs.size_spec || '', plan_qty: cs.plan_qty || 0,
            cutting_start: p.cutting_start || '', cutting_end: p.cutting_end || '',
            due_date: p.due_date || '',
          });
        }
      }
    }
    if (!rows.length) return res.status(404).json({ error: '无数据' });
    if (!minDate) minDate = fmtLocal(new Date());
    if (!maxDate) maxDate = fmtLocal(new Date());
    const sd = new Date(minDate + 'T00:00:00'), ed = new Date(maxDate + 'T00:00:00');
    const days = Math.floor((ed - sd) / 86400000) + 1;
    const dateCols = [];
    for (let i = 0; i < Math.min(days, 60); i++) {
      const dt = new Date(sd); dt.setDate(dt.getDate() + i);
      dateCols.push(fmtLocal(dt));
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('裁剪排程');

    function hdr(v) { return { value: v, font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }, border: { style: 'thin' } }; }
    const headers = ['款式', '品名', '颜色', '规格', '原单量', '裁剪上线', '裁剪下线', '合计'];
    for (const dc of dateCols) headers.push(dc);
    ws.addRow(headers.map(h => hdr(h)));

    for (const r of rows) {
      const row = [r.style_no, r.product_name, r.color, r.size_spec, r.plan_qty, r.cutting_start, r.cutting_end, ''];
      const rowNum = ws.rowCount + 1;
      const startColIdx = 9;
      const endColIdx = startColIdx + dateCols.length - 1;
      row[7] = { formula: `SUM(${String.fromCharCode(64 + startColIdx)}${rowNum}:${String.fromCharCode(64 + endColIdx)}${rowNum})` };
      for (const dc of dateCols) {
        if (r.cutting_start && r.cutting_end && dc >= r.cutting_start && dc <= r.cutting_end) {
          row.push(r.plan_qty);
        } else {
          row.push('');
        }
      }
      const excelRow = ws.addRow(row);
      for (let c = 1; c <= row.length; c++) {
        excelRow.getCell(c).border = { style: 'thin' };
        excelRow.getCell(c).alignment = { horizontal: 'center' };
      }
      for (let di = 0; di < dateCols.length; di++) {
        const dc = dateCols[di];
        if (r.cutting_start && r.cutting_end && dc >= r.cutting_start && dc <= r.cutting_end) {
          excelRow.getCell(9 + di).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD4EDDA' } };
        }
      }
    }

    ws.views = [{ state: 'frozen', xSplit: 7, ySplit: 1 }];
    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 16;
    ws.getColumn(3).width = 14;
    ws.getColumn(4).width = 8;
    ws.getColumn(5).width = 10;
    ws.getColumn(6).width = 12;
    ws.getColumn(7).width = 12;
    ws.getColumn(8).width = 8;
    for (let i = 0; i < dateCols.length; i++) ws.getColumn(9 + i).width = 7;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=${encodeURIComponent('裁剪排程_' + fmtLocal(new Date()) + '.xlsx')}`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/schedule/cutting/export error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 缝制每日计划（数据来源：预排总计划 + 分色分尺码 + 实际产量）----------
app.get('/api/schedule/sewing-daily-plan', (req, res) => {
  try {
    // 获取所有有缝制日期的 main_plan
    const plans = db.all(`
      SELECT id, style_no, product_name, plan_qty, sewing_start, sewing_end
      FROM main_plan
      WHERE sewing_start IS NOT NULL AND sewing_end IS NOT NULL
      ORDER BY sewing_start, style_no
    `);

    if (!plans.length) return res.json({ plans: [], dateRange: [], rows: [] });

    // 计算整体日期范围（限制在今天前后合理范围）
    let minDate = null, maxDate = null;
    for (const p of plans) {
      if (!minDate || p.sewing_start < minDate) minDate = p.sewing_start;
      if (!maxDate || p.sewing_end > maxDate) maxDate = p.sewing_end;
    }
    const _today3 = new Date(); const _ty3 = _today3.getFullYear(); const _tm3 = String(_today3.getMonth()+1).padStart(2,'0'); const _td3 = String(_today3.getDate()).padStart(2,'0');
    const _todayStr3 = `${_ty3}-${_tm3}-${_td3}`;
    const _cs3 = new Date(_todayStr3 + 'T00:00:00'); _cs3.setDate(_cs3.getDate() - 30);
    const _ce3 = new Date(_todayStr3 + 'T00:00:00'); _ce3.setDate(_ce3.getDate() + 60);
    const sd = new Date(minDate + 'T00:00:00') < _cs3 ? _cs3 : new Date(minDate + 'T00:00:00');
    const ed = new Date(maxDate + 'T00:00:00') > _ce3 ? _ce3 : new Date(maxDate + 'T00:00:00');
    const dayCount = Math.floor((ed - sd) / 86400000) + 1;
    const dateRange = [];
    for (let i = 0; i < dayCount; i++) {
      const dt = new Date(sd);
      dt.setDate(dt.getDate() + i);
      dateRange.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
    }

    // 为每个 plan 获取分色分尺码数据
    const rows = [];
    for (const plan of plans) {
      const colorSizes = db.all(
        'SELECT color, size_spec, plan_qty FROM style_color_size WHERE style_no = ? ORDER BY color, size_spec',
        [plan.style_no]
      );

      if (!colorSizes.length) {
        // 没有分色分尺码数据时，用主计划自身
        colorSizes.push({ color: '', size_spec: '', plan_qty: plan.plan_qty });
      }

      const workingDays = Math.floor((new Date(plan.sewing_end + 'T00:00:00') - new Date(plan.sewing_start + 'T00:00:00')) / 86400000) + 1;

      for (const cs of colorSizes) {
        const dailyTarget = workingDays > 0 ? Math.ceil(cs.plan_qty / workingDays) : 0;

        // 获取该颜色尺码的实际产量
        const actuals = db.all(
          `SELECT production_date, SUM(completed_qty) as qty
           FROM actual_production
           WHERE style_no = ? AND color = ? AND size_spec = ?
           AND (schedule_type IS NULL OR schedule_type = '' OR schedule_type = 'secondary')
           GROUP BY production_date`,
          [plan.style_no, cs.color || '', cs.size_spec || '']
        );
        const actualMap = {};
        for (const a of actuals) { actualMap[a.production_date] = a.qty || 0; }

        // 查询计划覆盖
        const planOverrides = db.all(
          "SELECT production_date, completed_qty FROM actual_production WHERE style_no = ? AND color = ? AND size_spec = ? AND schedule_type = 'plan_override'",
          [plan.style_no, cs.color || '', cs.size_spec || '']
        );
        const overrideMap = {};
        for (const po of planOverrides) { overrideMap[po.production_date] = po.completed_qty; }

        // 为每个日期生成计划/实际/差异
        const dateData = [];
        let totalPlan = 0, totalActual = 0;
        for (const date of dateRange) {
          let planQty = 0;
          if (overrideMap[date] != null) {
            // 有手动覆盖，使用覆盖值
            planQty = overrideMap[date];
          } else if (date >= plan.sewing_start && date <= plan.sewing_end && dailyTarget > 0) {
            const sd2 = new Date(plan.sewing_start + 'T00:00:00');
            const cd = new Date(date + 'T00:00:00');
            const dayIdx = Math.floor((cd - sd2) / 86400000);
            const fullDays = Math.floor(cs.plan_qty / dailyTarget);
            const remainder = cs.plan_qty % dailyTarget;
            if (dayIdx < fullDays) planQty = dailyTarget;
            else if (dayIdx === fullDays && remainder > 0) planQty = remainder;
          }
          const actualQty = actualMap[date] || 0;
          totalPlan += planQty;
          totalActual += actualQty;
          dateData.push({ date, plan: planQty, actual: actualQty, diff: actualQty - planQty });
        }

        rows.push({
          style_no: plan.style_no,
          product_name: plan.product_name,
          color: cs.color || '',
          size_spec: cs.size_spec || '',
          order_qty: cs.plan_qty,
          sewing_start: plan.sewing_start,
          sewing_end: plan.sewing_end,
          totalPlan,
          totalActual,
          totalDiff: totalActual - totalPlan,
          dateData,
        });
      }
    }

    res.json({ plans, dateRange, rows });
  } catch (e) {
    console.error('GET /api/schedule/sewing-daily-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 保存某个颜色+尺码某日的实际产量
app.post('/api/schedule/sewing-daily-plan/actual', requireRole('dispatcher', 'supervisor', 'admin'), (req, res) => {
  try {
    const { style_no, color, size_spec, production_date, completed_qty, secondary_type } = req.body;
    if (!style_no || !production_date) {
      return res.status(400).json({ error: '款号和日期不能为空' });
    }

    // [2026-06-20] 跨车间拦截:supervisor / dispatcher 必须匹配 secondary_type 对应的车间
    // secondary_type 形如 'printing' / 'embroidery' / 'template' / 'ironing'
    // [2026-06-20 fix#业务-P1-3] 用 userCanAccessWorkshop 允许 secondary 主任跨 3 工序
    const u = req.user;
    if (u.role !== 'admin') {
      const needWorkshop = secondary_type ? SCHEDULE_TYPE_WORKSHOP[secondary_type] : null;
      if (needWorkshop && !userCanAccessWorkshop(u, needWorkshop)) {
        return res.status(403).json({ error: '无权操作其他车间的数据' });
      }
    }

    // [2026-06-20] schedule_type 派生:secondary_type 决定 schedule_type(secondary)
    // 原代码硬编码 'sewing' 导致 secondary 详情页写入污染 sewing 数据,修复为 secondary
    const scheduleType = secondary_type ? 'secondary' : 'sewing';

    // [2026-06-20 Z-07] 用 UPSERT 替代 SELECT-then-INSERT,杜绝并发竞态
    // 依赖 idx_actual_production_unique UNIQUE 索引
    db.run(
      `INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty)
       VALUES (?, 0, ?, ?, ?, ?, ?)
       ON CONFLICT(style_no, color, size_spec, production_date, schedule_type, secondary_type, is_second_inspection)
       DO UPDATE SET completed_qty = excluded.completed_qty, recorded_at = datetime('now','localtime')`,
      [scheduleType, style_no, color || '', size_spec || '', production_date, completed_qty || 0]
    );
    logOp(req, 'actual_production', 'upsert', null, style_no, `qty=${completed_qty || 0} ${scheduleType}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/schedule/sewing-daily-plan/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [2026-06-20 fix P0-1/P0-2] 裁剪每日计划(与 sewing-daily-plan 对称)
// ScheduleView.vue cutting 模式调 GET/POST 这两个端点
app.get('/api/schedule/cutting-daily-plan', (req, res) => {
  try {
    const plans = db.all(`
      SELECT id, style_no, product_name, plan_qty, cutting_start, cutting_end
      FROM main_plan
      WHERE cutting_start IS NOT NULL AND cutting_end IS NOT NULL
      ORDER BY cutting_start, style_no
    `);

    if (!plans.length) return res.json({ plans: [], dateRange: [], rows: [] });

    // 计算整体日期范围(限制在今天前后合理范围,与 sewing 对齐)
    let minDate = null, maxDate = null;
    for (const p of plans) {
      if (!minDate || p.cutting_start < minDate) minDate = p.cutting_start;
      if (!maxDate || p.cutting_end > maxDate) maxDate = p.cutting_end;
    }
    const _today3 = new Date(); const _ty3 = _today3.getFullYear(); const _tm3 = String(_today3.getMonth()+1).padStart(2,'0'); const _td3 = String(_today3.getDate()).padStart(2,'0');
    const _todayStr3 = `${_ty3}-${_tm3}-${_td3}`;
    const _cs3 = new Date(_todayStr3 + 'T00:00:00'); _cs3.setDate(_cs3.getDate() - 30);
    const _ce3 = new Date(_todayStr3 + 'T00:00:00'); _ce3.setDate(_ce3.getDate() + 60);
    const sd = new Date(minDate + 'T00:00:00') < _cs3 ? _cs3 : new Date(minDate + 'T00:00:00');
    const ed = new Date(maxDate + 'T00:00:00') > _ce3 ? _ce3 : new Date(maxDate + 'T00:00:00');
    const dayCount = Math.floor((ed - sd) / 86400000) + 1;
    const dateRange = [];
    for (let i = 0; i < dayCount; i++) {
      const dt = new Date(sd);
      dt.setDate(dt.getDate() + i);
      dateRange.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`);
    }

    const rows = [];
    for (const plan of plans) {
      const colorSizes = db.all(
        'SELECT color, size_spec, plan_qty FROM style_color_size WHERE style_no = ? ORDER BY color, size_spec',
        [plan.style_no]
      );

      if (!colorSizes.length) {
        colorSizes.push({ color: '', size_spec: '', plan_qty: plan.plan_qty });
      }

      const workingDays = Math.floor((new Date(plan.cutting_end + 'T00:00:00') - new Date(plan.cutting_start + 'T00:00:00')) / 86400000) + 1;

      for (const cs of colorSizes) {
        const dailyTarget = workingDays > 0 ? Math.ceil(cs.plan_qty / workingDays) : 0;

        // 裁剪实际产量: schedule_type='cutting' 且不是二检
        const actuals = db.all(
          `SELECT production_date, SUM(completed_qty) as qty
           FROM actual_production
           WHERE style_no = ? AND color = ? AND size_spec = ?
           AND schedule_type = 'cutting' AND COALESCE(is_second_inspection, 0) = 0
           GROUP BY production_date`,
          [plan.style_no, cs.color || '', cs.size_spec || '']
        );
        const actualMap = {};
        for (const a of actuals) { actualMap[a.production_date] = a.qty || 0; }

        const dateData = [];
        let totalPlan = 0, totalActual = 0;
        for (const date of dateRange) {
          let planQty = 0;
          if (date >= plan.cutting_start && date <= plan.cutting_end && dailyTarget > 0) {
            const sd2 = new Date(plan.cutting_start + 'T00:00:00');
            const cd = new Date(date + 'T00:00:00');
            const dayIdx = Math.floor((cd - sd2) / 86400000);
            const fullDays = Math.floor(cs.plan_qty / dailyTarget);
            const remainder = cs.plan_qty % dailyTarget;
            if (dayIdx < fullDays) planQty = dailyTarget;
            else if (dayIdx === fullDays && remainder > 0) planQty = remainder;
          }
          const actualQty = actualMap[date] || 0;
          totalPlan += planQty;
          totalActual += actualQty;
          dateData.push({ date, plan: planQty, actual: actualQty, diff: actualQty - planQty });
        }

        rows.push({
          style_no: plan.style_no,
          product_name: plan.product_name,
          color: cs.color || '',
          size_spec: cs.size_spec || '',
          order_qty: cs.plan_qty,
          cutting_start: plan.cutting_start,
          cutting_end: plan.cutting_end,
          totalPlan,
          totalActual,
          totalDiff: totalActual - totalPlan,
          dateData,
        });
      }
    }

    res.json({ plans, dateRange, rows });
  } catch (e) {
    console.error('GET /api/schedule/cutting-daily-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/schedule/cutting-daily-plan/actual', requireRole('dispatcher', 'supervisor', 'admin'), (req, res) => {
  try {
    const { style_no, color, size_spec, production_date, completed_qty } = req.body;
    if (!style_no || !production_date) {
      return res.status(400).json({ error: '款号和日期不能为空' });
    }

    // [fix 2026-06-20] 裁剪报工走通用 validateActualPayload (负数/NaN/超 plan_qty*2/未来日期)
    // 注意:validateActualPayload 返回 null 表示通过,否则返回 {status, body}
    const validation = validateActualPayload({ style_no, production_date, completed_qty });
    if (validation) {
      return res.status(validation.status).json(validation.body);
    }

    // [fix 2026-06-20 Z-07] UPSERT,与 sewing 路径对齐
    db.run(
      `INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty, is_second_inspection)
       VALUES ('cutting', 0, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(style_no, color, size_spec, production_date, schedule_type, secondary_type, is_second_inspection)
       DO UPDATE SET completed_qty = excluded.completed_qty, recorded_at = datetime('now','localtime')`,
      [style_no, color || '', size_spec || '', production_date, completed_qty || 0]
    );
    logOp(req, 'actual_production', 'upsert_cutting', null, style_no, `qty=${completed_qty || 0}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/schedule/cutting-daily-plan/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 保存计划编辑（通用）[B-01/B-07 fix] ----------
// 之前用 schedule_type='plan_override_<type>' 写入 actual_production,语义混乱
// 改用专用表 schedule_plan_overrides,并包成事务
function savePlanOverride(typeLabel, req, res) {
  try {
    if (!SECONDARY_TYPES[typeLabel]) {
      return res.status(400).json({ error: `未知二次加工类型: ${typeLabel}` });
    }
    const { style_no, color, size_spec, order_qty, datePlans } = req.body;
    if (!style_no) return res.status(400).json({ error: '缺少款号' });
    if (!datePlans || typeof datePlans !== 'object') {
      return res.status(400).json({ error: '缺少 datePlans' });
    }
    const rawDb = db.getDb();
    const txn = rawDb.transaction(() => {
      // 先清掉这个 (type, style, color, size) 的所有旧覆盖
      rawDb.prepare(`
        DELETE FROM schedule_plan_overrides
        WHERE secondary_type = ? AND style_no = ? AND color = ? AND size_spec = ?
      `).run(typeLabel, style_no, color || '', size_spec || '');
      // 再插新的覆盖
      const ins = rawDb.prepare(`
        INSERT OR REPLACE INTO schedule_plan_overrides
          (secondary_type, style_no, color, size_spec, production_date, qty)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const [date, qty] of Object.entries(datePlans)) {
        const q = Number(qty) || 0;
        if (date && q > 0) {
          ins.run(typeLabel, style_no, color || '', size_spec || '', date, q);
        }
      }
      // 如果前端带 order_qty,同步更新分色分尺码
      if (order_qty != null && color && size_spec) {
        rawDb.prepare(`UPDATE style_color_size SET plan_qty = ? WHERE style_no = ? AND color = ? AND size_spec = ?`)
          .run(Number(order_qty) || 0, style_no, color, size_spec);
      }
    });
    txn();
    res.json({ success: true });
  } catch (e) {
    console.error(`POST save plan (${typeLabel}) error:`, e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

app.post('/api/schedule/printing-daily-plan/plan', (req, res) => savePlanOverride('printing', req, res));
app.post('/api/schedule/embroidery-daily-plan/plan', (req, res) => savePlanOverride('embroidery', req, res));
app.post('/api/schedule/ironing-daily-plan/plan', (req, res) => savePlanOverride('ironing', req, res));
app.post('/api/schedule/template-daily-plan/plan', (req, res) => savePlanOverride('template', req, res));

// ---------- 二次加工每日计划(统一处理)[B-03/B-04/B-05 fix] ----------
// 4 种 secondary 共用同一份逻辑,字段差异通过 SECONDARY_TYPES 配置解决
// 日期窗口统一:today-SEC_DAILY_PLAN_WINDOW.beforeDays ~ today+afterDays
// 计划覆盖从 schedule_plan_overrides 表读(不再查 actual_production)
function getSecondaryDailyPlan(secType, req, res) {
  try {
    const cfg = SECONDARY_TYPES[secType];
    if (!cfg) return res.status(400).json({ error: `未知二次加工类型: ${secType}` });

    // 1. 找到有这个 secondary 标志的款式
    const styles = db.all(
      `SELECT id, style_no, product_name, plan_qty, due_date, ${cfg.sqlField} as flag, ${cfg.dailyField} as daily_output
       FROM styles WHERE ${cfg.sqlField} IS NOT NULL AND ${cfg.sqlField} != ''`
    );
    if (!styles.length) return res.json({ plans: [], dateRange: [], rows: [] });

    // 2. 只保留在装柜清单里的款式
    const styleNos = styles.map(s => s.style_no);
    const loadingQ = inQuery('style_no', styleNos);
    const loadingStyles = db.all(
      `SELECT DISTINCT style_no FROM fabric_loading_list WHERE ${loadingQ.sql}`, loadingQ.params
    );
    const loadingSet = new Set(loadingStyles.map(r => r.style_no));
    const validStyles = styles.filter(s => loadingSet.has(s.style_no));
    if (!validStyles.length) return res.json({ plans: [], dateRange: [], rows: [] });

    // 3. 从 main_plan 取该 secondary 的起止时间
    const validStyleNos = validStyles.map(s => s.style_no);
    const mpQ = inQuery('style_no', validStyleNos);
    const mainPlans = db.all(
      `SELECT style_no, product_name, plan_qty, ${cfg.startField} as sec_start, ${cfg.endField} as sec_end
       FROM main_plan
       WHERE ${cfg.startField} IS NOT NULL AND ${cfg.startField} != ''
         AND ${mpQ.sql}
       ORDER BY ${cfg.startField}, style_no`,
      mpQ.params
    );
    const planMap = {};
    for (const p of mainPlans) {
      if (!planMap[p.style_no]) planMap[p.style_no] = p;
    }
    const activeStyles = validStyles.filter(s => planMap[s.style_no]);
    if (!activeStyles.length) return res.json({ plans: [], dateRange: [], rows: [] });

    // 4. 统一日期窗口
    const today = new Date();
    const sd = new Date(today); sd.setDate(sd.getDate() - SEC_DAILY_PLAN_WINDOW.beforeDays);
    const ed = new Date(today); ed.setDate(ed.getDate() + SEC_DAILY_PLAN_WINDOW.afterDays);
    const dayCount = Math.floor((ed - sd) / 86400000) + 1;
    const dateRange = [];
    for (let i = 0; i < dayCount; i++) {
      const dt = new Date(sd); dt.setDate(dt.getDate() + i);
      dateRange.push(fmtLocal(dt));
    }

    // 5. 生成 plans + rows
    const plans = [];
    const rows = [];
    for (const style of activeStyles) {
      const mp = planMap[style.style_no];
      const colorSizes = db.all(
        'SELECT color, size_spec, plan_qty, cutting_param FROM style_color_size WHERE style_no = ? ORDER BY color, size_spec',
        [style.style_no]
      );
      const totalOrderQty = colorSizes.reduce((s, cs) => s + (cs.plan_qty || 0), 0) || style.plan_qty;

      plans.push({
        style_no: style.style_no,
        product_name: style.product_name,
        order_qty: totalOrderQty,
        [`${secType}_start`]: mp.sec_start,
        [`${secType}_end`]: mp.sec_end,
        [`${secType}_daily_output`]: style.daily_output || 0,
        due_date: style.due_date || '',
      });

      const csList = colorSizes.length ? colorSizes : [{ color: '', size_spec: '', plan_qty: style.plan_qty, cutting_param: style.plan_qty }];
      const workingDays = Math.floor((new Date(mp.sec_end + 'T00:00:00') - new Date(mp.sec_start + 'T00:00:00')) / 86400000) + 1;

      for (const cs of csList) {
        if (cs.plan_qty <= 0) continue;
        // [2026-06-19] 排程计算用裁剪参数(原单数仍显示,cutting_param 默认 = order_qty)
        const cutParam = parseInt(cs.cutting_param) > 0 ? parseInt(cs.cutting_param) : cs.plan_qty;
        const dailyTarget = workingDays > 0 ? Math.ceil(cutParam / workingDays) : 0;

        // 实际产量(从 actual_production 读,过滤 schedule_type=secondary 且匹配 secondary_type)
        const actuals = db.all(
          `SELECT production_date, SUM(completed_qty) as qty
           FROM actual_production
           WHERE style_no = ? AND color = ? AND size_spec = ?
             AND schedule_type = 'secondary' AND secondary_type = ?
           GROUP BY production_date`,
          [style.style_no, cs.color || '', cs.size_spec || '', cfg.label]
        );
        const actualMap = {};
        for (const a of actuals) actualMap[a.production_date] = a.qty || 0;

        // [2026-06-19] 裁剪二检 A品数(从 actual_production 读 is_second_inspection=1 + source_type=此类型)
        const siActuals = db.all(
          `SELECT production_date, SUM(completed_qty) as qty
           FROM actual_production
           WHERE style_no = ? AND color = ? AND size_spec = ?
             AND schedule_type = 'cutting' AND is_second_inspection = 1 AND source_type = ?
           GROUP BY production_date`,
          [style.style_no, cs.color || '', cs.size_spec || '', secType]
        );
        const siMap = {};
        for (const a of siActuals) siMap[a.production_date] = a.qty || 0;

        // 计划覆盖(从专用表 schedule_plan_overrides 读[B-01 fix])
        const overrides = db.all(
          `SELECT production_date, qty
           FROM schedule_plan_overrides
           WHERE secondary_type = ? AND style_no = ? AND color = ? AND size_spec = ?`,
          [secType, style.style_no, cs.color || '', cs.size_spec || '']
        );
        const overrideMap = {};
        for (const o of overrides) overrideMap[o.production_date] = o.qty;

        const dateData = [];
        let totalPlan = 0, totalActual = 0, totalSecondInspection = 0;
        for (const date of dateRange) {
          let planQty = 0;
          if (overrideMap[date] != null) {
            planQty = overrideMap[date];
          } else if (date >= mp.sec_start && date <= mp.sec_end && dailyTarget > 0) {
            const sd2 = new Date(mp.sec_start + 'T00:00:00');
            const cd = new Date(date + 'T00:00:00');
            const dayIdx = Math.floor((cd - sd2) / 86400000);
            const fullDays = Math.floor(cutParam / dailyTarget);
            const remainder = cutParam % dailyTarget;
            if (dayIdx < fullDays) planQty = dailyTarget;
            else if (dayIdx === fullDays && remainder > 0) planQty = remainder;
          }
          const actualQty = actualMap[date] || 0;
          const siQty = siMap[date] || 0;
          totalPlan += planQty;
          totalActual += actualQty;
          totalSecondInspection += siQty;
          dateData.push({ date, plan: planQty, actual: actualQty, secondInspection: siQty, diff: actualQty - planQty });
        }

        rows.push({
          style_no: style.style_no,
          product_name: style.product_name,
          color: cs.color || '',
          size_spec: cs.size_spec || '',
          order_qty: cs.plan_qty,
          cutting_param: cutParam,
          [`${secType}_start`]: mp.sec_start,
          [`${secType}_end`]: mp.sec_end,
          totalPlan, totalActual, totalDiff: totalActual - totalPlan,
          totalSecondInspection,
          dateData,
        });
      }
    }

    res.json({ plans, dateRange, rows });
  } catch (e) {
    console.error(`GET /api/schedule/${secType}-daily-plan error:`, e);
    res.status(500).json({ error: 'Internal server error' });
  }
}

app.get('/api/schedule/printing-daily-plan',   (req, res) => getSecondaryDailyPlan('printing',   req, res));
app.get('/api/schedule/embroidery-daily-plan', (req, res) => getSecondaryDailyPlan('embroidery', req, res));
app.get('/api/schedule/ironing-daily-plan',    (req, res) => getSecondaryDailyPlan('ironing',    req, res));
app.get('/api/schedule/template-daily-plan',   (req, res) => getSecondaryDailyPlan('template',   req, res));


// ---------- \u5370\u82b1\u6bcf\u65e5\u8ba1\u5212\uff08\u6570\u636e\u6765\u6e90\uff1astyles + fabric_loading_list + style_color_size + main_plan\uff09----------
app.get('/api/schedule/:scheduleType', (req, res) => {
  try {
    const { secondary_type } = req.query;
    let sql = 'SELECT * FROM schedule_master WHERE schedule_type = ?';
    const params = [req.params.scheduleType];
    if (secondary_type) {
      sql += ' AND secondary_type = ?';
      params.push(secondary_type);
    }
    const rows = db.all(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/schedule error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 二次加工汇总（按类型统计）
app.get('/api/schedule/secondary/summary', (req, res) => {
  try {
    const rows = db.all(`
      SELECT secondary_type, COUNT(*) as count, SUM(plan_qty) as total_qty
      FROM schedule_master
      WHERE schedule_type = 'secondary'
      GROUP BY secondary_type
    `);
    const summary = {};
    for (const r of rows) {
      summary[r.secondary_type] = { count: r.count, totalQty: r.total_qty };
    }
    res.json(summary);
  } catch (e) {
    console.error('GET /api/schedule/secondary/summary error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 印花计划数据
app.get('/api/printing-plan-data', (req, res) => {
  try {
    const rows = db.all(`
      SELECT sm.*, s.fabric_code, s.embroidery, s.printing, s.ironing_label, s.template
      FROM schedule_master sm
      LEFT JOIN styles s ON sm.style_id = s.id
      WHERE sm.schedule_type = 'secondary' AND sm.secondary_type = 'printing'
      ORDER BY sm.plan_start
    `);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/printing-plan-data error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/schedule/:scheduleType/:masterId/daily', (req, res) => {
  try {
    const daily = db.all('SELECT * FROM schedule_daily WHERE master_id = ? ORDER BY schedule_date, row_type', [req.params.masterId]);
    const grouped = {};
    for (const d of daily) {
      if (!grouped[d.schedule_date]) grouped[d.schedule_date] = { date: d.schedule_date, plan: 0, actual: 0 };
      if (d.row_type === 'PLAN') grouped[d.schedule_date].plan = d.qty;
      if (d.row_type === 'ACTUAL') grouped[d.schedule_date].actual = d.qty;
    }
    const result = Object.values(grouped).map(r => ({ ...r, diff: r.actual - r.plan }));
    res.json(result);
  } catch (e) {
    console.error('GET /api/schedule/daily error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/schedule/:scheduleType', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const validTypes = ['cutting', 'secondary', 'sewing'];
    if (!validTypes.includes(req.params.scheduleType)) {
      return res.status(400).json({ error: '无效的排程类型' });
    }
    const m = req.body;
    if (!m.style_no) return res.status(400).json({ error: '款号不能为空' });
    const result = db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, color, size_spec, plan_qty, plan_start, plan_end, workshop, line_team, secondary_type, cutting_plan_qty, daily_target, due_date)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.scheduleType, m.style_id, m.style_no, m.product_name, m.color, m.size_spec, m.plan_qty || 0, m.plan_start, m.plan_end, m.workshop || '', m.line_team || '', m.secondary_type || '', m.cutting_plan_qty || 0, m.daily_target || 0, m.due_date || '']);
    const masterId = result.lastInsertRowid;

    if (m.plan_start && m.plan_end && m.plan_qty > 0) {
      generatePlanRows(masterId, m.plan_start, m.plan_end, m.plan_qty);
    }

    broadcastSection(`schedule_${req.params.scheduleType}`, db.all('SELECT * FROM schedule_master WHERE schedule_type = ?', [req.params.scheduleType]));
    logOp(req, `schedule_${req.params.scheduleType}`, 'create', masterId, m.style_no);
    res.json({ ok: true, id: masterId });
  } catch (e) {
    console.error('POST /api/schedule error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/schedule/:scheduleType/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const m = req.body;
    console.log('PUT /api/schedule', req.params.scheduleType, req.params.id, JSON.stringify(m).slice(0, 200));
    const existing = db.get('SELECT * FROM schedule_master WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    console.log('existing record:', JSON.stringify(existing).slice(0, 200));
    const info = db.run(`UPDATE schedule_master SET plan_start=?, plan_end=?, workshop=?, line_team=?, secondary_type=?, cutting_plan_qty=?, daily_target=?, due_date=? WHERE id=?`,
      [m.plan_start || '', m.plan_end || '', m.workshop || '', m.line_team || '', m.secondary_type || '', m.cutting_plan_qty || 0, m.daily_target || 0, m.due_date || '', req.params.id]);
    console.log('UPDATE result:', info);
    broadcastSection(`schedule_${req.params.scheduleType}`, db.all('SELECT * FROM schedule_master WHERE schedule_type = ?', [req.params.scheduleType]));
    logOp(req, `schedule_${req.params.scheduleType}`, 'update', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/schedule error:', e);
    sendError(res, 'PUT /api/schedule', e);
  }
});

app.delete('/api/schedule/:scheduleType/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const existing = db.get('SELECT id FROM schedule_master WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM schedule_daily WHERE master_id = ?', [req.params.id]);
    db.run('DELETE FROM schedule_master WHERE id = ?', [req.params.id]);
    broadcastSection(`schedule_${req.params.scheduleType}`, db.all('SELECT * FROM schedule_master WHERE schedule_type = ?', [req.params.scheduleType]));
    logOp(req, `schedule_${req.params.scheduleType}`, 'delete', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/schedule error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// ---------- 缝制模块汇总 ----------
app.get('/api/schedule/sewing/summary', (req, res) => {
  try {
    const today = fmtLocal(new Date());
    const d = new Date();
    const dow = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const mondayStr = fmtLocal(monday);

    const planMasters = db.all("SELECT * FROM schedule_master WHERE schedule_type='sewing'");
    const visualMasters = db.all("SELECT * FROM schedule_master WHERE schedule_type='sewing' AND workshop != '' AND line_team !=''");

    const makeStats = (list) => ({
      totalCount: list.length,
      weekPending: list.filter(m => m.plan_start && m.plan_start >= mondayStr && m.plan_start <= today).length,
      overdue: list.filter(m => m.plan_end && m.plan_end < today).length,
      lastUpdate: list.reduce((latest, m) => {
        const ts = m.updated_at || m.created_at;
        return !latest || (ts && ts > latest) ? ts : latest;
      }, null),
    });

    res.json({ plan: makeStats(planMasters), visual: makeStats(visualMasters) });
  } catch (e) {
    console.error('Sewing summary error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 产线状态详情（数据看板用）----------
app.get('/api/dashboard/line-status', (req, res) => {
  try {
    const today = fmtLocal(new Date());
    // [2026-06-20 fix#业务-P1-9] 非 admin 按 workshop 过滤
    const userWs = dashboardWorkshopScope(req);
    // 所有车间
    const workshops = userWs
      ? db.all('SELECT * FROM workshops WHERE name = ? ORDER BY sort_order', [userWs])
      : db.all('SELECT * FROM workshops ORDER BY sort_order');
    // 所有产线
    const lines = userWs
      ? db.all('SELECT pl.*, ws.name as workshop_name FROM production_lines pl JOIN workshops ws ON pl.workshop_id = ws.id WHERE ws.name = ? ORDER BY ws.sort_order, pl.sort_order', [userWs])
      : db.all('SELECT pl.*, ws.name as workshop_name FROM production_lines pl JOIN workshops ws ON pl.workshop_id = ws.id ORDER BY ws.sort_order, pl.sort_order');
    // 当前在产的缝制排程（今天在 plan_start ~ plan_end 之间）
    let activeSchedules;
    if (userWs) {
      activeSchedules = db.all(`
        SELECT sm.id, sm.style_no, sm.product_name, sm.plan_qty, sm.plan_start, sm.plan_end, sm.workshop, sm.line_team
        FROM schedule_master sm
        WHERE sm.schedule_type = 'sewing' AND sm.workshop = ? AND sm.plan_start <= ? AND sm.plan_end >= ?
      `, [userWs, today, today]);
    } else {
      activeSchedules = db.all(`
        SELECT sm.id, sm.style_no, sm.product_name, sm.plan_qty, sm.plan_start, sm.plan_end, sm.workshop, sm.line_team
        FROM schedule_master sm
        WHERE sm.schedule_type = 'sewing' AND sm.plan_start <= ? AND sm.plan_end >= ?
      `, [today, today]);
    }
    // 车间名归一化
    const wsNorm = { '一车间': '1', '二车间': '2', '三车间': '3', '四车间': '4', '五车间': '5' };
    const stripSuffix = (name) => String(name || '').replace(/班$/, '');
    // 按 workshop+line_team 索引排程
    const schedMap = {};
    for (const s of activeSchedules) {
      const wNorm = wsNorm[s.workshop] || s.workshop || '';
      const key = wNorm + '|' + (s.line_team || '');
      if (!schedMap[key]) schedMap[key] = [];
      schedMap[key].push(s);
    }
    // 实际产量按 style_no+line_team 聚合
    const styleNos = [...new Set(activeSchedules.map(s => s.style_no))];
    let actualMap = {};
    if (styleNos.length > 0) {
      const placeholders = styleNos.map(() => '?').join(',');
      const actuals = db.all(`
        SELECT style_no, line_team, SUM(completed_qty) as total
        FROM actual_production
        WHERE schedule_type = 'sewing' AND style_no IN (${placeholders})
        GROUP BY style_no, line_team
      `, styleNos);
      for (const a of actuals) {
        const key = (a.style_no || '') + '|' + (a.line_team || '');
        actualMap[key] = a.total || 0;
      }
    }
    // 组装结果
    const result = workshops.map(ws => ({
      workshop: ws.name,
      lines: lines.filter(l => l.workshop_id === ws.id).map(line => {
        const lNum = stripSuffix(line.line_name);
        const key = wsNorm[ws.name] + '|' + lNum;
        const tasks = schedMap[key] || [];
        const current = tasks[0] || null;
        let completed = 0;
        if (current) {
          completed = actualMap[current.style_no + '|' + current.line_team] || 0;
        }
        return {
          line_name: line.line_name,
          status: line.status,
          daily_output: line.daily_output || 0,
          style_no: current?.style_no || '',
          product_name: current?.product_name || '',
          plan_qty: current?.plan_qty || 0,
          completed,
          progress: current?.plan_qty ? Math.round(completed / current.plan_qty * 100) : 0,
        };
      })
    }));
    res.json(result);
  } catch (e) {
    console.error('GET /api/dashboard/line-status error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 前置车间生产状态（数据看板用）----------
app.get('/api/dashboard/secondary-status', (req, res) => {
  try {
    const today = fmtLocal(new Date());
    // [2026-06-20 fix#业务-P1-9] 非 admin 按 workshop 过滤
    const userWs = dashboardWorkshopScope(req);
    const processTypes = ['cutting', 'printing', 'embroidery', 'template', 'ironing'];
    const result = {};

    for (const type of processTypes) {
      let items = [];

      if (type === 'cutting') {
        // 裁剪:从 main_plan 取今天在裁剪时间段内的
        // [fix#业务-P1-9] main_plan 没有 workshop 字段,裁剪是前置工序对所有用户都可见
        const plans = db.all(`
          SELECT mp.id, mp.style_no, mp.product_name, mp.plan_qty,
                 mp.cutting_start as plan_start, mp.cutting_end as plan_end
          FROM main_plan mp
          WHERE mp.cutting_start IS NOT NULL AND mp.cutting_end IS NOT NULL
            AND mp.cutting_start <= ? AND mp.cutting_end >= ?
          ORDER BY mp.cutting_start
        `, [today, today]);

        const styleNos = plans.map(p => p.style_no).filter(Boolean);
        const actualMap = {};
        if (styleNos.length > 0) {
          const ph = styleNos.map(() => '?').join(',');
          const actuals = db.all(`
            SELECT style_no, SUM(completed_qty) as total
            FROM actual_production
            WHERE schedule_type = 'cutting' AND style_no IN (${ph})
            GROUP BY style_no
          `, styleNos);
          for (const a of actuals) actualMap[a.style_no] = a.total || 0;
        }

        items = plans.map(p => ({
          style_no: p.style_no,
          product_name: p.product_name || '',
          plan_qty: p.plan_qty || 0,
          completed: actualMap[p.style_no] || 0,
          plan_start: p.plan_start,
          plan_end: p.plan_end,
        }));
      } else {
        // 二次加工：从 schedule_master 取
        // [fix#业务-P1-9] 非 admin 加 workshop 过滤
        const masters = userWs
          ? db.all(`
            SELECT sm.id, sm.style_no, sm.product_name, sm.plan_qty,
                   sm.plan_start, sm.plan_end, sm.color, sm.size_spec
            FROM schedule_master sm
            WHERE sm.schedule_type = ? AND sm.workshop = ?
              AND sm.plan_start IS NOT NULL AND sm.plan_end IS NOT NULL
              AND sm.plan_start <= ? AND sm.plan_end >= ?
            ORDER BY sm.plan_start
          `, [type, userWs, today, today])
          : db.all(`
            SELECT sm.id, sm.style_no, sm.product_name, sm.plan_qty,
                   sm.plan_start, sm.plan_end, sm.color, sm.size_spec
            FROM schedule_master sm
            WHERE sm.schedule_type = ?
              AND sm.plan_start IS NOT NULL AND sm.plan_end IS NOT NULL
              AND sm.plan_start <= ? AND sm.plan_end >= ?
            ORDER BY sm.plan_start
          `, [type, today, today]);

        const masterIds = masters.map(m => m.id);
        const actualMap = {};
        if (masterIds.length > 0) {
          const ph = masterIds.map(() => '?').join(',');
          const actuals = db.all(`
            SELECT master_id, SUM(qty) as total
            FROM schedule_daily
            WHERE master_id IN (${ph}) AND row_type = 'ACTUAL'
            GROUP BY master_id
          `, ...masterIds);
          for (const a of actuals) actualMap[a.master_id] = a.total || 0;
        }

        items = masters.map(m => ({
          style_no: m.style_no,
          product_name: m.product_name || '',
          color: m.color || '',
          size_spec: m.size_spec || '',
          plan_qty: m.plan_qty || 0,
          completed: actualMap[m.id] || 0,
          plan_start: m.plan_start,
          plan_end: m.plan_end,
        }));
      }

      // 计算状态
      for (const item of items) {
        const pct = item.plan_qty > 0 ? item.completed / item.plan_qty : 0;
        if (pct >= 1) item.status = '已完成';
        else if (pct > 0) item.status = '进行中';
        else item.status = '待生产';
        item.progress = Math.round(pct * 100);
      }

      result[type] = items;
    }

    res.json(result);
  } catch (e) {
    console.error('GET /api/dashboard/secondary-status error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 订单接收/完成统计（数据看板用）----------
app.get('/api/dashboard/order-stats', (req, res) => {
  try {
    const { mode = 'week' } = req.query; // 'week' or 'month'
    // [2026-06-20 fix#业务-P1-9] 非 admin 按 workshop 过滤
    const userWs = dashboardWorkshopScope(req);
    const now = new Date();
    const periods = [];

    if (mode === 'week') {
      // 最近 12 周
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now);
        start.setDate(start.getDate() - start.getDay() + 1 - i * 7); // 周一
        const end = new Date(start);
        end.setDate(end.getDate() + 6); // 周日
        periods.push({
          label: `${start.getMonth() + 1}/${start.getDate()}`,
          start: fmtLocal(start),
          end: fmtLocal(end),
        });
      }
    } else {
      // 最近 6 个月
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const start = fmtLocal(d);
        const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const end = fmtLocal(lastDay);
        periods.push({
          label: `${d.getMonth() + 1}月`,
          start,
          end,
        });
      }
    }

    const received = [];
    const completed = [];

    for (const p of periods) {
      // 接收订单：面料装柜清单中该时间段内的去重款数
      const recv = db.get(`
        SELECT COUNT(DISTINCT style_no) as cnt
        FROM fabric_loading_list
        WHERE style_no IS NOT NULL AND style_no != ''
          AND (loading_date BETWEEN ? AND ? OR (loading_date IS NULL AND created_at BETWEEN ? AND ? || ' 23:59:59'))
      `, [p.start, p.end, p.start, p.end]);
      received.push(recv?.cnt || 0);

      // 完成订单：缝制排程中该时间段内 plan_end 且实际完成量 >= 计划量的款数
      // [fix#业务-P1-9] 非 admin 加 workshop 过滤
      const comp = userWs
        ? db.get(`
          SELECT COUNT(DISTINCT sm.style_no) as cnt
          FROM schedule_master sm
          WHERE sm.schedule_type = 'sewing' AND sm.workshop = ?
            AND sm.plan_end BETWEEN ? AND ?
            AND sm.plan_qty > 0
            AND (
              SELECT IFNULL(SUM(ap.completed_qty), 0)
              FROM actual_production ap
              WHERE ap.style_no = sm.style_no AND ap.schedule_type = 'sewing'
            ) >= sm.plan_qty
        `, [userWs, p.start, p.end])
        : db.get(`
          SELECT COUNT(DISTINCT sm.style_no) as cnt
          FROM schedule_master sm
          WHERE sm.schedule_type = 'sewing'
            AND sm.plan_end BETWEEN ? AND ?
            AND sm.plan_qty > 0
            AND (
              SELECT IFNULL(SUM(ap.completed_qty), 0)
              FROM actual_production ap
              WHERE ap.style_no = sm.style_no AND ap.schedule_type = 'sewing'
            ) >= sm.plan_qty
        `, [p.start, p.end]);
      completed.push(comp?.cnt || 0);
    }

    res.json({
      labels: periods.map(p => p.label),
      received,
      completed,
    });
  } catch (e) {
    console.error('GET /api/dashboard/order-stats error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 排产计划达成率 API ----------
app.get('/api/dashboard/achievement-rate', (req, res) => {
  try {
    // [2026-06-20 fix#业务-P1-9] 非 admin 按 workshop 隔离缓存
    const userWs = dashboardWorkshopScope(req);
    // [fix H-04] 60 秒内存缓存 + 单 SQL 聚合,避免 6 工序×30 天×N master 的 N+1
    const cacheKey = `achievement-rate:v1:${userWs || 'all'}`;
    const cached = achievementCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 60000) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached.data);
    }

    const today = fmtLocal(new Date());
    const dates = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(fmtLocal(d));
    }
    const minDate = dates[0];

    const processTypes = [
      { key: 'cutting', label: '裁剪', type: 'cutting' },
      { key: 'printing', label: '印花', type: 'secondary', subType: 'printing' },
      { key: 'embroidery', label: '刺绣', type: 'secondary', subType: 'embroidery' },
      { key: 'template', label: '模板', type: 'secondary', subType: 'template' },
      { key: 'ironing', label: '烫标', type: 'secondary', subType: 'ironing' },
      { key: 'sewing', label: '缝制', type: 'sewing' },
    ];

    // 一次拉全 schedule_master,前端按 type/secondary_type 过滤
    // [fix#业务-P1-9] 非 admin 加 workshop 过滤
    const allMasters = userWs
      ? db.all("SELECT id, schedule_type, secondary_type, workshop, plan_qty, plan_start, plan_end FROM schedule_master WHERE workshop = ? AND plan_start IS NOT NULL AND plan_end IS NOT NULL", [userWs])
      : db.all("SELECT id, schedule_type, secondary_type, workshop, plan_qty, plan_start, plan_end FROM schedule_master WHERE plan_start IS NOT NULL AND plan_end IS NOT NULL");
    // 一次聚合全 ACTUAL
    const allDaily = db.all("SELECT master_id, schedule_date, SUM(qty) as total FROM schedule_daily WHERE row_type='ACTUAL' AND schedule_date >= ? GROUP BY master_id, schedule_date", [minDate]);

    // 用 Map 索引,master_id → daily[]
    const dailyByMaster = new Map();
    for (const d of allDaily) {
      if (!dailyByMaster.has(d.master_id)) dailyByMaster.set(d.master_id, []);
      dailyByMaster.get(d.master_id).push(d);
    }
    // master_id → 该 master 的累计实际按日期升序前缀和
    const cumActualByMaster = new Map();
    for (const [mid, arr] of dailyByMaster) {
      arr.sort((a, b) => a.schedule_date < b.schedule_date ? -1 : 1);
      let sum = 0;
      const prefixByDate = new Map();
      for (const d of arr) {
        sum += d.total || 0;
        prefixByDate.set(d.schedule_date, sum);
      }
      cumActualByMaster.set(mid, prefixByDate);
    }

    function computeRates(masters) {
      const rates = dates.map(date => {
        let totalPlan = 0, totalActual = 0;
        for (const m of masters) {
          const planQty = m.plan_qty || 0;
          if (!planQty || !m.plan_start || !m.plan_end) continue;
          if (date >= m.plan_end) {
            totalPlan += planQty;
          } else if (date >= m.plan_start) {
            const totalDays = Math.max(1, Math.ceil((new Date(m.plan_end + 'T00:00:00') - new Date(m.plan_start + 'T00:00:00')) / 86400000) + 1);
            const elapsed = Math.ceil((new Date(date + 'T00:00:00') - new Date(m.plan_start + 'T00:00:00')) / 86400000) + 1;
            totalPlan += Math.round(planQty * Math.min(elapsed, totalDays) / totalDays);
          }
          const cum = cumActualByMaster.get(m.id);
          if (cum) {
            for (const [d, sum] of cum) {
              if (d <= date) totalActual += sum;
              else break;
            }
          }
        }
        return totalPlan > 0 ? Math.round(totalActual * 100 / totalPlan) : 0;
      });
      return rates;
    }

    const result = {};
    for (const pt of processTypes) {
      const masters = pt.type === 'secondary'
        ? allMasters.filter(m => m.schedule_type === 'secondary' && m.secondary_type === pt.subType)
        : allMasters.filter(m => m.schedule_type === pt.type);
      result[pt.key] = computeRates(masters);
    }

    const sewingByWorkshop = {};
    // [fix#业务-P1-9] 非 admin 只展示本车间 sewing 达成率
    const workshops = userWs
      ? db.all("SELECT * FROM workshops WHERE name = ? ORDER BY sort_order", [userWs])
      : db.all("SELECT * FROM workshops ORDER BY sort_order");
    for (const w of workshops) {
      const masters = allMasters.filter(m => m.schedule_type === 'sewing' && m.workshop === w.name);
      sewingByWorkshop[w.name] = computeRates(masters);
    }

    const data = { dates, processRates: result, sewingByWorkshop };
    achievementCache.set(cacheKey, { ts: Date.now(), data });
    res.setHeader('X-Cache', 'MISS');
    res.json(data);
  } catch (e) {
    console.error('GET /api/dashboard/achievement-rate error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [2026-06-20 M-4] 首页一次性统计接口
// 替代 EntryHome.vue 8 个并行请求
app.get('/api/dashboard/stats', (req, res) => {
  try {
    const today = fmtLocal(new Date());
    const stylesCount = db.get('SELECT COUNT(*) as c FROM styles').c;
    const planCount = db.get('SELECT COUNT(*) as c FROM main_plan').c;
    const workshopsCount = db.get('SELECT COUNT(*) as c FROM workshops').c;
    const linesCount = db.get('SELECT COUNT(*) as c FROM production_lines').c;
    const busyLinesCount = db.get("SELECT COUNT(*) as c FROM production_lines WHERE status = '生产中'").c;
    const cutPiecesInventory = db.get("SELECT COALESCE(SUM(current_qty), 0) as t FROM warehouse_inventory WHERE warehouse_type = 'cutting_piece'").t;
    const todayInbound = db.get(
      "SELECT COALESCE(SUM(qty), 0) as t FROM warehouse_inbound WHERE warehouse_type = 'cutting_piece' AND inbound_date = ?",
      [today]
    ).t;
    const todayOutbound = db.get(
      "SELECT COALESCE(SUM(qty), 0) as t FROM warehouse_outbound WHERE warehouse_type = 'cutting_piece' AND outbound_date = ?",
      [today]
    ).t;
    res.json({
      styles_count: stylesCount,
      main_plan_count: planCount,
      workshops_count: workshopsCount,
      lines_count: linesCount,
      busy_lines_count: busyLinesCount,
      cut_pieces_inventory: cutPiecesInventory,
      cut_pieces_today_inbound: todayInbound,
      cut_pieces_today_outbound: todayOutbound,
    });
  } catch (e) {
    console.error('GET /api/dashboard/stats error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 缝制导出（匹配缝制计划.xlsx）----------
app.get('/api/schedule/sewing/export', async (req, res) => {
  try {
    let masters;
    if (req.query.ids) {
      const ids = req.query.ids.split(',').map(Number).filter(Boolean);
      if (!ids.length) return res.status(400).json({ error: '无有效ID' });
      masters = db.all(`SELECT * FROM schedule_master WHERE schedule_type='sewing' AND id IN (${ids.map(() => '?').join(',')}) ORDER BY workshop, line_team, style_no`, ids);
    } else {
      masters = db.all("SELECT * FROM schedule_master WHERE schedule_type='sewing' ORDER BY workshop, line_team, style_no");
    }
    if (!masters.length) return res.status(404).json({ error: '无数据' });

    let minDate = null, maxDate = null;
    const masterDailies = [];
    for (const m of masters) {
      if (m.plan_start && (!minDate || m.plan_start < minDate)) minDate = m.plan_start;
      if (m.plan_end && (!maxDate || m.plan_end > maxDate)) maxDate = m.plan_end;
      const dailies = db.all('SELECT * FROM schedule_daily WHERE master_id=? ORDER BY schedule_date, row_type', [m.id]);
      const dailyMap = {};
      for (const d of dailies) {
        if (!dailyMap[d.schedule_date]) dailyMap[d.schedule_date] = {};
        dailyMap[d.schedule_date][d.row_type] = d.qty;
      }
      masterDailies.push({ master: m, dailyMap });
    }
    if (!minDate) minDate = fmtLocal(new Date());
    if (!maxDate) maxDate = fmtLocal(new Date());
    const sd = new Date(minDate + 'T00:00:00'), ed = new Date(maxDate + 'T00:00:00');
    const days = Math.floor((ed - sd) / 86400000) + 1;
    const dateCols = [];
    for (let i = 0; i < Math.min(days, 60); i++) {
      const dt = new Date(sd); dt.setDate(dt.getDate() + i);
      dateCols.push(fmtLocal(dt));
    }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('排程甘特图');

    function hdr(v) { return { value: v, font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }, border: { style: 'thin' } }; }
    // Excel列映射严格按照用户提供的《缝制排程模板.xlsx》调整
    const headers = ['车间', '班组', '款号', '品名', '裁床计划数量', '交期', '目标日产量', '缝制开始日期', '缝制结束日期', '合计', ''];
    for (const dc of dateCols) headers.push(dc);
    const hdrRow = ws.addRow(headers.map(h => hdr(h)));

    const typeLabels = ['计划', '实际QC1', '差异'];
    const rowTypes = ['PLAN', 'ACTUAL', 'DIFF'];

    for (const { master, dailyMap } of masterDailies) {
      const baseRow = ws.rowCount + 1;
      for (let ri = 0; ri < 3; ri++) {
        const r = ws.addRow([]);
        const rn = r.number;
        if (ri === 0) {
          r.getCell(1).value = master.workshop || '';
          r.getCell(2).value = master.line_team || '';
          r.getCell(3).value = master.style_no || '';
          r.getCell(4).value = master.product_name || '';
          r.getCell(5).value = master.cutting_plan_qty || master.plan_qty || 0;
          r.getCell(6).value = master.due_date || '';
          r.getCell(7).value = master.daily_target || 0;
          r.getCell(8).value = master.plan_start || '';
          r.getCell(9).value = master.plan_end || '';
        }
        r.getCell(11).value = typeLabels[ri];
        r.getCell(12).value = '合计';

        for (let di = 0; di < dateCols.length; di++) {
          const dc = dateCols[di];
          if (ri === 2) {
            r.getCell(13 + di).value = { formula: `${colIdxToLetter(13 + di)}${baseRow + 1}-${colIdxToLetter(13 + di)}${baseRow}` };
          } else {
            r.getCell(13 + di).value = (dailyMap[dc] && dailyMap[dc][rowTypes[ri]]) || 0;
          }
        }

        const fc = colIdxToLetter(13), lc = colIdxToLetter(13 + dateCols.length - 1);
        r.getCell(10).value = { formula: `SUM(${fc}${rn}:${lc}${rn})` };

        r.eachCell(c => { c.border = { style: 'thin' }; c.alignment = { horizontal: 'center' }; });
        if (ri === 0) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FF' } }; });
        else if (ri === 2) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } }; });
      }
    }

    [8, 8, 14, 22, 14, 12, 12, 14, 14, 12, 7].forEach((w, i) => ws.getColumn(i + 1).width = w);
    for (let di = 0; di < dateCols.length; di++) ws.getColumn(12 + di).width = 7;
    ws.views = [{ state: 'frozen', xSplit: 6, ySplit: 1 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('班组缝制计划_' + fmtLocal(new Date()).replace(/-/g, '') + '.xlsx')}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    sendError(res, 'GET /api/schedule/sewing/export', e);
  }
});

// ---------- 缝制导入 ----------
app.post('/api/schedule/sewing/import', async (req, res) => {
  try {
    const { records, mode } = req.body;
    if (!records?.length) return res.status(400).json({ error: '没有数据' });
    let imported = 0, skipped = 0;
    const errors = [];

    const insMaster = db.getDb().prepare("INSERT INTO schedule_master (schedule_type,style_id,style_no,product_name,color,size_spec,plan_qty,plan_start,plan_end,workshop,line_team,secondary_type,cutting_plan_qty,due_date,daily_target) VALUES ('sewing',?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const chkDup = db.getDb().prepare("SELECT id FROM schedule_master WHERE schedule_type='sewing' AND style_no=? AND plan_start=? AND plan_end=?");

    const tx = db.getDb().transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        try {
          const styleNo = r['款号'] || r.style_no || '';
          const planStart = r['缝制开始日期'] || r.plan_start || '';
          const planEnd = r['缝制结束日期'] || r.plan_end || '';
          if (mode === 'skip' && chkDup.get(styleNo, planStart, planEnd)) { skipped++; continue; }
          if (mode === 'overwrite') {
            const dup = chkDup.get(styleNo, planStart, planEnd);
            if (dup) { db.run('DELETE FROM schedule_daily WHERE master_id=?', [dup.id]); db.run('DELETE FROM schedule_master WHERE id=?', [dup.id]); }
          }
          const info = insMaster.run(
            parseInt(r.style_id) || 0, styleNo,
            r['品名'] || r.product_name || '', r['颜色'] || r.color || '', r['规格'] || r.size_spec || '',
            parseInt(r['裁床计划数量'] || r.plan_qty) || 0,
            planStart, planEnd,
            r['车间'] || r.workshop || '', r['班组'] || r.line_team || '', '',
            parseInt(r['裁床计划数量']) || parseInt(r.plan_qty) || 0,
            r['交期'] || r.due_date || null,
            parseInt(r['目标日产量'] || r.daily_target) || 0
          );
          const mid = info.lastInsertRowid;
          if (r['每日明细'] && mid) {
            const insDaily = db.getDb().prepare('INSERT OR REPLACE INTO schedule_daily (master_id,schedule_date,row_type,qty) VALUES (?,?,?,?)');
            for (const [date, vals] of Object.entries(r['每日明细'])) {
              if (vals.PLAN != null) insDaily.run(mid, date, 'PLAN', vals.PLAN || 0);
              if (vals.ACTUAL != null) insDaily.run(mid, date, 'ACTUAL', vals.ACTUAL || 0);
              insDaily.run(mid, date, 'DIFF', (vals.ACTUAL || 0) - (vals.PLAN || 0));
            }
          }
          imported++;
        } catch (e) { errors.push({ row: i + 2, message: e.message }); }
      }
    });
    tx();
    res.json({ ok: true, imported, skipped, errors });
  } catch (e) {
    sendError(res, 'POST /api/schedule/sewing/import', e);
  }
});

// ---------- 裁剪导入（写 schedule_master，type=cutting；cutting 详情表仍读 join 视图） ----------
app.post('/api/schedule/cutting/import', async (req, res) => {
  try {
    const { records, mode } = req.body;
    if (!records?.length) return res.status(400).json({ error: '没有数据' });
    let imported = 0, skipped = 0;
    const errors = [];

    const insMaster = db.getDb().prepare("INSERT INTO schedule_master (schedule_type,style_id,style_no,product_name,color,size_spec,plan_qty,plan_start,plan_end,workshop,line_team,secondary_type,cutting_plan_qty,due_date,daily_target) VALUES ('cutting',?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const chkDup = db.getDb().prepare("SELECT id FROM schedule_master WHERE schedule_type='cutting' AND style_no=? AND IFNULL(color,'')=? AND IFNULL(size_spec,'')=? AND IFNULL(plan_start,'')=?");

    const tx = db.getDb().transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        try {
          const styleNo = r['款号'] || r.style_no || '';
          const color = r['颜色'] || r.color || '';
          const sizeSpec = r['尺码'] || r.size_spec || '';
          const planStart = r['裁剪上线'] || r.cutting_start || r.plan_start || '';
          if (mode === 'skip' && chkDup.get(styleNo, color, sizeSpec, planStart)) { skipped++; continue; }
          if (mode === 'overwrite') {
            const dup = chkDup.get(styleNo, color, sizeSpec, planStart);
            if (dup) {
              // [2026-06-20 fix#后端-P2-5/业务-P2-7] 先删 daily 避免孤儿
              db.run('DELETE FROM schedule_daily WHERE master_id=?', [dup.id]);
              db.run('DELETE FROM schedule_master WHERE id=?', [dup.id]);
            }
          }
          const info = insMaster.run(
            parseInt(r.style_id) || 0, styleNo,
            r['品名'] || r.product_name || '', color, sizeSpec,
            parseInt(r['原单量'] || r.plan_qty) || 0,
            planStart, r['裁剪下线'] || r.cutting_end || r.plan_end || '',
            '', '', '',
            parseInt(r['计划数量']) || parseInt(r.plan_qty) || 0,
            r['交期'] || r.due_date || null,
            0
          );
          imported++;
        } catch (e) { errors.push({ row: i + 2, message: e.message }); }
      }
    });
    tx();
    res.json({ ok: true, imported, skipped, errors });
  } catch (e) {
    sendError(res, 'POST /api/schedule/cutting/import', e);
  }
});

// 列索引转Excel列字母
function colIdxToLetter(idx) {
  let letters = '';
  let n = idx;
  while (n > 0) {
    const mod = (n - 1) % 26;
    letters = String.fromCharCode(65 + mod) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

// [fix#4] Changed DIFF to ACTUAL (qty=0 initial)
function generatePlanRows(masterId, start, end, totalQty) {
  const startD = new Date(start);
  const endD = new Date(end);
  const days = Math.floor((endD - startD) / (1000 * 60 * 60 * 24)) + 1;
  if (days <= 0) return;

  const dailyQty = Math.ceil(totalQty / days);
  let accumulated = 0;

  const stmtPlan = db.getDb().prepare('INSERT OR REPLACE INTO schedule_daily (master_id, schedule_date, row_type, qty) VALUES (?, ?, ?, ?)');
  const stmtActual = db.getDb().prepare('INSERT OR REPLACE INTO schedule_daily (master_id, schedule_date, row_type, qty) VALUES (?, ?, ?, ?)');

  const txn = db.getDb().transaction(() => {
    for (let i = 0; i < days; i++) {
      const d = new Date(startD);
      d.setDate(d.getDate() + i);
      const dateStr = fmtLocal(d);
      const planForDay = Math.min(dailyQty, totalQty - accumulated);
      accumulated += planForDay;
      stmtPlan.run(masterId, dateStr, 'PLAN', planForDay);
      stmtActual.run(masterId, dateStr, 'ACTUAL', 0);
    }
  });
  txn();
}

// ---------- 实际生产数据 ----------
app.get('/api/actual', (req, res) => {
  try {
    const { scheduleType, keyword, is_second_inspection, secondary_type } = req.query;
    let sql = 'SELECT * FROM actual_production';
    const wheres = [];
    const params = [];
    if (scheduleType) { wheres.push('schedule_type = ?'); params.push(scheduleType); }
    // [2026-06-20 段8 M-2] 款号模糊,后端 SQL LIKE(替代前端 .filter())
    if (keyword) { wheres.push(`style_no LIKE ? ESCAPE '\\'`); params.push(`%${escapeLike(keyword)}%`); }
    // [2026-06-20 段11 M-2] 二检过滤,后端 SQL(替代 CuttingSecondDispatch .filter)
    if (is_second_inspection !== undefined && is_second_inspection !== '') {
      wheres.push('is_second_inspection = ?');
      params.push(parseInt(is_second_inspection) ? 1 : 0);
    }
    // [2026-06-20 段14 M-2] secondary_type 过滤(替代 SecondaryDispatch .filter)
    if (secondary_type) { wheres.push('secondary_type = ?'); params.push(secondary_type); }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
    sql += ' ORDER BY production_date DESC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/actual', requireRole('dispatcher', 'supervisor', 'admin'), (req, res) => {
  try {
    const r = req.body;
    if (!r.style_no) return res.status(400).json({ error: '款号不能为空' });
    if (!r.production_date) return res.status(400).json({ error: '日期不能为空' });
    // [2026-06-19] 二检必须指定 source_type
    if (parseInt(r.is_second_inspection) > 0 && !r.source_type) {
      return res.status(400).json({ error: '二检报工必须选择来源(印花/刺绣)' });
    }
    // [2026-06-20 批次1-业务-P0-6] 数值/日期合理性校验
    const vErr = validateActualPayload(r);
    if (vErr) return res.status(vErr.status).json(vErr.body);

    const result = db.run(`INSERT INTO actual_production (schedule_type, secondary_type, style_id, style_no, color, size_spec, production_date, completed_qty, defect_qty, workshop, line_team, remark, worker_name, start_time, end_time, is_second_inspection, source_type)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.schedule_type, r.secondary_type || '', r.style_id || 0, r.style_no, r.color, r.size_spec, r.production_date, r.completed_qty || 0, r.defect_qty || 0, r.workshop || '', r.line_team || '', r.remark || '', r.worker_name || '', r.start_time || '', r.end_time || '',
       parseInt(r.is_second_inspection) || 0, r.source_type || '']);

    const inserted = { id: result.lastInsertRowid, ...r };
    // [2026-06-19] 报工完成 → 自动入裁片库
    db.recordCutPiecesInbound(inserted);

    syncActualToDaily(inserted);
    // 自动重算任务状态
    // [2026-06-20 fix#业务-P1-11] 接住 recalcTaskStatus 返回值,失败时记入操作日志
    if (r.style_id) {
      const rc = db.recalcTaskStatus(r.style_id);
      if (!rc.ok) logOp(req, 'recalc_task_status', 'fail', r.style_id, r.style_no, `err=${rc.error}`);
    }
    logOp(req, 'actual_production', 'create', inserted.id, r.style_no, `qty=${r.completed_qty || 0} ${r.schedule_type}`);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 报工汇总 ----------
app.get('/api/dispatch-summary', (req, res) => {
  try {
    const { schedule_type, secondary_type, workshop, style_no, date_from, date_to, group_by = 'date' } = req.query;
    const ALLOWED_GROUP_BY = ['date', 'style', 'workshop', 'line_team'];
    if (!ALLOWED_GROUP_BY.includes(group_by)) {
      return res.status(400).json({ error: 'group_by 参数非法' });
    }
    let groupExpr, selectExtra;
    switch (group_by) {
      case 'style':
        groupExpr = 'style_no'; selectExtra = 'style_no,'; break;
      case 'workshop':
        groupExpr = 'workshop'; selectExtra = 'workshop,'; break;
      case 'line_team':
        groupExpr = 'line_team'; selectExtra = 'line_team,'; break;
      default:
        groupExpr = 'production_date, style_no'; selectExtra = 'production_date, style_no,';
    }
    let sql = `SELECT ${selectExtra}
      workshop, line_team, secondary_type,
      COUNT(*) as record_count,
      SUM(completed_qty) as total_completed,
      SUM(defect_qty) as total_defects,
      ROUND(CAST(SUM(completed_qty) AS REAL) * 100.0 / NULLIF(SUM(completed_qty) + SUM(defect_qty), 0), 1) as quality_rate
    FROM actual_production WHERE 1=1`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    if (style_no) { sql += ` AND style_no LIKE ? ESCAPE '\\\\'`; params.push(`%${escapeLike(style_no)}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    // [2026-06-20 fix#后端-P3-4] 支持 ?limit (1..2000,默认500) + ?offset 分页
    const limit = Math.max(1, Math.min(2000, parseInt(req.query.limit) || 500));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    sql += ` GROUP BY ${groupExpr} ORDER BY ${groupExpr.split(',')[0]} DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/dispatch-summary error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 单条报工 CRUD ----------
app.get('/api/actual/:id', (req, res) => {
  try {
    const row = db.get('SELECT * FROM actual_production WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: '记录不存在' });
    res.json(row);
  } catch (e) {
    console.error('GET /api/actual/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/actual/:id', requireRole('dispatcher', 'supervisor', 'admin'), (req, res) => {
  try {
    const r = req.body;
    const existing = db.get('SELECT * FROM actual_production WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '记录不存在' });

    // [2026-06-20 批次1-业务-P0-6] 数值/日期合理性校验(基于合并后的值)
    const merged = { ...existing, ...r };
    const vErr = validateActualPayload(merged, existing);
    if (vErr) return res.status(vErr.status).json(vErr.body);

    // [2026-06-20] 跨车间拦截:supervisor 只能改自己车间的报工,dispatcher 只能改自己车间的报工
    // [2026-06-20 fix#业务-P1-3] 用 userCanAccessWorkshop 允许 secondary 主任跨 3 工序
    const u = req.user;
    if (u.role !== 'admin') {
      const needWorkshop = SCHEDULE_TYPE_WORKSHOP[existing.schedule_type];
      if (needWorkshop && !userCanAccessWorkshop(u, needWorkshop)) {
        return res.status(403).json({ error: '无权操作其他车间的报工' });
      }
    }

    const oldStyleId = existing.style_id;
    const newStyleId = r.style_id || oldStyleId;
    const newIsSecond = r.is_second_inspection != null ? parseInt(r.is_second_inspection) : parseInt(existing.is_second_inspection);
    const newSourceType = r.source_type != null ? r.source_type : (existing.source_type || '');

    const oldIsSecond = parseInt(existing.is_second_inspection) || 0;
    const oldQty = parseInt(existing.completed_qty) || 0;
    const newQty = r.completed_qty != null ? parseInt(r.completed_qty) : oldQty;

    // [2026-06-20 fix#业务-P1-11] 收集待 recalc 的 style_id,transaction 提交后调用
    const recalcIds = new Set();
    // [2026-06-20 批次2-业务-P1-8] UPDATE + 副作用整段包事务
    // 之前 rollbackCutPiecesInbound / recordCutPiecesInbound / syncActualToDaily 都不在事务内
    // 失败会留下不一致状态(库存扣了但 actual 没改 / 反之)
    const updateTxn = db.getDb().transaction(() => {
      db.run(`UPDATE actual_production SET schedule_type=?, secondary_type=?, style_id=?, style_no=?, color=?, size_spec=?,
        production_date=?, completed_qty=?, defect_qty=?, workshop=?, line_team=?, remark=?,
        worker_name=?, start_time=?, end_time=?, is_second_inspection=?, source_type=? WHERE id=?`,
        [r.schedule_type || existing.schedule_type, r.secondary_type ?? existing.secondary_type,
         newStyleId, r.style_no || existing.style_no,
         r.color ?? existing.color, r.size_spec ?? existing.size_spec,
         r.production_date || existing.production_date, r.completed_qty ?? existing.completed_qty,
         r.defect_qty ?? existing.defect_qty, r.workshop ?? existing.workshop,
         r.line_team ?? existing.line_team, r.remark ?? existing.remark,
         r.worker_name ?? existing.worker_name, r.start_time ?? existing.start_time,
         r.end_time ?? existing.end_time,
         newIsSecond, newSourceType, req.params.id]);

      // [2026-06-19] 如果二检标记/数量变了 → 回滚旧入库并按新值重入
      // [2026-06-20 fix#后端-P1-4] 传 rawDb 让 recordCutPiecesInbound SQL 走当前 transaction
      const rawDb = db.getDb();
      if (oldIsSecond !== newIsSecond || oldQty !== newQty) {
        db.rollbackCutPiecesInbound(existing, rawDb);
        const updated = { ...existing, ...r, is_second_inspection: newIsSecond, source_type: newSourceType, completed_qty: newQty };
        db.recordCutPiecesInbound(updated, rawDb);
      }

      // syncActualToDaily 内部自带事务(SQLite SAVEPOINT 兼容嵌套)
      syncActualToDaily({ ...existing, ...r, style_id: newStyleId });
      // [2026-06-20 fix#业务-P1-11] 把待 recalc 的 style_id 收集到外层 Set,transaction 外再执行
      if (newStyleId) recalcIds.add(newStyleId);
      if (oldStyleId && oldStyleId !== newStyleId) recalcIds.add(oldStyleId);
    });
    updateTxn();
    // [2026-06-20 fix#业务-P1-11] transaction 提交后再 recalc,失败仅 logOp
    for (const sid of recalcIds) {
      const rc = db.recalcTaskStatus(sid);
      if (!rc.ok) logOp(req, 'recalc_task_status', 'fail', sid, '', `err=${rc.error}`);
    }
    logOp(req, 'actual_production', 'update', req.params.id, existing.style_no, `qty: ${oldQty}→${newQty} ${existing.schedule_type}`);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/actual/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/actual/:id', requireRole('supervisor', 'admin'), (req, res) => {
  try {
    const existing = db.get('SELECT * FROM actual_production WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '记录不存在' });

    // [2026-06-19] 已出库则拒
    const check = db.checkActualDeletable(existing);
    if (!check.ok) return res.status(400).json({ error: check.error });

    // P0 安全: 整个删除流程包事务,任一步骤失败回滚
    // [2026-06-20 fix#业务-P1-11] 收集 style_id 到外层,transaction 外 recalc
    const delRecalcIds = new Set();
    if (existing.style_id) delRecalcIds.add(existing.style_id);
    const delTxn = db.getDb().transaction(() => {
      // [2026-06-19] 回滚裁片库入库
      // [2026-06-20 fix#后端-P1-4] 传 rawDb 让 SQL 走当前 transaction
      const rawDb = db.getDb();
      db.rollbackCutPiecesInbound(existing, rawDb);

      db.run('DELETE FROM actual_production WHERE id = ?', [req.params.id]);

      const masters = db.all('SELECT id FROM schedule_master WHERE style_no = ? AND schedule_type = ?',
        [existing.style_no, existing.schedule_type]);
      for (const m of masters) {
        db.run("DELETE FROM schedule_daily WHERE master_id = ? AND schedule_date = ? AND row_type = 'ACTUAL'",
          [m.id, existing.production_date]);
      }
    });
    delTxn();
    // [2026-06-20 fix#业务-P1-11] transaction 提交后再 recalc
    for (const sid of delRecalcIds) {
      const rc = db.recalcTaskStatus(sid);
      if (!rc.ok) logOp(req, 'recalc_task_status', 'fail', sid, '', `err=${rc.error}`);
    }
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/actual/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 批量导入报工 ----------
app.post('/api/actual/batch', requireRole('dispatcher', 'supervisor', 'admin'), (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: '请提供报工记录数组' });
    }
    let inserted = 0;
    const styleIds = new Set();
    // P0 安全: 整批 INSERT+副作用 放进事务,部分失败可回滚
    const batchTxn = db.getDb().transaction(() => {
      for (const r of records) {
        if (!r.style_no || !r.production_date) continue;
        // [2026-06-20 批次1-业务-P0-6] 单条数值/日期合理性校验,失败整批回滚
        const vErr = validateActualPayload(r);
        if (vErr) {
          throw Object.assign(new Error('batch validation failed'), { httpStatus: vErr.status, httpBody: vErr.body });
        }
        const result = db.run(`INSERT INTO actual_production (schedule_type, secondary_type, style_id, style_no, color, size_spec, production_date, completed_qty, defect_qty, workshop, line_team, remark, worker_name, start_time, end_time, is_second_inspection, source_type)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [r.schedule_type || '', r.secondary_type || '', r.style_id || 0, r.style_no, r.color || '', r.size_spec || '',
           r.production_date, r.completed_qty || 0, r.defect_qty || 0, r.workshop || '',
           r.line_team || '', r.remark || '', r.worker_name || '', r.start_time || '', r.end_time || '',
           parseInt(r.is_second_inspection) || 0, r.source_type || '']);
        // [2026-06-19] 报工完成 → 自动入裁片库
        // [2026-06-20 fix#后端-P1-4] 传 rawDb 让 SQL 走当前 transaction
        db.recordCutPiecesInbound({ id: result.lastInsertRowid, ...r }, db.getDb());
        syncActualToDaily(r);
        if (r.style_id) styleIds.add(r.style_id);
        inserted++;
      }
      // [2026-06-20 fix#业务-P1-11] recalc 移到 transaction 外
    });
    batchTxn();
    // [2026-06-20 fix#业务-P1-11] transaction 提交后再 recalc,失败仅 logOp
    for (const sid of styleIds) {
      const rc = db.recalcTaskStatus(sid);
      if (!rc.ok) logOp(req, 'recalc_task_status', 'fail', sid, '', `err=${rc.error}`);
    }
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true, inserted });
  } catch (e) {
    console.error('POST /api/actual/batch error:', e);
    // [2026-06-20 批次1-业务-P0-6] 业务校验错透传 4xx,不要全返 500
    if (e && e.httpStatus && e.httpBody) return res.status(e.httpStatus).json(e.httpBody);
    res.status(500).json({ error: '批量导入失败' });
  }
});

// ---------- 每日完成量趋势 ----------
app.get('/api/dispatch-daily-trend', (req, res) => {
  try {
    const { schedule_type, secondary_type, workshop, style_no, date_from, date_to } = req.query;
    let sql = `SELECT production_date, SUM(completed_qty) as total_completed, SUM(defect_qty) as total_defects
      FROM actual_production WHERE 1=1`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    if (style_no) { sql += ` AND style_no LIKE ? ESCAPE '\\\\'`; params.push(`%${escapeLike(style_no)}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ' GROUP BY production_date ORDER BY production_date ASC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/dispatch-daily-trend error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 计划 vs 实际对比 ----------
app.get('/api/dispatch-plan-vs-actual', (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    let dateFilter = '';
    const params = [];
    if (date_from) { dateFilter += ' AND sm.plan_start >= ?'; params.push(date_from); }
    if (date_to) { dateFilter += ' AND sm.plan_end <= ?'; params.push(date_to); }

    const rows = db.all(`
      SELECT sm.style_no, sm.style_id, sm.plan_qty, sm.schedule_type,
        COALESCE(a.actual_total, 0) as actual_total,
        CASE WHEN sm.plan_qty > 0
          THEN MIN(ROUND(CAST(COALESCE(a.actual_total, 0) AS REAL) * 100.0 / sm.plan_qty), 100)
          ELSE 0 END as progress_pct
      FROM schedule_master sm
      LEFT JOIN (
        SELECT style_no, style_id, schedule_type, SUM(completed_qty) as actual_total
        FROM actual_production GROUP BY style_no, schedule_type
      ) a ON sm.style_no = a.style_no AND sm.schedule_type = a.schedule_type
      WHERE sm.plan_qty > 0 ${dateFilter}
      GROUP BY sm.style_no, sm.schedule_type
      ORDER BY progress_pct ASC
    `, params);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/dispatch-plan-vs-actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 报工预警（落后于计划） ----------
app.get('/api/dispatch-alerts', (req, res) => {
  try {
    const rows = db.all(`
      SELECT sm.style_no, sm.style_id, sm.plan_qty, sm.schedule_type, sm.plan_end,
        COALESCE(a.actual_total, 0) as actual_total,
        CASE WHEN sm.plan_qty > 0
          THEN ROUND(CAST(COALESCE(a.actual_total, 0) AS REAL) * 100.0 / sm.plan_qty, 1)
          ELSE 0 END as progress_pct
      FROM schedule_master sm
      LEFT JOIN (
        SELECT style_no, style_id, schedule_type, SUM(completed_qty) as actual_total
        FROM actual_production GROUP BY style_no, schedule_type
      ) a ON sm.style_no = a.style_no AND sm.schedule_type = a.schedule_type
      WHERE sm.plan_qty > 0 AND COALESCE(a.actual_total, 0) < sm.plan_qty
      ORDER BY sm.plan_end ASC
    `);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/dispatch-alerts error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [2026-06-19] 裁剪完成度对比：实际报工数 vs 裁剪参数 vs 原单数
// 用于 CuttingDispatch 报警：实际 < 原单数 红色提示
app.get('/api/cutting-completion', (req, res) => {
  try {
    // [2026-06-20 段10 M-2] mode=active 仅返回未完成或有报工的行(替代前端 .filter)
    const mode = req.query.mode;
    let sql = `
      SELECT
        scs.style_no, scs.color, scs.size_spec,
        scs.plan_qty AS order_qty,
        scs.cutting_param,
        COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 0 THEN ap.completed_qty ELSE 0 END), 0) AS first_actual,
        COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 1 THEN ap.completed_qty ELSE 0 END), 0) AS second_actual,
        CASE WHEN scs.plan_qty > 0 AND
          COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 0 THEN ap.completed_qty ELSE 0 END), 0) < scs.plan_qty
          THEN 1 ELSE 0 END AS under_order
      FROM style_color_size scs
      LEFT JOIN actual_production ap
        ON ap.style_no = scs.style_no AND ap.color = scs.color AND ap.size_spec = scs.size_spec
      WHERE scs.plan_qty > 0
      GROUP BY scs.style_no, scs.color, scs.size_spec
    `;
    if (mode === 'active') {
      // 重复表达式(SQLite HAVING 不支持别名)+ 复用 under_order 表达式
      sql += ` HAVING (
        CASE WHEN scs.plan_qty > 0 AND
          COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 0 THEN ap.completed_qty ELSE 0 END), 0) < scs.plan_qty
          THEN 1 ELSE 0 END = 1
        OR COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 0 THEN ap.completed_qty ELSE 0 END), 0)
         + COALESCE(SUM(CASE WHEN ap.schedule_type = 'cutting' AND COALESCE(ap.is_second_inspection, 0) = 1 THEN ap.completed_qty ELSE 0 END), 0) > 0
      )`;
    }
    sql += ' ORDER BY under_order DESC, scs.style_no';
    res.json(db.all(sql));
  } catch (e) {
    console.error('GET /api/cutting-completion error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 报工导出 Excel ----------
app.get('/api/dispatch-export', async (req, res) => {
  try {
    const { schedule_type, secondary_type, workshop, style_no, date_from, date_to } = req.query;
    let sql = `SELECT production_date, style_no, secondary_type, color, size_spec, completed_qty, defect_qty,
      workshop, line_team, worker_name, remark, recorded_at
      FROM actual_production WHERE 1=1`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    if (style_no) { sql += ` AND style_no LIKE ? ESCAPE '\\\\'`; params.push(`%${escapeLike(style_no)}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ' ORDER BY production_date DESC';
    const rows = db.all(sql, params);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('报工明细');
    ws.columns = [
      { header: '生产日期', key: 'production_date', width: 14 },
      { header: '款号', key: 'style_no', width: 25 },
      { header: '工序', key: 'secondary_type', width: 10 },
      { header: '颜色', key: 'color', width: 12 },
      { header: '尺码', key: 'size_spec', width: 10 },
      { header: '完成数量', key: 'completed_qty', width: 12 },
      { header: '次品数量', key: 'defect_qty', width: 10 },
      { header: '车间', key: 'workshop', width: 10 },
      { header: '班组', key: 'line_team', width: 10 },
      { header: '工人', key: 'worker_name', width: 12 },
      { header: '备注', key: 'remark', width: 20 },
      { header: '录入时间', key: 'recorded_at', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow(r);
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('报工明细_' + fmtLocal(new Date()).replace(/-/g, '') + '.xlsx')}`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/dispatch-export error:', e);
    res.status(500).json({ error: '导出失败' });
  }
});

// ---------- 按产线统计 ----------
app.get('/api/dispatch-by-line', (req, res) => {
  try {
    const { schedule_type, secondary_type, workshop, style_no, date_from, date_to } = req.query;
    let sql = `SELECT line_team, workshop,
      COUNT(*) as record_count,
      SUM(completed_qty) as total_completed,
      SUM(defect_qty) as total_defects,
      ROUND(CAST(SUM(completed_qty) AS REAL) * 100.0 / NULLIF(SUM(completed_qty) + SUM(defect_qty), 0), 1) as quality_rate
    FROM actual_production WHERE line_team != '' AND line_team IS NOT NULL`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    if (style_no) { sql += ` AND style_no LIKE ? ESCAPE '\\\\'`; params.push(`%${escapeLike(style_no)}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ' GROUP BY workshop, line_team ORDER BY total_completed DESC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/dispatch-by-line error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 按车间统计 ----------
app.get('/api/dispatch-by-workshop', (req, res) => {
  try {
    const { schedule_type, secondary_type, style_no, date_from, date_to } = req.query;
    let sql = `SELECT workshop,
      COUNT(*) as record_count,
      SUM(completed_qty) as total_completed,
      SUM(defect_qty) as total_defects,
      ROUND(CAST(SUM(completed_qty) AS REAL) * 100.0 / NULLIF(SUM(completed_qty) + SUM(defect_qty), 0), 1) as quality_rate
    FROM actual_production WHERE workshop != '' AND workshop IS NOT NULL`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (style_no) { sql += ` AND style_no LIKE ? ESCAPE '\\\\'`; params.push(`%${escapeLike(style_no)}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ' GROUP BY workshop ORDER BY total_completed DESC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/dispatch-by-workshop error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 按工人统计 ----------
app.get('/api/dispatch-by-worker', (req, res) => {
  try {
    const { schedule_type, secondary_type, workshop, line_team, date_from, date_to } = req.query;
    let sql = `SELECT worker_name, workshop, line_team,
      COUNT(*) as record_count,
      SUM(completed_qty) as total_completed,
      SUM(defect_qty) as total_defects,
      ROUND(CAST(SUM(completed_qty) AS REAL) * 100.0 / NULLIF(SUM(completed_qty) + SUM(defect_qty), 0), 1) as quality_rate
    FROM actual_production WHERE worker_name != '' AND worker_name IS NOT NULL`;
    const params = [];
    if (schedule_type) { sql += ' AND schedule_type = ?'; params.push(schedule_type); }
    if (secondary_type) { sql += ' AND secondary_type = ?'; params.push(secondary_type); }
    if (workshop) { sql += ' AND workshop = ?'; params.push(workshop); }
    if (line_team) { sql += ' AND line_team = ?'; params.push(line_team); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ' GROUP BY worker_name ORDER BY total_completed DESC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/dispatch-by-worker error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 出货计划 ----------
app.get('/api/shipping-plans', (req, res) => {
  try { res.json(db.all('SELECT * FROM shipping_plans ORDER BY ship_date')); }
  catch (e) { console.error('GET /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/shipping-plans', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const p = req.body;
    if (!p.plan_no) return res.status(400).json({ error: '计划编号不能为空' });
    const result = db.run('INSERT INTO shipping_plans (plan_no, customer, style_no, product_name, plan_qty, ship_date, remark) VALUES (?,?,?,?,?,?,?)',
      [p.plan_no, p.customer || '', p.style_no || '', p.product_name || '', p.plan_qty || 0, p.ship_date || '', p.remark || '']);
    logOp(req, 'shipping', 'create', result.lastInsertRowid, p.plan_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/shipping-plans/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const p = req.body;
    db.run('UPDATE shipping_plans SET customer=?, style_no=?, product_name=?, plan_qty=?, ship_date=?, status=?, remark=? WHERE id=?',
      [p.customer, p.style_no, p.product_name, p.plan_qty, p.ship_date, p.status, p.remark, req.params.id]);
    logOp(req, 'shipping', 'update', req.params.id, p.plan_no || '');
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/shipping-plans/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const existing = db.get('SELECT plan_no FROM shipping_plans WHERE id = ?', [req.params.id]);
    db.run('DELETE FROM shipping_plans WHERE id = ?', [req.params.id]);
    logOp(req, 'shipping', 'delete', req.params.id, existing?.plan_no || '');
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 从主计划自动生成出货计划
app.post('/api/shipping-plans/generate', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const plans = db.all('SELECT * FROM main_plan WHERE due_date IS NOT NULL ORDER BY due_date');
    let count = 0;
    const txn = db.getDb().transaction(() => {
      for (const p of plans) {
        const existing = db.get('SELECT id FROM shipping_plans WHERE style_no = ? AND ship_date = ?', [p.style_no, p.due_date]);
        if (existing) continue;
        const planNo = `SP-${fmtLocal(new Date()).replace(/-/g,'')}-${String(++count).padStart(3,'0')}`;
        db.run('INSERT INTO shipping_plans (plan_no, customer, style_no, product_name, plan_qty, ship_date) VALUES (?,?,?,?,?,?)',
          [planNo, '', p.style_no, p.product_name, p.plan_qty, p.due_date]);
      }
    });
    txn();
    logOp(req, 'shipping', 'generate', null, `自动生成${count}条出货计划`);
    res.json({ ok: true, count });
  } catch (e) { console.error('POST /api/shipping-plans/generate error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// ---------- 排产策略 ----------
app.get('/api/strategies', (req, res) => {
  try { res.json(db.all('SELECT * FROM scheduling_strategies ORDER BY id')); }
  catch (e) { console.error('GET /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/strategies', requireRole('admin', 'planning_manager'), (req, res) => {
  try {
    const s = req.body;
    const result = db.run('INSERT INTO scheduling_strategies (name, rule_type, description, config, active) VALUES (?,?,?,?,?)',
      [s.name, s.rule_type || 'due_date', s.description || '', JSON.stringify(s.config || {}), s.active ? 1 : 0]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/strategies/:id', requireRole('admin', 'planning_manager'), (req, res) => {
  try {
    const s = req.body;
    db.run('UPDATE scheduling_strategies SET name=?, rule_type=?, description=?, config=?, active=? WHERE id=?',
      [s.name, s.rule_type, s.description, JSON.stringify(s.config || {}), s.active ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/strategies/:id', requireRole('admin', 'planning_manager'), (req, res) => {
  try { db.run('DELETE FROM scheduling_strategies WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 一键自动排产
app.post('/api/auto-schedule', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const { strategy_id } = req.body;
    const result = db.autoSchedule(strategy_id, req.user?.id);
    res.json(result);
  } catch (e) { console.error('POST /api/auto-schedule error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 产能预排验证
app.get('/api/capacity-precheck', (req, res) => {
  try {
    const result = db.capacityPrecheck();
    res.json(result);
  } catch (e) { console.error('GET /api/capacity-precheck error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// [B-02 fix] Override instead of accumulate
// 增加 (color, size_spec, secondary_type) 维度精确匹配,避免一次报工污染所有 master
// [2026-06-18] 多 master 写入用事务,确保原子性(中途失败回滚全部)
function syncActualToDaily(record) {
  const conditions = ['style_no = ?', 'schedule_type = ?'];
  const params = [record.style_no, record.schedule_type];
  if (record.color !== undefined) {
    conditions.push('color = ?');
    params.push(record.color || '');
  }
  if (record.size_spec !== undefined) {
    conditions.push('size_spec = ?');
    params.push(record.size_spec || '');
  }
  if (record.secondary_type) {
    conditions.push('secondary_type = ?');
    params.push(record.secondary_type);
  }
  const masters = db.all(
    `SELECT id FROM schedule_master WHERE ${conditions.join(' AND ')}`,
    params
  );
  const txn = db.getDb().transaction(() => {
    for (const m of masters) {
      const existing = db.get('SELECT id, locked_by_user_id FROM schedule_daily WHERE master_id = ? AND schedule_date = ? AND row_type = ?',
        [m.id, record.production_date, 'ACTUAL']);
      if (existing) {
        // [2026-06-18] 锁检查:supervisor 锁定的行 dispatcher 不能再覆盖
        if (existing.locked_by_user_id) continue;
        db.run('UPDATE schedule_daily SET qty = ? WHERE id = ?', [record.completed_qty || 0, existing.id]);
      } else {
        db.run('INSERT INTO schedule_daily (master_id, schedule_date, row_type, qty) VALUES (?, ?, ?, ?)',
          [m.id, record.production_date, 'ACTUAL', record.completed_qty || 0]);
      }
    }
  });
  txn();
}

// [2026-06-18] 用户系统:supervisor 改 ACTUAL 行纠错
// 业务流:dispatcher 先报 → supervisor 复核 → 有错就改 → 改完锁定(防止 dispatcher 二次覆盖)

// [2026-06-18] supervisor 复核用:列出某 scheduleType 下所有 ACTUAL 行
// (含 daily id,用于编辑/解锁)
app.get('/api/schedule/daily/actuals', (req, res) => {
  try {
    const { schedule_type, style_no } = req.query;
    if (!schedule_type) return res.status(400).json({ error: 'schedule_type 必填' });

    // 角色 + 车间检查:仅 admin/supervisor 可访问
    // [2026-06-20 fix#业务-P1-3] 用 userCanAccessWorkshop 允许 secondary 主任跨 3 工序
    if (req.user.role === 'admin') {
      // 通过
    } else if (req.user.role === 'supervisor') {
      if (!userCanAccessWorkshop(req.user, SCHEDULE_TYPE_WORKSHOP[schedule_type])) {
        return res.status(403).json({ error: '无权查看其他车间的数据' });
      }
    } else {
      return res.status(403).json({ error: '该端点仅限车间主任或管理员' });
    }

    let sql = `
      SELECT sd.id, sd.master_id, sd.schedule_date, sd.qty, sd.locked_by_user_id, sd.locked_at,
             sm.schedule_type, sm.style_no, sm.color, sm.size_spec,
             u.display_name AS locked_by_name
      FROM schedule_daily sd
      JOIN schedule_master sm ON sm.id = sd.master_id
      LEFT JOIN users u ON u.id = sd.locked_by_user_id
      WHERE sd.row_type = 'ACTUAL' AND sm.schedule_type = ?
    `;
    const params = [schedule_type];
    if (style_no) { sql += ' AND sm.style_no LIKE ?'; params.push('%' + style_no + '%'); }
    sql += ' ORDER BY sd.schedule_date DESC LIMIT 500';
    res.json(db.all(sql, params));
  } catch (e) { sendError(res, 'GET /api/schedule/daily/actuals', e); }
});

app.put('/api/schedule/daily/actual/:id', requireRole('admin', 'supervisor'), (req, res) => {
  try {
    const { id } = req.params;
    const { qty } = req.body || {};
    if (qty == null || isNaN(qty) || qty < 0) {
      return res.status(400).json({ error: 'qty 必须是非负数' });
    }

    // [2026-06-20] 锁检查 + UPDATE 包进事务,避免理论并发竞态
    // (SQLite WAL 下 db.run 串行化,但业务层"读到未锁 → 写时已被锁"窗口存在)
    const txn = db.getDb().transaction(() => {
      const row = db.get('SELECT * FROM schedule_daily WHERE id = ?', [id]);
      if (!row) return { status: 404, body: { error: '记录不存在' } };

      // 角色 + 车间检查:admin 全权,supervisor 限本车间,其他角色拒绝
      // [2026-06-20 fix#业务-P1-3] 用 userCanAccessWorkshop 允许 secondary 主任跨 3 工序
      const master = db.get('SELECT schedule_type FROM schedule_master WHERE id = ?', [row.master_id]);
      if (!master) return { status: 404, body: { error: 'master 不存在' } };
      if (req.user.role === 'admin') {
        // 通过
      } else if (req.user.role === 'supervisor') {
        if (!userCanAccessWorkshop(req.user, SCHEDULE_TYPE_WORKSHOP[master.schedule_type])) {
          return { status: 403, body: { error: '无权操作其他车间的数据' } };
        }
      } else {
        return { status: 403, body: { error: '该操作仅限车间主任或管理员' } };
      }

      // [2026-06-20 fix#业务-P1-5] 多 tab 锁冲突:客户端传 expected_qty(看到行时的 qty)
      // 不匹配则 409,前端收到后重新 load
      if (req.body?.expected_qty != null && Number(req.body.expected_qty) !== Number(row.qty)) {
        return { status: 409, body: { error: '数据已被其他会话修改,请刷新后重试', current_qty: row.qty } };
      }

      // 锁检查:已被其他主任锁定?admin 可覆盖任何锁
      if (row.locked_by_user_id && row.locked_by_user_id !== req.user.id && req.user.role !== 'admin') {
        return { status: 409, body: { error: '该日已被其他主任修改锁定' } };
      }

      // [2026-06-18] admin 改不抢锁(保持原锁);supervisor 改才写自己的锁
      // [2026-06-20 批次1-业务-P0-4] admin 覆盖锁强制写审计 diff + 通知原锁定 supervisor
      if (req.user.role === 'admin') {
        const previousLocker = row.locked_by_user_id;
        const previousQty = row.qty;
        db.run('UPDATE schedule_daily SET qty = ? WHERE id = ?', [qty, id]);
        // 只有原本被其他 supervisor 锁住、且 admin 改动了 qty,才算覆盖
        if (previousLocker && previousLocker !== req.user.id && Number(previousQty) !== Number(qty)) {
          logOp(req, 'schedule_daily', 'admin_override',
            id,
            JSON.stringify({ qty: previousQty, locked_by_user_id: previousLocker }),
            JSON.stringify({ qty, overridden_by: req.user.id, overridden_at: fmtLocal(new Date()) }));
          try { io.emit('scheduleDaily:overridden', { id, qty, by: req.user.username, previousLocker }); } catch (_) {}
        }
      } else {
        db.run(`UPDATE schedule_daily SET qty = ?, locked_by_user_id = ?, locked_at = datetime('now','localtime') WHERE id = ?`,
          [qty, req.user.id, id]);
      }
      logOp(req, 'schedule_daily', 'update_actual', id, '', `qty=${qty} by ${req.user.username}`);
      return { status: 200, body: { ok: true, locked_by_user_id: row.locked_by_user_id || req.user.id, locked_at: fmtLocal(new Date()) } };
    });
    const result = txn();
    res.status(result.status).json(result.body);
  } catch (e) { sendError(res, 'PUT /api/schedule/daily/actual/:id', e); }
});

// [2026-06-18] 用户系统:supervisor 解锁(让 dispatcher 重新报工)
app.post('/api/schedule/daily/actual/:id/unlock', (req, res) => {
  try {
    const { id } = req.params;
    // [2026-06-20 fix#后端-P2-7] SELECT 权限检查 + UPDATE 包事务,防 TOCTOU
    let unlocked = false;
    const unlockTxn = db.getDb().transaction(() => {
      const row = db.get('SELECT * FROM schedule_daily WHERE id = ?', [id]);
      if (!row) return;
      // [2026-06-18] 仅 admin/supervisor 可解锁;且只能解自己锁的(管理员除外)
      if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return;
      if (req.user.role !== 'admin' && row.locked_by_user_id !== req.user.id) return;
      db.run('UPDATE schedule_daily SET locked_by_user_id = NULL, locked_at = NULL WHERE id = ?', [id]);
      unlocked = true;
    });
    unlockTxn();
    if (!unlocked) {
      const row = db.get('SELECT * FROM schedule_daily WHERE id = ?', [id]);
      if (!row) return res.status(404).json({ error: '记录不存在' });
      if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: '该操作仅限车间主任或管理员' });
      }
      return res.status(403).json({ error: '只能解锁自己锁定的记录' });
    }
    logOp(req, 'schedule_daily', 'unlock_actual', id, '', `unlocked by ${req.user.username}`);
    res.json({ ok: true });
  } catch (e) { sendError(res, 'POST /api/schedule/daily/actual/:id/unlock', e); }
});

// ---------- 仓库管理 ----------
app.get('/api/warehouse/:type/inbound', warehouseTypeGuard, (req, res) => {
  try {
    res.json(db.all('SELECT * FROM warehouse_inbound WHERE warehouse_type = ? ORDER BY inbound_date DESC', [req.params.type]));
  } catch (e) {
    console.error('GET /api/warehouse/inbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/warehouse/:type/inbound', warehouseTypeGuard, (req, res) => {
  try {
    const r = req.body;
    const errors = validateWarehouseRecord(r, req.params.type);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    // 自动生成入库单号（不可手动指定）
    const today = fmtLocal(new Date()).replace(/-/g, '');
    const todayCount = db.get("SELECT COUNT(*) as c FROM warehouse_inbound WHERE order_no LIKE ?", [`RB${today}%`]).c;
    const orderNo = `RB${today}-${String(todayCount + 1).padStart(3, '0')}`;

    const result = db.run(`INSERT INTO warehouse_inbound (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, inbound_date, operator, pot_no, fabric_name, supplier, customer, width, weight, unit, total_pcs, unit2, remark, order_no, loading_qty)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.params.type, r.ref_type || '', r.ref_id, r.style_no, r.color, r.size_spec, r.qty, r.inbound_date, r.operator || '',
       r.pot_no || '', r.fabric_name || '', r.supplier || '', r.customer || '', r.width || '', r.weight || '', r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.remark || '', orderNo, r.loading_qty || 0]);
    updateInventory(req.params.type, r.style_no, r.color, r.size_spec, r.qty, r);
    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
    logOp(req, 'warehouse', 'inbound', null, `${req.params.type} 入库${r.qty}件`);
    res.json({ ok: true, id: result.lastInsertRowid, order_no: orderNo });
  } catch (e) {
    console.error('POST /api/warehouse/inbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/warehouse/:type/outbound', warehouseTypeGuard, (req, res) => {
  try {
    res.json(db.all('SELECT * FROM warehouse_outbound WHERE warehouse_type = ? ORDER BY outbound_date DESC', [req.params.type]));
  } catch (e) {
    console.error('GET /api/warehouse/outbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/warehouse/:type/outbound', warehouseTypeGuard, (req, res) => {
  try {
    const r = req.body;
    const errors = validateWarehouseRecord(r, req.params.type);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    // 自动生成出库单号（不可手动指定）
    const today = fmtLocal(new Date()).replace(/-/g, '');
    const todayCount = db.get("SELECT COUNT(*) as c FROM warehouse_outbound WHERE order_no LIKE ?", [`CB${today}%`]).c;
    const orderNo = `CB${today}-${String(todayCount + 1).padStart(3, '0')}`;

    const txn = db.getDb().transaction(() => {
      const inv = db.get('SELECT current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
        [req.params.type, r.style_no, r.color || '', r.size_spec || '', r.pot_no || '']);
      if (!inv || inv.current_qty < r.qty) {
        throw new Error(`库存不足，当前库存 ${inv ? inv.current_qty : 0}，出库 ${r.qty}`);
      }

      const result = db.run(`INSERT INTO warehouse_outbound (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, outbound_date, operator, pot_no, fabric_name, supplier, customer, width, weight, unit, total_pcs, unit2, remark, order_no)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.params.type, r.ref_type || '', r.ref_id, r.style_no, r.color, r.size_spec, r.qty, r.outbound_date, r.operator || '',
         r.pot_no || '', r.fabric_name || '', r.supplier || '', r.customer || '', r.width || '', r.weight || '', r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.remark || '', orderNo]);
      updateInventory(req.params.type, r.style_no, r.color, r.size_spec, -r.qty, r);
      return result;
    });
    const result = txn();
    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
    logOp(req, 'warehouse', 'outbound', null, `${req.params.type} 出库${r.qty}件`);
    res.json({ ok: true, id: result.lastInsertRowid, order_no: orderNo });
  } catch (e) {
    console.error('POST /api/warehouse/outbound error:', e);
    res.status(400).json({ error: e.message || 'Internal server error' });
  }
});

app.get('/api/warehouse/:type/inventory', warehouseTypeGuard, (req, res) => {
  try {
    const { keyword, in_stock } = req.query;
    let sql = 'SELECT * FROM warehouse_inventory WHERE warehouse_type = ?';
    const params = [req.params.type];
    // [2026-06-20 段13 M-2] 关键字+库存过滤,后端 SQL(替代 WarehouseDetail .filter)
    if (keyword) {
      sql += ` AND (style_no LIKE ? ESCAPE '\\' OR color LIKE ? ESCAPE '\\' OR fabric_name LIKE ? ESCAPE '\\')`;
      const k = `%${escapeLike(keyword)}%`;
      params.push(k, k, k);
    }
    if (in_stock === '1') {
      sql += ' AND current_qty > 0';
    }
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/warehouse/inventory error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 仓库导出 ----------
app.get('/api/warehouse/:type/export', warehouseTypeGuard, async (req, res) => {
  try {
    const whType = req.params.type;
    const sheet = req.query.sheet; // inventory | inbound | outbound | undefined=全部
    const wb = new ExcelJS.Workbook();

    function addHeaders(ws, headers) {
      const row = ws.addRow(headers);
      row.font = { bold: true };
      row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } }; c.border = { style: 'thin' }; });
    }
    function addRow(ws, vals) {
      const row = ws.addRow(vals);
      row.eachCell(c => { c.border = { style: 'thin' }; });
    }

    if (!sheet || sheet === 'inventory') {
      const ws = wb.addWorksheet('库存');
      addHeaders(ws, ['款号', '颜色', '规格', '当前库存', '更新时间']);
      for (const r of db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [whType])) {
        addRow(ws, [r.style_no, r.color, r.size_spec, r.current_qty, r.updated_at || '']);
      }
      [14, 10, 10, 12, 18].forEach((w, i) => ws.getColumn(i + 1).width = w);
    }

    if (!sheet || sheet === 'inbound') {
      const ws = wb.addWorksheet('入库记录');
      addHeaders(ws, ['入库日期', '款号', '颜色', '规格', '数量', '操作人']);
      for (const r of db.all('SELECT * FROM warehouse_inbound WHERE warehouse_type = ? ORDER BY inbound_date DESC', [whType])) {
        addRow(ws, [r.inbound_date, r.style_no, r.color, r.size_spec, r.qty, r.operator]);
      }
      [14, 14, 10, 10, 10, 10].forEach((w, i) => ws.getColumn(i + 1).width = w);
    }

    if (!sheet || sheet === 'outbound') {
      const ws = wb.addWorksheet('出库记录');
      addHeaders(ws, ['出库日期', '款号', '颜色', '规格', '数量', '操作人']);
      for (const r of db.all('SELECT * FROM warehouse_outbound WHERE warehouse_type = ? ORDER BY outbound_date DESC', [whType])) {
        addRow(ws, [r.outbound_date, r.style_no, r.color, r.size_spec, r.qty, r.operator]);
      }
      [14, 14, 10, 10, 10, 10].forEach((w, i) => ws.getColumn(i + 1).width = w);
    }

    const nameMap = { inventory: '库存', inbound: '入库记录', outbound: '出库记录' };
    const whNames = { raw_material: '面料库', auxiliary: '辅料库', cutting_piece: '裁片库', finished: '成品库' };
    const suffix = sheet ? `_${nameMap[sheet]}` : '';
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(whNames[whType] + suffix + '_' + fmtLocal(new Date()).replace(/-/g, '') + '.xlsx')}`);
    res.send(Buffer.from(buf));
  } catch (e) {
    console.error('Warehouse export error:', e);
    res.status(500).json({ error: 'Export failed: ' + e.message });
  }
});

// ---------- 仓库导入 ----------
app.post('/api/warehouse/:type/import', warehouseTypeGuard, (req, res) => {
  try {
    const whType = req.params.type;
    const { records } = req.body;
    if (!records || !records.length) return res.status(400).json({ error: '没有数据' });

    let imported = 0;
    const errors = [];
    const tx = db.getDb().transaction(() => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        try {
          const sheet = r._sheet || '库存';
          const styleNo = r['款号'] || r.style_no || '';
          const color = r['颜色'] || r.color || '';
          const sizeSpec = r['规格'] || r.size_spec || '';

          if (sheet === '库存') {
            const qty = parseInt(r['当前库存'] || r.current_qty) || 0;
            const ex = db.get('SELECT id FROM warehouse_inventory WHERE warehouse_type=? AND style_no=? AND color=? AND size_spec=?', [whType, styleNo, color, sizeSpec]);
            if (ex) db.run('UPDATE warehouse_inventory SET current_qty=? WHERE id=?', [qty, ex.id]);
            else db.run('INSERT INTO warehouse_inventory (warehouse_type,style_no,color,size_spec,current_qty) VALUES (?,?,?,?,?)', [whType, styleNo, color, sizeSpec, qty]);
          } else if (sheet === '入库记录') {
            const qty = parseInt(r['数量'] || r.qty) || 0;
            db.run('INSERT INTO warehouse_inbound (warehouse_type,style_no,color,size_spec,qty,inbound_date,operator) VALUES (?,?,?,?,?,?,?)',
              [whType, styleNo, color, sizeSpec, qty, r['入库日期'] || r.inbound_date || fmtLocal(new Date()), r['操作人'] || r.operator || '']);
            updateInventory(whType, styleNo, color, sizeSpec, qty);
          } else if (sheet === '出库记录') {
            const qty = parseInt(r['数量'] || r.qty) || 0;
            db.run('INSERT INTO warehouse_outbound (warehouse_type,style_no,color,size_spec,qty,outbound_date,operator) VALUES (?,?,?,?,?,?,?)',
              [whType, styleNo, color, sizeSpec, qty, r['出库日期'] || r.outbound_date || fmtLocal(new Date()), r['操作人'] || r.operator || '']);
            updateInventory(whType, styleNo, color, sizeSpec, -qty);
          }
          imported++;
        } catch (e) { errors.push({ row: i + 2, message: e.message }); }
      }
    });
    tx();
    res.json({ ok: true, imported, skipped: 0, errors });
  } catch (e) {
    console.error('Warehouse import error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ============================================================
// ASN 到货通知单（入库流程）
// ============================================================
// 生成 ASN 单号
function genAsnCode() {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const count = db.get("SELECT COUNT(*) as c FROM asn_list WHERE asn_code LIKE ?", [`ASN${d}%`]).c;
  return `ASN${d}${String(count + 1).padStart(3, '0')}`;
}

app.get('/api/asn', (req, res) => {
  try {
    const { warehouse_type, status } = req.query;
    let sql = 'SELECT * FROM asn_list WHERE 1=1';
    const params = [];
    if (warehouse_type) { sql += ' AND warehouse_type = ?'; params.push(warehouse_type); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY id DESC';
    res.json(db.all(sql, params));
  } catch (e) { console.error('GET /api/asn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/asn/:id', (req, res) => {
  try {
    const asn = db.get('SELECT * FROM asn_list WHERE id = ?', [req.params.id]);
    if (!asn) return res.status(404).json({ error: 'Not found' });
    asn.details = db.all('SELECT * FROM asn_detail WHERE asn_id = ?', [asn.id]);
    res.json(asn);
  } catch (e) { console.error('GET /api/asn/:id error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/asn', (req, res) => {
  try {
    const { warehouse_type, supplier, expected_date, details, remark } = req.body;
    if (!warehouse_type) return res.status(400).json({ error: '仓库类型不能为空' });
    let total_qty = 0;
    if (details) details.forEach(d => total_qty += d.plan_qty || 0);

    // [2026-06-20 fix#后端-P2-1] genAsnCode + INSERT 整段包 transaction + UNIQUE 冲突重试,
    // better-sqlite3 同步但 handler 之间会交错;事务保证 SELECT COUNT 和 INSERT 在同一临界区
    let asnCodeFinal = null;
    let asnId = null;
    const insertAsnTxn = db.getDb().transaction(() => {
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = genAsnCode();
        try {
          const r = db.run('INSERT INTO asn_list (asn_code, warehouse_type, supplier, status, expected_date, total_qty, remark, operator) VALUES (?,?,?,?,?,?,?,?)',
            [code, warehouse_type, supplier || '', 'PENDING', expected_date || '', total_qty, remark || '', req.body.operator || 'YC']);
          asnCodeFinal = code;
          asnId = r.lastInsertRowid;
          return;
        } catch (e) {
          // UNIQUE 冲突:asn_code 已被另一并发 handler 占用,重试
          if (e.message && e.message.includes('UNIQUE constraint failed')) { lastErr = e; continue; }
          throw e;
        }
      }
      throw lastErr || new Error('genAsnCode 重试 3 次仍冲突');
    });
    insertAsnTxn();

    if (details && details.length > 0) {
      const insDetail = db.prepare('INSERT INTO asn_detail (asn_id, style_no, fabric_name, color, size_spec, pot_no, plan_qty, unit, remark) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const d of details) {
        insDetail.run(asnId, d.style_no || '', d.fabric_name || '', d.color || '', d.size_spec || '', d.pot_no || '', d.plan_qty || 0, d.unit || '件', d.remark || '');
      }
    }

    logOp(req, 'asn', 'create', asnId, asnCodeFinal);
    res.json({ ok: true, id: asnId, asn_code: asnCodeFinal });
  } catch (e) { console.error('POST /api/asn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/asn/:id/status', (req, res) => {
  try {
    const { status, actual_qty, shortage_qty, damage_qty } = req.body;
    const asn = db.get('SELECT * FROM asn_list WHERE id = ?', [req.params.id]);
    if (!asn) return res.status(404).json({ error: 'Not found' });

    const validTransitions = {
      'PENDING': ['RECEIVED', 'CANCELLED'],
      'RECEIVED': ['INSPECTING', 'COMPLETED'],
      'INSPECTING': ['COMPLETED'],
      'COMPLETED': [],
      'CANCELLED': [],
    };
    if (!validTransitions[asn.status]?.includes(status)) {
      return res.status(400).json({ error: `不能从 ${asn.status} 转换到 ${status}` });
    }

    // [2026-06-20 fix#后端-P2-4] status 变更 + 入库副作用整段包事务,失败可回滚
    const asnTxn = db.getDb().transaction(() => {
      db.run(`UPDATE asn_list SET status = ?, actual_date = datetime('now','localtime') WHERE id = ?`, [status, req.params.id]);

      if (status === 'COMPLETED') {
        // 入库完成：更新库存
        const details = db.all('SELECT * FROM asn_detail WHERE asn_id = ?', [asn.id]);
        for (const d of details) {
          const qty = d.actual_qty || d.plan_qty || 0;
          if (qty > 0) {
            updateInventory(asn.warehouse_type, d.style_no, d.color, d.size_spec, qty, { pot_no: d.pot_no });
            // 写入 inbound 记录
            db.run(`INSERT INTO warehouse_inbound (warehouse_type, style_no, color, size_spec, qty, inbound_date, operator, pot_no, fabric_name, supplier, unit, remark, order_no)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [asn.warehouse_type, d.style_no, d.color, d.size_spec, qty, asn.actual_date || fmtLocal(new Date()), asn.operator, d.pot_no, d.fabric_name, asn.supplier, d.unit, `ASN:${asn.asn_code}`, asn.asn_code]);
          }
        }
        // 更新 ASN 汇总
        const receivedTotal = details.reduce((s, d) => s + (d.actual_qty || d.plan_qty || 0), 0);
        const shortageTotal = details.reduce((s, d) => s + (d.shortage_qty || 0), 0);
        const damageTotal = details.reduce((s, d) => s + (d.damage_qty || 0), 0);
        db.run('UPDATE asn_list SET received_qty = ?, shortage_qty = ?, damage_qty = ? WHERE id = ?',
          [receivedTotal, shortageTotal, damageTotal, asn.id]);
      }
    });
    asnTxn();

    const statusLabels = { PENDING: '待收货', RECEIVED: '已收货', INSPECTING: '质检中', COMPLETED: '已完成', CANCELLED: '已取消' };
    logOp(req, 'asn', status.toLowerCase(), req.params.id, asn.asn_code, statusLabels[status] || status);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/asn/:id/status error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/asn/:id/details', (req, res) => {
  try {
    const { style_no, fabric_name, color, size_spec, pot_no, plan_qty, unit, remark } = req.body;
    const result = db.run('INSERT INTO asn_detail (asn_id, style_no, fabric_name, color, size_spec, pot_no, plan_qty, unit, remark) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.id, style_no || '', fabric_name || '', color || '', size_spec || '', pot_no || '', plan_qty || 0, unit || '件', remark || '']);
    // 更新总数量
    const total = db.get('SELECT SUM(plan_qty) as t FROM asn_detail WHERE asn_id = ?', [req.params.id]);
    db.run('UPDATE asn_list SET total_qty = ? WHERE id = ?', [total?.t || 0, req.params.id]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/asn/:id/details error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/asn/:id', (req, res) => {
  try {
    const asn = db.get('SELECT * FROM asn_list WHERE id = ?', [req.params.id]);
    if (!asn) return res.status(404).json({ error: 'Not found' });
    if (asn.status !== 'PENDING') return res.status(400).json({ error: '只有待收货状态的单据可以删除' });
    db.run('DELETE FROM asn_detail WHERE asn_id = ?', [req.params.id]);
    db.run('DELETE FROM asn_list WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/asn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================================
// DN 发货通知单（出库流程）
// ============================================================
function genDnCode() {
  const now = new Date();
  const d = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
  const count = db.get("SELECT COUNT(*) as c FROM dn_list WHERE dn_code LIKE ?", [`DN${d}%`]).c;
  return `DN${d}${String(count + 1).padStart(3, '0')}`;
}

app.get('/api/dn', (req, res) => {
  try {
    const { warehouse_type, status } = req.query;
    let sql = 'SELECT * FROM dn_list WHERE 1=1';
    const params = [];
    if (warehouse_type) { sql += ' AND warehouse_type = ?'; params.push(warehouse_type); }
    if (status) { sql += ' AND status = ?'; params.push(status); }
    sql += ' ORDER BY id DESC';
    res.json(db.all(sql, params));
  } catch (e) { console.error('GET /api/dn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/dn/:id', (req, res) => {
  try {
    const dn = db.get('SELECT * FROM dn_list WHERE id = ?', [req.params.id]);
    if (!dn) return res.status(404).json({ error: 'Not found' });
    dn.details = db.all('SELECT * FROM dn_detail WHERE dn_id = ?', [dn.id]);
    res.json(dn);
  } catch (e) { console.error('GET /api/dn/:id error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/dn', (req, res) => {
  try {
    const { warehouse_type, customer, ship_date, details, remark } = req.body;
    if (!warehouse_type) return res.status(400).json({ error: '仓库类型不能为空' });
    const dn_code = genDnCode();
    let total_qty = 0;
    if (details) details.forEach(d => total_qty += d.plan_qty || 0);

    const result = db.run('INSERT INTO dn_list (dn_code, warehouse_type, customer, status, ship_date, total_qty, remark, operator) VALUES (?,?,?,?,?,?,?,?)',
      [dn_code, warehouse_type, customer || '', 'PENDING', ship_date || '', total_qty, remark || '', req.body.operator || 'YC']);
    const dnId = result.lastInsertRowid;

    if (details && details.length > 0) {
      const insDetail = db.prepare('INSERT INTO dn_detail (dn_id, style_no, color, size_spec, plan_qty, unit, remark) VALUES (?,?,?,?,?,?,?)');
      for (const d of details) {
        insDetail.run(dnId, d.style_no || '', d.color || '', d.size_spec || '', d.plan_qty || 0, d.unit || '件', d.remark || '');
      }
    }

    logOp(req, 'dn', 'create', dnId, dn_code);
    res.json({ ok: true, id: dnId, dn_code });
  } catch (e) { console.error('POST /api/dn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/dn/:id/status', (req, res) => {
  try {
    const { status, picked_qty, shipped_qty } = req.body;
    const dn = db.get('SELECT * FROM dn_list WHERE id = ?', [req.params.id]);
    if (!dn) return res.status(404).json({ error: 'Not found' });

    const validTransitions = {
      'PENDING': ['PICKING', 'CANCELLED'],
      'PICKING': ['PICKED', 'CANCELLED'],
      'PICKED': ['SHIPPED'],
      'SHIPPED': ['DELIVERED'],
      'DELIVERED': [],
      'CANCELLED': [],
    };
    if (!validTransitions[dn.status]?.includes(status)) {
      return res.status(400).json({ error: `不能从 ${dn.status} 转换到 ${status}` });
    }

    db.run('UPDATE dn_list SET status = ? WHERE id = ?', [status, req.params.id]);

    if (status === 'SHIPPED') {
      // 发货：扣减库存
      const details = db.all('SELECT * FROM dn_detail WHERE dn_id = ?', [dn.id]);
      for (const d of details) {
        const qty = d.shipped_qty || d.picked_qty || d.plan_qty || 0;
        if (qty > 0) {
          updateInventory(dn.warehouse_type, d.style_no, d.color, d.size_spec, -qty);
          db.run(`INSERT INTO warehouse_outbound (warehouse_type, style_no, color, size_spec, qty, outbound_date, operator, remark, order_no)
            VALUES (?,?,?,?,?,?,?,?,?)`,
            [dn.warehouse_type, d.style_no, d.color, d.size_spec, qty, fmtLocal(new Date()), dn.operator, `DN:${dn.dn_code}`, dn.dn_code]);
        }
      }
      const shippedTotal = details.reduce((s, d) => s + (d.shipped_qty || d.plan_qty || 0), 0);
      db.run(`UPDATE dn_list SET shipped_qty = ?, actual_ship_date = datetime('now','localtime') WHERE id = ?`, [shippedTotal, dn.id]);
    }

    if (status === 'DELIVERED') {
      db.run(`UPDATE dn_list SET delivery_date = datetime('now','localtime') WHERE id = ?`, [req.params.id]);
    }

    const statusLabels = { PENDING: '待拣货', PICKING: '拣货中', PICKED: '已拣货', SHIPPED: '已发货', DELIVERED: '已签收', CANCELLED: '已取消' };
    logOp(req, 'dn', status.toLowerCase(), req.params.id, dn.dn_code, statusLabels[status] || status);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/dn/:id/status error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/dn/:id/details', (req, res) => {
  try {
    const { style_no, color, size_spec, plan_qty, unit, remark } = req.body;
    const result = db.run('INSERT INTO dn_detail (dn_id, style_no, color, size_spec, plan_qty, unit, remark) VALUES (?,?,?,?,?,?,?)',
      [req.params.id, style_no || '', color || '', size_spec || '', plan_qty || 0, unit || '件', remark || '']);
    const total = db.get('SELECT SUM(plan_qty) as t FROM dn_detail WHERE dn_id = ?', [req.params.id]);
    db.run('UPDATE dn_list SET total_qty = ? WHERE id = ?', [total?.t || 0, req.params.id]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/dn/:id/details error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/dn/:id', (req, res) => {
  try {
    const dn = db.get('SELECT * FROM dn_list WHERE id = ?', [req.params.id]);
    if (!dn) return res.status(404).json({ error: 'Not found' });
    if (dn.status !== 'PENDING') return res.status(400).json({ error: '只有待拣货状态的单据可以删除' });
    db.run('DELETE FROM dn_detail WHERE dn_id = ?', [req.params.id]);
    db.run('DELETE FROM dn_list WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/dn error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// [fix#5] Inventory update with safety check
function updateInventory(type, styleNo, color, sizeSpec, delta, extra) {
  if (!delta || delta === 0) return;
  const potNo = extra?.pot_no || ''
  // 查找库存记录（按 UNIQUE 约束的 5 个字段匹配,含 pot_no 避免多锅号混淆）
  const existing = db.get('SELECT * FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
    [type, styleNo, color || '', sizeSpec || '', potNo]);
  if (existing) {
    const newQty = existing.current_qty + delta;
    if (newQty < 0) {
      console.warn(`库存不足: ${type}/${styleNo} 当前${existing.current_qty}，出库${Math.abs(delta)}`);
    }
    db.run(`UPDATE warehouse_inventory SET current_qty = ?, updated_at = datetime('now','localtime') WHERE id = ?`,
      [Math.max(0, newQty), existing.id]);
  } else if (delta > 0) {
    try {
      db.run('INSERT INTO warehouse_inventory (warehouse_type, style_no, color, size_spec, current_qty, pot_no, fabric_name, supplier, customer, width, weight, unit, total_pcs, unit2) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [type, styleNo, color || '', sizeSpec || '', delta, potNo, extra?.fabric_name || '', extra?.supplier || '', extra?.customer || '', extra?.width || '', extra?.weight || '', extra?.unit || 'KG', extra?.total_pcs || 0, extra?.unit2 || '匹']);
    } catch (e) {
      // 并发插入时可能冲突，改用 UPDATE
      const fallback = db.get('SELECT * FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ?',
        [type, styleNo, color || '', sizeSpec || '']);
      if (fallback) {
        db.run('UPDATE warehouse_inventory SET current_qty = current_qty + ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?', [delta, fallback.id]);
      }
    }
  }
}

// ============================================================
// 分色分尺码
// ============================================================
app.get('/api/style-color-size', (req, res) => {
  try {
    const { keyword } = req.query;
    let sql = 'SELECT * FROM style_color_size';
    const params = [];
    if (keyword) {
      sql += ' WHERE style_no LIKE ? OR product_name LIKE ? OR color LIKE ?';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw);
    }
    sql += ' ORDER BY order_date DESC, style_no, color, size_spec';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/style-color-size error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/style-color-size', (req, res) => {
  try {
    const r = req.body;
    // [2026-06-19] 裁剪参数必须 ≥ 原单数
    if (parseInt(r.cutting_param) > 0 && parseInt(r.cutting_param) < parseInt(r.plan_qty)) {
      return res.status(400).json({ error: '裁剪参数不能小于原单量' });
    }
    const result = db.run(
      'INSERT INTO style_color_size (order_date, style_no, due_date, product_name, size_spec, color, plan_qty, cutting_param) VALUES (?,?,?,?,?,?,?,?)',
      [r.order_date || '', r.style_no || '', r.due_date || '', r.product_name || '', r.size_spec || '', r.color || '', r.plan_qty || 0, r.cutting_param || r.plan_qty || 0]
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/style-color-size error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/style-color-size/:id', (req, res) => {
  try {
    const r = req.body;
    if (parseInt(r.cutting_param) > 0 && parseInt(r.cutting_param) < parseInt(r.plan_qty)) {
      return res.status(400).json({ error: '裁剪参数不能小于原单量' });
    }
    db.run(
      'UPDATE style_color_size SET order_date=?, style_no=?, due_date=?, product_name=?, size_spec=?, color=?, plan_qty=?, cutting_param=? WHERE id=?',
      [r.order_date || '', r.style_no || '', r.due_date || '', r.product_name || '', r.size_spec || '', r.color || '', r.plan_qty || 0, r.cutting_param || r.plan_qty || 0, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/style-color-size error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/style-color-size/:id', (req, res) => {
  try {
    db.run('DELETE FROM style_color_size WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/style-color-size error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/style-color-size/export', async (req, res) => {
  try {
    const rows = db.all('SELECT * FROM style_color_size ORDER BY order_date DESC, style_no, color, size_spec');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('分色分尺码');
    ws.columns = [
      { header: '订单日期', key: 'order_date', width: 14 },
      { header: '款式', key: 'style_no', width: 24 },
      { header: '交期', key: 'due_date', width: 14 },
      { header: '产品名', key: 'product_name', width: 14 },
      { header: '规格', key: 'size_spec', width: 10 },
      { header: '颜色', key: 'color', width: 18 },
      { header: '原单量', key: 'plan_qty', width: 10 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({
        order_date: r.order_date || '', style_no: r.style_no || '', due_date: r.due_date || '',
        product_name: r.product_name || '', size_spec: r.size_spec || '', color: r.color || '',
        plan_qty: r.plan_qty || 0,
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=style-color-size.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/style-color-size/export error:', e);
    res.status(500).json({ error: '导出失败' });
  }
});

app.post('/api/style-color-size/import', (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !records.length) return res.status(400).json({ error: '没有数据' });
    let imported = 0;
    const tx = db.getDb().transaction(() => {
      for (const r of records) {
        db.run(
          'INSERT INTO style_color_size (order_date, style_no, due_date, product_name, size_spec, color, plan_qty) VALUES (?,?,?,?,?,?,?)',
          [r.order_date || '', r.style_no || '', r.due_date || '', r.product_name || '', r.size_spec || '', r.color || '', r.plan_qty || 0]
        );
        imported++;
      }
    });
    tx();
    logOp(req, 'style_color_size', 'import', null, `导入 ${imported} 条分色分尺码`);
    res.json({ ok: true, imported });
  } catch (e) {
    console.error('POST /api/style-color-size/import error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// 获取装柜数据供仓库选择（款号+锅号联动）
app.get('/api/fabric-loading/options', (req, res) => {
  try {
    const { keyword } = req.query
    let sql = 'SELECT DISTINCT style_no, pot_no, fabric_name, supplier, customer, color, width, weight, unit, loading_qty FROM fabric_loading_list'
    const params = []
    if (keyword) {
      sql += ' WHERE style_no LIKE ? OR pot_no LIKE ? OR fabric_name LIKE ?'
      const kw = `%${keyword}%`
      params.push(kw, kw, kw)
    }
    sql += ' ORDER BY style_no'
    res.json(db.all(sql, params))
  } catch (e) {
    console.error('GET /api/fabric-loading/options error:', e)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ---------- 面料装柜清单 ----------
app.get('/api/fabric-loading', (req, res) => {
  try {
    const { keyword } = req.query;
    let sql = 'SELECT * FROM fabric_loading_list';
    const params = [];
    if (keyword) {
      sql += ' WHERE style_no LIKE ? OR fabric_name LIKE ? OR supplier LIKE ? OR customer LIKE ? OR color LIKE ?';
      const kw = `%${keyword}%`;
      params.push(kw, kw, kw, kw, kw);
    }
    sql += ' ORDER BY id DESC';
    res.json(db.all(sql, params));
  } catch (e) {
    console.error('GET /api/fabric-loading error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/fabric-loading', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const r = req.body;
    const result = db.run(
      `INSERT INTO fabric_loading_list (inbound_date, supplier, customer, style_no, pot_no, fabric_name, width, weight, color, qty, unit, total_pcs, unit2, loading_date, loading_qty, garment_qty, remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [r.inbound_date, r.supplier, r.customer, r.style_no, r.pot_no, r.fabric_name, r.width, r.weight, r.color, r.qty || 0, r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.loading_date, r.loading_qty || 0, r.garment_qty || 0, r.remark]
    );
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/fabric-loading error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/fabric-loading/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const r = req.body;
    const existing = db.get('SELECT id FROM fabric_loading_list WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run(
      `UPDATE fabric_loading_list SET inbound_date=?, supplier=?, customer=?, style_no=?, pot_no=?, fabric_name=?, width=?, weight=?, color=?, qty=?, unit=?, total_pcs=?, unit2=?, loading_date=?, loading_qty=?, remark=? WHERE id=?`,
      [r.inbound_date, r.supplier, r.customer, r.style_no, r.pot_no, r.fabric_name, r.width, r.weight, r.color, r.qty || 0, r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.loading_date, r.loading_qty || 0, r.remark, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/fabric-loading error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/fabric-loading/:id', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    db.run('DELETE FROM fabric_loading_list WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/fabric-loading error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量入库：从面料装柜清单选中多条，一键入库
app.post('/api/fabric-loading/batch-inbound', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请选择要入库的记录' });
    }

    const today = fmtLocal(new Date()).replace(/-/g, '');
    let imported = 0;
    let errors = [];

    const txn = db.getDb().transaction(() => {
      for (const id of ids) {
        const record = db.get('SELECT * FROM fabric_loading_list WHERE id = ?', [id]);
        if (!record) { errors.push(`ID ${id} 不存在`); continue }

        // 检查是否已经入过库
        const existing = db.get(
          "SELECT id FROM warehouse_inbound WHERE ref_type = 'fabric_loading' AND ref_id = ?",
          [id]
        );
        if (existing) { errors.push(`${record.style_no} 已入库`); continue }

        // 生成入库单号
        const count = db.get("SELECT COUNT(*) as c FROM warehouse_inbound WHERE order_no LIKE ?", [`RB${today}%`]).c;
        const orderNo = `RB${today}-${String(count + 1 + imported).padStart(3, '0')}`;

        // 写入入库记录
        db.run(`INSERT INTO warehouse_inbound (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, inbound_date, operator, pot_no, fabric_name, supplier, customer, width, weight, unit, total_pcs, unit2, remark, order_no, loading_qty)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          ['raw_material', 'fabric_loading', id, record.style_no || '', record.color || '', '', record.qty || 0,
           record.inbound_date || fmtLocal(new Date()), '', record.pot_no || '', record.fabric_name || '',
           record.supplier || '', record.customer || '', record.width || '', record.weight || '',
           record.unit || 'KG', record.total_pcs || 0, record.unit2 || '匹', record.remark || '', orderNo, record.loading_qty || 0]);

        // 更新库存
        updateInventory('raw_material', record.style_no, record.color, '', record.qty || 0, record);

        imported++;
      }
    });
    txn();

    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', ['raw_material']));
    logOp(req, 'warehouse', 'batch_inbound', null, `批量入库 ${imported} 条`);

    res.json({ ok: true, imported, errors });
  } catch (e) {
    console.error('POST /api/fabric-loading/batch-inbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/fabric-loading/export', async (req, res) => {
  try {
    const rows = db.all('SELECT * FROM fabric_loading_list ORDER BY id');
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('面料装柜清单');
    ws.columns = [
      { header: '入库日期', key: 'inbound_date', width: 14 },
      { header: '供应商', key: 'supplier', width: 14 },
      { header: '客户', key: 'customer', width: 14 },
      { header: '款号', key: 'style_no', width: 22 },
      { header: '锅号', key: 'pot_no', width: 16 },
      { header: '面料名称', key: 'fabric_name', width: 24 },
      { header: '幅宽', key: 'width', width: 10 },
      { header: '克重', key: 'weight', width: 10 },
      { header: '颜色', key: 'color', width: 18 },
      { header: '数量', key: 'qty', width: 10 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '总匹数', key: 'total_pcs', width: 10 },
      { header: '单位2', key: 'unit2', width: 8 },
      { header: '装柜日期', key: 'loading_date', width: 14 },
      { header: '装柜数量', key: 'loading_qty', width: 12 },
      { header: '成衣计划数量', key: 'garment_qty', width: 12 },
      { header: '备注', key: 'remark', width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      ws.addRow({
        inbound_date: r.inbound_date || '', supplier: r.supplier || '', customer: r.customer || '',
        style_no: r.style_no || '', pot_no: r.pot_no || '', fabric_name: r.fabric_name || '',
        width: r.width || '', weight: r.weight || '', color: r.color || '',
        qty: r.qty || 0, unit: r.unit || 'KG', total_pcs: r.total_pcs || 0,
        unit2: r.unit2 || '匹', loading_date: r.loading_date || '', loading_qty: r.loading_qty || 0,
        garment_qty: r.garment_qty || 0, remark: r.remark || '',
      });
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=fabric-loading-list.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('GET /api/fabric-loading/export error:', e);
    res.status(500).json({ error: '导出失败' });
  }
});

app.post('/api/fabric-loading/import', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  try {
    const { records } = req.body;
    if (!records || !records.length) return res.status(400).json({ error: '没有数据' });
    let imported = 0;
    const tx = db.getDb().transaction(() => {
      for (const r of records) {
        db.run(
          `INSERT INTO fabric_loading_list (inbound_date, supplier, customer, style_no, pot_no, fabric_name, width, weight, color, qty, unit, total_pcs, unit2, loading_date, loading_qty, garment_qty, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.inbound_date, r.supplier, r.customer, r.style_no, r.pot_no, r.fabric_name, r.width, r.weight, r.color, r.qty || 0, r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.loading_date, r.loading_qty || 0, r.garment_qty || 0, r.remark]
        );
        imported++;
      }
    });
    tx();
    res.json({ ok: true, imported });
  } catch (e) {
    console.error('POST /api/fabric-loading/import error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
  }
});

// ---------- 产能配置 ----------
app.get('/api/config/capacity', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM capacity_config'));
  } catch (e) {
    console.error('GET /api/config/capacity error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/config/capacity/:id', (req, res) => {
  try {
    const c = req.body;
    const existing = db.get('SELECT id FROM capacity_config WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('UPDATE capacity_config SET daily_capacity = ?, unit = ? WHERE id = ?', [c.daily_capacity, c.unit, req.params.id]);
    broadcastSection('capacityConfig', db.all('SELECT * FROM capacity_config'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/config/capacity error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/config/system', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM system_config'));
  } catch (e) {
    console.error('GET /api/config/system error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// [fix#9] Accept both configValue and config_value
app.put('/api/config/system/:key', requireRole('admin', 'planning_manager'), (req, res) => {
  try {
    const value = req.body.configValue ?? req.body.config_value;
    if (value === undefined) return res.status(400).json({ error: '参数值不能为空' });
    db.run('UPDATE system_config SET config_value = ? WHERE config_key = ?', [String(value), req.params.key]);
    invalidateSystemConfig();  // [段7 C-1] 刷新缓存
    broadcastSection('systemConfig', db.all('SELECT * FROM system_config'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/config/system error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 工作日历
// ============================================================
app.get('/api/work-modes', (req, res) => {
  try { res.json(db.all('SELECT * FROM work_modes ORDER BY id')); }
  catch (e) { console.error('GET /api/work-modes error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/work-modes', (req, res) => {
  try {
    const { name, working_hours, shifts } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    const result = db.run('INSERT INTO work_modes (name, working_hours, shifts) VALUES (?,?,?)',
      [name, working_hours || 8, JSON.stringify(shifts || ['08:00-17:00'])]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/work-modes error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/work-modes/:id', (req, res) => {
  try { db.run('DELETE FROM work_modes WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/work-modes error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/work-calendars', (req, res) => {
  try { res.json(db.all('SELECT * FROM work_calendars ORDER BY priority DESC')); }
  catch (e) { console.error('GET /api/work-calendars error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/work-calendars', (req, res) => {
  try {
    const { name, work_mode_id, work_days, start_date, end_date, priority } = req.body;
    if (!name) return res.status(400).json({ error: '名称不能为空' });
    const result = db.run('INSERT INTO work_calendars (name, work_mode_id, work_days, start_date, end_date, priority, enabled) VALUES (?,?,?,?,?,?,1)',
      [name, work_mode_id, work_days || '1111100', start_date, end_date, priority || 0]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/work-calendars error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/work-calendars/:id', (req, res) => {
  try {
    const { name, work_mode_id, work_days, start_date, end_date, priority, enabled } = req.body;
    db.run('UPDATE work_calendars SET name=?, work_mode_id=?, work_days=?, start_date=?, end_date=?, priority=?, enabled=? WHERE id=?',
      [name, work_mode_id, work_days, start_date, end_date, priority || 0, enabled !== undefined ? enabled : 1, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/work-calendars error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/work-calendars/:id', (req, res) => {
  try {
    db.run('DELETE FROM calendar_exceptions WHERE calendar_id = ?', [req.params.id]);
    db.run('DELETE FROM work_calendars WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('DELETE /api/work-calendars error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.get('/api/work-calendars/:id/exceptions', (req, res) => {
  try { res.json(db.all('SELECT * FROM calendar_exceptions WHERE calendar_id = ? ORDER BY exception_date', [req.params.id])); }
  catch (e) { console.error('GET /api/exceptions error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/work-calendars/:id/exceptions', (req, res) => {
  try {
    const { exception_date, is_workday, remark } = req.body;
    if (!exception_date) return res.status(400).json({ error: '日期不能为空' });
    db.run('INSERT OR REPLACE INTO calendar_exceptions (calendar_id, exception_date, is_workday, remark) VALUES (?,?,?,?)',
      [req.params.id, exception_date, is_workday ? 1 : 0, remark || '']);
    res.json({ ok: true });
  } catch (e) { console.error('POST /api/exceptions error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/work-calendars/:calendarId/exceptions/:exceptionId', (req, res) => {
  try { db.run('DELETE FROM calendar_exceptions WHERE id = ? AND calendar_id = ?', [req.params.exceptionId, req.params.calendarId]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/exceptions error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 判断某天是否工作日（前端可用）
app.get('/api/workday-check', (req, res) => {
  try {
    const { date } = req.query;
    if (!date) return res.status(400).json({ error: '日期不能为空' });
    res.json({ date, isWorkday: db.isWorkday(date) });
  } catch (e) { console.error('GET /api/workday-check error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// ============================================================
// 甘特图字段配置
// ============================================================
app.get('/api/config/gantt', (req, res) => {
  try {
    const rows = db.all('SELECT * FROM gantt_field_config');
    const result = {};
    for (const r of rows) {
      result[r.schedule_type] = {
        barFields: JSON.parse(r.bar_fields || '[]'),
        tooltipFields: JSON.parse(r.tooltip_fields || '[]'),
        leftFields: JSON.parse(r.left_fields || '[]'),
      };
    }
    res.json(result);
  } catch (e) {
    console.error('GET /api/config/gantt error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/config/gantt/:type', (req, res) => {
  try {
    const { barFields, tooltipFields, leftFields } = req.body;
    const existing = db.get('SELECT id FROM gantt_field_config WHERE schedule_type = ?', [req.params.type]);
    if (!existing) {
      db.run('INSERT INTO gantt_field_config (schedule_type, bar_fields, tooltip_fields, left_fields) VALUES (?,?,?,?)',
        [req.params.type, JSON.stringify(barFields || []), JSON.stringify(tooltipFields || []), JSON.stringify(leftFields || [])]);
    } else {
      db.run(`UPDATE gantt_field_config SET bar_fields=?, tooltip_fields=?, left_fields=?, updated_at=datetime('now','localtime') WHERE schedule_type=?`,
        [JSON.stringify(barFields || []), JSON.stringify(tooltipFields || []), JSON.stringify(leftFields || []), req.params.type]);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/config/gantt error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// 操作日志
// ============================================================
app.get('/api/logs', (req, res) => {
  try {
    const { module: mod, action, operator, page = 1, pageSize = 50 } = req.query;
    let sql = 'SELECT * FROM operation_logs WHERE 1=1';
    const params = [];
    // [2026-06-18] 非管理员只看自己的日志;admin 看全部
    if (req.user.role !== 'admin') {
      sql += ' AND user_id = ?';
      params.push(req.user.id);
    }
    if (mod) { sql += ' AND module = ?'; params.push(mod); }
    if (action) { sql += ' AND action = ?'; params.push(action); }
    if (operator) { sql += ' AND operator = ?'; params.push(operator); }
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = db.get(countSql, params).total;
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));
    const rows = db.all(sql, params);
    res.json({ rows, total, page: Number(page), pageSize: Number(pageSize) });
  } catch (e) {
    console.error('GET /api/logs error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// SOCKET.IO [fix#17]
// ============================================================
const httpServer = createServer(app);
const io = new SocketIO(httpServer, {
  cors: { origin: ALLOWED_ORIGINS.includes('*') ? '*' : ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  pingInterval: 25000,
  pingTimeout: 10000,
});

// [2026-06-18] Socket.IO 鉴权: 共享 express-session 中间件,从 cookie 读 session
// 之前用 Bearer token 校验,前端 useWebSocket 没传 token → 一直断
// 现在跟 axios 一样靠 session cookie,免去前端额外配置
io.engine.use(session({
  store: sessionStore,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    // [fix 2026-06-20 S-2] 同步修复 socket.io session cookie
    secure: process.env.HTTPS === 'true',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

if (AUTH_ENABLED) {
  io.use((socket, next) => {
    const session = socket.request.session;
    if (session && session.user) return next();
    // 也接受 Bearer token(供外部工具/CLI 调用)
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    // [2026-06-20 fix#后端-P2-6] 用 timingSafeEqual 防时序攻击泄露 token 长度
    if (typeof token === 'string' && token.length === API_TOKEN.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(API_TOKEN))) return next();
    return next(new Error('Unauthorized'));
  });
}

// [fix#13] Safe broadcast
// [2026-06-20 fix#后端-P2-8] 在线用户 Map,O(1) 查询代替 io.sockets.sockets 全扫
const __onlineUsers = new Map();

// [2026-06-20 fix#后端-P2-3] section 名白名单 + 字符限制,防 req.params 污染 broadcast section
const ALLOWED_BROADCAST_SECTIONS = new Set([
  'styles', 'productionLines', 'mainPlan', 'actual', 'warehouse', 'capacityConfig',
  'systemConfig', 'dailyReports', 'inventory', 'schedule_cutting', 'schedule_sewing',
  'schedule_printing', 'schedule_embroidery', 'schedule_ironing', 'schedule_template',
  'schedule_secondary', 'asn', 'dn', 'users',
]);
function broadcastSection(section, data) {
  try {
    if (!ALLOWED_BROADCAST_SECTIONS.has(section)) {
      console.error(`[broadcastSection] 拒绝未知 section: ${section}`);
      return;
    }
    io.emit('sectionUpdate', { section, data });
  } catch (e) {
    console.error('broadcastSection error:', e);
  }
}

io.on('connection', (socket) => {
  console.log(`🔗 用户连接: ${socket.id}`);

  socket.emit('initData', db.getFullData());

  // [2026-06-20 fix#后端-P2-8] 维护 userName Map,避免 Array.from 全扫(高并发下 O(N))
  socket.on('join', (userName) => {
    socket.userName = userName || '匿名';
    __onlineUsers.set(socket.id, socket.userName);
    io.emit('userList', Array.from(__onlineUsers.values()));
  });

  socket.on('disconnect', () => {
    console.log(`🔌 用户断开: ${socket.id}`);
    __onlineUsers.delete(socket.id);
    io.emit('userList', Array.from(__onlineUsers.values()));
  });
});

// ---------- 日报 ----------
app.get('/api/daily', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM daily_reports ORDER BY date DESC'));
  } catch (e) {
    console.error('GET /api/daily error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/daily', (req, res) => {
  try {
    const r = req.body;
    if (!r.styleNo) return res.status(400).json({ error: '款号不能为空' });
    const result = db.run('INSERT INTO daily_reports (date, workshop, style_no, color, plan_qty, actual_qty, remark) VALUES (?,?,?,?,?,?,?)',
      [r.date, r.workshop || '', r.styleNo, r.color || '', r.planQty || 0, r.actualQty || 0, r.remark || '']);
    logOp(req, 'daily_reports', 'create', result.lastInsertRowid, r.styleNo, `plan=${r.planQty || 0} actual=${r.actualQty || 0}`);
    broadcastSection('dailyReports', db.all('SELECT * FROM daily_reports ORDER BY date DESC'));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/daily error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 库存 ----------
app.get('/api/inventory', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM inventory_snapshots ORDER BY date DESC'));
  } catch (e) {
    console.error('GET /api/inventory error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/inventory', (req, res) => {
  try {
    const r = req.body;
    if (!r.styleNo) return res.status(400).json({ error: '款号不能为空' });
    const result = db.run('INSERT INTO inventory_snapshots (date, style_no, color, qty, location, remark) VALUES (?,?,?,?,?,?)',
      [r.date, r.styleNo, r.color || '', r.qty || 0, r.location || '', r.remark || '']);
    broadcastSection('inventory', db.all('SELECT * FROM inventory_snapshots ORDER BY date DESC'));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/inventory error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 目视化排程 ----------
app.get('/api/visual-schedule/gantt', (req, res) => {
  try {
    // 先加载所有车间和产线
    const allWorkshops = db.all('SELECT * FROM workshops ORDER BY sort_order');
    for (const ws of allWorkshops) {
      ws.lines = db.all('SELECT * FROM production_lines WHERE workshop_id = ? ORDER BY sort_order', [ws.id]);
    }

    // 加载所有缝制排程数据
    // [2026-06-20 fix#业务-P1-7] 支持 ?from=&to= 分片,限制 plan_start 在区间内
    //   不传时保持原行为(全表);传了时走 WHERE,避免 50 条产线 * 1 年数据全量返回
    const { from, to } = req.query;
    let ganttWhere = "sm.schedule_type = 'sewing'";
    const ganttParams = [];
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { ganttWhere += ' AND sm.plan_start >= ?'; ganttParams.push(from); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to))   { ganttWhere += ' AND sm.plan_start <= ?'; ganttParams.push(to); }
    const allTasks = db.all(`SELECT sm.id as planId, sm.style_no as styleNo,
      sm.product_name as productName, sm.color, sm.size_spec as sizeSpec,
      sm.plan_qty as planQty, sm.plan_start as sewingStart, sm.plan_end as sewingEnd,
      sm.workshop, sm.line_team
      FROM schedule_master sm WHERE ${ganttWhere}
      ORDER BY sm.workshop, sm.line_team, sm.plan_start`, ganttParams);

    // 按 workshop+line_team 建索引（schedule_master 中 line_team 是纯数字如 "20"，line_name 是 "20班"）
    // 车间名映射：一车间→1, 二车间→2, 三车间→3, 四车间→4, 五车间→5
    const wsNameMap = { '一车间': '1', '二车间': '2', '三车间': '3', '四车间': '4', '五车间': '5' }
    const taskIndex = {}
    for (const t of allTasks) {
      const wsNorm = wsNameMap[t.workshop] || t.workshop || ''
      const key = wsNorm + '|' + (t.line_team || '')
      if (!taskIndex[key]) taskIndex[key] = []
      taskIndex[key].push(t)
    }

    // 加载所有产线的款式分类
    const allCats = db.all('SELECT * FROM line_style_categories ORDER BY line_id, sort_order');
    const catIndex = {}
    for (const c of allCats) {
      if (!catIndex[c.line_id]) catIndex[c.line_id] = []
      catIndex[c.line_id].push({ name: c.name })
    }

    // 以车间产线为骨架，关联排程数据和分类
    const workshops = allWorkshops.map(ws => ({
      name: ws.name,
      lines: ws.lines.map(line => {
        const lineNum = stripLineSuffix(line.line_name)  // [B-12 fix]
        const key = ws.name + '|' + lineNum
        return {
          name: line.line_name,
          status: line.status,
          dailyOutput: line.daily_output || 0,
          categories: catIndex[line.id] || [],
          tasks: taskIndex[key] || []
        }
      })
    }))

    // 未排班项：main_plan 中尚未排程的（JOIN styles 获取颜色/规格）
    const unscheduled = db.all(`SELECT mp.id as planId, mp.style_no as styleNo, mp.product_name as productName,
      s.color, s.size_spec as sizeSpec, mp.plan_qty as planQty, mp.due_date as dueDate
      FROM main_plan mp
      LEFT JOIN styles s ON mp.style_id = s.id
      WHERE mp.is_scheduled = 0 OR mp.is_scheduled IS NULL
      ORDER BY mp.due_date`);
    // 工作日历：返回当前启用的工作日模式
    const cal = db.get('SELECT work_days, start_date, end_date FROM work_calendars WHERE enabled = 1 ORDER BY priority DESC LIMIT 1');
    const workDays = cal ? cal.work_days : '1111100' // 默认周一~周五
    res.json({ workshops, unscheduled, workDays });
  } catch (e) {
    console.error('GET /api/visual-schedule/gantt error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/visual-schedule/date-range', (req, res) => {
  try {
    const min = db.get("SELECT MIN(plan_start) as d FROM schedule_master WHERE schedule_type = 'sewing' AND plan_start != ''");
    const max = db.get("SELECT MAX(plan_end) as d FROM schedule_master WHERE schedule_type = 'sewing' AND plan_end != ''");
    const start = min?.d || '2026-06-01';
    const end = max?.d || '2026-08-31';
    res.json({ start, end });
  } catch (e) {
    console.error('GET /api/visual-schedule/date-range error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/visual-schedule/assign', (req, res) => {
  try {
    const { planId, workshop, lineTeam } = req.body;
    if (!planId || !workshop || !lineTeam) return res.status(400).json({ error: '参数不完整' });
    const plan = db.get('SELECT * FROM main_plan WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: '计划不存在' });
    if (plan.is_scheduled) return res.status(400).json({ error: '该计划已排班' });
    const lineNum = stripLineSuffix(lineTeam)  // [B-12 fix] 用 helper 替代散落 .replace

    // 查产线日产量(优先用完整 line_name,fallback 拼"班"后缀)
    const lineId = db.get(
      'SELECT id FROM production_lines WHERE line_name IN (?, ?)',
      [lineTeam, lineNameWithSuffix(lineNum)]
    );
    let dailyTarget = 0;
    if (lineId) {
      const cat = db.get('SELECT daily_output FROM line_style_categories WHERE line_id = ? ORDER BY sort_order LIMIT 1', [lineId.id]);
      dailyTarget = cat?.daily_output || 0;
    }

    // 查该产线最后一个任务的结束日期，新任务排在后面
    const lastTask = db.get(`SELECT plan_end FROM schedule_master
      WHERE schedule_type = 'sewing' AND workshop = ? AND line_team = ?
      ORDER BY plan_end DESC LIMIT 1`, [workshop, lineNum])

    const today = fmtLocal(new Date())
    // 无任务产线从明天开始（当天排不上）
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = fmtLocal(tomorrow)
    let sewingStart = tomorrowStr
    // 有任务则排在最后任务之后
    if (lastTask && lastTask.plan_end) {
      const nextDay = new Date(lastTask.plan_end + 'T00:00:00')
      nextDay.setDate(nextDay.getDate() + 1)
      const nextDayStr = fmtLocal(nextDay)
      if (nextDayStr > tomorrowStr) sewingStart = nextDayStr
    }

    // 计算下线时间：计划数量 / 日产量（向上取整）
    let sewingEnd = sewingStart
    if (dailyTarget > 0 && plan.plan_qty > 0) {
      const daysNeeded = Math.ceil(plan.plan_qty / dailyTarget)
      sewingEnd = db.addWorkdays(sewingStart, daysNeeded - 1) // start算第1天
    }

    // 更新 main_plan
    db.run('UPDATE main_plan SET workshop = ?, line_team = ?, is_scheduled = 1, sewing_start = ?, sewing_end = ? WHERE id = ?',
      [workshop, lineNum, sewingStart, sewingEnd, planId]);

    // 查款式数据，插入 schedule_master
    const style = db.get('SELECT * FROM styles WHERE style_no = ? LIMIT 1', [plan.style_no]);
    if (style && sewingStart <= sewingEnd) {
      db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, color, size_spec,
        plan_qty, plan_start, plan_end, workshop, line_team, daily_target, cutting_plan_qty, due_date)
        VALUES ('sewing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [style.id, plan.style_no, plan.product_name, style.color || '', style.size_spec || '',
         plan.plan_qty, sewingStart, sewingEnd, workshop, lineNum, dailyTarget, plan.plan_qty, plan.due_date || '']);
    }
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true, sewingStart, sewingEnd, dailyTarget });
  } catch (e) {
    console.error('POST /api/visual-schedule/assign error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/visual-schedule/unassign', (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: '参数不完整' });
    // planId 是 schedule_master.id，先取出 style_id
    const sm = db.get('SELECT style_id FROM schedule_master WHERE id = ?', [planId]);
    if (sm && sm.style_id) {
      // 更新 main_plan：清除车间/班组，标记未排
      db.run('UPDATE main_plan SET workshop = ?, line_team = ?, is_scheduled = 0 WHERE style_id = ?', ['', '', sm.style_id]);
    }
    // 删除 schedule_master 记录
    // [2026-06-20 fix#后端-P2-5/业务-P2-7] 先删 daily 避免孤儿
    db.run('DELETE FROM schedule_daily WHERE master_id = ?', [planId]);
    db.run('DELETE FROM schedule_master WHERE id = ?', [planId]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/visual-schedule/unassign error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 移动排班：从旧产线移到新产线（取消旧排班 + 在新产线重新排）
app.post('/api/visual-schedule/move', (req, res) => {
  try {
    const { scheduleId, newWorkshop, newLineTeam } = req.body;
    if (!scheduleId || !newWorkshop || !newLineTeam) return res.status(400).json({ error: '参数不完整' });
    // 查原排程记录
    const sm = db.get('SELECT * FROM schedule_master WHERE id = ?', [scheduleId]);
    if (!sm) return res.status(404).json({ error: '排程记录不存在' });
    const newLineNum = stripLineSuffix(newLineTeam);  // [B-12 fix]
    // 查新产线日产量(优先用完整 line_name,fallback 拼"班"后缀)
    const lineId = db.get(
      'SELECT id FROM production_lines WHERE line_name IN (?, ?)',
      [newLineTeam, lineNameWithSuffix(newLineNum)]
    );
    let dailyTarget = 0;
    if (lineId) {
      const cat = db.get('SELECT daily_output FROM line_style_categories WHERE line_id = ? ORDER BY sort_order LIMIT 1', [lineId.id]);
      dailyTarget = cat?.daily_output || 0;
    }
    // 查新产线最后一个任务的结束日期
    const lastTask = db.get(`SELECT plan_end FROM schedule_master
      WHERE schedule_type = 'sewing' AND workshop = ? AND line_team = ?
      ORDER BY plan_end DESC LIMIT 1`, [newWorkshop, newLineNum]);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = fmtLocal(tomorrow);
    let sewingStart = tomorrowStr;
    if (lastTask && lastTask.plan_end) {
      const nextDay = new Date(lastTask.plan_end + 'T00:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      const nextDayStr = fmtLocal(nextDay);
      if (nextDayStr > tomorrowStr) sewingStart = nextDayStr;
    }
    // 计算下线时间
    let sewingEnd = sewingStart;
    if (dailyTarget > 0 && sm.plan_qty > 0) {
      const daysNeeded = Math.ceil(sm.plan_qty / dailyTarget);
      sewingEnd = db.addWorkdays(sewingStart, daysNeeded - 1);
    }
    // P0 安全: DELETE+INSERT+UPDATE 包事务,失败回滚避免丢数据
    const moveTxn = db.getDb().transaction(() => {
      // [2026-06-20 fix#后端-P2-5/业务-P2-7] 先删 daily 避免孤儿
      db.run('DELETE FROM schedule_daily WHERE master_id = ?', [scheduleId]);
      db.run('DELETE FROM schedule_master WHERE id = ?', [scheduleId]);
      if (sewingStart <= sewingEnd) {
        db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, color, size_spec,
          plan_qty, plan_start, plan_end, workshop, line_team, daily_target, cutting_plan_qty, due_date)
          VALUES ('sewing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [sm.style_id, sm.style_no, sm.product_name, sm.color || '', sm.size_spec || '',
           sm.plan_qty, sewingStart, sewingEnd, newWorkshop, newLineNum, dailyTarget, sm.plan_qty, sm.due_date || '']);
      }
      db.run('UPDATE main_plan SET workshop = ?, line_team = ?, sewing_start = ?, sewing_end = ? WHERE style_id = ?',
        [newWorkshop, newLineNum, sewingStart, sewingEnd, sm.style_id]);
    });
    moveTxn();
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true, sewingStart, sewingEnd, dailyTarget });
  } catch (e) {
    console.error('POST /api/visual-schedule/move error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================
// GLOBAL ERROR HANDLER [fix#12]
// ============================================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// [2026-06-19] SPA catch-all: 兜底非 /api/ 请求返 index.html(vue-router hash 模式实际很少触发,但防 history 模式 + 直刷新)
// 排除 /api /socket.io /assets /node_modules 等已知前缀
app.get(/^\/(?!api|socket\.io|assets|node_modules|favicon\.ico).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// [2026-06-19] 健康检查: UptimeRobot / CI smoke test 用
// 必须放在所有 catch-all 之前,否则会落到 SPA fallback
// /api/health 在两个 auth 中间件(line 524/540)已加 /health 豁免,免登录访问
app.get('/api/health', (req, res) => {
  try {
    const row = db.get('SELECT 1 AS ok');
    res.json({
      ok: !!(row && row.ok === 1),
      ts: Date.now(),
      uptime: process.uptime(),
      auth: AUTH_ENABLED,
      node_env: process.env.NODE_ENV || 'development',
    });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'db unavailable' });
  }
});

// ============================================================
// 全局异常兜底 [批次1-后端-P0-1]
// ============================================================
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason && reason.stack ? reason.stack : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.stack ? err.stack : err);
  // 已知致命错误(如 DB 文件被删/磁盘满)→ 进程退出由 PM2/systemd 重启
  // 这里不主动 process.exit,避免与连接清理冲突
});

// [2026-06-20 批次2-业务-P0-2] 锁超时自动清理
// supervisor 锁了 schedule_daily 行后,如果浏览器崩溃 / 离职 / 忘解锁 → dispatcher 永远报不进去
// 方案:每 5 分钟扫描一次,锁定时间 > 2 小时的锁自动释放
// 注:locked_at 是 'YYYY-MM-DD HH:mm:ss' 字符串,SQLite 字符串比较能正确工作
// [2026-06-20 fix#后端-P1-1] .unref() 防止阻塞 Node 优雅退出
const LOCK_TIMEOUT_HOURS = 2;
const LOCK_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  try {
    const result = db.run(
      `UPDATE schedule_daily
         SET locked_by_user_id = NULL, locked_at = NULL
       WHERE locked_at IS NOT NULL
         AND locked_at < datetime('now','localtime', ?)`,
      [`-${LOCK_TIMEOUT_HOURS} hours`]
    );
    if (result.changes > 0) {
      console.log(`[lock-cleanup] 自动释放 ${result.changes} 条过期锁`);
      // 通知所有客户端:锁变化
      try {
        const daily = db.all("SELECT * FROM schedule_daily WHERE locked_by_user_id IS NOT NULL");
        broadcastSection('schedule_sewing', daily);
      } catch (_) { /* 广播失败不影响主路径 */ }
    }
  } catch (e) {
    console.error('[lock-cleanup] error:', e && e.message);
  }
}, LOCK_CLEANUP_INTERVAL_MS).unref();  // 不阻止进程退出

// ============================================================
// START
// ============================================================
httpServer.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║  制衣工厂生产排程系统 V2                  ║
  ║  Server: http://localhost:${PORT}           ║
  ║  WebSocket: ws://localhost:${PORT}          ║
  ║  Auth: ${AUTH_ENABLED ? 'ENABLED' : 'DISABLED'}                      ║
  ╚══════════════════════════════════════════╝
  `);
});
