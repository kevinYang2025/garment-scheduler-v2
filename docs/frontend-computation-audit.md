# garment-scheduler-v2 前端计算问题审查报告

> 审查日期：2026-06-20
> 审查范围：前端 (garment-web/src) + 后端 API (garment-server/server.js)
> 问题定性：**确认存在"大量业务计算放在前端"的问题，且有数据一致性、安全性、性能三重风险**

---

## 一、问题总览

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 严重 | 4 | 业务核心算法在前端，可被篡改，前后端逻辑不同步 |
| 🟡 中等 | 4 | 全量加载无分页、前端做聚合、重复请求 |
| 🟢 建议 | 3 | 代码结构、缓存、可维护性 |

**核心结论**：后端 `auto-schedule`（自动排产）有一套完整算法，但前端 `MainPlan.vue` 自己又写了一套简化的日期计算，两套逻辑并存且不一致。裁剪排程的日产量分配完全在前端做，后端只返回原始数据。

---

## 二、🔴 严重问题详细分析

### S-1：排程日期计算在前端（MainPlan.vue）

**文件**：`garment-web/src/views/MainPlan.vue` 第 311-349 行

**现状代码**：
```javascript
async function autoCalcDates() {
  if (!form.value.due_date) return
  await loadConfig()  // 从后端读配置
  const c = configCache.value
  const due = new Date(form.value.due_date + 'T00:00:00')
  const qty = form.value.plan_qty || 0

  // ↓↓↓ 全部在前端算 ↓↓↓
  const sewingEnd = new Date(due)
  sewingEnd.setDate(sewingEnd.getDate() - c.shippingBuffer)          // 缝制结束 = 交期 - 出货缓冲
  const sewingDays = Math.ceil(qty / c.sewingCapacity) || 1          // 缝制天数 = 数量 / 日产能
  const sewingStart = new Date(sewingEnd)
  sewingStart.setDate(sewingStart.getDate() - sewingDays - Math.ceil(c.lineChangeDays)) // 缝制开始
  const sewingRemind = new Date(sewingStart)
  sewingRemind.setDate(sewingRemind.getDate() - 2)                   // 缝制提醒 = 开始 - 2天

  const secondaryEnd = new Date(sewingStart)
  secondaryEnd.setDate(secondaryEnd.getDate() - 1)                   // 二次加工结束
  const secondaryStart = new Date(secondaryEnd)
  secondaryStart.setDate(secondaryStart.getDate() - 3)               // 二次加工开始（固定3天？）

  const cuttingEnd = new Date(secondaryStart)
  cuttingEnd.setDate(cuttingEnd.getDate() - c.pickingDays)           // 裁剪结束
  const cuttingDays = Math.ceil(qty / c.cuttingCapacity) || 1
  const cuttingStart = new Date(cuttingEnd)
  cuttingStart.setDate(cuttingStart.getDate() - cuttingDays)         // 裁剪开始

  // 写回表单，提交时原样存入数据库
  form.value.cutting_start = fmtLocal(cuttingStart)
  form.value.cutting_end = fmtLocal(cuttingEnd)
  // ... 其他日期
}
```

