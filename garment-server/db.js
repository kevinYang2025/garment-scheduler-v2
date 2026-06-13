const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.sqlite');

let db;

function fmtLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables();
  migrateStyles();
  seedDefaultData();
  seedMainPlan();
  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

function createTables() {
  db.exec(`
    -- 款式主数据（订单一览表）
    CREATE TABLE IF NOT EXISTS styles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      style_no TEXT NOT NULL,
      product_name TEXT DEFAULT '',
      fabric_code TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      due_date TEXT,
      order_date TEXT DEFAULT '',
      embroidery_printing TEXT DEFAULT '',
      embroidery TEXT DEFAULT '',
      printing TEXT DEFAULT '',
      ironing_label TEXT DEFAULT '',
      template TEXT DEFAULT '',
      tt_time TEXT DEFAULT '',
      target_daily_output INTEGER DEFAULT 0,
      production_lines INTEGER DEFAULT 0,
      remarks TEXT DEFAULT '',
      -- legacy columns kept for compatibility
      category TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      secondary_types TEXT DEFAULT '',
      status TEXT DEFAULT '待排',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    -- No unique index on style_no: same style can have multiple orders

    -- 车间
    CREATE TABLE IF NOT EXISTS workshops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    -- 产线
    CREATE TABLE IF NOT EXISTS production_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workshop_id INTEGER NOT NULL,
      line_name TEXT NOT NULL,
      status TEXT DEFAULT '空闲',
      sort_order INTEGER DEFAULT 0
    );

    -- 主计划（需求3、4、5）
    CREATE TABLE IF NOT EXISTS main_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      due_date TEXT,

      cutting_start TEXT,
      cutting_end TEXT,

      secondary_start TEXT,
      secondary_end TEXT,

      sewing_remind_date TEXT,
      sewing_start TEXT,
      sewing_end TEXT,

      pipeline_count INTEGER DEFAULT 1,
      is_scheduled INTEGER DEFAULT 0,
      workshop TEXT DEFAULT '',
      line_team TEXT DEFAULT '',

      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 排程主记录 — 统一模型（需求9、14、15、16）
    CREATE TABLE IF NOT EXISTS schedule_master (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_type TEXT NOT NULL,
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      plan_start TEXT,
      plan_end TEXT,

      workshop TEXT DEFAULT '',
      line_team TEXT DEFAULT '',

      secondary_type TEXT DEFAULT '',

      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 排程每日明细 — 三行模型（需求9、10、12）
    CREATE TABLE IF NOT EXISTS schedule_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      master_id INTEGER NOT NULL,
      schedule_date TEXT NOT NULL,
      row_type TEXT NOT NULL,
      qty INTEGER DEFAULT 0,
      UNIQUE(master_id, schedule_date, row_type)
    );

    -- 实际生产数据录入（需求11）
    CREATE TABLE IF NOT EXISTS actual_production (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_type TEXT DEFAULT '',
      style_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      production_date TEXT NOT NULL,
      completed_qty INTEGER DEFAULT 0,
      defect_qty INTEGER DEFAULT 0,
      workshop TEXT DEFAULT '',
      line_team TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      recorded_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 仓库入库
    CREATE TABLE IF NOT EXISTS warehouse_inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_type TEXT NOT NULL,
      ref_type TEXT DEFAULT '',
      ref_id INTEGER,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      qty INTEGER DEFAULT 0,
      inbound_date TEXT,
      operator TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 仓库出库
    CREATE TABLE IF NOT EXISTS warehouse_outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_type TEXT NOT NULL,
      ref_type TEXT DEFAULT '',
      ref_id INTEGER,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      qty INTEGER DEFAULT 0,
      outbound_date TEXT,
      operator TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 仓库动态库存
    CREATE TABLE IF NOT EXISTS warehouse_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_type TEXT NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      current_qty INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(warehouse_type, style_no, color, size_spec)
    );

    -- 产能配置
    CREATE TABLE IF NOT EXISTS capacity_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_type TEXT NOT NULL UNIQUE,
      daily_capacity INTEGER DEFAULT 1000,
      unit TEXT DEFAULT '件',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 全局系统参数
    CREATE TABLE IF NOT EXISTS system_config (
      config_key TEXT PRIMARY KEY,
      config_value TEXT DEFAULT '',
      description TEXT DEFAULT ''
    );

    -- 日报
    CREATE TABLE IF NOT EXISTS daily_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      workshop TEXT,
      style_no TEXT,
      color TEXT,
      plan_qty INTEGER DEFAULT 0,
      actual_qty INTEGER DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 库存快照
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      style_no TEXT,
      color TEXT,
      qty INTEGER DEFAULT 0,
      location TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 操作日志
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id INTEGER,
      target_name TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      operator TEXT DEFAULT 'YC',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

function migrateStyles() {
  // Add new columns if not exists (for existing databases)
  // 迁移 schedule_master 添加 Excel 模板字段
  try {
    const scols = db.prepare("PRAGMA table_info(schedule_master)").all().map(c => c.name);
    if (!scols.includes('cutting_plan_qty')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN cutting_plan_qty INTEGER DEFAULT 0").run();
    }
    if (!scols.includes('due_date')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN due_date TEXT").run();
    }
    if (!scols.includes('daily_target')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN daily_target INTEGER DEFAULT 0").run();
    }
    if (!scols.includes('updated_at')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN updated_at TEXT DEFAULT ''").run();
    }
  } catch (e) { console.log('schedule_master migration skip:', e.message); }

  // 迁移：添加 priority 字段
  try {
    const scols2 = db.prepare("PRAGMA table_info(schedule_master)").all().map(c => c.name);
    if (!scols2.includes('task_status')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN task_status TEXT DEFAULT 'PENDING'").run();
    }
    if (!scols2.includes('progress_pct')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN progress_pct REAL DEFAULT 0").run();
    }
  } catch (e) { console.log('schedule_master task_status migration skip:', e.message); }

  try {
    const stcols = db.prepare("PRAGMA table_info(styles)").all().map(c => c.name);
    if (!stcols.includes('priority')) {
      db.prepare("ALTER TABLE styles ADD COLUMN priority INTEGER DEFAULT 3").run();
    }
  } catch (e) { console.log('styles priority migration skip:', e.message); }

  try {
    const mpcols = db.prepare("PRAGMA table_info(main_plan)").all().map(c => c.name);
    if (!mpcols.includes('priority')) {
      db.prepare("ALTER TABLE main_plan ADD COLUMN priority INTEGER DEFAULT 3").run();
    }
  } catch (e) { console.log('main_plan priority migration skip:', e.message); }

  const cols = db.prepare("PRAGMA table_info(styles)").all().map(c => c.name);
  if (!cols.includes('embroidery')) {
    db.prepare("ALTER TABLE styles ADD COLUMN embroidery TEXT DEFAULT ''").run();
  }
  if (!cols.includes('printing')) {
    db.prepare("ALTER TABLE styles ADD COLUMN printing TEXT DEFAULT ''").run();
  }
  // Migrate data from embroidery_printing to new columns
  const rows = db.prepare("SELECT id, embroidery_printing FROM styles WHERE (embroidery = '' OR printing = '') AND embroidery_printing != ''").all();
  for (const r of rows) {
    const val = r.embroidery_printing || ''
    const hasEmbroidery = val.includes('刺绣')
    const hasPrinting = val.includes('印花')
    if (hasEmbroidery || hasPrinting) {
      db.prepare("UPDATE styles SET embroidery = ?, printing = ? WHERE id = ?")
        .run(hasEmbroidery ? '是' : '', hasPrinting ? '是' : '', r.id)
    }
  }
  if (rows.length > 0) console.log(`✅ 迁移款式数据：${rows.length} 条刺绣/印花字段拆分`)
}

function seedDefaultData() {
  const count = db.prepare('SELECT COUNT(*) as c FROM workshops').get().c;
  if (count > 0) return;

  const seed = db.transaction(() => {
    // 车间
    const insWorkshop = db.prepare('INSERT INTO workshops (id, name, sort_order) VALUES (?, ?, ?)');
    insWorkshop.run(1, '一车间', 1);
    insWorkshop.run(2, '二车间', 2);
    insWorkshop.run(3, '三车间', 3);
    insWorkshop.run(4, '四车间', 4);
    insWorkshop.run(5, '五车间', 5);

    // 产线（50条）
    const insLine = db.prepare('INSERT INTO production_lines (workshop_id, line_name, sort_order) VALUES (?, ?, ?)');
    const wsConfig = [
      { w: 1, lines: ['1班','2班','3班','4班','5班','6班','7班','8班','9班','10班'] },
      { w: 2, lines: ['11班','12班','13班','14班','15班','16班','17班','18班','19班','20班','2-2班'] },
      { w: 3, lines: ['21班','22班','23班','24班','25班','26班','27班','28班','29班'] },
      { w: 4, lines: ['31班','32班','35班','36班','37班','38班','39班','40班','41班','42班'] },
      { w: 5, lines: ['43班','44班','45班','46班','47班','48班','49班','50班','53班','54班'] },
    ];
    let sort = 1;
    for (const ws of wsConfig) {
      for (const line of ws.lines) {
        insLine.run(ws.w, line, sort++);
      }
    }

    // 产能配置
    const insCap = db.prepare('INSERT INTO capacity_config (process_type, daily_capacity, unit) VALUES (?, ?, ?)');
    insCap.run('cutting', 30000, '件');
    insCap.run('printing', 10000, '片');
    insCap.run('embroidery', 5000, '件');
    insCap.run('template', 3000, '件');
    insCap.run('ironing', 3000, '片');
    insCap.run('sewing', 800, '件/线');

    // 系统参数
    const insCfg = db.prepare('INSERT OR REPLACE INTO system_config (config_key, config_value, description) VALUES (?, ?, ?)');
    insCfg.run('shipping_buffer_days', '5', '出货前缓冲天数');
    insCfg.run('picking_days', '3', '挑片天数');
    insCfg.run('line_change_days', '0.5', '换线时间（天）');
    insCfg.run('cutting_daily_capacity', '30000', '裁剪日产能');

    // 测试款式数据
    const insStyle = db.prepare(`INSERT INTO styles (style_no, product_name, fabric_code, category, color, size_spec, plan_qty, customer, due_date, secondary_types, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '待排')`);
    const testStyles = [
      ['A001', '短袖T恤', 'FB-001', 'T恤类', '红色', 'M', 5000, 'UNIQLO', '2026-07-15', '印花'],
      ['A001', '短袖T恤', 'FB-001', 'T恤类', '红色', 'L', 5000, 'UNIQLO', '2026-07-15', '印花'],
      ['A001', '短袖T恤', 'FB-001', 'T恤类', '白色', 'M', 3000, 'UNIQLO', '2026-07-15', '印花'],
      ['A002', '长袖衬衫', 'FB-002', '衬衫类', '蓝色', 'L', 3000, 'H&M', '2026-07-20', '刺绣,模板'],
      ['A002', '长袖衬衫', 'FB-002', '衬衫类', '蓝色', 'XL', 2000, 'H&M', '2026-07-20', '刺绣,模板'],
      ['A003', '连帽卫衣', 'FB-003', '卫衣类', '黑色', 'M', 4000, 'NIKE', '2026-07-25', '印花,烫标'],
      ['A003', '连帽卫衣', 'FB-003', '卫衣类', '黑色', 'L', 4000, 'NIKE', '2026-07-25', '印花,烫标'],
      ['A003', '连帽卫衣', 'FB-003', '卫衣类', '灰色', 'M', 2000, 'NIKE', '2026-07-25', '印花,烫标'],
      ['A004', '休闲长裤', 'FB-004', '裤类', '卡其', 'M', 6000, 'ZARA', '2026-07-18', ''],
      ['A004', '休闲长裤', 'FB-004', '裤类', '卡其', 'L', 4000, 'ZARA', '2026-07-18', ''],
      ['A004', '休闲长裤', 'FB-004', '裤类', '黑色', 'M', 3000, 'ZARA', '2026-07-18', ''],
      ['A005', '牛仔夹克', 'FB-005', '夹克类', '深蓝', 'L', 2000, 'LEVIS', '2026-08-01', '刺绣'],
      ['A005', '牛仔夹克', 'FB-005', '夹克类', '深蓝', 'XL', 1500, 'LEVIS', '2026-08-01', '刺绣'],
      ['A006', '运动短裤', 'FB-006', '裤类', '黑色', 'M', 8000, 'ADIDAS', '2026-07-10', ''],
      ['A006', '运动短裤', 'FB-006', '裤类', '黑色', 'L', 5000, 'ADIDAS', '2026-07-10', ''],
      ['A007', 'POLO衫', 'FB-007', 'T恤类', '白色', 'M', 4000, 'RALPH LAUREN', '2026-07-30', '烫标'],
      ['A007', 'POLO衫', 'FB-007', 'T恤类', '白色', 'L', 3000, 'RALPH LAUREN', '2026-07-30', '烫标'],
      ['A007', 'POLO衫', 'FB-007', 'T恤类', '深蓝', 'M', 2000, 'RALPH LAUREN', '2026-07-30', '烫标'],
      ['A008', '工装马甲', 'FB-008', '马甲类', '军绿', 'L', 1500, 'CARHARTT', '2026-08-05', '模板'],
      ['A008', '工装马甲', 'FB-008', '马甲类', '军绿', 'XL', 1000, 'CARHARTT', '2026-08-05', '模板'],
    ];
    for (const s of testStyles) {
      insStyle.run(...s);
    }
  });
  seed();
  console.log('✅ 数据库初始化完成：5个车间、50条产线、20条款式');
}

// [fix#11] Read from system_config instead of hardcoding
function seedMainPlan() {
  const planCount = db.prepare('SELECT COUNT(*) as c FROM main_plan').get().c;
  if (planCount > 0) return;

  const styles = db.prepare('SELECT id, style_no, product_name, plan_qty, due_date FROM styles ORDER BY id').all();
  if (styles.length === 0) return;

  // Read config values
  const shippingBuffer = parseInt(db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get('shipping_buffer_days')?.config_value || '5');
  const pickingDays = parseInt(db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get('picking_days')?.config_value || '3');
  const lineChangeDays = parseFloat(db.prepare('SELECT config_value FROM system_config WHERE config_key = ?').get('line_change_days')?.config_value || '0.5');
  const cuttingCapacity = parseInt(db.prepare('SELECT daily_capacity FROM capacity_config WHERE process_type = ?').get('cutting')?.daily_capacity || '30000');
  const sewingCapacity = parseInt(db.prepare('SELECT daily_capacity FROM capacity_config WHERE process_type = ?').get('sewing')?.daily_capacity || '800');

  // Group by style_no
  const grouped = {};
  for (const s of styles) {
    if (!grouped[s.style_no]) {
      grouped[s.style_no] = { ...s, plan_qty: 0 };
    }
    grouped[s.style_no].plan_qty += s.plan_qty;
  }

  const insPlan = db.prepare(`INSERT INTO main_plan (style_id, style_no, product_name, plan_qty, due_date, cutting_start, cutting_end, secondary_start, secondary_end, sewing_remind_date, sewing_start, sewing_end, pipeline_count, is_scheduled, workshop, line_team)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const workshopNames = ['一车间', '二车间', '三车间', '四车间', '五车间'];
  let wsIdx = 0;
  let lineIdx = 1;

  const txn = db.transaction(() => {
    for (const [styleNo, g] of Object.entries(grouped)) {
      const dueDate = new Date(g.due_date || '2026-07-15');

      // Backward calculation from due date
      const sewingEnd = new Date(dueDate);
      sewingEnd.setDate(sewingEnd.getDate() - shippingBuffer);
      const sewingDays = Math.ceil(g.plan_qty / (sewingCapacity * 1));
      const sewingStart = new Date(sewingEnd);
      sewingStart.setDate(sewingStart.getDate() - sewingDays - Math.ceil(lineChangeDays));
      const sewingRemind = new Date(sewingStart);
      sewingRemind.setDate(sewingRemind.getDate() - 2);

      const secondaryEnd = new Date(sewingStart);
      const secondaryStart = new Date(secondaryEnd);
      secondaryStart.setDate(secondaryStart.getDate() - 3);

      const cuttingEnd = new Date(secondaryStart);
      cuttingEnd.setDate(cuttingEnd.getDate() - pickingDays);
      const cuttingDays = Math.ceil(g.plan_qty / cuttingCapacity);
      const cuttingStart = new Date(cuttingEnd);
      cuttingStart.setDate(cuttingStart.getDate() - cuttingDays);

      const fmt = d => fmtLocal(d);

      insPlan.run(
        g.id, g.style_no, g.product_name, g.plan_qty, g.due_date,
        fmt(cuttingStart), fmt(cuttingEnd),
        fmt(secondaryStart), fmt(secondaryEnd),
        fmt(sewingRemind), fmt(sewingStart), fmt(sewingEnd),
        1, 0, '', ''
      );

      wsIdx++;
      lineIdx++;
      if (lineIdx > 10) lineIdx = 1;
    }
  });
  txn();

  console.log('✅ 主计划种子数据已生成：' + Object.keys(grouped).length + ' 条');
}

// ============================================================
// Generic CRUD [fix#18] with error handling
// ============================================================
function all(sql, params = []) {
  try { return db.prepare(sql).all(...params); }
  catch (e) { console.error('DB all error:', sql, e.message); throw e; }
}
function get(sql, params = []) {
  try { return db.prepare(sql).get(...params); }
  catch (e) { console.error('DB get error:', sql, e.message); throw e; }
}
function run(sql, params = []) {
  try { return db.prepare(sql).run(...params); }
  catch (e) { console.error('DB run error:', sql, e.message); throw e; }
}

// ============================================================
// Style helpers
// ============================================================
function searchStyles(keyword) {
  if (!keyword || !keyword.trim()) {
    return db.prepare('SELECT * FROM styles ORDER BY style_no').all();
  }
  const kw = `%${keyword.trim()}%`;
  return db.prepare(`SELECT * FROM styles WHERE style_no LIKE ? OR product_name LIKE ? OR fabric_code LIKE ? OR remarks LIKE ? ORDER BY style_no`)
    .all(kw, kw, kw, kw);
}

function getDistinctStyleNos() {
  return db.prepare('SELECT DISTINCT style_no, product_name, fabric_code, due_date FROM styles ORDER BY style_no').all();
}

// ============================================================
// Build full data for WebSocket init
// ============================================================
function getFullData() {
  return {
    styles: db.prepare('SELECT * FROM styles ORDER BY style_no, color, size_spec').all(),
    workshops: db.prepare('SELECT * FROM workshops ORDER BY sort_order').all(),
    productionLines: db.prepare('SELECT * FROM production_lines ORDER BY sort_order').all(),
    mainPlan: db.prepare('SELECT * FROM main_plan').all(),
    capacityConfig: db.prepare('SELECT * FROM capacity_config').all(),
    systemConfig: db.prepare('SELECT * FROM system_config').all(),
  };
}

// ============================================================
// 操作日志
// ============================================================
function logOperation(module, action, targetId, targetName, detail) {
  try {
    db.prepare('INSERT INTO operation_logs (module, action, target_id, target_name, detail) VALUES (?,?,?,?,?)')
      .run(module, action, targetId || null, targetName || '', detail || '');
  } catch (e) { console.error('logOperation error:', e.message); }
}

module.exports = {
  init, getDb,
  all, get, run,
  searchStyles, getDistinctStyleNos,
  getFullData,
  logOperation,
};
