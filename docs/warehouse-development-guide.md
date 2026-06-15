# 仓库管理模块开发文档

> 项目路径：`C:\AIsaving\plan management project`
> 技术栈：Node.js + Express + SQLite (better-sqlite3) + Vue 3 + Element Plus
> 更新日期：2026-06-15

---

## 一、模块概览

### 4 个仓库类型

| 代号 | 名称 | 单位 | 特殊字段 |
|------|------|------|---------|
| `raw_material` | 面料库 | KG / 匹 | pot_no(缸号), fabric_name, width, weight |
| `auxiliary` | 辅料库 | 个/卷 | — |
| `cutting_piece` | 裁片库 | 片 | — |
| `finished` | 成品库 | 件 | — |

### 核心业务流程

```
┌─────────────────────────────────────────────────────┐
│                    面料库完整流程                       │
│                                                       │
│  面料装柜清单 ──→ 批量入库 ──→ 库存管理 ──→ 出库      │
│  (Excel导入)      (一键入库)    (动态库存)   (扣减库存)  │
│                                                       │
│  或：创建ASN到货通知 → 收货确认 → 质检 → 入库完成      │
│  或：创建DN发货通知 → 拣货 → 发货 → 客户签收          │
└─────────────────────────────────────────────────────┘
```

---

## 二、数据库表结构

### 2.1 核心表

#### `warehouse_inventory` — 动态库存

```sql
CREATE TABLE warehouse_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_type TEXT NOT NULL,    -- raw_material/auxiliary/cutting_piece/finished
  style_no TEXT DEFAULT '',
  color TEXT DEFAULT '',
  size_spec TEXT DEFAULT '',
  current_qty INTEGER DEFAULT 0,
  -- 面料库扩展字段
  pot_no TEXT DEFAULT '',          -- 缸号
  fabric_name TEXT DEFAULT '',     -- 面料名称
  supplier TEXT DEFAULT '',       -- 供应商（表面）
  customer TEXT DEFAULT '',       -- 客户
  width TEXT DEFAULT '',           -- 幅宽
  weight TEXT DEFAULT '',          -- 克重
  unit TEXT DEFAULT 'KG',          -- 单位
  total_pcs INTEGER DEFAULT 0,    -- 总匹数
  unit2 TEXT DEFAULT '匹',         -- 单位2
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(warehouse_type, style_no, color, size_spec, pot_no)
);
```

> ⚠️ **关键约束**：`UNIQUE(warehouse_type, style_no, color, size_spec, pot_no)`
> 同一仓库+款号+颜色+规格+缸号 只能有一条库存记录

#### `warehouse_inbound` — 入库记录