**后端 `POST /api/main-plan`**（server.js 第 1255-1280 行）：
```javascript
// 后端直接存入前端传来的值，不做任何重算或校验
db.run(`INSERT INTO main_plan (..., cutting_start, cutting_end, sewing_start, sewing_end, ...)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [p.style_id, p.style_no, ..., p.cutting_start, p.cutting_end, p.sewing_start, p.sewing_end, ...]);
```

**后端 `auto-schedule`**（server.js 第 1384-1484 行）有一套**完全不同的算法**：
```javascript
// 后端 auto-schedule 用的是：
const LOADING_TO_ARRIVAL = parseInt(cfg.loading_to_arrival_days) || 15;  // 装柜到货
const FABRIC_INSPECTION = parseInt(cfg.fabric_inspection_days) || 9;     // 面料检验
const SEWING_BUFFER = parseInt(cfg.sewing_buffer_days) || 15;            // 缝制缓冲（前端用5）
const SPECIAL_WASH_DAYS = ...;  // 特殊水洗（前端完全没考虑）
// 从 loading_date 开始正推，不是从 due_date 倒推
```

**风险**：
1. **安全漏洞**：用户通过浏览器 DevTools 修改 `form.value` 中的日期，后端不做校验直接存入，可绕过所有业务规则
2. **数据矛盾**：前端用 `shippingBuffer=5` 倒推，后端 `auto-schedule` 用 `sewing_buffer=15` 正推，同一款式的日期会不一致
3. **业务规则遗漏**：前端没考虑「特殊水洗」「面料检验天数」「装柜到货天数」等后端已有的逻辑
4. **维护陷阱**：改需求时只改了一边，另一边不知道要同步

---

### S-2：裁剪日产量分配在前端（CuttingSchedule.vue）

**文件**：`garment-web/src/views/CuttingSchedule.vue` 第 134-147 行

**现状代码**：
```javascript
function calcPlanQty(r, date) {
  if (!r.cutting_start || !r.cutting_end) return 0
  if (!r.daily_target || !r.plan_qty) return 0
  if (date < r.cutting_start || date > r.cutting_end) return 0
  const sd = new Date(r.cutting_start + 'T00:00:00')
  const cd = new Date(date + 'T00:00:00')
  const dayIdx = Math.floor((cd - sd) / 86400000)
  const fullDays = Math.floor(r.plan_qty / r.daily_target)
  const remainder = r.plan_qty % r.daily_target
  if (dayIdx < fullDays) return r.daily_target
  if (dayIdx === fullDays && remainder > 0) return remainder
  return 0
}
```

**后端 `GET /api/schedule/cutting`**（server.js 第 1764-1869 行）：
```javascript
// 后端只返回原始行数据（style_no, color, size_spec, plan_qty, cutting_start, cutting_end）
// 不返回每天的计划量，前端自己算
res.json({ rows, daily: dailyMap, dailyTarget });
```

**对比：后端 `GET /api/schedule/sewing-daily-plan`**（server.js 第 1989-2103 行）：
```javascript
// 缝制的每日计划是后端算好的！包含每天的 plan/actual/diff
const fullDays = Math.floor(cs.plan_qty / dailyTarget);
const remainder = cs.plan_qty % dailyTarget;
if (dayIdx < fullDays) planQty = dailyTarget;
else if (dayIdx === fullDays && remainder > 0) planQty = remainder;
dateData.push({ date, plan: planQty, actual: actualQty, diff: actualQty - planQty });
```

**问题**：同一套「日产量分配算法」，缝制在后端算（正确），裁剪在前端算（错误）。架构不一致。

**风险**：
1. 前端 `calcPlanQty` 完全不考虑工作日历（周末/节假日），而后端可能有工作日历逻辑
2. 如果后端改了分配策略（比如最后一天不满产能时均匀分配），前端不知道
3. 前端算了 `planQty` 之后，还算了 `totalPlan`、`totalActual`、`totalDiff`——全是 reduce 聚合

---

### S-3：汇总聚合在前端（多处）

**文件及位置**：

| 文件 | 行号 | 前端在做什么 |
|------|------|-------------|
| `CuttingSchedule.vue` | 156-204 | `groupedRows`：按 style_no 分组，SUM(plan_qty)，SUM(actual)，算差异 |
| `CuttingSchedule.vue` | 31-38 | `summaryCellPlan`：遍历所有行做 SUM |
| `ScheduleView.vue` | 194-210 | `groupedSewingRows`：按款号分组标记 |
| `MainPlan.vue` | 85-87 | `conflictCount`/`dueWarnCount`/`expiredCount`：filter + count |
| `EntryHome.vue` | 65-83 | 统计 styles 数量、busyLines、仓库出入库（filter + reduce） |
| `Dashboard.vue` | 54-63 | 统计 busyLines（filter 生产中） |

**示例（CuttingSchedule.vue groupedRows）**：
```javascript
const groupedRows = computed(() => {
  const styleGroups = {}
  for (const r of filteredRows.value) {
    if (!styleGroups[r.style_no]) styleGroups[r.style_no] = { ... }
    styleGroups[r.style_no].rows.push(r)
  }
  // 每个分组：遍历所有行 × 所有日期 做 reduce
  const totalPlan = group.rows.reduce((s, x) =>
    s + dateCols.value.reduce((ss, d) => ss + calcPlanQty(x, d), 0), 0)
  const totalActual = group.rows.reduce((s, x) =>
    s + ((dailyMap.value[x.row_id] || []).reduce((ss, dd) => ss + (dd.actual || 0), 0)), 0)
  // ...
})
```

**性能影响**：假设有 100 款 × 5 色码 × 28 天 = 14,000 次 `calcPlanQty` 调用，加上 reduce 嵌套，每次 `filteredRows` 变化都会重新计算。

---

### S-4：后端不校验前端提交的业务数据

**文件**：`garment-server/server.js` 第 1255-1280 行

**现状**：
```javascript
app.post('/api/main-plan', requireRole('admin', 'planning_manager', 'planner'), (req, res) => {
  const p = req.body;
  const errors = validateMainPlan(p);  // 只做基础校验
  // 直接存入，不重算日期
  db.run(`INSERT INTO main_plan (...) VALUES (...)`, [...]);
});
```

`validateMainPlan` 只校验字段是否存在，不校验：
- 日期逻辑是否合理（cutting_start < cutting_end < sewing_start < sewing_end < due_date）
- 日产能是否与配置一致
- 交期是否在合理范围内
- 是否与已有计划冲突

---

## 三、🟡 中等问题详细分析

### M-1：全量加载，无分页/筛选参数

| 接口 | 后端实现 | 问题 |
|------|----------|------|
| `GET /api/main-plan` | `SELECT * FROM main_plan` | 返回全部计划，无 LIMIT/OFFSET |
| `GET /api/styles` | 支持 keyword，但无分页 | 大量款式时传输慢 |
| `GET /api/schedule/cutting` | 返回所有裁剪行 + 实际产量 | 行数 = 款式数 × 色码数 |
| `GET /api/schedule/sewing-daily-plan` | 返回所有缝制计划 + 每日数据 | 每行包含 dateData 数组（28-90天） |
| `GET /api/production-lines` | `SELECT * FROM production_lines` | 50条，问题不大 |
| `GET /api/warehouse/{type}/inbound` | 全量返回 | 仓库记录增长后会很慢 |

**EntryHome.vue 首页加载**（第 53-84 行）一次性发 **8 个并行请求**：
```javascript
const [stylesRes, planRes, linesRes, workshopsRes, achRes, whRes, ibRes, obRes] = await Promise.all([
  api.getStyles(''),           // 全部款式
  api.getMainPlan(),           // 全部计划
  api.getProductionLines(),    // 全部产线
  api.getWorkshops(),          // 全部车间
  api.getAchievementRate(),    // 达成率（后端有缓存）
  api.getWarehouseInventory('cutting_piece'),  // 全部裁片库库存
  api.getWarehouseInbound('cutting_piece'),    // 全部入库记录
  api.getWarehouseOutbound('cutting_piece'),   // 全部出库记录
]);
```

---

### M-2：前端做所有筛选和排序

**MainPlan.vue**（第 151-205 行）：
```javascript
const filteredPlans = computed(() => {
  return plans.value
    .filter(r => {
      // 日期筛选：遍历 dateFilters
      // 文本筛选：遍历 textFilters
      // ...
    })
    .sort((a, b) => {
      // 多级排序：未排班组优先 → 缝制提醒到期 → 上线时间
    })
});
```

后端 `GET /api/main-plan` 不接受任何查询参数。所有筛选/排序/分页逻辑在前端。

**CuttingSchedule.vue**（第 67-112 行）同理：前端做 textFilter + dateFilter + numFilter + sort。

---

### M-3：前端重复计算已存在于后端的逻辑

| 业务逻辑 | 后端位置 | 前端重复位置 | 一致性 |
|----------|----------|-------------|--------|
| 日产量分配 | `sewing-daily-plan` (2059-2074) | `CuttingSchedule.calcPlanQty` (134-147) | ⚠️ 算法相同但独立维护 |
| 日期倒推 | `auto-schedule` (1384-1484) | `MainPlan.autoCalcDates` (311-349) | ❌ 完全不同的逻辑 |
| 达成率计算 | `dashboard/achievement-rate` | 无（正确，前端只渲染） | ✅ |
| 款式→产线匹配 | `auto-schedule` 内部 | 无（前端不做） | ✅ |

---

### M-4：首页加载冗余数据

EntryHome.vue 加载了全部仓库入库/出库记录（`getWarehouseInbound` + `getWarehouseOutbound`），但只用它们做了两件事：
```javascript
// 只统计今天的入库量
stats.value.cutPiecesInbound = (ibRes.data || [])
  .filter(r => (r.inbound_date || '').slice(0, 10) === today)
  .reduce((s, r) => s + (r.qty || 0), 0)
