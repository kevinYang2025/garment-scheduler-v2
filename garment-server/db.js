const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');  // [2026-06-18] 用户系统:密码哈希

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
  db.pragma('synchronous = NORMAL');     // WAL 模式下安全且 ~2x 写入
  db.pragma('temp_store = MEMORY');      // 临时表/索引放内存,减少磁盘 IO
  db.pragma('mmap_size = 268435456');    // 256 MB memory-mapped I/O
  db.pragma('cache_size = -64000');      // 64 MB page cache
  db.pragma('foreign_keys = ON');
  createTables();
  migrateStyles();
  migrateUserColumns();
  seedDefaultData();
  seedSystemConfig();  // [2026-06-19] system_config 每次启动 OR REPLACE,确保新参数生效
  seedUsers();
  migratePinHashes();  // [fix] 迁移旧明文 PIN 为 bcrypt 哈希
  seedMainPlan();
  return db;
}

function getDb() {
  if (!db) init();
  return db;
}

// [2026-06-20 fix#后端-P1-2] per-Database prepared statement 缓存
// better-sqlite3 的 .prepare() 每次都新建 Statement,SQL 不变时复用更快
// 用 WeakMap 绑到 rawDb 实例,事务/多连接不会互相干扰
const __stmtCache = new WeakMap();
function cachedPrepare(conn, sql) {
  let cache = __stmtCache.get(conn);
  if (!cache) { cache = new Map(); __stmtCache.set(conn, cache); }
  let stmt = cache.get(sql);
  if (!stmt) { stmt = conn.prepare(sql); cache.set(sql, stmt); }
  return stmt;
}
function getStmtCacheStats() {
  const out = [];
  for (const [k, v] of (db ? [[db, __stmtCache.get(db) || new Map()]] : [])) {
    out.push({ size: v.size });
  }
  return out;
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

    -- 系统参数（key/value 通用配置）
    CREATE TABLE IF NOT EXISTS system_params (
      key TEXT PRIMARY KEY,
      value TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
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

    -- [B-01 fix] 计划覆盖：用户手动编辑 daily-plan 时的"覆盖值"
    -- 之前用 actual_production.schedule_type='plan_override_<type>' 复用,语义混乱
    -- 拆出来独立成表
    CREATE TABLE IF NOT EXISTS schedule_plan_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      secondary_type TEXT NOT NULL,    -- printing/embroidery/template/ironing
      style_no TEXT NOT NULL,
      color TEXT DEFAULT '',
      size_spec TEXT DEFAULT '',
      production_date TEXT NOT NULL,
      qty INTEGER DEFAULT 0,
      UNIQUE(secondary_type, style_no, color, size_spec, production_date)
    );

    -- 用户表(2026-06-18 用户系统新增)
    -- 5 角色:admin / planning_manager / planner / dispatcher / supervisor
    -- workshop 必填规则:dispatcher / supervisor 必须填(admin / planning_manager / planner 为 NULL)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,           -- 账号(admin/planner/supervisor)
      username_km TEXT,                -- 高棉文账号(dispatcher 报工员)
      pin TEXT,                        -- 4 位 PIN(dispatcher 专用,NULL 表示不用)
      password_hash TEXT,              -- bcrypt 哈希(NULL 表示不用)
      display_name TEXT NOT NULL,      -- 中文姓名
      display_name_km TEXT,            -- 高棉文姓名
      role TEXT NOT NULL CHECK(role IN
        ('admin','planning_manager','planner','dispatcher','supervisor')),
      workshop TEXT CHECK(workshop IN
        ('cutting','printing','embroidery','template','ironing','sewing')),
      active INTEGER DEFAULT 1,        -- 软删除
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
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
    // [2026-06-20 Z-15] 裁剪一/二检完成标志 + 时间戳
    if (!scols2.includes('first_inspection_completed_at')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN first_inspection_completed_at TEXT DEFAULT ''").run();
    }
    if (!scols2.includes('second_inspection_completed_at')) {
      db.prepare("ALTER TABLE schedule_master ADD COLUMN second_inspection_completed_at TEXT DEFAULT ''").run();
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

  // 装柜清单添加成衣计划数量字段
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

  try {
    const mpcols2 = db.prepare("PRAGMA table_info(main_plan)").all().map(c => c.name);
    if (!mpcols2.includes('ironing_start')) db.prepare("ALTER TABLE main_plan ADD COLUMN ironing_start TEXT DEFAULT ''").run();
    if (!mpcols2.includes('ironing_end')) db.prepare("ALTER TABLE main_plan ADD COLUMN ironing_end TEXT DEFAULT ''").run();
    if (!mpcols2.includes('conflict_flag')) db.prepare("ALTER TABLE main_plan ADD COLUMN conflict_flag INTEGER DEFAULT 0").run();
    if (!mpcols2.includes('printing_start')) db.prepare("ALTER TABLE main_plan ADD COLUMN printing_start TEXT DEFAULT ''").run();
    if (!mpcols2.includes('printing_end')) db.prepare("ALTER TABLE main_plan ADD COLUMN printing_end TEXT DEFAULT ''").run();
    if (!mpcols2.includes('embroidery_start')) db.prepare("ALTER TABLE main_plan ADD COLUMN embroidery_start TEXT DEFAULT ''").run();
    if (!mpcols2.includes('embroidery_end')) db.prepare("ALTER TABLE main_plan ADD COLUMN embroidery_end TEXT DEFAULT ''").run();
    if (!mpcols2.includes('template_start')) db.prepare("ALTER TABLE main_plan ADD COLUMN template_start TEXT DEFAULT ''").run();
    if (!mpcols2.includes('template_end')) db.prepare("ALTER TABLE main_plan ADD COLUMN template_end TEXT DEFAULT ''").run();
    if (!mpcols2.includes('arrival_date')) db.prepare("ALTER TABLE main_plan ADD COLUMN arrival_date TEXT DEFAULT ''").run();
    if (!mpcols2.includes('line_count')) db.prepare("ALTER TABLE main_plan ADD COLUMN line_count INTEGER DEFAULT 1").run();
    if (!mpcols2.includes('line_index')) db.prepare("ALTER TABLE main_plan ADD COLUMN line_index INTEGER DEFAULT 1").run();
    if (!mpcols2.includes('expired')) db.prepare("ALTER TABLE main_plan ADD COLUMN expired INTEGER DEFAULT 0").run();
  } catch (e) { console.log('main_plan ironing/conflict migration skip:', e.message); }

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

  // [2026-06-20 Z-07] actual_production 加 UNIQUE 索引,防 sewing-daily-plan/actual 竞态
  // 1) dedup 历史重复(保留最大 id)
  // 2) 创建 UNIQUE 索引
  try {
    const dups = db.prepare(`
      SELECT style_no, color, size_spec, production_date, schedule_type, secondary_type, COALESCE(is_second_inspection,0) AS sii, COUNT(*) c
      FROM actual_production
      GROUP BY style_no, color, size_spec, production_date, schedule_type, secondary_type, sii
      HAVING c > 1
    `).all();
    if (dups.length > 0) {
      const dedupTxn = db.transaction(() => {
        let removed = 0;
        for (const d of dups) {
          const rows = db.prepare(`
            SELECT id FROM actual_production
            WHERE style_no = ? AND color = ? AND size_spec = ? AND production_date = ?
              AND schedule_type = ? AND secondary_type = ?
              AND COALESCE(is_second_inspection,0) = ?
            ORDER BY id DESC
          `).all(d.style_no, d.color, d.size_spec, d.production_date, d.schedule_type, d.secondary_type, d.sii);
          // 保留第一行(最大 id,最新),删除其余
          for (let i = 1; i < rows.length; i++) {
            db.prepare('DELETE FROM actual_production WHERE id = ?').run(rows[i].id);
            removed++;
          }
        }
        return removed;
      });
      const removed = dedupTxn();
      console.log(`✅ actual_production dedup: 删除 ${removed} 条重复记录 (${dups.length} 组)`);
    }
    // 创建 UNIQUE 索引(若不存在)
    const idxExists = db.prepare(`
      SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_actual_production_unique'
    `).get();
    if (!idxExists) {
      db.prepare(`
        CREATE UNIQUE INDEX idx_actual_production_unique
        ON actual_production(style_no, color, size_spec, production_date, schedule_type, secondary_type, is_second_inspection)
      `).run();
      console.log('✅ 创建 UNIQUE INDEX idx_actual_production_unique');
    }
  } catch (e) {
    console.log('actual_production UNIQUE index migration skip:', e.message);
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
  // [2026-06-20 Z-12] 把 NULL 强制置 0,防御历史数据
  try { db.prepare("UPDATE production_lines SET daily_output = 0 WHERE daily_output IS NULL").run() } catch {}

  // 迁移：产线-款式分类加日产量字段(autoSchedule 用)
  try { db.prepare("ALTER TABLE line_style_categories ADD COLUMN daily_output INTEGER DEFAULT 0").run() } catch {}
  // [2026-06-20 Z-12] 把 NULL 强制置 0,防御历史数据
  try { db.prepare("UPDATE line_style_categories SET daily_output = 0 WHERE daily_output IS NULL").run() } catch {}

  // [2026-06-20 Z-12] styles 表 5 个 daily_output 字段同样兜底
  const styleDailyFields = ['target_daily_output', 'embroidery_daily_output', 'printing_daily_output', 'ironing_daily_output', 'template_daily_output'];
  for (const f of styleDailyFields) {
    try { db.prepare(`UPDATE styles SET ${f} = 0 WHERE ${f} IS NULL`).run() } catch {}
  }

  // [2026-06-19] 一次性迁移:把仓库类型 cut_pieces 统一改为 cutting_piece(对齐 whNames + 现有 API)
  try {
    const r1 = db.prepare(`UPDATE warehouse_inbound SET warehouse_type = 'cutting_piece' WHERE warehouse_type = 'cut_pieces'`).run();
    const r2 = db.prepare(`UPDATE warehouse_inventory SET warehouse_type = 'cutting_piece' WHERE warehouse_type = 'cut_pieces'`).run();
    const r3 = db.prepare(`UPDATE warehouse_outbound SET warehouse_type = 'cutting_piece' WHERE warehouse_type = 'cut_pieces'`).run();
    if (r1.changes || r2.changes || r3.changes) {
      console.log(`✅ cut_pieces → cutting_piece 迁移: inbound=${r1.changes} inventory=${r2.changes} outbound=${r3.changes}`);
    }
  } catch (e) {
    console.warn('cut_pieces 迁移跳过:', e.message);
  }

  // [B-01 fix] 一次性迁移:把旧的 plan_override_<type> 行从 actual_production 复制到 schedule_plan_overrides
  // 完成后不删除旧行(保留审计);新代码不再读旧位置
  try {
    const oldOverrides = db.prepare(`
      SELECT * FROM actual_production
      WHERE schedule_type LIKE 'plan_override_%'
    `).all();
    if (oldOverrides.length > 0) {
      const ins = db.prepare(`
        INSERT OR IGNORE INTO schedule_plan_overrides
          (secondary_type, style_no, color, size_spec, production_date, qty)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      let migrated = 0;
      const txn = db.transaction(() => {
        for (const r of oldOverrides) {
          // schedule_type 形如 'plan_override_printing'
          const sec = String(r.schedule_type).replace(/^plan_override_/, '');
          ins.run(sec, r.style_no || '', r.color || '', r.size_spec || '',
                  r.production_date || '', r.completed_qty || 0);
          migrated++;
        }
      });
      txn();
      console.log(`✅ 迁移 plan_override 数据: ${migrated} 条 → schedule_plan_overrides`);
    }
  } catch (e) { console.log('plan_override migration skip:', e.message); }
}

// [2026-06-18] 用户系统:为已有表加 user_id / 锁字段
// - operation_logs: 加 user_id(写操作关联到具体人)
// - schedule_daily: 加 locked_by_user_id + locked_at(supervisor 改 ACTUAL 锁)
// [2026-06-20] 整函数包事务,DDL 失败回滚避免部分迁移导致 INSERT 静默失败
function migrateUserColumns() {
  const tx = db.transaction(() => {
    // operation_logs 加 user_id(nullable,历史日志留空)
    const opCols = db.prepare("PRAGMA table_info(operation_logs)").all().map(c => c.name);
    if (!opCols.includes('user_id')) {
      db.prepare("ALTER TABLE operation_logs ADD COLUMN user_id INTEGER REFERENCES users(id)").run();
      console.log('✅ operation_logs 加 user_id 字段');
    }

    // schedule_daily 加锁字段(nullable,历史数据默认未锁)
    const sdCols = db.prepare("PRAGMA table_info(schedule_daily)").all().map(c => c.name);
    if (!sdCols.includes('locked_by_user_id')) {
      db.prepare("ALTER TABLE schedule_daily ADD COLUMN locked_by_user_id INTEGER REFERENCES users(id)").run();
      console.log('✅ schedule_daily 加 locked_by_user_id 字段');
    }
    if (!sdCols.includes('locked_at')) {
      db.prepare("ALTER TABLE schedule_daily ADD COLUMN locked_at TEXT").run();
      console.log('✅ schedule_daily 加 locked_at 字段');
    }

    // users 加 avatar_url + username_km + display_name_km(nullable)
    const uCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!uCols.includes('avatar_url')) {
      db.prepare("ALTER TABLE users ADD COLUMN avatar_url TEXT").run();
      console.log('✅ users 加 avatar_url 字段');
    }
    if (!uCols.includes('username_km')) {
      db.prepare("ALTER TABLE users ADD COLUMN username_km TEXT").run();
      console.log('✅ users 加 username_km 字段');
    }
    if (!uCols.includes('display_name_km')) {
      db.prepare("ALTER TABLE users ADD COLUMN display_name_km TEXT").run();
      console.log('✅ users 加 display_name_km 字段');
    }

    // [2026-06-19] 特殊水洗 + 裁剪二检 + 裁剪参数 + system_params
    const sCols = db.prepare("PRAGMA table_info('styles')").all().map(c => c.name);
    if (!sCols.includes('has_special_wash')) {
      db.prepare("ALTER TABLE styles ADD COLUMN has_special_wash INTEGER DEFAULT 0").run();
      console.log('✅ styles 加 has_special_wash 字段');
    }

    const scsCols = db.prepare("PRAGMA table_info('style_color_size')").all().map(c => c.name);
    if (!scsCols.includes('cutting_param')) {
      db.prepare("ALTER TABLE style_color_size ADD COLUMN cutting_param INTEGER DEFAULT 0").run();
      console.log('✅ style_color_size 加 cutting_param 字段');
    }
    // backfill: cutting_param 默认 = plan_qty
    db.prepare("UPDATE style_color_size SET cutting_param = plan_qty WHERE cutting_param = 0 AND plan_qty > 0").run();

    const apCols = db.prepare("PRAGMA table_info('actual_production')").all().map(c => c.name);
    if (!apCols.includes('is_second_inspection')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN is_second_inspection INTEGER DEFAULT 0").run();
      console.log('✅ actual_production 加 is_second_inspection 字段');
    }
    if (!apCols.includes('source_type')) {
      db.prepare("ALTER TABLE actual_production ADD COLUMN source_type TEXT DEFAULT ''").run();
      console.log('✅ actual_production 加 source_type 字段');
    }

    // system_params 默认值
    const paramCount = db.prepare("SELECT COUNT(*) as c FROM system_params WHERE key = ?").get('special_wash_days');
    if (!paramCount || paramCount.c === 0) {
      db.prepare("INSERT INTO system_params (key, value, remark) VALUES (?, ?, ?)").run(
        'special_wash_days', '7', '特殊水洗前置天数（裁剪排期前置）'
      );
      console.log('✅ system_params 初始化 special_wash_days=7');
    }
  });
  try { tx(); } catch (e) { console.error('migrateUserColumns 失败(已回滚):', e.message); }
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

// [2026-06-19] system_config 独立 seed:每次启动 OR REPLACE,新增参数可即时生效
function seedSystemConfig() {
  const insCfg = db.prepare('INSERT OR REPLACE INTO system_config (config_key, config_value, description) VALUES (?, ?, ?)');
  insCfg.run('shipping_buffer_days', '5', '缝制到出货缓冲天数');
  insCfg.run('picking_days', '3', '裁剪1检转运时间');
  insCfg.run('line_change_days', '0.5', '换线时间（天）');
  insCfg.run('loading_to_arrival_days', '15', '装柜到货天数');
  insCfg.run('fabric_inspection_days', '9', '面料检验天数');
  insCfg.run('sewing_remind_days', '10', '缝制提前提醒天数');
  insCfg.run('ironing_buffer_days', '3', '烫标完成缓冲天数');
  insCfg.run('max_sewing_lines', '49', '全厂缝制线数上限');
  insCfg.run('default_daily_target', '500', '缝制日产量兜底');
}

// [2026-06-18] 用户系统:种子用户(首次启动插入 19 个账号)
// 守护:已存在则跳过,避免重启重复插
// - admin / admin123(首登后建议改密)
// - 其他账号默认密码 123456 / PIN 1234(部署后由 admin 通过 /api/users 修改)
function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (count > 0) return;

  const adminHash = bcrypt.hashSync('admin123', 12);
  const defaultHash = bcrypt.hashSync('123456', 12);

  const ins = db.prepare(`INSERT INTO users (username, pin, password_hash, display_name, role, workshop, active)
    VALUES (?, ?, ?, ?, ?, ?, 1)`);

  const txn = db.transaction(() => {
    // 1 个 admin
    ins.run('admin', null, adminHash, '系统管理员', 'admin', null);

    // 1 planning_manager + 3 planner
    ins.run('manager01', null, defaultHash, '计划主管', 'planning_manager', null);
    ins.run('planner01', null, defaultHash, '计划员01', 'planner', null);
    ins.run('planner02', null, defaultHash, '计划员02', 'planner', null);
    ins.run('planner03', null, defaultHash, '计划员03', 'planner', null);

    // 7 supervisor(缝制 × 2 + 裁/印/绣/模/烫各 × 1)
    ins.run('sup_cutting', null, defaultHash, '裁剪主任', 'supervisor', 'cutting');
    ins.run('sup_printing', null, defaultHash, '印花主任', 'supervisor', 'printing');
    ins.run('sup_embroidery', null, defaultHash, '刺绣主任', 'supervisor', 'embroidery');
    ins.run('sup_template', null, defaultHash, '模板主任', 'supervisor', 'template');
    ins.run('sup_ironing', null, defaultHash, '烫标主任', 'supervisor', 'ironing');
    ins.run('sup_sewing_01', null, defaultHash, '缝制主任01', 'supervisor', 'sewing');
    ins.run('sup_sewing_02', null, defaultHash, '缝制主任02', 'supervisor', 'sewing');

    // 7 dispatcher(裁/印/绣/模/烫 + 缝制 × 2)
    const defaultPinHash = bcrypt.hashSync('1234', 12);
    ins.run('101', defaultPinHash, null, '裁剪报工员', 'dispatcher', 'cutting');
    ins.run('102', defaultPinHash, null, '印花报工员', 'dispatcher', 'printing');
    ins.run('103', defaultPinHash, null, '刺绣报工员', 'dispatcher', 'embroidery');
    ins.run('104', defaultPinHash, null, '模板报工员', 'dispatcher', 'template');
    ins.run('105', defaultPinHash, null, '烫标报工员(中国)', 'dispatcher', 'ironing');
    ins.run('201', defaultPinHash, null, '缝制报工员01', 'dispatcher', 'sewing');
    ins.run('202', defaultPinHash, null, '缝制报工员02', 'dispatcher', 'sewing');
  });
  txn();
  console.log('✅ 种子用户: 1 admin + 4 planning + 7 supervisor + 7 dispatcher = 19 个');
  console.log('   默认账号: admin/admin123, 其他 123456 / PIN 1234(请尽快修改)');
}

// [fix] 迁移旧明文 PIN 为 bcrypt 哈希(兼容已有数据库)
function migratePinHashes() {
  const users = db.prepare('SELECT id, pin FROM users WHERE pin IS NOT NULL').all();
  let migrated = 0;
  for (const u of users) {
    // bcrypt 哈希以 $2a$/$2b$ 开头，长度 60；如果不是哈希格式则为明文
    if (u.pin && !u.pin.startsWith('$2')) {
      db.prepare('UPDATE users SET pin = ? WHERE id = ?').run(bcrypt.hashSync(u.pin, 12), u.id);
      migrated++;
    }
  }
  if (migrated > 0) console.log(`✅ PIN 迁移: ${migrated} 个明文 PIN 已哈希`);
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
  try { return cachedPrepare(db, sql).all(...params); }
  catch (e) { console.error('DB all error:', sql, e.message); throw e; }
}
function get(sql, params = []) {
  try { return cachedPrepare(db, sql).get(...params); }
  catch (e) { console.error('DB get error:', sql, e.message); throw e; }
}
function run(sql, params = []) {
  try { return cachedPrepare(db, sql).run(...params); }
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
    if (!master) return { ok: false, error: 'master not found' };

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

    // [2026-06-20 Z-15] 裁剪一/二检完成检测:
    // cutting schedule_master 当 sum(actual is_second_inspection=0) >= plan_qty → 一检完成
    //                                  is_second_inspection=1) >= plan_qty → 二检完成
    // 仅在 schedule_type='cutting' 时生效
    // 注: actual_production.style_id 经常为 0(写入时未填),所以用 style_no 匹配
    let firstAt = '';
    let secondAt = '';
    if (master.schedule_type === 'cutting' && planQty > 0 && master.style_no) {
      const firstActual = db.prepare(
        "SELECT COALESCE(SUM(completed_qty), 0) as total FROM actual_production WHERE style_no = ? AND color = ? AND size_spec = ? AND schedule_type = 'cutting' AND COALESCE(is_second_inspection, 0) = 0"
      ).get(master.style_no, master.color || '', master.size_spec || '');
      const secondActual = db.prepare(
        "SELECT COALESCE(SUM(completed_qty), 0) as total FROM actual_production WHERE style_no = ? AND color = ? AND size_spec = ? AND schedule_type = 'cutting' AND COALESCE(is_second_inspection, 0) = 1"
      ).get(master.style_no, master.color || '', master.size_spec || '');
      if ((firstActual.total || 0) >= planQty) {
        // 已写过则保留,否则写入当前时间
        firstAt = master.first_inspection_completed_at || db.prepare("SELECT datetime('now','localtime') as t").get().t;
      }
      if ((secondActual.total || 0) >= planQty) {
        secondAt = master.second_inspection_completed_at || db.prepare("SELECT datetime('now','localtime') as t").get().t;
      }
    }

    db.prepare('UPDATE schedule_master SET task_status = ?, progress_pct = ?, first_inspection_completed_at = COALESCE(NULLIF(?, \'\'), first_inspection_completed_at), second_inspection_completed_at = COALESCE(NULLIF(?, \'\'), second_inspection_completed_at) WHERE id = ?')
      .run(taskStatus, progressPct, firstAt, secondAt, masterId);
    return { ok: true };
  } catch (e) {
    // [2026-06-20 fix#业务-P1-11] 返回失败状态而非只 log,调用方可在 transaction 外
    // 显式记入操作日志(operation_logs),便于事故复盘
    // 注:这里不抛错以避免回滚外层 transaction,调用方接住返回值后自行 logOp
    console.error('recalcTaskStatus error:', e.message);
    return { ok: false, error: e.message };
  }
}

// ============================================================
// 自动排产算法（按款式分类匹配产线）
// ============================================================
function autoSchedule(strategyId, userId) {
  try {
    const strategy = strategyId
      ? db.prepare('SELECT * FROM scheduling_strategies WHERE id = ?').get(strategyId)
      : db.prepare('SELECT * FROM scheduling_strategies WHERE active = 1').get();

    if (!strategy) return { error: '未找到排产策略' };

    const config = JSON.parse(strategy.config || '{}');
    const sortField = config.sortField || 'due_date';

    // P0 安全: orderBy 白名单,防止 SQL 注入
    const ORDER_BY_WHITELIST = {
      priority: 'priority ASC, due_date ASC',
      plan_qty: 'plan_qty DESC',
      due_date: 'due_date ASC',
    };
    const orderBy = ORDER_BY_WHITELIST[sortField] || ORDER_BY_WHITELIST.due_date;

    // 1. 获取未排产的计划
    const unplanned = db.prepare(`SELECT * FROM main_plan WHERE is_scheduled = 0 OR is_scheduled IS NULL ORDER BY ${orderBy}`).all();
    if (unplanned.length === 0) return { message: '没有待排产的计划', scheduled: 0 };

    // 2. 获取款式信息（含 style_category）
    const styleMap = {};
    const styles = db.prepare('SELECT * FROM styles').all();
    for (const s of styles) styleMap[s.style_no] = s;

    // 3. 获取产线信息
    const lines = db.prepare("SELECT * FROM production_lines WHERE status != '故障' ORDER BY sort_order").all();
    const workshops = db.prepare('SELECT * FROM workshops ORDER BY sort_order').all();

    // 4. 获取产线-款式分类映射
    const lineCategories = db.prepare('SELECT * FROM line_style_categories').all();
    // 建立索引：line_id → [{name, dailyOutput}]
    const lineCatMap = {};
    for (const lc of lineCategories) {
      if (!lineCatMap[lc.line_id]) lineCatMap[lc.line_id] = [];
      lineCatMap[lc.line_id].push({ name: lc.name, dailyOutput: lc.daily_output || 0 });
    }
    // 建立索引：category_name → [line_id]（快速查找哪些线能产某类款式）
    const categoryLineMap = {};
    for (const lc of lineCategories) {
      if (!categoryLineMap[lc.name]) categoryLineMap[lc.name] = [];
      categoryLineMap[lc.name].push(lc.line_id);
    }

    // 5. 记录每条线已分配的负荷（用于负载均衡）
    const lineLoad = {};
    for (const l of lines) lineLoad[l.id] = 0;

    let scheduled = 0;
    let skipped = 0;
    const skippedReasons = [];

    const txn = db.transaction(() => {
      for (const plan of unplanned) {
        const style = styleMap[plan.style_no];
        const category = style?.style_category || '';

        // 确定日产能：优先用款式自己的 target_daily_output
        let dailyCapacity = style?.target_daily_output || 0;

        // 找到能产该款式分类的产线
        let candidateLineIds = [];
        if (category && categoryLineMap[category]) {
          candidateLineIds = categoryLineMap[category];
        } else {
          skipped++;
          skippedReasons.push(plan.style_no + ': 无款式分类或无匹配产线');
          continue;
        }

        if (candidateLineIds.length === 0) {
          skipped++;
          skippedReasons.push(plan.style_no + ': 无可用产线');
          continue;
        }

        // 在候选产线中选负荷最小的（负载均衡）
        let bestLineId = null;
        let minLoad = Infinity;
        for (const lid of candidateLineIds) {
          if (lineLoad[lid] < minLoad) {
            minLoad = lineLoad[lid];
            bestLineId = lid;
          }
        }
        // 选完即用,不让后续款式重复占用同一条线导致超负荷
        if (bestLineId !== null) {
          // 把候选池里这条线标记为不可再用
          for (let i = candidateLineIds.length - 1; i >= 0; i--) {
            if (candidateLineIds[i] === bestLineId) candidateLineIds.splice(i, 1);
          }
        }

        const line = lines.find(l => l.id === bestLineId);
        if (!line) {
          skipped++;
          skippedReasons.push(plan.style_no + ': 产线数据异常');
          continue;
        }

        // 如果款式没有自定义日产能，用产线的日产能
        if (dailyCapacity <= 0) {
          const lcEntry = lineCatMap[line.id]?.find(c => c.name === category);
          dailyCapacity = lcEntry?.dailyOutput || line.daily_output || 800;
        }

        const workshop = workshops.find(w => w.id === line.workshop_id);
        const sewingDays = Math.ceil((plan.plan_qty || 0) / dailyCapacity);
        const startDate = plan.sewing_start || plan.cutting_start || fmtLocal(new Date());
        const endDate = plan.sewing_end || addWorkdays(startDate, sewingDays);

        // 更新 main_plan
        db.run('UPDATE main_plan SET is_scheduled = 1, workshop = ?, line_team = ? WHERE id = ?',
          [workshop?.name || '', line.line_name, plan.id]);

        // 写入缝制排程
        const result = db.run(`INSERT INTO schedule_master (schedule_type, style_id, style_no, product_name, plan_qty, plan_start, plan_end, workshop, line_team, daily_target, due_date)
          VALUES ('sewing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [plan.style_id, plan.style_no, plan.product_name, plan.plan_qty, startDate, endDate, workshop?.name || '', line.line_name, dailyCapacity, plan.due_date || '']);

        if (startDate && endDate && plan.plan_qty > 0) {
          generatePlanRows(result.lastInsertRowid, startDate, endDate, plan.plan_qty);
        }

        lineLoad[line.id] += sewingDays;
        scheduled++;
      }

      // ========== 自动生成印花排程（保留原有逻辑）==========
      const printingStyles = db.prepare("SELECT * FROM styles WHERE printing = '是' AND printing_daily_output > 0").all();
      const mainPlanAll = db.prepare("SELECT style_no, printing_start, printing_end FROM main_plan WHERE printing_start != '' AND printing_start IS NOT NULL").all();
      const printingPlanMap = {};
      for (const p of mainPlanAll) {
        if (!printingPlanMap[p.style_no] || (p.printing_start < printingPlanMap[p.style_no].printing_start)) {
          printingPlanMap[p.style_no] = p;
        }
      }
      let printingCount = 0;
      for (const style of printingStyles) {
        const mp = printingPlanMap[style.style_no];
        if (!mp || !mp.printing_start || !mp.printing_end) continue;
        const colorSizes = db.prepare("SELECT * FROM style_color_size WHERE style_no = ?").all(style.style_no);
        for (const cs of colorSizes) {
          const exists = db.prepare("SELECT id FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing' AND style_no=? AND color=? AND size_spec=?").get(cs.style_no, cs.color || '', cs.size_spec || '');
          if (exists || !(cs.plan_qty > 0)) continue;
          const r = db.prepare(`INSERT INTO schedule_master (schedule_type, secondary_type, style_id, style_no, product_name, color, size_spec, plan_qty, cutting_plan_qty, plan_start, plan_end, daily_target, due_date)
            VALUES ('secondary','printing',?,?,?,?,?,?,?,?,?,?,?)`).run(
            style.id, style.style_no, style.product_name, cs.color || '', cs.size_spec || '', cs.plan_qty, cs.plan_qty, mp.printing_start, mp.printing_end, style.printing_daily_output || 0, style.due_date || ''
          );
          generatePlanRows(r.lastInsertRowid, mp.printing_start, mp.printing_end, cs.plan_qty);
          printingCount++;
        }
      }
      if (printingCount > 0) {
        broadcastSection('schedule_secondary', db.prepare("SELECT * FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing'").all());
      }
    });
    txn();

    broadcastSection('mainPlan', db.all('SELECT * FROM main_plan'));
    broadcastSection('schedule_sewing', db.all("SELECT * FROM schedule_master WHERE schedule_type = 'sewing'"));
    logOperation('scheduling', 'auto_schedule', strategyId, strategy.name, `自动排产${scheduled}条，跳过${skipped}条`, userId);

    const result = { ok: true, scheduled, strategy: strategy.name };
    if (skipped > 0) {
      result.skipped = skipped;
      result.skippedReasons = skippedReasons.slice(0, 10);
    }
    return result;
  } catch (e) {
    console.error('autoSchedule error:', e);
    return { error: '自动排产失败，请检查数据' };
  }
}

// ============================================================
// 产能预排（验证可行性）
// ============================================================
function capacityPrecheck() {
  try {
    const plans = db.prepare("SELECT * FROM main_plan WHERE is_scheduled = 0 OR is_scheduled IS NULL").all();
    if (plans.length === 0) return { message: '没有待排产的计划', plans: [] };

    const sewingCap = db.prepare("SELECT daily_capacity FROM capacity_config WHERE process_type = 'sewing'").get();
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
  // [2026-06-20 fix#后端-P1-6] 入参防御 + 循环上限 1000,防异常 plan_qty 触发长循环
  //   之前 guard=days*3+365,days=1000 → 3365 次循环,每次 isWorkday 查库
  //   现:days 上限 365,guard 上限 1000
  days = Math.max(0, Math.min(365, parseInt(days) || 0));
  let current = new Date(startDate + 'T00:00:00');
  let remaining = days;
  let guard = 1000;
  while (remaining > 0 && guard-- > 0) {
    current.setDate(current.getDate() + 1);
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    if (isWorkday(`${y}-${m}-${d}`)) remaining--;
  }
  if (remaining > 0) {
    console.error(`addWorkdays: exceeded max iterations for ${startDate}+${days}d, check calendar config`);
  }
  const y = current.getFullYear();
  const m = String(current.getMonth() + 1).padStart(2, '0');
  const d = String(current.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ============================================================
// 操作日志
// ============================================================
// [2026-06-18] 加 userId 参数(末尾,可空),所有写操作的 user_id 都从这里来
// [2026-06-20] 返回 lastInsertRowid,失败 stderr(不再完全静默吞错)
function logOperation(module, action, targetId, targetName, detail, userId) {
  try {
    const r = db.prepare('INSERT INTO operation_logs (module, action, target_id, target_name, detail, user_id) VALUES (?,?,?,?,?,?)')
      .run(module, action, targetId || null, targetName || '', detail || '', userId || null);
    return r.lastInsertRowid;
  } catch (e) { console.error('logOperation error:', e.message); return null; }
}

// ============================================================
// [2026-06-19] 裁片库入库 — 报工完成自动入库
// ============================================================
// 入库决策:
//   - 款式有 印花/刺绣 → 入库源 = 裁剪二检 A品 (is_second_inspection=1)
//   - 款式有 模板      → 入库源 = 模板报工
//   - 两者都没有        → 入库源 = 裁剪一检 A品 (is_second_inspection=0)
// [2026-06-20 fix#后端-P1-4/5] 接 rawDb 参数(可选),transaction 内调用时传 rawDb 让 SQL 走同一事务
function recordCutPiecesInbound(actual, rawDb = null) {
  const conn = rawDb || db;
  if (!actual || !actual.style_no) return;
  const st = conn.prepare('SELECT printing, embroidery, template FROM styles WHERE style_no = ?').get(actual.style_no);
  const hasSecondary = !!(st && ((st.printing || '').trim() || (st.embroidery || '').trim()));
  const hasTemplate  = !!(st && (st.template || '').trim());

  let inboundType = null;
  if (actual.schedule_type === 'cutting') {
    const isSecond = parseInt(actual.is_second_inspection) > 0;
    if (hasSecondary) {
      if (isSecond) inboundType = 'cutting_2nd';
    } else if (hasTemplate) {
      // 模板款不入裁剪一检库,等模板报工
    } else {
      if (!isSecond) inboundType = 'cutting_1st';
    }
  } else if (actual.schedule_type === 'template') {
    if (hasTemplate) inboundType = 'template';
  }
  if (!inboundType) return;

  const qty = parseInt(actual.completed_qty) || 0;
  if (qty <= 0) return;

  // 1) 写 audit log
  conn.prepare(`INSERT INTO warehouse_inbound
    (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty, inbound_date, operator, remark)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'cutting_piece', inboundType, actual.id,
    actual.style_no, actual.color || '', actual.size_spec || '',
    qty, actual.production_date,
    actual.worker_name || '', `报工 #${actual.id} 自动入库 (${inboundType})`);

  // 2) UPSERT 库存
  upsertInventoryDelta('cutting_piece', actual.style_no, actual.color || '', actual.size_spec || '', qty, rawDb);
}

function upsertInventoryDelta(warehouseType, styleNo, color, sizeSpec, deltaQty, rawDb = null) {
  // [2026-06-20 fix#后端-P1-5] 接 rawDb 让外层 transaction 上下文生效
  const conn = rawDb || db;
  const exist = conn.prepare(`SELECT id FROM warehouse_inventory
    WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ''`).get(
    warehouseType, styleNo, color, sizeSpec);
  if (exist) {
    conn.prepare(`UPDATE warehouse_inventory SET current_qty = current_qty + ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(deltaQty, exist.id);
  } else {
    conn.prepare(`INSERT INTO warehouse_inventory (warehouse_type, style_no, color, size_spec, pot_no, current_qty)
      VALUES (?, ?, ?, ?, '', ?)`).run(warehouseType, styleNo, color, sizeSpec, deltaQty);
  }
}

// 报工删除前置校验：已出库则拒
function checkActualDeletable(actual) {
  if (!actual || !actual.style_no) return { ok: true };
  const inbounds = db.prepare(`SELECT qty FROM warehouse_inbound
    WHERE warehouse_type = 'cutting_piece' AND ref_id = ?`).all(actual.id);
  if (inbounds.length === 0) return { ok: true };
  const inboundQty = inbounds.reduce((s, r) => s + (parseInt(r.qty) || 0), 0);
  const inv = db.prepare(`SELECT current_qty FROM warehouse_inventory
    WHERE warehouse_type = 'cutting_piece' AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ''`).get(
    actual.style_no, actual.color || '', actual.size_spec || '');
  const available = inv ? (parseInt(inv.current_qty) || 0) : 0;
  if (available < inboundQty) {
    return { ok: false, error: `已被出库无法删除(可用 ${available},需回滚 ${inboundQty})` };
  }
  return { ok: true };
}

// 报工删除回滚：冲账 + 删 audit log
function rollbackCutPiecesInbound(actual, rawDb = null) {
  // [2026-06-20 fix#后端-P1-4] 接 rawDb 让 transaction 内调用时 SQL 走同一事务
  const conn = rawDb || db;
  const inbounds = conn.prepare(`SELECT * FROM warehouse_inbound
    WHERE warehouse_type = 'cutting_piece' AND ref_id = ?`).all(actual.id);
  for (const ib of inbounds) {
    upsertInventoryDelta('cutting_piece', actual.style_no, actual.color || '', actual.size_spec || '', -(parseInt(ib.qty) || 0), rawDb);
    conn.prepare('DELETE FROM warehouse_inbound WHERE id = ?').run(ib.id);
  }
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
  getSystemParam, setSystemParam, listSystemParams,
  recordCutPiecesInbound, rollbackCutPiecesInbound, checkActualDeletable,
};

// [2026-06-19] system_params 通用 key/value 配置读写
function getSystemParam(key, fallback = '') {
  try {
    const row = db.prepare('SELECT value FROM system_params WHERE key = ?').get(key);
    return row ? row.value : fallback;
  } catch (e) { return fallback; }
}

function setSystemParam(key, value, remark = '') {
  const stmt = db.prepare(`
    INSERT INTO system_params (key, value, remark, updated_at)
    VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      remark = COALESCE(NULLIF(excluded.remark, ''), remark),
      updated_at = datetime('now','localtime')
  `);
  return stmt.run(key, String(value), remark);
}

function listSystemParams() {
  return db.prepare('SELECT * FROM system_params ORDER BY key').all();
}
