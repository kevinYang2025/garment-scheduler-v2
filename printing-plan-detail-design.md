# 印花排程表格重构方案

## 目标
将 SecondaryDetail.vue 中的印花排程（`secondaryType='printing'`）替换为与 SewingPlanDetail.vue 完全相同格式的 Excel 风格表格。

---

## 1. 数据模型设计

### 1.1 行粒度

每个款式的 **每个颜色 + 每个尺码** = 一个 `schedule_master` 记录。

| 字段 | 来源 | 说明 |
|------|------|------|
| schedule_type | 固定 `'secondary'` | 区分排程大类 |
| secondary_type | 固定 `'printing'` | 区分印花 |
| style_id | styles.id | 关联款式 |
| style_no | styles.style_no | 款号 |
| product_name | styles.product_name | 品名 |
| color | style_color_size.color | 颜色 |
| size_spec | style_color_size.size_spec | 尺码 |
| plan_qty | style_color_size.plan_qty | 原单量（该颜色+尺码的计划数量） |
| daily_target | styles.printing_daily_output | 印花日产量 |
| due_date | styles.due_date | 交期 |
| plan_start | main_plan.printing_start | 印花开始日期 |
| plan_end | main_plan.printing_end | 印花结束日期 |
| cutting_plan_qty | 同 plan_qty | 原单量（兼容前端列名） |
| workshop | '' | 默认空，可手动编辑 |
| line_team | '' | 默认空，可手动编辑 |

### 1.2 三行模型

每条 `schedule_master` 记录在 `schedule_daily` 中有三组子行：
- **PLAN** — 计划行，按 `plan_start` ~ `plan_end` 天数均分 `plan_qty`
- **ACTUAL** — 实际行，初始为 0，可在线编辑
- **DIFF** — 差异行，前端计算 `actual - plan`（不存数据库）