```sql
CREATE TABLE warehouse_inbound (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_type TEXT NOT NULL,
  ref_type TEXT DEFAULT '',        -- 来源类型：fabric_loading/asn/manual
  ref_id INTEGER,                  -- 关联ID
  style_no TEXT DEFAULT '',
  color TEXT DEFAULT '',
  size_spec TEXT DEFAULT '',
  qty INTEGER DEFAULT 0,
  inbound_date TEXT,
  operator TEXT DEFAULT '',
  order_no TEXT DEFAULT '',        -- 自动生成：RB20260614-001
  pot_no TEXT DEFAULT '',
  fabric_name TEXT DEFAULT '',
  supplier TEXT DEFAULT '',
  customer TEXT DEFAULT '',
  width TEXT DEFAULT '',
  weight TEXT DEFAULT '',
  unit TEXT DEFAULT 'KG',
  total_pcs INTEGER DEFAULT 0,
  unit2 TEXT DEFAULT '匹',
  loading_qty REAL DEFAULT 0,     -- 装柜数量
  remark TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

#### `warehouse_outbound` — 出库记录

```sql
CREATE TABLE warehouse_outbound (
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
  order_no TEXT DEFAULT '',        -- 自动生成：CB20260614-001
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
```

#### `fabric_loading_list` — 面料装柜清单

```sql
CREATE TABLE fabric_loading_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbound_date TEXT,               -- 入库日期
  supplier TEXT DEFAULT '',        -- 供应商
  customer TEXT DEFAULT '',        -- 客户
  style_no TEXT DEFAULT '',        -- 款号
  pot_no TEXT DEFAULT '',          -- 缸号
  fabric_name TEXT DEFAULT '',     -- 面料名称
  width TEXT DEFAULT '',           -- 幅宽
  weight TEXT DEFAULT '',          -- 克重
  color TEXT DEFAULT '',           -- 颜色
  qty REAL DEFAULT 0,             -- 数量(KG)
  unit TEXT DEFAULT 'KG',
  total_pcs INTEGER DEFAULT 0,    -- 总匹数
  unit2 TEXT DEFAULT '匹',
  loading_date TEXT,               -- 装柜日期
  loading_qty REAL DEFAULT 0,     -- 装柜数量
  remark TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

### 2.2 ASN/DN 流程表

#### `asn_list` — 到货通知单头

```sql
CREATE TABLE asn_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asn_code TEXT NOT NULL UNIQUE,   -- 自动生成：ASN20260614-001
  warehouse_type TEXT NOT NULL,
  supplier TEXT DEFAULT '',
  status TEXT DEFAULT 'PENDING',   -- PENDING→RECEIVED→INSPECTING→COMPLETED→CANCELLED
  expected_date TEXT,              -- 预计到货日期
  actual_date TEXT,                -- 实际到货日期
  total_qty REAL DEFAULT 0,
  received_qty REAL DEFAULT 0,
  inspect_qty REAL DEFAULT 0,
  shortage_qty REAL DEFAULT 0,    -- 短缺数量
  damage_qty REAL DEFAULT 0,      -- 损坏数量
  remark TEXT DEFAULT '',
  operator TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

#### `asn_detail` — 到货通知明细

```sql
CREATE TABLE asn_detail (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asn_id INTEGER NOT NULL,
  style_no TEXT DEFAULT '',
  fabric_name TEXT DEFAULT '',
  color TEXT DEFAULT '',
  size_spec TEXT DEFAULT '',
  pot_no TEXT DEFAULT '',
  plan_qty REAL DEFAULT 0,        -- 计划数量
  actual_qty REAL DEFAULT 0,      -- 实际数量
  inspect_qty REAL DEFAULT 0,     -- 质检数量
  shortage_qty REAL DEFAULT 0,    -- 短缺数量
  damage_qty REAL DEFAULT 0,      -- 损坏数量
  unit TEXT DEFAULT '件',
  remark TEXT DEFAULT '',
  FOREIGN KEY (asn_id) REFERENCES asn_list(id) ON DELETE CASCADE
);
```

#### `dn_list` — 发货通知单头

```sql
CREATE TABLE dn_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dn_code TEXT NOT NULL UNIQUE,    -- 自动生成：DN20260614-001
  warehouse_type TEXT NOT NULL,
  customer TEXT DEFAULT '',
  status TEXT DEFAULT 'PENDING',   -- PENDING→PICKING→PICKED→SHIPPED→DELIVERED→CANCELLED
  ship_date TEXT,                  -- 要求发货日期
  actual_ship_date TEXT,           -- 实际发货日期
  delivery_date TEXT,              -- 签收日期
  total_qty REAL DEFAULT 0,
  picked_qty REAL DEFAULT 0,
  shipped_qty REAL DEFAULT 0,
  received_qty REAL DEFAULT 0,
  remark TEXT DEFAULT '',
  operator TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
);
```

#### `dn_detail` — 发货通知明细

```sql
CREATE TABLE dn_detail (
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
```

#### `warehouse_stock_status` — 多维度库存状态

```sql
CREATE TABLE warehouse_stock_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_type TEXT NOT NULL,
  style_no TEXT DEFAULT '',
  color TEXT DEFAULT '',
  size_spec TEXT DEFAULT '',
  pot_no TEXT DEFAULT '',
  onhand_qty REAL DEFAULT 0,      -- 在手库存
  intransit_qty REAL DEFAULT 0,   -- 在途库存
  inspect_qty REAL DEFAULT 0,     -- 检验库存
  hold_qty REAL DEFAULT 0,        -- 冻结库存
  picked_qty REAL DEFAULT 0,      -- 已拣库存
  allocated_qty REAL DEFAULT 0,   -- 已分配库存
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(warehouse_type, style_no, color, size_spec, pot_no)
);
```

---

## 三、API 接口

### 3.1 基础 CRUD

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/warehouse/:type/inbound` | 入库记录列表 |
| `POST` | `/api/warehouse/:type/inbound` | 入库（单号自动生成 RB日期-序号） |
| `GET` | `/api/warehouse/:type/outbound` | 出库记录列表 |
| `POST` | `/api/warehouse/:type/outbound` | 出库（单号自动生成 CB日期-序号） |
| `GET` | `/api/warehouse/:type/inventory` | 当前库存 |
| `POST` | `/api/warehouse/:type/import` | Excel 导入 |
| `GET` | `/api/warehouse/:type/export` | Excel 导出 |
| `GET` | `/api/fabric-loading` | 装柜清单列表 |
| `POST` | `/api/fabric-loading` | 新增装柜记录 |
| `PUT` | `/api/fabric-loading/:id` | 修改装柜记录 |
| `DELETE` | `/api/fabric-loading/:id` | 删除装柜记录 |
| `POST` | `/api/fabric-loading/import` | 装柜清单 Excel 导入 |
| `GET` | `/api/fabric-loading/export` | 装柜清单 Excel 导出 |