```

**问题**：传了全部历史记录，只取今天的。后端应提供 `/api/warehouse/stats` 接口直接返回统计数字。

---

## 四、🟢 改进建议

### C-1：前端缓存配置数据

`MainPlan.vue` 的 `loadConfig()` 每次创建计划都请求系统配置和产能配置：
```javascript
async function loadConfig() {
  const [sysRes, capRes] = await Promise.all([api.getSystemConfig(), api.getCapacityConfig()])
  // ...
}
```

应缓存到 Pinia store，只在配置变更时刷新。

### C-2：重复的日期格式化函数

`fmtLocal()` 函数在以下文件中各自定义了一份：
- `garment-server/db.js` 第 9-14 行
- `garment-server/server.js` 第 17-22 行
- `garment-web/src/views/MainPlan.vue` 第 304-309 行

应提取为共享工具函数。

### C-3：CuttingSchedule.vue 的 N+1 查询模式

后端 `GET /api/schedule/cutting` 已经优化为批量查询（一次 SQL 拿所有 color_size），但前端 `summaryCellPlan` 对每个汇总行又遍历全部 rows：
```javascript
function summaryCellPlan(sumRow, date) {
  let s = 0
  for (const r of rows.value) {        // 遍历全部行
    if (r.style_no !== sumRow.style_no) continue
    s += calcPlanQty(r, date)           // 每行每天算一次
  }
  return s
}
```

如果 50 款 × 28 天，每次展开折叠触发 1400 次 `calcPlanQty`。

---

## 五、修复方案（按优先级排序）

### P0：后端校验 + 重算日期（1-2天）

**目标**：`POST /api/main-plan` 时后端重算日期，不信任前端传的值。

**修改点**：
1. `server.js` 的 `POST /api/main-plan` 和 `PUT /api/main-plan/:id`：收到请求后，根据 `due_date` + `plan_qty` + `system_config` 重新计算所有日期字段
2. 前端 `autoCalcDates()` 改为调用后端接口（比如 `POST /api/main-plan/preview-dates`），或者直接删除，由后端返回计算好的日期
3. 统一前后端的日期计算逻辑，以 `auto-schedule` 的算法为准

**后端伪代码**：
```javascript
app.post('/api/main-plan', requireRole(...), (req, res) => {
  const p = req.body;
  // 后端重算日期（复用 auto-schedule 的逻辑）
  const cfg = loadSystemConfig();
  const dates = calcScheduleDates(p.due_date, p.plan_qty, cfg);
  // 用后端算的日期，忽略前端传的
  p.cutting_start = dates.cutting_start;
  p.cutting_end = dates.cutting_end;
  p.sewing_start = dates.sewing_start;
  // ...
  db.run(`INSERT INTO main_plan (...) VALUES (...)`, [...]);
});
```

---

### P1：裁剪日产量分配移到后端（1天）

**目标**：`GET /api/schedule/cutting` 返回每天的计划量，和 `sewing-daily-plan` 保持一致。

**修改点**：
1. `server.js` 的 `GET /api/schedule/cutting`：参照 `sewing-daily-plan` 的逻辑，在后端计算每天的 `planQty`，返回 `dateData` 数组
2. `CuttingSchedule.vue`：删除 `calcPlanQty()` 函数，直接用后端返回的 `dateData`
3. `groupedRows` 的聚合也移到后端（SQL GROUP BY）

**后端返回格式变更**：
```javascript
// 现在：只返回原始行
{ rows: [{ style_no, color, size_spec, plan_qty, cutting_start, cutting_end }], daily: {} }