### 1.3 数据流

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│ styles           │────>│ 新 API            │────>│ PrintingPlan │
│ (printing='是')  │     │ /api/printing-    │     │ Detail.vue   │
│                  │     │  plan-data        │     │              │
│ style_color_size │────>│                   │     │ 每个 color+  │
│ (按 style_no)    │     │ 返回扁平列表:     │     │ size 一行    │
│                  │     │ 每个 color+size   │     │ 三行子行      │
│ main_plan        │────>│ = 一条记录        │     │              │
│ (printing_start  │     │                   │     │              │
│  printing_end)   │     └──────────────────┘     └──────────────┘
└─────────────────┘
```

---

## 2. 后端修改

### 2.1 新增 API：`GET /api/printing-plan-data`

**文件**: `garment-server/server.js`

**功能**: 聚合三张表的数据，返回印花排程的扁平列表。

```js
// 印花排程数据（聚合 styles + style_color_size + main_plan）
app.get('/api/printing-plan-data', (req, res) => {
  try {
    // 1. 获取所有 printing='是' 的款式
    const printingStyles = db.all(
      "SELECT id, style_no, product_name, plan_qty, due_date, printing_daily_output FROM styles WHERE printing = '是'"
    );
    if (printingStyles.length === 0) return res.json([]);

    const styleMap = {};
    for (const s of printingStyles) styleMap[s.style_no] = s;

    // 2. 获取 main_plan 中有 printing_start 的记录
    const mainPlans = db.all(
      "SELECT style_no, printing_start, printing_end FROM main_plan WHERE printing_start != '' AND printing_start IS NOT NULL"
    );
    const planMap = {};
    for (const p of mainPlans) {
      // 同一款号可能有多条 main_plan，取最早的 printing_start
      if (!planMap[p.style_no] || (p.printing_start < planMap[p.style_no].printing_start)) {
        planMap[p.style_no] = p;
      }
    }

    // 3. 获取分色分尺码数据
    const colorSizes = db.all('SELECT * FROM style_color_size ORDER BY style_no, color, size_spec');

    // 4. 组装：每个 style+color+size 一行
    const result = [];
    for (const cs of colorSizes) {
      const style = styleMap[cs.style_no];
      if (!style) continue; // 该款式不需要印花

      const mp = planMap[cs.style_no] || {};
      const dailyTarget = style.printing_daily_output || 0;
      const planStart = mp.printing_start || '';
      const planEnd = mp.printing_end || '';

      // 查找是否已有 schedule_master 记录
      const existing = db.get(
        "SELECT * FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing' AND style_no=? AND color=? AND size_spec=?",
        [cs.style_no, cs.color, cs.size_spec]
      );

      if (existing) {
        // 已有排程记录，使用其数据（允许手动调整过的日期）
        result.push({
          ...existing,
          // 保留手动编辑的值，若无则用自动计算的值
          daily_target: existing.daily_target || dailyTarget,
          cutting_plan_qty: existing.cutting_plan_qty || existing.plan_qty,
        });
      } else {
        // 新增虚拟记录（未排产）
        result.push({
          id: `virtual_${cs.style_no}_${cs.color}_${cs.size_spec}`,
          schedule_type: 'secondary',
          secondary_type: 'printing',
          style_id: style.id,
          style_no: cs.style_no,
          product_name: style.product_name,
          color: cs.color,
          size_spec: cs.size_spec,
          plan_qty: cs.plan_qty || 0,
          cutting_plan_qty: cs.plan_qty || 0,
          daily_target: dailyTarget,
          due_date: style.due_date || '',
          plan_start: planStart,
          plan_end: planEnd,
          workshop: '',
          line_team: '',
          task_status: 'PENDING',
          progress_pct: 0,
          _virtual: true,  // 标记为虚拟记录，前端可区分
        });
      }
    }

    res.json(result);
  } catch (e) {
    console.error('GET /api/printing-plan-data error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2.2 新增 API：`POST /api/printing-plan-data/confirm`

**功能**: 将虚拟记录转为正式的 `schedule_master` + `schedule_daily` 记录。

```js
app.post('/api/printing-plan-data/confirm', (req, res) => {
  try {
    const { style_no, color, size_spec, plan_start, plan_end, plan_qty, daily_target, workshop, line_team } = req.body;
    
    // 查找或创建 schedule_master
    let master = db.get(
      "SELECT id FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing' AND style_no=? AND color=? AND size_spec=?",
      [style_no, color, size_spec]
    );

    let masterId;
    if (master) {
      db.run(`UPDATE schedule_master SET plan_start=?, plan_end=?, plan_qty=?, cutting_plan_qty=?, daily_target=?, workshop=?, line_team=? WHERE id=?`,
        [plan_start, plan_end, plan_qty, plan_qty, daily_target || 0, workshop || '', line_team || '', master.id]);
      masterId = master.id;
    } else {
      const style = db.get("SELECT id, product_name FROM styles WHERE style_no=?", [style_no]);
      const result = db.run(
        `INSERT INTO schedule_master (schedule_type, secondary_type, style_id, style_no, product_name, color, size_spec, plan_qty, cutting_plan_qty, plan_start, plan_end, daily_target, due_date, workshop, line_team)
         VALUES ('secondary','printing',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [style?.id || 0, style_no, style?.product_name || '', color, size_spec, plan_qty, plan_qty, plan_start, plan_end, daily_target || 0, '', workshop || '', line_team || '']
      );
      masterId = result.lastInsertRowid;
    }

    // 生成 schedule_daily 行
    if (plan_start && plan_end && plan_qty > 0) {
      generatePlanRows(masterId, plan_start, plan_end, plan_qty);
    }

    broadcastSection('schedule_secondary', db.all("SELECT * FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing'"));
    db.logOperation('schedule_secondary', 'confirm_printing', masterId, style_no);
    res.json({ ok: true, id: masterId });
  } catch (e) {
    console.error('POST /api/printing-plan-data/confirm error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

### 2.3 新增 API：`GET /api/printing-plan-data/:masterId/daily`

**功能**: 获取印花排程的日明细（复用现有 `schedule_daily` 表）。

直接复用现有端点：
```
GET /api/schedule/secondary/:masterId/daily
```
无需新增，前端直接调用 `api.getScheduleDaily('secondary', masterId)`。

### 2.4 修改自动排产：自动生成印花排程记录

**文件**: `garment-server/db.js` → `autoSchedule()` 函数

在现有 `autoSchedule()` 中，为每个 `printing='是'` 的款式自动生成 `schedule_master` 记录。

修改位置：`db.js:940` 附近，在 `txn()` 事务中添加：

```js
// ========== 新增：自动生成印花排程 ==========
const printingStyles = db.prepare("SELECT * FROM styles WHERE printing = '是' AND printing_daily_output > 0").all();
const mainPlans = db.prepare("SELECT * FROM main_plan WHERE printing_start != '' AND printing_start IS NOT NULL").all();
const planMap = {};
for (const p of mainPlans) {
  if (!planMap[p.style_no] || (p.printing_start < (planMap[p.style_no].printing_start || ''))) {
    planMap[p.style_no] = p;
  }
}

for (const style of printingStyles) {
  const mp = planMap[style.style_no];
  if (!mp || !mp.printing_start || !mp.printing_end) continue;

  // 获取该款式的分色分尺码数据
  const colorSizes = db.prepare("SELECT * FROM style_color_size WHERE style_no = ?").all(style.style_no);
  if (colorSizes.length === 0) continue;

  for (const cs of colorSizes) {
    // 检查是否已有记录
    const exists = db.get(
      "SELECT id FROM schedule_master WHERE schedule_type='secondary' AND secondary_type='printing' AND style_no=? AND color=? AND size_spec=?",
      [cs.style_no, cs.color, cs.size_spec]
    );
    if (exists) continue; // 已有则跳过

    const planQty = cs.plan_qty || 0;
    if (planQty <= 0) continue;

    const result = db.run(
      `INSERT INTO schedule_master (schedule_type, secondary_type, style_id, style_no, product_name, color, size_spec, plan_qty, cutting_plan_qty, plan_start, plan_end, daily_target, due_date)
       VALUES ('secondary','printing',?,?,?,?,?,?,?,?,?,?,?)`,
      [style.id, style.style_no, style.product_name, cs.color, cs.size_spec, planQty, planQty, mp.printing_start, mp.printing_end, style.printing_daily_output || 0, style.due_date || '']
    );

    generatePlanRows(result.lastInsertRowid, mp.printing_start, mp.printing_end, planQty);
  }
}
```

### 2.5 新增 API：`GET /api/schedule/secondary/summary`

**文件**: `garment-server/server.js`

现有代码中没有此端点（前端 `SecondaryHome.vue` 调用了 `api.getSecondarySummary()`），需要新增：

```js
app.get('/api/schedule/secondary/summary', (req, res) => {
  try {
    const today = fmtLocal(new Date());
    const d = new Date();
    const dow = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const mondayStr = fmtLocal(monday);

    const types = ['printing', 'embroidery', 'template', 'ironing'];
    const summary = {};
    for (const t of types) {
      const masters = db.all("SELECT * FROM schedule_master WHERE schedule_type='secondary' AND secondary_type=?", [t]);
      summary[t] = {
        weekPending: masters.filter(m => m.plan_start && m.plan_start >= mondayStr && m.plan_start <= today).length,
        overdue: masters.filter(m => m.plan_end && m.plan_end < today).length,
        lastUpdate: masters.reduce((latest, m) => {
          const ts = m.updated_at || m.created_at;
          return !latest || (ts && ts > latest) ? ts : latest;
        }, null),
      };
    }
    res.json(summary);
  } catch (e) {
    console.error('GET /api/schedule/secondary/summary error:', e);
    res.status(500).json({ error: 'Internal server error' });
  }
});
```

---

## 3. 前端修改

### 3.1 新建文件：`garment-web/src/views/PrintingPlanDetail.vue`

**核心思路**: 从 SewingPlanDetail.vue 复制并修改，适配印花排程的数据结构。

#### 关键差异对照

| 项目 | SewingPlanDetail (缝制) | PrintingPlanDetail (印花) |
|------|------------------------|--------------------------|
| 数据加载 | `api.getSchedule('sewing')` | `api.get('/printing-plan-data')` |
| 日明细加载 | `api.getScheduleDaily('sewing', id)` | `api.getScheduleDaily('secondary', masterId)` |
| 保存实际 | `api.saveActual({ schedule_type:'sewing', ... })` | `api.saveActual({ schedule_type:'secondary', secondary_type:'printing', ... })` |
| 创建排程 | `api.createSchedule('sewing', data)` | `api.post('/printing-plan-data/confirm', data)` |
| 导入 | `api.importSchedule('sewing', records)` | 新的印花 Excel 导入逻辑 |
| 导出 | 现有缝制导出 | 新的印花 Excel 导出 |
| 列名 | 裁床计划数量 / 目标日产量 / 缝制开始 / 缝制结束 | 原单量 / 印花日产量 / 印花开始 / 印花结束 |
| 车间/班组 | 有（缝制产线） | 有（印花车间） |

#### 模板结构（修改点）

```vue
<!-- 固定列标题（修改列名） -->
<th class="fix">车间</th>
<th class="fix">班组</th>
<th class="fix">状态</th>
<th class="fix">款号</th>
<th class="fix">品名</th>
<th class="fix">颜色</th>        <!-- 新增：印花需要显示颜色 -->
<th class="fix">尺码</th>        <!-- 新增：印花需要显示尺码 -->
<th class="fix">原单量</th>      <!-- 原"裁床计划数量" -->
<th class="fix">交期</th>
<th class="fix">印花日产量</th>   <!-- 原"目标日产量" -->
<th class="fix">印花开始</th>    <!-- 原"缝制开始" -->
<th class="fix">印花结束</th>    <!-- 原"缝制结束" -->
<th class="fix">合计</th>
<th class="fix">类型</th>
<!-- 动态日期列 -->
<!-- 操作列 -->
```

#### 数据加载逻辑

```js
async function load() {
  try {
    const { data } = await api.get('/printing-plan-data')
    masters.value = data || []
  } catch { ElMessage.error('加载排程失败') }
}

async function loadAllDaily() {
  // 只加载非虚拟记录的日明细
  const ids = masters.value
    .filter(m => !m._virtual && !dailyData.value[m.id])
    .map(m => m.id)
  if (!ids.length) return
  const results = await Promise.allSettled(
    ids.map(id => api.getScheduleDaily('secondary', id).then(r => ({ id, data: r.data })))
  )
  for (const r of results) {
    if (r.status === 'fulfilled') {
      dailyData.value[r.value.id] = r.value.data || []
    }
  }
}
```

#### 保存实际产量

```js
async function updateDailyActual(masterId, date, val) {
  if (date > today.value) { ElMessage.warning('不能填写未来日期的实际产量'); return }
  const m = masters.value.find(x => x.id === masterId)
  if (!m) return
  try {
    await api.saveActual({
      schedule_type: 'secondary', secondary_type: 'printing',
      style_id: m?.style_id || 0, style_no: m?.style_no || '',
      color: m?.color || '', size_spec: m?.size_spec || '',
      production_date: date,
      completed_qty: parseInt(val) || 0, defect_qty: 0,
      workshop: m?.workshop || '', line_team: m?.line_team || '', remark: ''
    })
    const { data } = await api.getScheduleDaily('secondary', masterId)
    dailyData.value[masterId] = data || []
  } catch { ElMessage.error('更新失败') }
}
```

#### 创建排程弹窗

```js
function openCreate() {
  form.value = {
    style_id: null, style_no: '', product_name: '', color: '', size_spec: '',
    plan_qty: 0, cutting_plan_qty: 0, due_date: '', daily_target: 0,
    plan_start: '', plan_end: '', workshop: '', line_team: ''
  }
  selectedStyle.value = null
  dialogVisible.value = true
}

async function create() {
  if (!selectedStyle.value) { ElMessage.warning('请先选择款式'); return }
  try {
    await api.post('/printing-plan-data/confirm', { ...form.value })
    dialogVisible.value = false
    ElMessage.success('创建成功')
    await load()
    await loadAllDaily()
  } catch (e) { ElMessage.error('创建失败') }
}
```

#### 编辑保存

```js
async function saveEdit() {
  try {
    await api.updateSchedule('secondary', editForm.value.id, editForm.value)
    ElMessage.success('修改成功')
    editingId.value = null
    await load()
    await loadAllDaily()
  } catch (e) {
    ElMessage.error('修改失败: ' + (e.response?.data?.detail || e.message))
  }
}
```

#### 计划产量计算（与缝制相同逻辑）

```js
function calcPlanQty(master, date, apiRow) {
  if (apiRow && apiRow.plan) return apiRow.plan
  const totalQty = master.cutting_plan_qty || master.plan_qty
  if (master.plan_start && master.plan_end && master.daily_target && totalQty && date >= master.plan_start && date <= master.plan_end) {
    const sd = new Date(master.plan_start + 'T00:00:00')
    const cd = new Date(date + 'T00:00:00')
    const dayIdx = Math.floor((cd - sd) / 86400000)
    const fullDays = Math.floor(totalQty / master.daily_target)
    const remainder = totalQty % master.daily_target
    if (dayIdx < fullDays) return master.daily_target
    if (dayIdx === fullDays && remainder > 0) return remainder
    return 0
  }
  return 0
}
```

#### 新增：自动计算印花结束

```js
function calcPlanEnd(start, qty, daily) {
  if (!start || !qty || !daily) return ''
  const days = Math.ceil(qty / daily)
  const d = new Date(start + 'T00:00:00')
  d.setDate(d.getDate() + days - 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

watch(() => [editForm.value.plan_start, editForm.value.cutting_plan_qty, editForm.value.daily_target], () => {
  if (!editingId.value) return
  const v = calcPlanEnd(editForm.value.plan_start, editForm.value.cutting_plan_qty, editForm.value.daily_target)
  if (v) editForm.value.plan_end = v
})
```

### 3.2 修改路由：`garment-web/src/App.vue`

将 `secondaryType === 'printing'` 时路由到新的 `PrintingPlanDetail.vue`。

```diff
+ import PrintingPlanDetail from './views/PrintingPlanDetail.vue'

  function enterSecondaryDetail(type) {
-   secondaryActiveType.value = type
+   if (type === 'printing') {
+     currentModule.value = 'printingPlan'
+   } else {
+     secondaryActiveType.value = type
+   }
  }

  // 模板中：
+ <PrintingPlanDetail v-else-if="currentModule === 'printingPlan'" @back="backToSecondaryHome" key="printingPlan" />
  <SecondaryDetail v-else-if="currentModule === 'secondary' && secondaryActiveType" ... />
```

或者更简单的方式：在 SecondaryHome.vue 中，点击"印花排程"时直接 emit 一个不同的事件。

### 3.3 修改 `SecondaryHome.vue`（可选）

如果不想改 App.vue 路由逻辑，可以保持原有路由，在 SecondaryDetail.vue 内部判断：

```vue
<!-- SecondaryDetail.vue 模板顶部 -->
<PrintingPlanDetail v-if="secondaryType === 'printing'" @back="emit('back')" />
<template v-else>
  <!-- 原有的 SecondaryDetail 内容 -->
</template>
```

### 3.4 修改 `SecondaryDetail.vue`（推荐方案）

在 SecondaryDetail.vue 的 `<script setup>` 中导入 PrintingPlanDetail：

```js
import PrintingPlanDetail from './PrintingPlanDetail.vue'
```

模板中：

```vue
<template>
  <PrintingPlanDetail v-if="secondaryType === 'printing'" @back="emit('back')" />
  <div v-else class="secondary-detail">
    <!-- 原有内容不变 -->
  </div>
</template>
```

这样改动最小，不影响其他排程类型。

### 3.5 前端 API 补充：`garment-web/src/api/index.js`

```js
// 印花排程数据
getPrintingPlanData: () => api.get('/printing-plan-data'),
confirmPrintingPlan: (data) => api.post('/printing-plan-data/confirm', data),
```

---

## 4. 导入导出设计

### 4.1 导入 Excel 格式

| 车间 | 班组 | 款号 | 品名 | 颜色 | 尺码 | 原单量 | 交期 | 印花日产量 | 印花开始 | 印花结束 | PLAN 2026-06-01 | ACTUAL 2026-06-01 | PLAN 2026-06-02 | ... |
|------|------|------|------|------|------|--------|------|-----------|---------|---------|----------------|-------------------|----------------|-----|

导入逻辑（与 SewingPlanDetail 类似）：
1. 读取 Excel，按行解析
2. 每两行为一组（PLAN + ACTUAL）
3. 调用 `confirmPrintingPlan` 创建排程
4. 调用 `saveActual` 写入实际产量

### 4.2 导出 Excel 格式

与缝制排程导出格式一致，三行模型（PLAN / ACTUAL / DIFF），日期列为动态列。

---

## 5. 实施步骤

### Phase 1: 后端基础（约 30 分钟）
1. ✅ 在 `server.js` 中新增 `GET /api/printing-plan-data` 端点
2. ✅ 在 `server.js` 中新增 `POST /api/printing-plan-data/confirm` 端点
3. ✅ 在 `server.js` 中新增 `GET /api/schedule/secondary/summary` 端点（如果缺失）
4. ✅ 在 `db.js` 的 `autoSchedule()` 中添加自动生成印花排程记录的逻辑
5. ✅ 在 `api/index.js` 中添加新 API 方法

### Phase 2: 前端组件（约 1-2 小时）
1. ✅ 创建 `PrintingPlanDetail.vue`（从 SewingPlanDetail.vue 复制并修改）
2. ✅ 修改列名、数据加载、创建/编辑/保存逻辑
3. ✅ 添加颜色和尺码列
4. ✅ 修改导入导出逻辑

### Phase 3: 路由集成（约 15 分钟）
1. ✅ 修改 `SecondaryDetail.vue` 或 `App.vue`，将印花路由指向新组件
2. ✅ 测试路由切换

### Phase 4: 验证（约 30 分钟）
1. ✅ 测试数据加载（styles × color_size × main_plan 聚合）
2. ✅ 测试三行模型（PLAN/ACTUAL/DIFF）
3. ✅ 测试内联编辑
4. ✅ 测试导入导出
5. ✅ 测试自动排产生成印花记录

---

## 6. 文件清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `garment-web/src/views/PrintingPlanDetail.vue` | 印花排程详情页（~800行） |
| 修改 | `garment-web/src/views/SecondaryDetail.vue` | 添加条件路由到 PrintingPlanDetail |
| 修改 | `garment-server/server.js` | 新增 3 个 API 端点 |
| 修改 | `garment-server/db.js` | autoSchedule() 添加印花逻辑 |
| 修改 | `garment-web/src/api/index.js` | 添加 2 个 API 方法 |

---

## 7. 注意事项

1. **虚拟记录**: `GET /api/printing-plan-data` 可能返回尚未正式排产的虚拟记录（`_virtual: true`），前端需区分处理
2. **日期窗口**: 与缝制排程相同，默认显示 today-7 到 today+21，支持 ±7 天偏移
3. **今天列高亮**: 保持 `#e0d4ff` 背景色
4. **sticky 列**: 左侧固定列（车间→类型），与缝制排程一致
5. **三行模型**: 计划行蓝色背景，实际行可编辑，差异行正绿负红
6. **filter 组件**: 复用现有 TextFilter/NumberFilter/DateFilter 组件
7. **StylePicker**: 复用现有组件，但只显示 `printing='是'` 的款式