### 3.2 批量入库

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/fabric-loading/batch-inbound` | 从装柜清单批量入库到面料库 |

**请求体：**
```json
{ "ids": [2, 3, 4, 5] }
```

**响应：**
```json
{
  "ok": true,
  "imported": 4,
  "errors": []
}
```

**逻辑：**
1. 遍历选中的装柜记录
2. 检查是否已入库（`ref_type='fabric_loading' AND ref_id=ID`）
3. 自动生成入库单号 `RB20260614-001`
4. 写入 `warehouse_inbound` 表
5. 更新 `warehouse_inventory` 库存
6. 已入库的跳过，记录到 errors

### 3.3 ASN 到货通知

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/asn` | ASN 列表（支持 warehouse_type/status 筛选） |
| `GET` | `/api/asn/:id` | ASN 详情（含明细） |
| `POST` | `/api/asn` | 创建 ASN（单号自动生成） |
| `PUT` | `/api/asn/:id/status` | ASN 状态流转 |
| `POST` | `/api/asn/:id/details` | 添加 ASN 明细 |
| `DELETE` | `/api/asn/:id` | 删除 ASN（仅 PENDING 状态） |

**ASN 状态流转：**
```
PENDING → RECEIVED → INSPECTING → COMPLETED
   │
   └→ CANCELLED
```

**COMPLETED 时自动操作：**
- 更新 `warehouse_inventory` 库存
- 写入 `warehouse_inbound` 记录
- 更新 ASN 汇总数量

### 3.4 DN 发货通知

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/dn` | DN 列表（支持 warehouse_type/status 筛选） |
| `GET` | `/api/dn/:id` | DN 详情（含明细） |
| `POST` | `/api/dn` | 创建 DN（单号自动生成） |
| `PUT` | `/api/dn/:id/status` | DN 状态流转 |
| `POST` | `/api/dn/:id/details` | 添加 DN 明细 |
| `DELETE` | `/api/dn/:id` | 删除 DN（仅 PENDING 状态） |

**DN 状态流转：**
```
PENDING → PICKING → PICKED → SHIPPED → DELIVERED
   │         │
   └→ CANCELLED
```

**SHIPPED 时自动操作：**
- 扣减 `warehouse_inventory` 库存
- 写入 `warehouse_outbound` 记录
- 更新 DN 汇总数量

### 3.5 关键函数

#### `updateInventory(type, styleNo, color, sizeSpec, delta, extra)`

- **作用**：更新库存（入库 +delta，出库 -delta）
- **匹配逻辑**：按 `(warehouse_type, style_no, color, size_spec)` 查重
- **库存不会为负**：`Math.max(0, current_qty + delta)`
- **INSERT 失败时 fallback 到 UPDATE**：处理并发冲突

#### `genAsnCode()` / `genDnCode()`

- 格式：`ASN20260614-001` / `DN20260614-001`
- 按日期+当日序号自动生成
- 数据库 COUNT 查询确保唯一

---

## 四、前端组件

### 4.1 页面文件

| 文件 | 说明 |
|------|------|
| `WarehouseHome.vue` | 仓库首页：4 个仓库卡片 + 入库/出库按钮 |
| `WarehouseDetail.vue` | 仓库详情：动态库存 + 入库记录 + 出库记录 + Excel 导入导出 |
| `FabricLoadingList.vue` | 面料装柜清单：Excel 风格表格 + 批量入库 + Excel 导入导出 |
| `ASNWorkflow.vue` | ASN 到货通知单流程页面 |
| `DNWorkflow.vue` | DN 发货通知单流程页面 |

### 4.2 组件关系

```
App.vue
├── WarehouseHome
│   ├── 点击卡片 → WarehouseDetail（库存/入库/出库记录）
│   ├── 点击「入库」按钮 → ASNWorkflow（ASN 流程）
│   └── 点击「出库」按钮 → DNWorkflow（DN 流程）
├── FabricLoadingList（面料装柜清单，独立页面）
└── WarehouseDetail
    ├── 三个 Tab：动态库存 / 入库记录 / 出库记录
    ├── 入库对话框：单号自动生成，只读
    ├── 出库对话框：只显示有库存的款号
    ├── Excel 导入/导出
    └── 面料库：款号搜索从 fabric_loading_list 取
