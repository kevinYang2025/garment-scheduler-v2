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
      -- 面料库扩展字段
      pot_no TEXT DEFAULT '',
      fabric_name TEXT DEFAULT '',
      supplier TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      width TEXT DEFAULT '',
      weight TEXT DEFAULT '',
      unit TEXT DEFAULT 'KG',
      total_pcs INTEGER DEFAULT 0,
      unit2 TEXT DEFAULT '匹',
      remark TEXT DEFAULT '',
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
      -- 面料库扩展字段
      pot_no TEXT DEFAULT '',
      fabric_name TEXT DEFAULT '',
      supplier TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      width TEXT DEFAULT '',
      weight TEXT DEFAULT '',
      unit TEXT DEFAULT 'KG',
      total_pcs INTEGER DEFAULT 0,
      unit2 TEXT DEFAULT '匹',
      remark TEXT DEFAULT '',
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
      -- 面料库扩展字段
      pot_no TEXT DEFAULT '',
      fabric_name TEXT DEFAULT '',
      supplier TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      width TEXT DEFAULT '',
      weight TEXT DEFAULT '',
      unit TEXT DEFAULT 'KG',
      total_pcs INTEGER DEFAULT 0,
      unit2 TEXT DEFAULT '匹',
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(warehouse_type, style_no, color, size_spec, pot_no)
    );

    -- ASN 到货通知单（入库单头）
    CREATE TABLE IF NOT EXISTS asn_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asn_code TEXT NOT NULL UNIQUE,
      warehouse_type TEXT NOT NULL,
      supplier TEXT DEFAULT '',
      status TEXT DEFAULT 'PENDING',
      -- PENDING=待收货, RECEIVED=已收货, INSPECTING=质检中, COMPLETED=已完成, CANCELLED=已取消
      expected_date TEXT,
      actual_date TEXT,
      total_qty REAL DEFAULT 0,
      received_qty REAL DEFAULT 0,
      inspect_qty REAL DEFAULT 0,
      shortage_qty REAL DEFAULT 0,
      damage_qty REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      operator TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ASN 明细（入库单行）
    CREATE TABLE IF NOT EXISTS asn_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asn_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      fabric_name TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      pot_no TEXT DEFAULT '',
      plan_qty REAL DEFAULT 0,
      actual_qty REAL DEFAULT 0,
      inspect_qty REAL DEFAULT 0,
      shortage_qty REAL DEFAULT 0,
      damage_qty REAL DEFAULT 0,
      unit TEXT DEFAULT '件',
      remark TEXT DEFAULT '',
      FOREIGN KEY (asn_id) REFERENCES asn_list(id) ON DELETE CASCADE
    );

    -- DN 发货通知单（出库单头）
    CREATE TABLE IF NOT EXISTS dn_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dn_code TEXT NOT NULL UNIQUE,
      warehouse_type TEXT NOT NULL,
      customer TEXT DEFAULT '',
      status TEXT DEFAULT 'PENDING',
      -- PENDING=待拣货, PICKING=拣货中, PICKED=已拣货, PACKING=装箱中, SHIPPED=已发货, DELIVERED=已签收, CANCELLED=已取消
      ship_date TEXT,
      actual_ship_date TEXT,
      delivery_date TEXT,
      total_qty REAL DEFAULT 0,
      picked_qty REAL DEFAULT 0,
      shipped_qty REAL DEFAULT 0,
      received_qty REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      operator TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- DN 明细（出库单行）
    CREATE TABLE IF NOT EXISTS dn_detail (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dn_id INTEGER NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      plan_qty REAL DEFAULT 0,
      picked_qty REAL DEFAULT 0,
      shipped_qty REAL DEFAULT 0,
      received_qty REAL DEFAULT 0,
      unit TEXT DEFAULT '件',
      remark TEXT DEFAULT '',
      FOREIGN KEY (dn_id) REFERENCES dn_list(id) ON DELETE CASCADE
    );

    -- 库存扩展：增加状态维度（参考 GreaterWMS 16 维库存）
    CREATE TABLE IF NOT EXISTS warehouse_stock_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      warehouse_type TEXT NOT NULL,
      style_no TEXT DEFAULT '',
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      pot_no TEXT DEFAULT '',
      onhand_qty REAL DEFAULT 0,
      intransit_qty REAL DEFAULT 0,
      inspect_qty REAL DEFAULT 0,
      hold_qty REAL DEFAULT 0,
      picked_qty REAL DEFAULT 0,
      allocated_qty REAL DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(warehouse_type, style_no, color, size_spec, pot_no)
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

    -- 甘特图字段配置
    CREATE TABLE IF NOT EXISTS gantt_field_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_type TEXT NOT NULL UNIQUE,
      bar_fields TEXT DEFAULT '["styleNo","planQty"]',
      tooltip_fields TEXT DEFAULT '["styleNo","productName","planQty","sewingStart","sewingEnd"]',
      left_fields TEXT DEFAULT '["workshop","lineTeam"]',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 工作模式
    CREATE TABLE IF NOT EXISTS work_modes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      working_hours REAL DEFAULT 8,
      shifts TEXT DEFAULT '["08:00-17:00"]',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 工作日历
    CREATE TABLE IF NOT EXISTS work_calendars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      work_mode_id INTEGER,
      work_days TEXT DEFAULT '1111100',
      start_date TEXT,
      end_date TEXT,
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 日历例外（节假日/调休）
    CREATE TABLE IF NOT EXISTS calendar_exceptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calendar_id INTEGER NOT NULL,
      exception_date TEXT NOT NULL,
      is_workday INTEGER DEFAULT 0,
      remark TEXT DEFAULT '',
      UNIQUE(calendar_id, exception_date)
    );

    -- 产线状态事件记录
    CREATE TABLE IF NOT EXISTS production_line_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      start_time TEXT,
      end_time TEXT,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 缝制车间款式分类（第三层）
    CREATE TABLE IF NOT EXISTS line_style_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0
    );

    -- 交期预估
    CREATE TABLE IF NOT EXISTS delivery_estimations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      style_id INTEGER,
      style_no TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      estimated_days INTEGER DEFAULT 0,
      estimated_start TEXT,
      estimated_end TEXT,
      status TEXT DEFAULT 'ESTIMATED',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 出货计划
    CREATE TABLE IF NOT EXISTS shipping_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_no TEXT NOT NULL,
      customer TEXT DEFAULT '',
      style_no TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      ship_date TEXT,
      status TEXT DEFAULT 'PLANNED',
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 排产策略
    CREATE TABLE IF NOT EXISTS scheduling_strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rule_type TEXT DEFAULT 'due_date',
      description TEXT DEFAULT '',
      config TEXT DEFAULT '{}',
      active INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 面料装柜清单
    CREATE TABLE IF NOT EXISTS fabric_loading_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inbound_date TEXT,
      supplier TEXT DEFAULT '',
      customer TEXT DEFAULT '',
      style_no TEXT DEFAULT '',
      pot_no TEXT DEFAULT '',
      fabric_name TEXT DEFAULT '',
      width TEXT DEFAULT '',
      weight TEXT DEFAULT '',
      color TEXT DEFAULT '',
      qty REAL DEFAULT 0,
      unit TEXT DEFAULT 'KG',
      total_pcs INTEGER DEFAULT 0,
      unit2 TEXT DEFAULT '匹',
      loading_date TEXT,
      loading_qty REAL DEFAULT 0,
      remark TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    -- 分色分尺码
    CREATE TABLE IF NOT EXISTS style_color_size (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_date TEXT DEFAULT '',
      style_no TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      product_name TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      color TEXT DEFAULT '',
      plan_qty INTEGER DEFAULT 0,
      created_at TEXT DEFAULT ''
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

  // 迁移：扩展 actual_production 表
  try {
    const apCols = db.prepare("PRAGMA table_info(actual_production)").all().map(c => c.name);
    if (!apCols.includes('worker_name')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN worker_name TEXT DEFAULT ''").run();
    }
    if (!apCols.includes('start_time')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN start_time TEXT DEFAULT ''").run();
    }
    if (!apCols.includes('end_time')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN end_time TEXT DEFAULT ''").run();
    }
    if (!apCols.includes('secondary_type')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN secondary_type TEXT DEFAULT ''").run();
    }
  } catch (e) { console.log('actual_production migration skip:', e.message); }

  try {
    const stcols = db.prepare("PRAGMA table_info(styles)").all().map(c => c.name);
    if (!stcols.includes('priority')) {
      db.prepare("ALTER TABLE styles ADD COLUMN priority INTEGER DEFAULT 3").run();
    }
  } catch (e) { console.log('styles priority migration skip:', e.message); }

  // 款式分类字段迁移
  try {
    const sccols = db.prepare("PRAGMA table_info(styles)").all().map(c => c.name);
    if (!sccols.includes('style_category')) {
      db.prepare("ALTER TABLE styles ADD COLUMN style_category TEXT DEFAULT ''").run();
    }
  } catch (e) { console.log('style_category migration skip:', e.message); }

  // 装柜清单添加成衣数量字段
  try {
    const flcols = db.prepare("PRAGMA table_info(fabric_loading_list)").all().map(c => c.name);
    if (!flcols.includes('garment_qty')) {
      db.prepare("ALTER TABLE fabric_loading_list ADD COLUMN garment_qty REAL DEFAULT 0").run();
    }
  } catch (e) { console.log('garment_qty migration skip:', e.message); }

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

  // 新增4个日产量字段
  const newStyleCols = ['embroidery_daily_output', 'printing_daily_output', 'ironing_daily_output', 'template_daily_output']
  for (const col of newStyleCols) {
    if (!cols.includes(col)) {
      db.prepare(`ALTER TABLE styles ADD COLUMN ${col} INTEGER DEFAULT 0`).run()
    }
  }

  // 迁移：仓库表添加面料库扩展字段
  const whFields = ['pot_no', 'fabric_name', 'supplier', 'customer', 'width', 'weight', 'unit', 'total_pcs', 'unit2', 'remark']
  for (const tbl of ['warehouse_inbound', 'warehouse_outbound', 'warehouse_inventory']) {
    for (const f of whFields) {
      try {
        const def = f === 'total_pcs' ? 'INTEGER DEFAULT 0' : f === 'unit' ? "TEXT DEFAULT 'KG'" : f === 'unit2' ? "TEXT DEFAULT '匹'" : "TEXT DEFAULT ''"
        db.prepare(`ALTER TABLE ${tbl} ADD COLUMN ${f} ${def}`).run()
      } catch { /* 已存在 */ }
    }
  }
  // 重建 inventory 唯一索引（加 pot_no）
  try {
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_fabric ON warehouse_inventory(warehouse_type, style_no, color, size_spec, pot_no)`).run()
  } catch { /* ignore */ }

  // 迁移：入库/出库加单号和装柜数量
  try { db.prepare("ALTER TABLE warehouse_inbound ADD COLUMN order_no TEXT DEFAULT ''").run() } catch {}
  try { db.prepare("ALTER TABLE warehouse_inbound ADD COLUMN loading_qty REAL DEFAULT 0").run() } catch {}
  try { db.prepare("ALTER TABLE warehouse_outbound ADD COLUMN order_no TEXT DEFAULT ''").run() } catch {}

  // 迁移：产线加日产量字段
  try { db.prepare("ALTER TABLE production_lines ADD COLUMN daily_output INTEGER DEFAULT 0").run() } catch {}
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

  // 工作日历种子数据
  const calCount = db.prepare('SELECT COUNT(*) as c FROM work_calendars').get().c;
  if (calCount === 0) {
    const modeResult = db.prepare("INSERT INTO work_modes (name, working_hours, shifts) VALUES ('常白班', 8, '[\"08:00-12:00\",\"13:00-17:00\"]')").run();
    db.prepare("INSERT INTO work_calendars (name, work_mode_id, work_days, start_date, end_date, priority, enabled) VALUES ('默认工作日历', ?, '1111100', '2025-01-01', '2027-12-31', 0, 1)").run(modeResult.lastInsertRowid);
    console.log('✅ 工作日历种子数据已生成');
  }

  // 甘特图字段配置种子数据
  const ganttCount = db.prepare('SELECT COUNT(*) as c FROM gantt_field_config').get().c;
  if (ganttCount === 0) {
    const insGantt = db.prepare('INSERT OR IGNORE INTO gantt_field_config (schedule_type, bar_fields, tooltip_fields, left_fields) VALUES (?,?,?,?)');
    insGantt.run('sewing', '["styleNo","planQty"]', '["styleNo","productName","planQty","sewingStart","sewingEnd"]', '["workshop","lineTeam"]');
    insGantt.run('cutting', '["styleNo","planQty"]', '["styleNo","productName","planQty","cuttingStart","cuttingEnd"]', '["workshop"]');
    insGantt.run('secondary', '["styleNo","planQty"]', '["styleNo","productName","planQty","secondaryType"]', '["workshop"]');
  }

  console.log('✅ 数据库初始化完成：5个车间、50条产线、20款式');

  // 排产策略种子数据
  const stratCount = db.prepare('SELECT COUNT(*) as c FROM scheduling_strategies').get().c;
  if (stratCount === 0) {
    const insStrat = db.prepare('INSERT INTO scheduling_strategies (name, rule_type, description, config, active) VALUES (?,?,?,?,?)');
    insStrat.run('交期优先', 'due_date', '按交期从近到远排序，紧急订单优先排产', '{"sortField":"due_date","sortDir":"asc","prioritizeUrgent":true}', 1);
    insStrat.run('批量优先', 'batch_size', '大批量订单优先排产，减少换线次数', '{"sortField":"plan_qty","sortDir":"desc","minimizeChangeover":true}', 0);
    insStrat.run('均衡排产', 'balanced', '综合考虑交期、产能、换线，均衡分配', '{"sortField":"priority","sortDir":"asc","balanceLoad":true}', 0);
    console.log('✅ 排产策略种子数据已生成');
  }
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
// 任务状态计算
// ============================================================
function recalcTaskStatus(masterId) {
  try {
    const master = db.prepare('SELECT * FROM schedule_master WHERE id = ?').get(masterId);
    if (!master) return;

    // 计算实际总完成量
    const actual = db.prepare(
      "SELECT COALESCE(SUM(qty), 0) as total FROM schedule_daily WHERE master_id = ? AND row_type = 'ACTUAL'"
    ).get(masterId);

    const planQty = master.plan_qty || 0;
    const actualQty = actual.total || 0;
    const progressPct = planQty > 0 ? Math.min(Math.round(actualQty * 100 / planQty), 100) : 0;

    let taskStatus = 'PENDING';
    if (actualQty > 0 && progressPct >= 100) {
      taskStatus = 'COMPLETED';
    } else if (actualQty > 0) {
      taskStatus = 'IN_PROGRESS';
    }

    db.prepare('UPDATE schedule_master SET task_status = ?, progress_pct = ? WHERE id = ?')
      .run(taskStatus, progressPct, masterId);
  } catch (e) { console.error('recalcTaskStatus error:', e.message); }
}

// ============================================================
// 自动排产算法（贪心）
// ============================================================
function autoSchedule(strategyId) {
  try {
    const strategy = strategyId
      ? db.prepare('SELECT * FROM scheduling_strategies WHERE id = ?').get(strategyId)
      : db.prepare('SELECT * FROM scheduling_strategies WHERE active = 1').get();

    if (!strategy) return { error: '未找到排产策略' };

    const config = JSON.parse(strategy.config || '{}');
    const sortField = config.sortField || 'due_date';

    let orderBy = sortField === 'priority' ? 'priority ASC, due_date ASC' :
                  sortField === 'plan_qty' ? 'plan_qty DESC' :
                  'due_date ASC';

    const unplanned = db.prepare(`SELECT * FROM main_plan WHERE is_scheduled = 0 OR is_scheduled IS NULL ORDER BY ${orderBy}`).all();
    if (unplanned.length === 0) return { message: '没有待排产的计划', scheduled: 0 };

    const lines = db.prepare("SELECT * FROM production_lines WHERE status != '故障' ORDER BY sort_order").all();
    const workshops = db.prepare('SELECT * FROM workshops ORDER BY sort_order').all();
    const sewingCap = db.get("SELECT daily_capacity FROM capacity_config WHERE process_type = 'sewing'");
    const dailyCapacity = sewingCap?.daily_capacity || 800;

    let scheduled = 0;
    let lineIdx = 0;

    const txn = db.transaction(() => {
      for (const plan of unplanned) {
        if (lines.length === 0) break;
        if (lineIdx >= lines.length) lineIdx = 0;

        const line = lines[lineIdx];
        const workshop = workshops.find(w => w.id === line.workshop_id);
        const sewingDays = Math.ceil((plan.plan_qty || 0) / dailyCapacity);
        const startDate = plan.sewing_start || plan.cutting_start || fmtLocal(new Date());
        const endDate = plan.sewing_end || addWorkdays(startDate, sewingDays);

        db.run('UPDATE main_plan SET is_scheduled = 1, workshop = ?, line_team = ? WHERE id = ?',
          [workshop?.name || '', line.line_name, plan.id]);

        const result = db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, plan_qty, plan_start, plan_end, workshop, line_team, daily_target, due_date)
          VALUES ('sewing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [plan.style_id, plan.style_no, plan.product_name, plan.plan_qty, startDate, endDate, workshop?.name || '', line.line_name, dailyCapacity, plan.due_date || '']);

        if (startDate && endDate && plan.plan_qty > 0) {
          generatePlanRows(result.lastInsertRowid, startDate, endDate, plan.plan_qty);
        }

        lineIdx++;
        scheduled++;
      }
    });
    txn();

    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    broadcastSection('schedule_sewing', db.all("SELECT * FROM schedule_master WHERE schedule_type = 'sewing'"));
    logOperation('scheduling', 'auto_schedule', strategyId, strategy.name, `自动排产${scheduled}条`);

    return { ok: true, scheduled, strategy: strategy.name };
  } catch (e) {
    console.error('autoSchedule error:', e);
    return { error: e.message };
  }
}

// ============================================================
// 产能预排（验证可行性）
// ============================================================
function capacityPrecheck() {
  try {
    const plans = db.prepare("SELECT * FROM main_plan WHERE is_scheduled = 0 OR is_scheduled IS NULL").all();
    if (plans.length === 0) return { message: '没有待排产的计划', plans: [] };

    const sewingCap = db.get("SELECT daily_capacity FROM capacity_config WHERE process_type = 'sewing'");
    const dailyCapacity = sewingCap?.daily_capacity || 800;
    const lines = db.prepare("SELECT * FROM production_lines WHERE status != '故障'").all();
    const lineCount = lines.length;

    const results = plans.map(p => {
      const sewingDays = Math.ceil((p.plan_qty || 0) / dailyCapacity);
      const parallelDays = Math.ceil(sewingDays / Math.max(lineCount, 1));
      return {
        id: p.id, style_no: p.style_no, plan_qty: p.plan_qty,
        sewing_days: sewingDays, parallel_days: parallelDays,
        due_date: p.due_date, is_feasible: true,
        warning: parallelDays > 30 ? '排程周期过长，建议增加产线或分批' : null,
      };
    });

    return { ok: true, plans: results, lineCount, dailyCapacity };
  } catch (e) {
    console.error('capacityPrecheck error:', e);
    return { error: e.message };
  }
}

// ============================================================
// 工作日历辅助函数
// ============================================================
function isWorkday(dateStr) {
  // 获取当前启用的日历
  const cal = db.prepare('SELECT * FROM work_calendars WHERE enabled = 1 ORDER BY priority DESC LIMIT 1').get();
  if (!cal) return true; // 无日历配置，默认每天都是工作日

  // 检查例外日期
  const exception = db.prepare('SELECT is_workday FROM calendar_exceptions WHERE calendar_id = ? AND exception_date = ?').get(cal.id, dateStr);
  if (exception) return exception.is_workday === 1;

  // 检查工作日位（周一~周日）
  const d = new Date(dateStr + 'T00:00:00');
  const dayOfWeek = d.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const idx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 转为 0=周一, ..., 6=周日
  return cal.work_days[idx] === '1';
}

function addWorkdays(startDate, days) {
  let current = new Date(startDate + 'T00:00:00');
  let remaining = days;
  while (remaining > 0) {
    current.setDate(current.getDate() + 1);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    if (isWorkday(`${y}-${m}-${d}`)) remaining--;
  }
  const y = current.getFullYear();
  const m = String(current.getMonth() + 1).padStart(2, '0');
  const d = String(current.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  isWorkday, addWorkdays,
  recalcTaskStatus,
  autoSchedule, capacityPrecheck,
};
