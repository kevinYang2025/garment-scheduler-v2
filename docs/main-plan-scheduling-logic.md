# 预排总计划排产逻辑梳理

> 写于 2026-06-19，供 kevin 审阅后排产逻辑是否需要调整
> 代码位置：`garment-server/server.js:1209-1555`（`POST /api/main-plan/auto-schedule`）

---

## 1. 整体流程

```
装柜清单(fabric_loading_list) → Step1裁剪 → Step2二次加工 → Step3缝制+烫标倒推 → Step4过期检测 → Step5多线分流 → Step6写入main_plan
```

**核心原则**：从交期倒推，确保每个工序在最晚完成时间内完成；多线分流确保缝制上线日晚于前道下线日。

---

## 2. 数据源

| 来源表 | 用途 | 关键字段 |
|---|---|---|
| `fabric_loading_list` | **决定哪些款式参与排产**（只有装柜清单里的才排） | style_no, loading_date, garment_qty |
| `styles` | 款式属性 | printing/embroidery/template/ironing_label(是否标记), *_daily_output(日产量), target_daily_output, due_date |
| `capacity_config` | 全局日产能上限 | cutting=60000, printing=10000, embroidery=8000, template=3000, ironing=6000 |
| `production_lines` | 缝制日产量 fallback | daily_output |
| `sewing_workshop_tree` | 多线分流分类限制 | category |

**数量优先规则**（`server.js:1240-1246`）：
```
装柜清单 garment_qty > 0 → 用 garment_qty
否则 → 用 styles.plan_qty
```

---

## 3. Step 1 — 裁剪排程（server.js:1272-1306）

### 算法

```
裁剪开工日 = 装柜日期(loading_date) + 24天
排序：按 cutting_start 升序，同日按 style_no 升序
贪心分配：
  每天产能 cuttingStandard(60000件)
  当天排满 → 推到下一天继续
输出：cuttingResults[style_no] = { cutting_start, cutting_end }
```

### 示例

```
款式A: loading_date=6/1, qty=80000
  cutting_start = 6/25
  6/25 排60000, 剩20000
  6/26 排20000
  → cutting_start=6/25, cutting_end=6/26

款式B: loading_date=6/1, qty=30000
  6/26 排剩余产能40000中的30000
  → cutting_start=6/25, cutting_end=6/26
```

### 注意

- **不考虑工作日历**，用的是自然日（`addDays`），不是 `addWorkdays`
- 裁剪开工固定 = 装柜日+24天，不根据实际排产拥挤度调整

#### 工作日历裁剪前不考虑，裁剪后要考虑

## 4. Step 2 — 二次加工排程（server.js:1308-1364）

### 算法

```
3种二次加工依次处理：印花 → 刺绣 → 模板（烫标在Step3单独处理）
条件：styles.printing/embroidery/template = '是' 且 对应 daily_output > 0
开工日 = 裁剪结束日(cutting_end) + 1天
排序：按 start 升序

贪心分配：
  每天可用产能 = min(款式日产量(style_max), 全局剩余产能(remain))
  当天排满 → 推到下一天

输出：secondaryResults[style_no] = {
  printing_start/end, embroidery_start/end, template_start/end
}
```

### 关键点

- **3种二次加工各自独立贪心**，互不依赖
- 每款式的日产量受 `styles.*_daily_output` 限制（不能超款式自身产能）
- 每天全局产能也受 `capacity_config` 限制（多款式共享产能）
- 烫标(ironing)不在这一步，放在Step3倒推

### 潜在问题

- 印花/刺绣/模板**并行排列**而非串行，如果一个款式同时有印花+刺绣，两者的时间可能重叠
- 实际业务中，印花和刺绣通常是串行的（先印花再刺绣，或反过来）

---------------------------------------------------------------------------------------------------------------------------
#### 这里需要再确认
-----------------------------------------------------------------------------------------------------------------------------

## 5. Step 3 — 缝制 + 烫标倒推（server.js:1366-1426）