```

### 4.3 数据流向

```
装柜清单 (fabric_loading_list)
    │
    ├── 批量入库 API ──→ 入库记录 (warehouse_inbound)
    │                  ──→ 更新库存 (warehouse_inventory)
    │
    └── （或）手动入库对话框 ──→ 同上

出库对话框 ──→ 出库记录 (warehouse_outbound)
            ──→ 扣减库存 (warehouse_inventory)

ASN 流程 ──→ ASN 单 (asn_list + asn_detail)
          ──→ 状态流转到 COMPLETED 时 ──→ 同手动入库

DN 流程 ──→ DN 单 (dn_list + dn_detail)
          ──→ 状态流转到 SHIPPED 时 ──→ 同手动出库
```

---

## 五、已知问题 & TODO

### 已修复

| 问题 | 修复方案 |
|------|---------|
| 入库单号可手动修改导致重复 | 后端自动生成，前端 disabled |
| 出库单号可手动修改导致重复 | 同上 |
| 出库显示所有款号（含无库存的） | 改为从 inventory 查询 |
| `updateInventory` UNIQUE 约束冲突 | 查重改为 4 字段匹配，INSERT fallback |
| `datetime("now")` 引号错误 | 改用模板字符串 |
| 批量入库不工作 | 修复 API + 前端调用 |

### 待开发

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P0 | 裁片库/成品库出入库 | 目前只做了面料库的完整流程 |
| P0 | 装柜清单重复入库检查 | 批量入库时应标记已入库记录 |
| P1 | ASN/DN 导入导出 | ASN/DN 单据支持 Excel 导入导出 |
| P1 | 库存不足预警 | 低于安全库存时自动提醒 |
| P2 | `warehouse_stock_status` 表使用 | 多维度库存状态目前未使用 |
| P2 | 仓库间调拨 | 面料库→裁片库、裁片库→成品库 |
| P3 | 库存盘点功能 | 循环盘点、手工盘点 |

---

## 六、开发规范

### 6.1 数据库操作

```javascript
// ✅ 正确：用 db 封装的方法
db.run('INSERT INTO xxx VALUES (?,?,?)', [a, b, c])
db.get('SELECT * FROM xxx WHERE id = ?', [id])
db.all('SELECT * FROM xxx')

// ❌ 错误：直接操作 sqlite3
const sqlite3 = require('better-sqlite3')
```

### 6.2 日期处理

```javascript
// ✅ 正确：使用 fmtLocal() 生成本地日期
function fmtLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// ❌ 错误：使用 toISOString() 有时区问题
new Date().toISOString()  // 可能是 UTC 时间
```

### 6.3 SQL 中的 datetime

```javascript
// ✅ 正确：使用模板字符串包裹含单引号的 SQL
db.run(`UPDATE xxx SET updated_at = datetime('now','localtime') WHERE id = ?`, [id])

// ❌ 错误：在单引号字符串中用 datetime("now","localtime")
db.run('UPDATE xxx SET updated_at = datetime("now","localtime") WHERE id = ?', [id])
```

### 6.4 库存更新

```javascript
// ✅ 正确：使用 updateInventory()
updateInventory('raw_material', styleNo, color, sizeSpec, +100, { pot_no: 'a123' })

// ❌ 直接操作 warehouse_inventory 表（会跳过 UNIQUE 检查逻辑）
```

### 6.5 Git 分支规范

```
master          ← 稳定版
develop         ← 开发集成分支
feature/xxx     ← 功能开发分支
```

- 每个功能开 `feature/xxx` 分支
- 开发完合并到 `develop`
- 测试通过后合并到 `master`
- **不要直接在 master 上改代码**

### 6.6 文件命名

| 类型 | 规范 | 示例 |
|------|------|------|
| Vue 组件 | PascalCase | `WarehouseDetail.vue` |
| API 方法 | camelCase | `getWarehouseInventory()` |
| 数据库表 | snake_case | `warehouse_inventory` |
| API 路径 | kebab-case | `/api/fabric-loading/batch-inbound` |

---

## 七、快速启动

```bash
# 后端
cd garment-server
npm install
node server.js    # http://localhost:3001

# 前端
cd garment-web
npm install
npx vite --host   # http://localhost:5173

# API 代理已配置：前端 :5173 → 后端 :3001
```

### 测试批量入库

```bash
# 查看装柜清单
curl http://localhost:3001/api/fabric-loading

# 批量入库（选中 ID 2,3,4）
curl -X POST http://localhost:3001/api/fabric-loading/batch-inbound \
  -H "Content-Type: application/json" \
  -d '{"ids":[2,3,4]}'

# 查看库存
curl http://localhost:3001/api/warehouse/raw_material/inventory
```
