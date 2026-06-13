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
      '接单日期': 'order_date', '款号': 'style_no', '品名': 'product_name',
      '面料代号': 'fabric_code', '成衣计划数量': 'plan_qty', '交期': 'due_date',
      '是否刺绣': 'embroidery', '是否印花': 'printing', '是否烫标': 'ironing_label',
      '是否用模板': 'template', 'TT时间': 'tt_time', '目标日产量': 'target_daily_output',
      '几条线生产': 'production_lines', '备注': 'remarks',
    };
    const colMap = {};
    ws.getRow(1).eachCell((cell, colNumber) => {
      const key = headerMap[String(cell.value).trim()];
      if (key) colMap[colNumber] = key;
    });
    let imported = 0, skipped = 0;
    const txn = db.transaction(() => {
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const data = {};
        for (const [col, key] of Object.entries(colMap)) {
          let val = row.getCell(Number(col)).value;
          if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
          if (val instanceof Date) {
            data[key] = `${val.getFullYear()}-${String(val.getMonth()+1).padStart(2,'0')}-${String(val.getDate()).padStart(2,'0')}`;
          } else {
            data[key] = val != null ? String(val).trim() : '';
          }
        }
        if (!data.style_no) { skipped++; continue; }
        data.plan_qty = parseInt(data.plan_qty) || 0;
        data.target_daily_output = parseInt(data.target_daily_output) || 0;
        data.production_lines = parseInt(data.production_lines) || 0;
        db.run(`INSERT INTO styles (style_no, product_name, fabric_code, plan_qty, due_date, order_date,
          embroidery, printing, ironing_label, template, tt_time, target_daily_output, production_lines, remarks)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [data.style_no, data.product_name, data.fabric_code, data.plan_qty, data.due_date,
           data.order_date, data.embroidery, data.printing, data.ironing_label, data.template,
           data.tt_time, data.target_daily_output, data.production_lines, data.remarks]);
        imported++;
      }
    });
    txn();
    broadcastSection('styles', db.all('SELECT * FROM styles ORDER BY id'));
    res.json({ ok: true, imported, skipped });
  } catch (e) {
    console.error('POST /api/styles/import error:', e);
    res.status(500).json({ error: '导入失败: ' + e.message });
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
      db.run(`UPDATE styles SET style_no=?,product_name=?,fabric_code=?,plan_qty=?,due_date=?,order_date=?,embroidery=?,printing=?,ironing_label=?,template=?,tt_time=?,target_daily_output=?,production_lines=?,remarks=? WHERE id=?`,
        [s.style_no, s.product_name, s.fabric_code, s.plan_qty, s.due_date, s.order_date||'', s.embroidery||'', s.printing||'', s.ironing_label||'', s.template||'', s.tt_time||'', s.target_daily_output||0, s.production_lines||0, s.remarks||'', s.id]);
      broadcastSection('styles', db.searchStyles(''));
      return res.json({ ok: true, id: s.id });
    }
    const result = db.run(`INSERT INTO styles (style_no, product_name, fabric_code, plan_qty, due_date, order_date, embroidery, printing, ironing_label, template, tt_time, target_daily_output, production_lines, remarks)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [s.style_no, s.product_name, s.fabric_code, s.plan_qty || 0, s.due_date, s.order_date||'', s.embroidery||'', s.printing||'', s.ironing_label||'', s.template||'', s.tt_time||'', s.target_daily_output||0, s.production_lines||0, s.remarks||'']);
    broadcastSection('styles', db.searchStyles(''));
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
    const existing = db.get('SELECT id FROM production_lines WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('UPDATE production_lines SET status = ? WHERE id = ?', [status, req.params.id]);
    broadcastSection('productionLines', db.all('SELECT * FROM production_lines ORDER BY sort_order'));
    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/production-lines error:', e);
    res.status(500).json({ error: 'Internal server error' });
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

app.post('/api/main-plan', (req, res) => {
  try {
    const p = req.body;
    const errors = validateMainPlan(p);
    if (errors.length > 0) return res.status(400).json({ error: errors.join('; ') });

    if (p.id) {
      const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [p.id]);
      if (!existing) return res.status(404).json({ error: '计划不存在' });
      db.run(`UPDATE main_plan SET style_id=?,style_no=?,product_name=?,plan_qty=?,due_date=?,cutting_start=?,cutting_end=?,secondary_start=?,secondary_end=?,sewing_remind_date=?,sewing_start=?,sewing_end=?,pipeline_count=?,is_scheduled=?,workshop=?,line_team=? WHERE id=?`,
        [p.style_id, p.style_no, p.product_name, p.plan_qty, p.due_date, p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.sewing_remind_date, p.sewing_start, p.sewing_end, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '', p.id]);
      broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
      return res.json({ ok: true, id: p.id });
    }
    const result = db.run(`INSERT INTO main_plan (style_id,style_no,product_name,plan_qty,due_date,cutting_start,cutting_end,secondary_start,secondary_end,sewing_remind_date,sewing_start,sewing_end,pipeline_count,is_scheduled,workshop,line_team)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [p.style_id, p.style_no, p.product_name, p.plan_qty || 0, p.due_date, p.cutting_start, p.cutting_end, p.secondary_start, p.secondary_end, p.sewing_remind_date, p.sewing_start, p.sewing_end, p.pipeline_count || 1, p.is_scheduled ? 1 : 0, p.workshop || '', p.line_team || '']);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/main-plan/:id', (req, res) => {
  try {
    const existing = db.get('SELECT id FROM main_plan WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    db.run('DELETE FROM main_plan WHERE id = ?', [req.params.id]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true });
  } catch (e) {
    console.error('DELETE /api/main-plan error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- 排程管理（统一三行模型）----------
app.get('/api/schedule/:scheduleType', (req, res) => {
  try {
    const rows = db.all('SELECT * FROM schedule_master WHERE schedule_type = ?', [req.params.scheduleType]);
    res.json(rows);
  } catch (e) {
    console.error('GET /api/schedule error:', e);
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

// ---------- 缝制导出（匹配缝制计划.xlsx）----------
app.get('/api/schedule/sewing/export', async (req, res) => {
  try {
    const masters = db.all("SELECT * FROM schedule_master WHERE schedule_type='sewing' ORDER BY workshop, line_team, style_no");
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
    console.error('Sewing export error:', e);
    res.status(500).json({ error: 'Export failed: ' + e.message });
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
    console.error('Sewing import error:', e);
    res.status(500).json({ error: 'Import failed: ' + e.message });
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

    const result = db.run(`INSERT INTO actual_production (schedule_type, style_id, style_no, color, size_spec, production_date, completed_qty, defect_qty, workshop, line_team, remark)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [r.schedule_type, r.style_id, r.style_no, r.color, r.size_spec, r.production_date, r.completed_qty || 0, r.defect_qty || 0, r.workshop || '', r.line_team || '', r.remark || '']);

    syncActualToDaily(r);
    broadcastSection('actual', db.all('SELECT * FROM actual_production ORDER BY production_date DESC'));
    res.json({ ok: true, id: result.lastInsertRowid });
  } catch (e) {
    console.error('POST /api/actual error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
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

    const result = db.run(`INSERT INTO warehouse_inbound (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, inbound_date, operator)
      VALUES (?,?,?,?,?,?,?,?,?)`,
      [req.params.type, r.ref_type || '', r.ref_id, r.style_no, r.color, r.size_spec, r.qty, r.inbound_date, r.operator || '']);
    updateInventory(req.params.type, r.style_no, r.color, r.size_spec, r.qty);
    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
    res.json({ ok: true, id: result.lastInsertRowid });
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

    const txn = db.getDb().transaction(() => {
      const inv = db.get('SELECT current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ?',
        [req.params.type, r.style_no, r.color || '', r.size_spec || '']);
      if (!inv || inv.current_qty < r.qty) {
        throw new Error(`库存不足，当前库存 ${inv ? inv.current_qty : 0}，出库 ${r.qty}`);
      }
      const result = db.run(`INSERT INTO warehouse_outbound (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, outbound_date, operator)
        VALUES (?,?,?,?,?,?,?,?,?)`,
        [req.params.type, r.ref_type || '', r.ref_id, r.style_no, r.color, r.size_spec, r.qty, r.outbound_date, r.operator || '']);
      updateInventory(req.params.type, r.style_no, r.color, r.size_spec, -r.qty);
      return result;
    });
    const result = txn();
    broadcastSection('warehouse', db.all('SELECT * FROM warehouse_inventory WHERE warehouse_type = ?', [req.params.type]));
    res.json({ ok: true, id: result.lastInsertRowid });
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

// [fix#5] Inventory update with safety check
function updateInventory(type, styleNo, color, sizeSpec, delta) {
  if (!delta || delta === 0) return;
  const existing = db.get('SELECT * FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ?',
    [type, styleNo, color || '', sizeSpec || '']);
  if (existing) {
    const newQty = Math.max(0, existing.current_qty + delta);
    db.run('UPDATE warehouse_inventory SET current_qty = ?, updated_at = datetime("now","localtime") WHERE id = ?',
      [newQty, existing.id]);
  } else if (delta > 0) {
    db.run('INSERT INTO warehouse_inventory (warehouse_type, style_no, color, size_spec, current_qty) VALUES (?,?,?,?,?)',
      [type, styleNo, color || '', sizeSpec || '', delta]);
  }
}

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
    const workshops = db.all('SELECT * FROM workshops ORDER BY sort_order');
    for (const ws of workshops) {
      ws.lines = db.all('SELECT * FROM production_lines WHERE workshop_id = ? ORDER BY sort_order', [ws.id]);
      for (const line of ws.lines) {
        line.tasks = db.all(`SELECT mp.id as planId, mp.style_no as styleNo, mp.product_name as productName,
          mp.color, mp.size_spec as sizeSpec, mp.plan_qty as planQty,
          mp.sewing_start as sewingStart, mp.sewing_end as sewingEnd, mp.due_date as dueDate
          FROM main_plan mp WHERE mp.workshop = ? AND mp.line_team = ? AND mp.is_scheduled = 1`,
          [ws.name, line.line_name]);
      }
    }
    const unscheduled = db.all(`SELECT mp.id as planId, mp.style_no as styleNo, mp.product_name as productName,
      s.color, s.size_spec as sizeSpec, s.plan_qty as planQty, mp.due_date as dueDate
      FROM main_plan mp JOIN styles s ON mp.style_id = s.id
      WHERE mp.is_scheduled = 0 ORDER BY mp.due_date`);
    res.json({ workshops, unscheduled });
  } catch (e) {
    console.error('GET /api/visual-schedule/gantt error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/visual-schedule/date-range', (req, res) => {
  try {
    const min = db.get("SELECT MIN(sewing_start) as d FROM main_plan WHERE sewing_start != ''");
    const max = db.get("SELECT MAX(sewing_end) as d FROM main_plan WHERE sewing_end != ''");
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
    db.run('UPDATE main_plan SET workshop = ?, line_team = ?, is_scheduled = 1 WHERE id = ?',
      [workshop, lineTeam, planId]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/visual-schedule/assign error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/visual-schedule/unassign', (req, res) => {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: '参数不完整' });
    db.run('UPDATE main_plan SET workshop = ?, line_team = ?, is_scheduled = 0 WHERE id = ?', ['', '', planId]);
    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    res.json({ ok: true });
  } catch (e) {
    console.error('POST /api/visual-schedule/unassign error:', e);
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
