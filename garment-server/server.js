const express = require('express');
const { createServer } = require('http');
const { Server: SocketIO } = require('socket.io');
const path = require('path');
const db = require('./db');
const ExcelJS = require('exceljs');

const PORT = process.env.PORT || 3001;
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const API_TOKEN = process.env.API_TOKEN || 'garment-dev-token';

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

// ============================================================
// INIT
// ============================================================
db.init();

if (!AUTH_ENABLED) {
  console.warn('⚠️  WARNING: Authentication is DISABLED. Set AUTH_ENABLED=true for production.');
}
if (API_TOKEN === 'garment-dev-token') {
  console.warn('⚠️  WARNING: Using default API_TOKEN. Set API_TOKEN env var for production.');
}

// ============================================================
// EXPRESS SETUP
// ============================================================
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Simple token auth [fix#2]
if (AUTH_ENABLED) {
  app.use('/api', (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token !== API_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  });
}

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
  return errors;
}

function validateMainPlan(p) {
  const errors = [];
  if (!p.style_no || !p.style_no.trim()) errors.push('款号不能为空');
  if (p.style_no && p.style_no.length > 50) errors.push('款号长度不能超过50');
  if (!p.due_date) errors.push('交期不能为空');
  if (p.plan_qty !== undefined && (isNaN(p.plan_qty) || p.plan_qty < 0)) errors.push('计划数量必须为非负数');
  return errors;
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

// Handle unique constraint violations with 409
function handleUniqueError(e, res) {
  if (e.message && e.message.includes('UNIQUE constraint failed')) {
    return res.status(409).json({ error: '记录已存在（唯一约束冲突）' });
  }
  return res.status(500).json({ error: 'Internal server error' });
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
    db.logOperation('styles', 'import', null, `导入${imported}条`);
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

app.post('/api/styles', (req, res) => {
  try {
    const s = req.body;
    const errors = validateStyle(s);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    if (s.id) {
      const existing = db.get('SELECT id FROM styles WHERE id = ?', [s.id]);
      if (!existing) return res.status(404).json({ error: '款式不存在' });
      db.run(`UPDATE styles SET style_no=?,product_name=?,style_category=?,fabric_code=?,plan_qty=?,due_date=?,order_date=?,embroidery=?,embroidery_daily_output=?,printing=?,printing_daily_output=?,ironing_label=?,ironing_daily_output=?,template=?,template_daily_output=?,tt_time=?,target_daily_output=?,remarks=? WHERE id=?`,
        [s.style_no, s.product_name, s.style_category||'', s.fabric_code, s.plan_qty, s.due_date, s.order_date||'', s.embroidery||'', s.embroidery_daily_output||0, s.printing||'', s.printing_daily_output||0, s.ironing_label||'', s.ironing_daily_output||0, s.template||'', s.template_daily_output||0, s.tt_time||'', s.target_daily_output||0, s.remarks||'', s.id]);
      broadcastSection('styles', db.searchStyles(''));
      db.logOperation('styles', 'update', s.id, s.style_no);
      return res.json({ ok: true, id: s.id });
    }
    const result = db.run(`INSERT INTO styles (style_no, product_name, style_category, fabric_code, plan_qty, due_date, order_date, embroidery, embroidery_daily_output, printing, printing_daily_output, ironing_label, ironing_daily_output, template, template_daily_output, tt_time, target_daily_output, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.style_no, s.product_name, s.style_category||'', s.fabric_code, s.plan_qty || 0, s.due_date, s.order_date||'', s.embroidery||'', s.embroidery_daily_output||0, s.printing||'', s.printing_daily_output||0, s.ironing_label||'', s.ironing_daily_output||0, s.template||'', s.template_daily_output||0, s.tt_time||'', s.target_daily_output||0, s.remarks||'']);
    broadcastSection('styles', db.searchStyles(''));
    db.logOperation('styles', 'create', result.lastInsertRowid, s.style_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/styles error:', e);
    handleUniqueError(e, res);
  }
});

app.delete('/api/styles/:id', (req, res) => {
  try {
    const existing = db.get('SELECT id FROM styles WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM styles WHERE id = ?', [req.params.id]);
    broadcastSection('styles', db.searchStyles(''));
    db.logOperation('styles', 'delete', req.params.id, '');
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
      db.logOperation('production_lines', 'status_change', req.params.id, existing.line_name, `${oldStatus}→${status}`);
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
    res.json(db.all('SELECT * FROM main_plan'));
  } catch (e) {
    console.error('GET /api/main-plan error:', e);
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

app.post('/api/main-plan', (req, res) => {
  try {
    const p = req.body;
    const errors = validateMainPlan(p);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    if (p.id) {
      const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [p.id]);
      if (!existing) return res.status(404).json({ error: '计划不存在' });
      db.run(`UPDATE main_plan SET style_id=?,style_no=?,product_name=?,plan_qty=?,due_date=?,arrival_date=?,cutting_start=?,cutting_end=?,secondary_start=?,secondary_end=?,printing_start=?,printing_end=?,embroidery_start=?,embroidery_end=?,template_start=?,template_end=?,sewing_remind_date=?,sewing_start=?,sewing_end=?,ironing_start=?,ironing_end=?,conflict_flag=?,pipeline_count=?,is_scheduled=?,workshop=?,line_team=?,line_count=?,line_index=?,expired=? WHERE id=?`,
        [p.style_id, p.style_no, p.product_name, p.plan_qty, p.due_date, p.arrival_date||'', p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.printing_start||'', p.printing_end||'', p.embroidery_start||'', p.embroidery_end||'', p.template_start||'', p.template_end||'', p.sewing_remind_date, p.sewing_start, p.sewing_end, p.ironing_start || '', p.ironing_end || '', p.conflict_flag || 0, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '', p.line_count || 1, p.line_index || 1, p.expired || 0, p.id]);
      broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
      db.logOperation('main_plan', 'update', p.id, p.style_no);
      return res.json({ ok: true, id: p.id });
    }
    const result = db.run(`INSERT INTO main_plan (style_id,style_no,product_name,plan_qty,due_date,arrival_date,cutting_start,cutting_end,secondary_start,secondary_end,printing_start,printing_end,embroidery_start,embroidery_end,template_start,template_end,sewing_remind_date,sewing_start,sewing_end,ironing_start,ironing_end,conflict_flag,pipeline_count,is_scheduled,workshop,line_team,line_count,line_index,expired)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.style_id, p.style_no, p.product_name, p.plan_qty || 0, p.due_date, p.arrival_date||'', p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.printing_start||'', p.printing_end||'', p.embroidery_start||'', p.embroidery_end||'', p.template_start||'', p.template_end||'', p.sewing_remind_date, p.sewing_start, p.sewing_end, p.ironing_start || '', p.ironing_end || '', p.conflict_flag || 0, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '', p.line_count || 1, p.line_index || 1, p.expired || 0]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    db.logOperation('main_plan', 'create', result.lastInsertRowid, p.style_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/main-plan/:id', (req, res) => {
  try {
    const p = req.body;
    const id = req.params.id;
    const existing = db.get('SELECT * FROM main_plan WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '计划不存在' });
    // 未传的字段保留原值
    const style_id = p.style_id ?? existing.style_id;
    const style_no = p.style_no ?? existing.style_no;
    const product_name = p.product_name ?? existing.product_name;
    const plan_qty = p.plan_qty ?? existing.plan_qty;
    const due_date = p.due_date ?? existing.due_date;
    const arrival_date = p.arrival_date ?? existing.arrival_date ?? '';
    const cutting_start = p.cutting_start ?? existing.cutting_start;
    const cutting_end = p.cutting_end ?? existing.cutting_end;
    const secondary_start = p.secondary_start ?? existing.secondary_start;
    const secondary_end = p.secondary_end ?? existing.secondary_end;
    const printing_start = p.printing_start ?? existing.printing_start ?? '';
    const printing_end = p.printing_end ?? existing.printing_end ?? '';
    const embroidery_start = p.embroidery_start ?? existing.embroidery_start ?? '';
    const embroidery_end = p.embroidery_end ?? existing.embroidery_end ?? '';
    const template_start = p.template_start ?? existing.template_start ?? '';
    const template_end = p.template_end ?? existing.template_end ?? '';
    const sewing_remind_date = p.sewing_remind_date ?? existing.sewing_remind_date;
    const sewing_start = p.sewing_start ?? existing.sewing_start;
    const sewing_end = p.sewing_end ?? existing.sewing_end;
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
    db.logOperation('main_plan', 'update', id, style_no);
    res.json({ ok: true, id });
  } catch (e) {
    console.error('PUT /api/main-plan/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/main-plan/:id', (req, res) => {
  try {
    const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM main_plan WHERE id = ?', [req.params.id]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    db.logOperation('main_plan', 'delete', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 预排产算法 ----------
app.post('/api/main-plan/auto-schedule', (req, res) => {
  try {
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
      return dt.toISOString().slice(0, 10);
    }

    // ========== Step 1: 裁剪 ==========
    const cuttingItems = styleNos.map(sn => {
      const li = loadingInfo[sn];
      return {
        style_no: sn,
        qty: getQty(sn),
        cutting_start: li ? addDays(li.loading_date, 24) : '',
      };
    }).filter(item => item.cutting_start && item.qty > 0);

    cuttingItems.sort((a, b) => a.cutting_start.localeCompare(b.cutting_start) || a.style_no.localeCompare(b.style_no));

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

      items.sort((a, b) => a.start.localeCompare(b.start) || a.style_no.localeCompare(b.style_no));

      let curDay = '';
      let remain = sec.standard;
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
    const today = new Date().toISOString().slice(0, 10);
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
      const sewingEnd = addDays(st.due_date, -15);
      let dailyTarget = parseInt(st.target_daily_output) || 0;
      if (dailyTarget <= 0) {
        const pl = db.get("SELECT daily_output FROM production_lines WHERE line_name = ? AND daily_output > 0 LIMIT 1", [st.product_name || '']);
        if (pl) dailyTarget = parseInt(pl.daily_output) || 0;
      }
      if (dailyTarget <= 0) dailyTarget = 500;
      const sewingDays = Math.ceil(qty / dailyTarget) + 1;
      const sewingStart = addDays(sewingEnd, -(sewingDays - 1));

      // 烫标倒推（仅 ironing_label = '是'）
      let ironingStart = '', ironingEnd = '';
      if (st.ironing_label === '是') {
        ironingEnd = addDays(sewingStart, -3);
        const ironingMax = parseInt(st.ironing_daily_output) || 0;
        const ironingStandard = cap.ironing || 6000;
        if (ironingMax > 0 && ironingStandard > 0) {
          let curDay = ironingEnd, remain = ironingStandard, styleRemain = qty;
          while (styleRemain > 0) {
            const todayCap = Math.min(ironingMax, remain);
            if (todayCap <= 0) { curDay = addDays(curDay, -1); remain = ironingStandard; continue; }
            const produce = Math.min(styleRemain, todayCap);
            styleRemain -= produce;
            remain -= produce;
            if (styleRemain > 0) { curDay = addDays(curDay, -1); remain = ironingStandard; }
          }
          ironingStart = curDay;
        }
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
        sewing_remind_date: addDays(sewingStart, -10), sewing_start: sewingStart, sewing_end: sewingEnd,
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

    baseResults.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));

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
      const fullLimit = 49 - totalLinesAssigned;
      let catLimit = fullLimit;
      if (styleCategory) {
        const catRows = db.all("SELECT id FROM sewing_workshop_tree WHERE category = ? AND type = 'category'", [styleCategory]);
        const totalCatSlots = catRows.length * 3;
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
        const perLineIroningEnd = r.ironing_start ? addDays(perLineSewingStart, -3) : '';

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
          sewing_remind_date: addDays(perLineSewingStart, -10),
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
    db.logOperation('main_plan', 'auto_schedule', 0, `生成${results.length}条计划`);
    res.json({ ok: true, count: results.length, conflicts: conflictCount, expired: expiredCount, lines: totalLinesAssigned });
  } catch (e) {
    console.error('POST /api/main-plan/auto-schedule error:', e);
    res.status(500).json({ error: 'Internal server error: ' + e.message });
  }
});

// ---------- 裁剪排程 ----------
app.get('/api/schedule/cutting', (req, res) => {
  try {
    const plans = db.all("SELECT * FROM main_plan ORDER BY cutting_start, style_no");
    const result = [];
    for (const p of plans) {
      if (!p.style_no) continue;
      const colorSizes = db.all(
        "SELECT color, size_spec, plan_qty FROM style_color_size WHERE style_no = ? ORDER BY color, size_spec",
        [p.style_no]
      );
      if (colorSizes.length === 0) {
        result.push({
          id: p.id,
          style_no: p.style_no,
          product_name: p.product_name || '',
          color: '',
          size_spec: '',
          plan_qty: p.plan_qty || 0,
          cutting_start: p.cutting_start || '',
          cutting_end: p.cutting_end || '',
          plan_start: p.cutting_start || '',
          plan_end: p.cutting_end || '',
          due_date: p.due_date || '',
          main_plan_id: p.id,
        });
      } else {
        for (const cs of colorSizes) {
          result.push({
            id: p.id + '_' + (cs.color || '') + '_' + (cs.size_spec || ''),
            style_no: p.style_no,
            product_name: p.product_name || '',
            color: cs.color || '',
            size_spec: cs.size_spec || '',
            plan_qty: cs.plan_qty || 0,
            cutting_start: p.cutting_start || '',
            cutting_end: p.cutting_end || '',
            plan_start: p.cutting_start || '',
            plan_end: p.cutting_end || '',
            due_date: p.due_date || '',
            main_plan_id: p.id,
          });
        }
      }
    }
    res.json(result);
  } catch (e) {
    console.error('GET /api/schedule/cutting error:', e);
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

// ---------- 排程管理（统一三行模型）----------
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

app.post('/api/schedule/:scheduleType', (req, res) => {
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
    db.logOperation(`schedule_${req.params.scheduleType}`, 'create', masterId, m.style_no);
    res.json({ ok: true, id: masterId });
  } catch (e) {
    console.error('POST /api/schedule error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/schedule/:scheduleType/:id', (req, res) => {
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
    db.logOperation(`schedule_${req.params.scheduleType}`, 'update', req.params.id, '');
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/schedule error:', e);
    res.status(500).json({ error: 'Internal server error', detail: e.message });
  }
});

app.delete('/api/schedule/:scheduleType/:id', (req, res) => {
  try {
    const existing = db.get('SELECT id FROM schedule_master WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM schedule_daily WHERE master_id = ?', [req.params.id]);
    db.run('DELETE FROM schedule_master WHERE id = ?', [req.params.id]);
    broadcastSection(`schedule_${req.params.scheduleType}`, db.all('SELECT * FROM schedule_master WHERE schedule_type = ?', [req.params.scheduleType]));
    db.logOperation(`schedule_${req.params.scheduleType}`, 'delete', req.params.id, '');
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

    // 计算整体日期范围
    let minDate = null, maxDate = null;
    for (const p of plans) {
      if (!minDate || p.sewing_start < minDate) minDate = p.sewing_start;
      if (!maxDate || p.sewing_end > maxDate) maxDate = p.sewing_end;
    }
    const sd = new Date(minDate + 'T00:00:00');
    const ed = new Date(maxDate + 'T00:00:00');
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
           GROUP BY production_date`,
          [plan.style_no, cs.color || '', cs.size_spec || '']
        );
        const actualMap = {};
        for (const a of actuals) { actualMap[a.production_date] = a.qty || 0; }

        // 为每个日期生成计划/实际/差异
        const dateData = [];
        let totalPlan = 0, totalActual = 0;
        for (const date of dateRange) {
          let planQty = 0;
          if (date >= plan.sewing_start && date <= plan.sewing_end && dailyTarget > 0) {
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
app.post('/api/schedule/sewing-daily-plan/actual', (req, res) => {
  try {
    const { style_no, color, size_spec, production_date, completed_qty } = req.body;
    if (!style_no || !production_date) {
      return res.status(400).json({ error: '款号和日期不能为空' });
    }

    // 检查是否已存在
    const existing = db.get(
      `SELECT id FROM actual_production
       WHERE style_no = ? AND color = ? AND size_spec = ? AND production_date = ?`,
      [style_no, color || '', size_spec || '', production_date]
    );

    if (existing) {
      db.run(
        `UPDATE actual_production SET completed_qty = ?, recorded_at = datetime('now','localtime')
         WHERE id = ?`,
        [completed_qty || 0, existing.id]
      );
    } else {
      db.run(
        `INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty)
         VALUES ('sewing', 0, ?, ?, ?, ?, ?)`,
        [style_no, color || '', size_spec || '', production_date, completed_qty || 0]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/schedule/sewing-daily-plan/actual error:', e);
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
    const { scheduleType } = req.query;
    let rows;
    if (scheduleType) {
      rows = db.all('SELECT * FROM actual_production WHERE schedule_type = ? ORDER BY production_date DESC', [scheduleType]);
    } else {
      rows = db.all('SELECT * FROM actual_production ORDER BY production_date DESC');
    }
    res.json(rows);
  } catch (e) {
    console.error('GET /api/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/actual', (req, res) => {
  try {
    const r = req.body;
    if (!r.style_no) return res.status(400).json({ error: '款号不能为空' });
    if (!r.production_date) return res.status(400).json({ error: '日期不能为空' });

    const result = db.run(`INSERT INTO actual_production (schedule_type, secondary_type, style_id, style_no, color, size_spec, production_date, completed_qty, defect_qty, workshop, line_team, remark, worker_name, start_time, end_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [r.schedule_type, r.secondary_type || '', r.style_id, r.style_no, r.color, r.size_spec, r.production_date, r.completed_qty || 0, r.defect_qty || 0, r.workshop || '', r.line_team || '', r.remark || '', r.worker_name || '', r.start_time || '', r.end_time || '']);

    syncActualToDaily(r);
    // 自动重算任务状态
    if (r.style_id) {
      db.recalcTaskStatus(r.style_id);
    }
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
    if (style_no) { sql += ' AND style_no LIKE ?'; params.push(`%${style_no}%`); }
    if (date_from) { sql += ' AND production_date >= ?'; params.push(date_from); }
    if (date_to) { sql += ' AND production_date <= ?'; params.push(date_to); }
    sql += ` GROUP BY ${groupExpr} ORDER BY ${groupExpr.split(',')[0]} DESC LIMIT 500`;
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

app.put('/api/actual/:id', (req, res) => {
  try {
    const r = req.body;
    const existing = db.get('SELECT * FROM actual_production WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '记录不存在' });

    const oldStyleId = existing.style_id;
    const newStyleId = r.style_id || oldStyleId;

    db.run(`UPDATE actual_production SET schedule_type=?, secondary_type=?, style_id=?, style_no=?, color=?, size_spec=?,
      production_date=?, completed_qty=?, defect_qty=?, workshop=?, line_team=?, remark=?,
      worker_name=?, start_time=?, end_time=? WHERE id=?`,
      [r.schedule_type || existing.schedule_type, r.secondary_type ?? existing.secondary_type,
       newStyleId, r.style_no || existing.style_no,
       r.color ?? existing.color, r.size_spec ?? existing.size_spec,
       r.production_date || existing.production_date, r.completed_qty ?? existing.completed_qty,
       r.defect_qty ?? existing.defect_qty, r.workshop ?? existing.workshop,
       r.line_team ?? existing.line_team, r.remark ?? existing.remark,
       r.worker_name ?? existing.worker_name, r.start_time ?? existing.start_time,
       r.end_time ?? existing.end_time, req.params.id]);

    syncActualToDaily({ ...existing, ...r, style_id: newStyleId });
    if (newStyleId) db.recalcTaskStatus(newStyleId);
    if (oldStyleId && oldStyleId !== newStyleId) db.recalcTaskStatus(oldStyleId);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/actual/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/actual/:id', (req, res) => {
  try {
    const existing = db.get('SELECT * FROM actual_production WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: '记录不存在' });

    db.run('DELETE FROM actual_production WHERE id = ?', [req.params.id]);

    const masters = db.all('SELECT id FROM schedule_master WHERE style_no = ? AND schedule_type = ?',
      [existing.style_no, existing.schedule_type]);
    for (const m of masters) {
      db.run("DELETE FROM schedule_daily WHERE master_id = ? AND schedule_date = ? AND row_type = 'ACTUAL'",
        [m.id, existing.production_date]);
    }

    if (existing.style_id) db.recalcTaskStatus(existing.style_id);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/actual/:id error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 批量导入报工 ----------
app.post('/api/actual/batch', (req, res) => {
  try {
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: '请提供报工记录数组' });
    }
    let inserted = 0;
    const styleIds = new Set();
    for (const r of records) {
      if (!r.style_no || !r.production_date) continue;
      const result = db.run(`INSERT INTO actual_production (schedule_type, secondary_type, style_id, style_no, color, size_spec, production_date, completed_qty, defect_qty, workshop, line_team, remark, worker_name, start_time, end_time)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [r.schedule_type || '', r.secondary_type || '', r.style_id || 0, r.style_no, r.color || '', r.size_spec || '',
         r.production_date, r.completed_qty || 0, r.defect_qty || 0, r.workshop || '',
         r.line_team || '', r.remark || '', r.worker_name || '', r.start_time || '', r.end_time || '']);
      syncActualToDaily(r);
      if (r.style_id) styleIds.add(r.style_id);
      inserted++;
    }
    for (const sid of styleIds) db.recalcTaskStatus(sid);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true, inserted });
  } catch (e) {
    console.error('POST /api/actual/batch error:', e);
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
    if (style_no) { sql += ' AND style_no LIKE ?'; params.push(`%${style_no}%`); }
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
    if (style_no) { sql += ' AND style_no LIKE ?'; params.push(`%${style_no}%`); }
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
    if (style_no) { sql += ' AND style_no LIKE ?'; params.push(`%${style_no}%`); }
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
    if (style_no) { sql += ' AND style_no LIKE ?'; params.push(`%${style_no}%`); }
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

// ---------- 交期预估 ----------
app.get('/api/estimations', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM delivery_estimations ORDER BY id DESC'));
  } catch (e) {
    console.error('GET /api/estimations error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/estimations/simulate', (req, res) => {
  try {
    const { style_id, style_no, product_name, plan_qty, start_date } = req.body;
    if (!plan_qty || plan_qty <= 0) return res.status(400).json({ error: '计划数量必须大于0' });

    // 读取产能配置
    const cuttingCap = db.get("SELECT daily_capacity FROM capacity_config WHERE process_type = 'cutting'");
    const sewingCap = db.get("SELECT daily_capacity FROM capacity_config WHERE process_type = 'sewing'");
    const cuttingDaily = cuttingCap?.daily_capacity || 30000;
    const sewingDaily = sewingCap?.daily_capacity || 800;

    // 读取系统配置
    const shippingBuffer = parseInt(db.get("SELECT config_value FROM system_config WHERE config_key = 'shipping_buffer_days'")?.config_value || '5');
    const pickingDays = parseInt(db.get("SELECT config_value FROM system_config WHERE config_key = 'picking_days'")?.config_value || '3');

    // 计算各阶段天数
    const cuttingDays = Math.ceil(plan_qty / cuttingDaily);
    const secondaryDays = 3; // 二次加工固定3天
    const sewingDays = Math.ceil(plan_qty / sewingDaily);
    const totalDays = cuttingDays + pickingDays + secondaryDays + sewingDays + shippingBuffer;

    // 使用工作日历计算实际日期
    const today = start_date || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();

    const estimatedEnd = db.addWorkdays(today, totalDays);
    const cuttingEnd = db.addWorkdays(today, cuttingDays);
    const secondaryEnd = db.addWorkdays(cuttingEnd, pickingDays + secondaryDays);
    const sewingEnd = db.addWorkdays(secondaryEnd, sewingDays);

    res.json({
      ok: true,
      estimation: {
        style_id: style_id || null,
        style_no: style_no || '',
        product_name: product_name || '',
        plan_qty,
        estimated_days: totalDays,
        estimated_start: today,
        estimated_end: estimatedEnd,
        breakdown: {
          cutting: { days: cuttingDays, start: today, end: cuttingEnd },
          picking: { days: pickingDays },
          secondary: { days: secondaryDays, start: cuttingEnd, end: secondaryEnd },
          sewing: { days: sewingDays, start: secondaryEnd, end: sewingEnd },
          shipping_buffer: { days: shippingBuffer },
        },
      },
    });
  } catch (e) {
    console.error('POST /api/estimations/simulate error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/estimations', (req, res) => {
  try {
    const e = req.body;
    const result = db.run('INSERT INTO delivery_estimations (style_id, style_no, product_name, plan_qty, estimated_days, estimated_start, estimated_end, remark) VALUES (?,?,?,?,?,?,?,?)',
      [e.style_id, e.style_no, e.product_name, e.plan_qty, e.estimated_days, e.estimated_start, e.estimated_end, e.remark || '']);
    db.logOperation('estimations', 'create', result.lastInsertRowid, e.style_no, `预估${e.estimated_days}天`);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/estimations error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/estimations/:id/confirm', (req, res) => {
  try {
    db.run("UPDATE delivery_estimations SET status = 'CONFIRMED' WHERE id = ?", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/estimations/:id/confirm error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 出货计划 ----------
app.get('/api/shipping-plans', (req, res) => {
  try { res.json(db.all('SELECT * FROM shipping_plans ORDER BY ship_date')); }
  catch (e) { console.error('GET /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/shipping-plans', (req, res) => {
  try {
    const p = req.body;
    if (!p.plan_no) return res.status(400).json({ error: '计划编号不能为空' });
    const result = db.run('INSERT INTO shipping_plans (plan_no, customer, style_no, product_name, plan_qty, ship_date, remark) VALUES (?,?,?,?,?,?,?)',
      [p.plan_no, p.customer || '', p.style_no || '', p.product_name || '', p.plan_qty || 0, p.ship_date || '', p.remark || '']);
    db.logOperation('shipping', 'create', result.lastInsertRowid, p.plan_no);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/shipping-plans/:id', (req, res) => {
  try {
    const p = req.body;
    db.run('UPDATE shipping_plans SET customer=?, style_no=?, product_name=?, plan_qty=?, ship_date=?, status=?, remark=? WHERE id=?',
      [p.customer, p.style_no, p.product_name, p.plan_qty, p.ship_date, p.status, p.remark, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/shipping-plans/:id', (req, res) => {
  try { db.run('DELETE FROM shipping_plans WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/shipping-plans error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 从主计划自动生成出货计划
app.post('/api/shipping-plans/generate', (req, res) => {
  try {
    const plans = db.all('SELECT * FROM main_plan WHERE due_date IS NOT NULL ORDER BY due_date');
    let count = 0;
    const txn = db.getDb().transaction(() => {
      for (const p of plans) {
        const existing = db.get('SELECT id FROM shipping_plans WHERE style_no = ? AND ship_date = ?', [p.style_no, p.due_date]);
        if (existing) continue;
        const planNo = `SP-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(++count).padStart(3,'0')}`;
        db.run('INSERT INTO shipping_plans (plan_no, customer, style_no, product_name, plan_qty, ship_date) VALUES (?,?,?,?,?,?)',
          [planNo, '', p.style_no, p.product_name, p.plan_qty, p.due_date]);
      }
    });
    txn();
    db.logOperation('shipping', 'generate', null, `自动生成${count}条出货计划`);
    res.json({ ok: true, count });
  } catch (e) { console.error('POST /api/shipping-plans/generate error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// ---------- 排产策略 ----------
app.get('/api/strategies', (req, res) => {
  try { res.json(db.all('SELECT * FROM scheduling_strategies ORDER BY id')); }
  catch (e) { console.error('GET /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/strategies', (req, res) => {
  try {
    const s = req.body;
    const result = db.run('INSERT INTO scheduling_strategies (name, rule_type, description, config, active) VALUES (?,?,?,?,?)',
      [s.name, s.rule_type || 'due_date', s.description || '', JSON.stringify(s.config || {}), s.active ? 1 : 0]);
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) { console.error('POST /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.put('/api/strategies/:id', (req, res) => {
  try {
    const s = req.body;
    db.run('UPDATE scheduling_strategies SET name=?, rule_type=?, description=?, config=?, active=? WHERE id=?',
      [s.name, s.rule_type, s.description, JSON.stringify(s.config || {}), s.active ? 1 : 0, req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('PUT /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

app.delete('/api/strategies/:id', (req, res) => {
  try { db.run('DELETE FROM scheduling_strategies WHERE id = ?', [req.params.id]); res.json({ ok: true }); }
  catch (e) { console.error('DELETE /api/strategies error:', e); res.status(500).json({ error: 'Internal server error' }); }
});

// 一键自动排产
app.post('/api/auto-schedule', (req, res) => {
  try {
    const { strategy_id } = req.body;
    const result = db.autoSchedule(strategy_id);
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

// [fix#8] Override instead of accumulate
function syncActualToDaily(record) {
  const masters = db.all('SELECT id FROM schedule_master WHERE style_no = ? AND schedule_type = ?',
    [record.style_no, record.schedule_type]);
  for (const m of masters) {
    const existing = db.get('SELECT id FROM schedule_daily WHERE master_id = ? AND schedule_date = ? AND row_type = ?',
      [m.id, record.production_date, 'ACTUAL']);
    if (existing) {
      db.run('UPDATE schedule_daily SET qty = ? WHERE id = ?', [record.completed_qty || 0, existing.id]);
    } else {
      db.run('INSERT INTO schedule_daily (master_id, schedule_date, row_type, qty) VALUES (?, ?, ?, ?)',
        [m.id, record.production_date, 'ACTUAL', record.completed_qty || 0]);
    }
  }
}

// ---------- 仓库管理 ----------
app.get('/api/warehouse/:type/inbound', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM warehouse_inbound WHERE warehouse_type = ? ORDER BY inbound_date DESC', [req.params.type]));
  } catch (e) {
    console.error('GET /api/warehouse/inbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/warehouse/:type/inbound', (req, res) => {
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
    db.logOperation('warehouse', 'inbound', null, `${req.params.type} 入库${r.qty}件`);
    res.json({ ok: true, id: result.lastInsertRowid, order_no: orderNo });
  } catch (e) {
    console.error('POST /api/warehouse/inbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/warehouse/:type/outbound', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM warehouse_outbound WHERE warehouse_type = ? ORDER BY outbound_date DESC', [req.params.type]));
  } catch (e) {
    console.error('GET /api/warehouse/outbound error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/warehouse/:type/outbound', (req, res) => {
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
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [req.params.type, r.ref_type || '', r.ref_id, r.style_no, r.color, r.size_spec, r.qty, r.outbound_date, r.operator || '',
         r.pot_no || '', r.fabric_name || '', r.supplier || '', r.customer || '', r.width || '', r.weight || '', r.unit || 'KG', r.total_pcs || 0, r.unit2 || '匹', r.remark || '', orderNo]);
      updateInventory(req.params.type, r.style_no, r.color, r.size_spec, -r.qty, r);
      return result;
    });
    const result = txn();
    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
    db.logOperation('warehouse', 'outbound', null, `${req.params.type} 出库${r.qty}件`);
    res.json({ ok: true, id: result.lastInsertRowid, order_no: orderNo });
  } catch (e) {
    console.error('POST /api/warehouse/outbound error:', e);
    res.status(400).json({ error: e.message || 'Internal server error' });
  }
});

app.get('/api/warehouse/:type/inventory', (req, res) => {
  try {
    res.json(db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
  } catch (e) {
    console.error('GET /api/warehouse/inventory error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 仓库导出 ----------
app.get('/api/warehouse/:type/export', async (req, res) => {
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
app.post('/api/warehouse/:type/import', (req, res) => {
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
    const asn_code = genAsnCode();
    let total_qty = 0;
    if (details) details.forEach(d => total_qty += d.plan_qty || 0);

    const result = db.run('INSERT INTO asn_list (asn_code, warehouse_type, supplier, status, expected_date, total_qty, remark, operator) VALUES (?,?,?,?,?,?,?,?)',
      [asn_code, warehouse_type, supplier || '', 'PENDING', expected_date || '', total_qty, remark || '', req.body.operator || 'YC']);
    const asnId = result.lastInsertRowid;

    if (details && details.length > 0) {
      const insDetail = db.prepare('INSERT INTO asn_detail (asn_id, style_no, fabric_name, color, size_spec, pot_no, plan_qty, unit, remark) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const d of details) {
        insDetail.run(asnId, d.style_no || '', d.fabric_name || '', d.color || '', d.size_spec || '', d.pot_no || '', d.plan_qty || 0, d.unit || '件', d.remark || '');
      }
    }

    db.logOperation('asn', 'create', asnId, asn_code);
    res.json({ ok: true, id: asnId, asn_code });
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
            [asn.warehouse_type, d.style_no, d.color, d.size_spec, qty, asn.actual_date || new Date().toISOString().split('T')[0], asn.operator, d.pot_no, d.fabric_name, asn.supplier, d.unit, `ASN:${asn.asn_code}`, asn.asn_code]);
        }
      }
      // 更新 ASN 汇总
      const receivedTotal = details.reduce((s, d) => s + (d.actual_qty || d.plan_qty || 0), 0);
      const shortageTotal = details.reduce((s, d) => s + (d.shortage_qty || 0), 0);
      const damageTotal = details.reduce((s, d) => s + (d.damage_qty || 0), 0);
      db.run('UPDATE asn_list SET received_qty = ?, shortage_qty = ?, damage_qty = ? WHERE id = ?',
        [receivedTotal, shortageTotal, damageTotal, asn.id]);
    }

    const statusLabels = { PENDING: '待收货', RECEIVED: '已收货', INSPECTING: '质检中', COMPLETED: '已完成', CANCELLED: '已取消' };
    db.logOperation('asn', status.toLowerCase(), req.params.id, asn.asn_code, statusLabels[status] || status);
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

    db.logOperation('dn', 'create', dnId, dn_code);
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
            [dn.warehouse_type, d.style_no, d.color, d.size_spec, qty, new Date().toISOString().split('T')[0], dn.operator, `DN:${dn.dn_code}`, dn.dn_code]);
        }
      }
      const shippedTotal = details.reduce((s, d) => s + (d.shipped_qty || d.plan_qty || 0), 0);
      db.run(`UPDATE dn_list SET shipped_qty = ?, actual_ship_date = datetime('now','localtime') WHERE id = ?`, [shippedTotal, dn.id]);
    }

    if (status === 'DELIVERED') {
      db.run(`UPDATE dn_list SET delivery_date = datetime('now','localtime') WHERE id = ?`, [req.params.id]);
    }

    const statusLabels = { PENDING: '待拣货', PICKING: '拣货中', PICKED: '已拣货', SHIPPED: '已发货', DELIVERED: '已签收', CANCELLED: '已取消' };
    db.logOperation('dn', status.toLowerCase(), req.params.id, dn.dn_code, statusLabels[status] || status);
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
  // 查找库存记录（按 UNIQUE 约束的 4 个字段匹配）
  const existing = db.get('SELECT * FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ?',
    [type, styleNo, color || '', sizeSpec || '']);
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
    const result = db.run(
      'INSERT INTO style_color_size (order_date, style_no, due_date, product_name, size_spec, color, plan_qty) VALUES (?,?,?,?,?,?,?)',
      [r.order_date || '', r.style_no || '', r.due_date || '', r.product_name || '', r.size_spec || '', r.color || '', r.plan_qty || 0]
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
    db.run(
      'UPDATE style_color_size SET order_date=?, style_no=?, due_date=?, product_name=?, size_spec=?, color=?, plan_qty=? WHERE id=?',
      [r.order_date || '', r.style_no || '', r.due_date || '', r.product_name || '', r.size_spec || '', r.color || '', r.plan_qty || 0, req.params.id]
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
    db.logOperation('style_color_size', 'import', null, `导入 ${imported} 条分色分尺码`);
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

app.post('/api/fabric-loading', (req, res) => {
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

app.put('/api/fabric-loading/:id', (req, res) => {
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

app.delete('/api/fabric-loading/:id', (req, res) => {
  try {
    db.run('DELETE FROM fabric_loading_list WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/fabric-loading error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 批量入库：从面料装柜清单选中多条，一键入库
app.post('/api/fabric-loading/batch-inbound', (req, res) => {
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
    db.logOperation('warehouse', 'batch_inbound', null, `批量入库 ${imported} 条`);

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

app.post('/api/fabric-loading/import', (req, res) => {
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
app.put('/api/config/system/:key', (req, res) => {
  try {
    const value = req.body.configValue ?? req.body.config_value;
    if (value === undefined) return res.status(400).json({ error: '参数值不能为空' });
    db.run('UPDATE system_config SET config_value = ? WHERE config_key = ?', [String(value), req.params.key]);
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

// Socket.IO auth middleware
if (AUTH_ENABLED) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token !== API_TOKEN) {
      return next(new Error('Unauthorized'));
    }
    next();
  });
}

// [fix#13] Safe broadcast
function broadcastSection(section, data) {
  try {
    io.emit('sectionUpdate', { section, data });
  } catch (e) {
    console.error('broadcastSection error:', e);
  }
}

io.on('connection', (socket) => {
  console.log(`🔗 用户连接: ${socket.id}`);

  socket.emit('initData', db.getFullData());

  socket.on('join', (userName) => {
    socket.userName = userName || '匿名';
    io.emit('userList', Array.from(io.sockets.sockets.values()).map(s => s.userName).filter(Boolean));
  });

  socket.on('disconnect', () => {
    console.log(`🔌 用户断开: ${socket.id}`);
    io.emit('userList', Array.from(io.sockets.sockets.values()).map(s => s.userName).filter(Boolean));
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
    const allTasks = db.all(`SELECT sm.id as planId, sm.style_no as styleNo,
      sm.product_name as productName, sm.color, sm.size_spec as sizeSpec,
      sm.plan_qty as planQty, sm.plan_start as sewingStart, sm.plan_end as sewingEnd,
      sm.workshop, sm.line_team
      FROM schedule_master sm WHERE sm.schedule_type = 'sewing'
      ORDER BY sm.workshop, sm.line_team, sm.plan_start`);

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
        const lineNum = line.line_name.replace(/班$/, '')
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
    const lineNum = String(lineTeam).replace(/班$/, '')

    // 查产线日产量
    const lineId = db.get('SELECT id FROM production_lines WHERE line_name = ?', [lineTeam]);
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
    const newLineNum = String(newLineTeam).replace(/班$/, '');
    // 删除旧 schedule_master
    db.run('DELETE FROM schedule_master WHERE id = ?', [scheduleId]);
    // 查新产线日产量
    const lineId = db.get('SELECT id FROM production_lines WHERE line_name = ?', [newLineTeam]);
    let dailyTarget = 0;
    if (lineId) {
      const cat = db.get('SELECT daily_output FROM line_style_categories WHERE line_id = ? ORDER BY sort_order LIMIT 1', [lineId.id]);
      dailyTarget = cat?.daily_output || 0;
    }
    // 查新产线最后一个任务的结束日期
    const lastTask = db.get(`SELECT plan_end FROM schedule_master
      WHERE schedule_type = 'sewing' AND workshop = ? AND line_team = ?
      ORDER BY plan_end DESC LIMIT 1`, [newWorkshop, newLineNum]);
    const today = fmtLocal(new Date());
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
    // 插入新 schedule_master
    if (sewingStart <= sewingEnd) {
      db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, color, size_spec,
        plan_qty, plan_start, plan_end, workshop, line_team, daily_target, cutting_plan_qty, due_date)
        VALUES ('sewing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [sm.style_id, sm.style_no, sm.product_name, sm.color || '', sm.size_spec || '',
         sm.plan_qty, sewingStart, sewingEnd, newWorkshop, newLineNum, dailyTarget, sm.plan_qty, sm.due_date || '']);
    }
    // 更新 main_plan
    db.run('UPDATE main_plan SET workshop = ?, line_team = ?, sewing_start = ?, sewing_end = ? WHERE style_id = ?',
      [newWorkshop, newLineNum, sewingStart, sewingEnd, sm.style_id]);
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