// 改为：返回每天的计划/实际/差异
{ rows: [{ style_no, color, size_spec, plan_qty, cutting_start, cutting_end,
            dateData: [{ date, plan, actual, diff }], totalPlan, totalActual }] }
```

---

### P2：后端加分页/筛选参数（1-2天）

**目标**：所有列表接口支持 `?page=1&limit=50&sort=due_date&dir=asc&status=待排`。

**需要改的接口**：
1. `GET /api/main-plan` → 加 page/limit/sort/filter 参数
2. `GET /api/styles` → 加 page/limit
3. `GET /api/schedule/cutting` → 加 page/limit
4. `GET /api/warehouse/{type}/inbound` → 加 page/limit/date_range

**前端配合**：用 el-pagination 或无限滚动替换全量加载。

---

### P3：首页统计接口（0.5天）

**目标**：新增 `GET /api/dashboard/stats` 一次性返回首页所有统计数字。

**返回格式**：
```json
{
  "styles_count": 120,
  "main_plan_count": 45,
  "workshops_count": 5,
  "lines_count": 50,
  "busy_lines_count": 32,
  "cut_pieces_inventory": 15000,
  "cut_pieces_today_inbound": 3000,
  "cut_pieces_today_outbound": 2000
}
```

EntryHome 从 8 个请求减为 1 个。

---

### P4：前端筛选改为后端筛选（2-3天）

**目标**：MainPlan.vue 的 `filteredPlans` 从后端查询，前端只做渲染。

**修改点**：
1. 后端 `GET /api/main-plan` 支持筛选参数
2. 前端 `filteredPlans` 改为调用后端（debounced）
3. 保留前端的即时筛选体验（输入时先前端 filter，松手后请求后端）

---

## 六、风险评估矩阵

| 问题 | 影响范围 | 发生概率 | 修复成本 | 优先级 |
|------|----------|----------|----------|--------|
| S-1 日期计算在前端 | 全部计划数据 | 已发生（前后端逻辑不同步） | 中（1-2天） | **P0** |
| S-2 裁剪日产量在前端 | 裁剪排程 | 已发生 | 低（1天） | **P0** |
| S-3 前端聚合 | 性能 | 数据量大时触发 | 中（1-2天） | **P1** |
| S-4 后端不校验 | 数据安全 | 随时可被利用 | 低（0.5天） | **P0** |
| M-1 全量加载 | 性能 | 数据增长后 | 中（1-2天） | **P2** |
| M-2 前端筛选排序 | 性能+一致性 | 已发生 | 高（2-3天） | **P2** |
| M-3 重复逻辑 | 维护成本 | 每次改需求 | — | **P1** |
| M-4 首页冗余请求 | 加载速度 | 每次打开首页 | 低（0.5天） | **P3** |

---

## 七、验收标准

修完后应满足：
1. 前端不包含任何业务计算逻辑（日期推算、日产量分配、聚合汇总）
2. 后端接口返回的数据可直接渲染，前端只做展示格式化
3. 后端对所有写入接口做业务校验（不信任前端数据）
4. 列表接口支持分页，单次返回不超过 100 条
5. 首页加载请求数 ≤ 3 个
6. 前端 `autoCalcDates()` 函数已删除或改为调用后端
7. 前端 `calcPlanQty()` 函数已删除

---

## 附录：涉及文件清单

| 文件 | 需修改内容 |
|------|-----------|
| `garment-server/server.js` | POST /api/main-plan 加日期重算；GET /api/schedule/cutting 加每日计划；新增 /api/dashboard/stats；列表接口加分页 |
| `garment-web/src/views/MainPlan.vue` | 删除 autoCalcDates()，改用后端返回的日期；filteredPlans 改为后端筛选 |
| `garment-web/src/views/CuttingSchedule.vue` | 删除 calcPlanQty()，改用后端返回的 dateData；删除 groupedRows 前端聚合 |
| `garment-web/src/views/EntryHome.vue` | 改用 /api/dashboard/stats，减少请求数 |
| `garment-web/src/views/ScheduleView.vue` | 删除前端日期窗口计算（改用后端返回的 dateRange） |
| `garment-web/src/api/index.js` | 新增 stats 接口、分页参数支持 |