### 缝制倒推

```
sewingEnd = due_date - 15天（交期前15天必须缝完）
dailyTarget = styles.target_daily_output
           || production_lines.daily_output（按product_name匹配）
           || 500（兜底默认值）
sewingDays = ceil(qty / dailyTarget) + 1
sewingStart = sewingEnd - (sewingDays - 1)天
sewingRemindDate = sewingStart - 10天
```

### 烫标倒推（仅 styles.ironing_label = '是'）

```
ironingEnd = sewingStart - 3天
从 ironingEnd 倒推，每天消耗 = min(styles.ironing_daily_output, cap.ironing剩余)
倒推到 ironingStart
```

### 其他字段

```
arrival_date = loading_date + 21天
secondary_start = cutting_end + 1天
secondary_end = max(printing_end, embroidery_end, template_end)（取最晚的二次加工结束日）
```

### 注意

- 缝制 dailyTarget 默认500件/线/天，这个兜底值可能需要根据实际调整
- 烫标倒推方向是**向前推**（从缝制上线日往前推），如果倒推到过去 → Step5会标冲突
- `-15天`、`-3天`、`-10天` 这些缓冲值都是硬编码

---

## 6. Step 4 — 过期检测（server.js:1428-1431）

```
expired = (due_date < 今天) ? 1 : 0
```

过期的款式在Step5不分流，直接单线+冲突标记。

---

## 7. Step 5 — 多线分流（server.js:1433-1516）

### 算法

```
排序：按 due_date 升序

过期/交期≤15天的款式：
  不分流，单线排产，conflict_flag=1

正常款式：
  前道最晚下线日 maxPreEnd = max(printing_end, embroidery_end, template_end, ironing_end) 或 cutting_end

  从 N=1 开始尝试增加线数：
    sewingDays = ceil(plan_qty / (N * dailyTarget)) + 1
    sewingStart = sewingEnd - (sewingDays - 1)
    如果 sewingStart > maxPreEnd → 停止增加，当前N就是需要的线数

  N 的限制：
    N ≤ 分类可用产位数（sewing_workshop_tree中该分类的槽数×3 - 已用）
    N ≤ 全厂剩余线数（49 - totalLinesAssigned）
    如果分类限制≤0 → 强制N=1

  按N条线均分数量（首条线多分余数），每线独立重算：
    perLineSewingStart, perLineIroningEnd, conflict_flag

  冲突检测：
    1) sewingStart ≤ maxPreEnd → 缝制上线不晚于前道下线，来不及
    2) ironingStart < 今天 → 烫标倒推到过去

输出：每条线一行 main_plan 记录，带 line_count 和 line_index
```

### 硬编码值

| 值 | 含义 | 位置 |
|---|---|---|
| 49 | 全厂缝制线数上限 | `server.js:1459` |
| 15天 | 交期紧急判定线 | `server.js:1444` |

### 注意

- 分流是**贪心顺序分配**，按交期先后先到先得
- `categoryUsed` 跟踪每个分类已分配的线数，但 `sewing_workshop_tree` 的槽数计算是 `catRows.length * 3`（每节点3条线），这个3也是硬编码
- 分流后总数量 = 原数量（首线多分余数），每线 sewingStart 不同

---

## 8. Step 6 — 写入主计划（server.js:1518-1555）

```
事务内：
  DELETE FROM main_plan  ← 先清空全部
  批量 INSERT results
广播 mainPlan 更新
返回：总行数、冲突数、过期数、分配线数
```

### 关键问题

**每次排产先删除全部 main_plan 再重建**。如果用户手动调整过某条计划的日期，重新排产会丢失调整。

---

## 9. 另一条排产路径：缝制自动排产（db.js:autoSchedule）

| | 预排总计划 | 缝制自动排产 |
|---|---|---|
| 入口 | `POST /api/main-plan/auto-schedule` | `POST /api/schedule/auto` → `db.autoSchedule()` |
| 数据源 | `fabric_loading_list` | `main_plan WHERE is_scheduled=0` |
| 输出表 | `main_plan`（只有时间线，无每日明细） | `schedule_master` + `schedule_daily`（有PLAN/ACTUAL行） |
| 覆盖工序 | 裁剪+二次加工+缝制+烫标 全链路 | 只排缝制（+印花） |
| 分配逻辑 | 多线分流（按交期倒推） | 轮询分配到 production_lines |
| 生成daily | 不生成 | 生成（generatePlanRows） |

---

## 10. 潜在问题汇总

| # | 问题 | 严重度 | 说明 |
|---|---|---|---|
| P1 | 裁剪不考虑工作日历 | 高 | `addDays` 用自然日，周末/假日也排产，与工厂实际不符 |-------------------裁剪前不考虑，之后所有流程都要考虑
| P2 | 二次加工并行排列 | 中 | 印花/刺绣/模板各自独立排，同时有的款式时间会重叠；实际可能需要串行 |----------这个再确认
| P3 | 多线分流上限硬编码49 | 中 | 全厂50线不一定都是缝制线，应从 production_lines 动态计算 |----------都是缝制线，但可能调整，需要跟着基础数据调整而调整
| P4 | 删除重建策略 | 高 | 用户手动调整会被覆盖，应改为"新增/更新，保留手动修改"或标记来源 |-------可记录手动调整
| P5 | 缓冲天数硬编码 | 中 | -15天(出货缓冲)、-3天(烫标缓冲)、-10天(缝制提醒)、+24天(面料到裁剪) 都写死在代码里，应可配置 |-----可加入配置
| P6 | dailyTarget 兜底500 | 低 | 缝制日产量 fallback 到500，可能不符合实际产线产能 |--------产能应该根据不同款式设定，基础数据里面
| P7 | 款式日产量=0则跳过 | 中 | `styles.*_daily_output = 0` 的款式不排二次加工，但可能只是没填数据 |---------这里要确认是什么问题？
| P8 | sewing_workshop_tree槽数×3 | 低 | 多线分流时分类限制计算用 `catRows.length * 3`，3是硬编码 |---------这里要确认是什么问题？

---

## 11. 决策点(已确认)

1. **二次加工串行/并行** — ⏳ 待定,等业务确认后再改
2. **装柜清单覆盖范围** — ✅ 全部订单(含补单)都在装柜清单,当前逻辑已对,无需扩展
3. **冲突报警** — ✅ 已有预设冲突逻辑,新增行仍冲突需主动报警(写入 `operation_logs` 或前端推送),目前只 set `conflict_flag=1` 不够
4. **手动调整保护** — ✅ 记录即可:加 `main_plan.manual_edited_at` / `manual_edited_by` / `manual_edited_by_user_id` 字段,Step 6 改为"非手动行删除 + 自动行重建 + 手动行保留"

## 12. 由决策 3/4 衍生的具体改动

| 改动 | 位置 | 说明 |
|---|---|---|
| main_plan 加 3 列 | `db.js:createTables` | `manual_edited_at TEXT, manual_edited_by TEXT, manual_edited_by_user_id INTEGER` |
| 报警写入日志 | `server.js:Step 5` 冲突后 | `logOp(req, 'main_plan', 'schedule_conflict', id, style_no, '...')` + 前端 socket 推送 |
| 报警 UI | MainPlan view | 顶栏红条 "X 条计划冲突" 列表 + socket 监听(per-row 标识已有,仅补顶部汇总 + toast) |
| Step 6 删除改为条件 | `server.js:1518` | `DELETE FROM main_plan WHERE manual_edited_at IS NULL`,只删自动行 |
| PUT 接口标手动 | `PUT /api/main-plan/:id` | 改日期时 `UPDATE ... SET manual_edited_at=datetime('now','localtime'), manual_edited_by=?, manual_edited_by_user_id=?` |
