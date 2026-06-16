# 服装生产管理系统 — 全栈代码审查报告

> 审查日期：2026-06-16  
> 审查范围：garment-server（Node.js 后端）、garment-scheduler（Java Spring Boot 后端）、garment-web（Vue.js 前端）  
> 审查依据：严格基于实际代码，无臆测编造

---

## 一、审查概览

| 模块 | 覆盖文件数 | 风险等级 | 核心结论 |
|------|-----------|---------|---------|
| garment-server | 2（server.js 3249行 + db.js 1063行） | **中** | 结构清晰，有基本校验，但并发安全和数据一致性存在风险 |
| garment-scheduler | 24（9控制器 + 1服务 + 14实体） | **高** | 全API无认证、H2控制台暴露、仓库出库竞态、Controller-Service职责混乱 |
| garment-web | 6（api/index.js + 5个核心视图） | **高** | API方法被覆盖导致路由错误、Dashboard字段名不匹配显示为空 |

**整体风险等级：高**  
**核心结论**：Java后端存在多个阻断级安全问题需上线前修复；Node.js后端的并发安全和前端的API覆盖Bug会直接影响用户使用。

---

## 二、严重问题（阻断/高风险）

### 跨模块严重问题

> **问题编号**：X-01（前端 + 后端协同）  
> **所在位置**：`garment-web\src\api\index.js` 第 63 行 vs 第 176 行  
> **问题描述**：`autoSchedule` 方法在导出对象中被定义了两次，第 176 行的定义覆盖了第 63 行。原始定义请求 `/main-plan/auto-schedule`（预排总计划端点），被覆盖后请求 `/auto-schedule`（排产策略端点）。`MainPlan.vue` 第 85 行调用 `api.autoSchedule()` 时实际走了错误的端点，执行了不同的业务逻辑。  
> **代码佐证**：  
> ```javascript
> // 第 63 行 — 原始定义（被覆盖，不可见）
> autoSchedule: () => api.post('/main-plan/auto-schedule'),
> // 第 176 行 — 覆盖定义（生效）
> autoSchedule: (strategyId) => api.post('/auto-schedule', { strategy_id: strategyId }),
> ```  
> **修复建议**：将第 176 行重命名为 `autoScheduleWithStrategy`，保留第 63 行原始定义。

> **问题编号**：X-02（前端 + 后端协同）  
> **所在位置**：`garment-web\src\views\Dashboard.vue` 第 326-331 行  
> **问题描述**：Dashboard「近期预排总计划」表格引用的字段名与后端 `main_plan` 表 schema 不匹配。后端字段为 `style_no`/`plan_qty`/`due_date`，但前端使用了 `style_name`/`quantity`/`delivery_date`，导致这三列数据始终显示为空。  
> **代码佐证**：  
> ```html
> <span class="cell-name">{{ plan.style_name || plan.style_id }}</span>
> <td class="cell-mono">{{ plan.quantity || '-' }}</td>
> <td class="cell-muted">{{ plan.delivery_date || '-' }}</td>
> ```  
> **修复建议**：改为 `plan.style_no`、`plan.plan_qty`、`plan.due_date`。

---

### Node.js 后端严重问题

> **问题编号**：NS-01  
> **所在位置**：`server.js` 第 1956-1959 行，`POST /api/warehouse/:type/inbound`  
> **问题描述**：入库单号生成存在并发竞态。先 `SELECT COUNT(*)` 再 `INSERT`，并发请求可能拿到相同 count 导致重复单号。同样的问题存在于 `genAsnCode()`（第 2136 行）、`genDnCode()`（第 2259 行）、出库单号生成（第 1991 行）。  
> **代码佐证**：  
> ```javascript
> const todayCount = db.get("SELECT COUNT(*) as c FROM warehouse_inbound WHERE order_no LIKE ?", [`RB${today}%`]).c;
> const orderNo = `RB${today}-${String(todayCount + 1).padStart(3, '0')}`;
> ```  
> **修复建议**：为 `order_no` 添加 UNIQUE 约束并处理冲突重试，或使用原子计数器。

> **问题编号**：NS-02  
> **所在位置**：`server.js` 第 2380-2403 行，`updateInventory` 函数  
> **问题描述**：库存更新先 SELECT 再 UPDATE，高并发下可能超卖。且 `Math.max(0, ...)` 使出库库存不足时静默归零而非报错。`updateInventory` 被多处调用（ASN完成、DN发货、批量入库等），并非所有路径都有前置库存检查。  
> **代码佐证**：  
> ```javascript
> const existing = db.get('SELECT * FROM warehouse_inventory WHERE ...');
> const newQty = Math.max(0, existing.current_qty + delta);
> db.run(`UPDATE warehouse_inventory SET current_qty = ? WHERE id = ?`, [newQty, existing.id]);
> ```  
> **修复建议**：使用原子操作 `UPDATE ... SET current_qty = current_qty + ?`，出库时加 `AND current_qty >= ABS(?)` 条件。

> **问题编号**：NS-03  
> **所在位置**：`server.js` 第 1028 行，`POST /api/main-plan/auto-schedule`  
> **问题描述**：预排产先 `DELETE FROM main_plan` 清空全部数据再逐条 INSERT，无事务保护。中间失败会导致数据库处于不一致状态。  
> **修复建议**：将 DELETE + INSERT 包裹在 `db.getDb().transaction()` 中。

> **问题编号**：NS-04  
> **所在位置**：`server.js` 第 266 行、第 1126 行、第 1270 行、第 1324 行、第 2015 行  
> **问题描述**：多个错误处理分支直接返回 `e.message`（数据库原始错误信息），可能泄露数据库结构、文件路径等敏感信息。  
> **代码佐证**：  
> ```javascript
> res.status(500).json({ error: '导入失败: ' + e.message });
> ```  
> **修复建议**：生产环境返回通用错误提示，详细信息记录到服务端日志。

---

### Java 后端严重问题

> **问题编号**：JS-01  
> **所在位置**：`WarehouseController.java` 第 53-74 行，`addOutbound` + `updateInventory`  
> **问题描述**：仓库出库存在 TOCTOU 竞态条件。库存校验和扣减之间无锁，高并发下可超卖。  
> **代码佐证**：  
> ```java
> WarehouseInventory inv = inventoryMapper.selectOne(...);
> if (inv == null || inv.getCurrentQty() < record.getQty()) { /* 校验 */ }
> // 两步之间无锁
> outboundMapper.insert(record);
> updateInventory(type, ..., -record.getQty());
> ```  
> **修复建议**：使用 `UPDATE ... SET current_qty = current_qty - ? WHERE current_qty >= ?` 原子 SQL。

> **问题编号**：JS-02  
> **所在位置**：`ActualProductionController.java` 第 62-119 行，`syncToDailyActual`  
> **问题描述**：复杂的多表同步逻辑直接写在 Controller 中，无事务保护。删除实际生产记录时不同步清理 `schedule_daily` 中的 ACTUAL/DIFF 行，产生孤儿数据。  
> **修复建议**：迁移至 Service 层并添加 `@Transactional`；delete 时同步清理关联数据。

> **问题编号**：JS-03  
> **所在位置**：`WarehouseController.java` 第 36-42 行，`addInbound`  
> **问题描述**：入库接口无任何入参校验。`qty` 为 null 时 `updateInventory` 中的拆箱操作会抛 NPE。  
> **修复建议**：增加 styleNo、qty 等必填字段的非空和正数校验。

> **问题编号**：JS-04  
> **所在位置**：`MainPlanController.java` 第 42-46 行，`save`  
> **问题描述**：主计划保存未校验 styleId、planQty、dueDate。当 planQty 为 null 或 0 时，`ScheduleEngineService.calculate()` 静默跳过计算，但前端收到 `ok: true`，用户无感知。  
> **修复建议**：保存前校验必填字段，缺少时返回明确错误。

> **问题编号**：JS-05  
> **所在位置**：`VisualScheduleController.java` 第 140-203 行，`assignToLine`  
> **问题描述**：甘特图拖拽排班使用 `Map<String, Object>` 接收请求，`Long.valueOf(planIdObj.toString())` 未做格式校验，非法输入时抛未捕获的 NumberFormatException。整个 60 行逻辑全在 Controller 中。  
> **修复建议**：定义专用 DTO 类（含校验注解），核心逻辑迁移至 Service 层。

> **问题编号**：JS-06  
> **所在位置**：`application.yml` 第 17-19 行  
> **问题描述**：H2 数据库控制台启用且路径为 `/h2-console`，使用默认凭据（sa/空密码）。暴露在网络中等于直接暴露整个数据库。  
> **代码佐证**：  
> ```yaml
> h2:
>   console:
>     enabled: true
>     path: /h2-console
> username: sa
> password:
> ```  
> **修复建议**：生产环境禁用 H2 控制台，设置强密码。

---

### 前端严重问题

> **问题编号**：FS-01  
> **所在位置**：`garment-web\src\views\Dashboard.vue` 第 116-136 行  
> **问题描述**：生产趋势柱状图在 computed 中使用 `Math.random()` 生成数据，每次重新求值时图表随机变化。KPI 卡片的 `change` 百分比（+12%、+8% 等）也是硬编码的虚假数据。  
> **代码佐证**：  
> ```javascript
> data: months.map(() => Math.floor(planCount * (0.6 + Math.random() * 0.8))),
> ```  
> **修复建议**：后端暂无按月统计时应显示空状态，不应在 computed 中使用 `Math.random()`。

---

## 三、一般问题（优化改进）

### Node.js 后端

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| NG-01 | server.js:10 | API_TOKEN 默认值 `'garment-dev-token'`，AUTH_ENABLED 默认 false，生产环境可能认证完全失效 | AUTH_ENABLED=true 时若 token 仍为默认值应报错退出 |
| NG-02 | server.js:1844-1856 | 出货计划更新/删除未检查记录存在性，未校验字段合法性 | 添加存在性检查和字段校验 |
| NG-03 | server.js:482-506 | 删除车间时级联删除不在事务中，中间失败会导致部分删除 | 包裹在 `db.getDb().transaction()` 中 |
| NG-04 | server.js:854-863 | `parseDate` 的正则 `/^\d{4,6}$/` 范围过宽，纯数字款号会被误判为 Excel 日期序列号 | 增加上下文判断，仅对日期字段做序列号转换 |
| NG-05 | server.js:56 | Token 通过 URL query 传递易泄露，比较未使用时间安全函数 | 生产环境禁用 query string 传 token |
| NG-06 | server.js:1410-1436 | `group_by` 拼接 GROUP BY，当前 switch 白名单安全，但扩展时有注入风险 | 添加注释标明安全边界 |
| NG-07 | server.js:928 | `autoSchedule` 的 orderBy 来源于数据库 JSON，当前三元映射安全 | 使用枚举常量明确安全边界 |
| NG-08 | server.js:1867 | 出货计划编号并发可能重复 | 使用数据库唯一约束 |
| NG-09 | server.js:2578 | 装柜清单更新未校验字段，qty 可为负数 | 添加输入校验 |
| NG-10 | server.js:1114-1120 | 多处 console.log 调试日志输出敏感业务数据 | 移除或降级为 debug 级别 |
| NG-11 | server.js:1512-1538 | 批量导入报工数据单条失败不报告，与缝制导入的 errors 收集机制不一致 | 添加 try-catch 收集错误 |
| NG-12 | db.js:31-510 | styles 表 style_no 无 UNIQUE，但多处代码假设唯一 | 明确文档说明，确保关联查询能处理多条 |
| NG-13 | server.js:2331-2343 | DN 发货扣减库存未检查是否充足，静默归零 | 发货前检查库存 |

### Java 后端

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| JG-01 | CapacityConfigController:41-49 | 配置项不存在时静默返回 ok=true | 返回错误信息 |
| JG-02 | WorkshopController:41-46 | updateLine 静默覆盖 id，全字段更新无权限校验 | 校验 id 一致性，选择性更新 |
| JG-03 | ScheduleController:127-130 | 注释标注批量插入但实际仍是逐条 insert | 使用 saveBatch |
| JG-04 | ScheduleController:79-91 | regenerate 只删 PLAN 行，generatePlanRows 又创建 ACTUAL 行，违反 UNIQUE 约束 | 同时删除旧 ACTUAL 行或先检查存在 |
| JG-05 | VisualScheduleController:42-138 | 甘特图全量加载无分页，通过字符串匹配关联车间和计划 | 使用外键关联，增加分页 |
| JG-06 | ExcelUtil:85-140 | 导入使用反射设置任意字段，含 isScheduled 等敏感字段 | 移除不应导入的字段 |
| JG-07 | ScheduleEngineService:127-138 | recalculateAll 全量加载逐条更新，性能线性恶化 | 分页查询+批量更新 |
| JG-08 | 多个 Controller | 多个接口使用 Map 接收请求体，绕过 Spring 参数校验 | 定义专用 DTO + @Valid |
| JG-09 | GlobalExceptionHandler:19-23 | 直接返回 e.getMessage()，可能泄露堆栈/SQL | 生产环境只返回通用错误 |
| JG-10 | MainPlanController:70-74 | 删除主计划未检查是否已排程 | 删除前检查关联 |
| JG-11 | ScheduleController:133-139 | 排程删除先删 daily 再删 master，无事务保护 | 添加 @Transactional |
| JG-12 | application.yml:43 | SQL 日志输出到 stdout，生产环境性能差且泄露数据 | 改为 SLF4J |

### 前端

| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| FG-01 | MainPlan.vue:462-476 | onMounted 添加 mousedown 监听，onUnmounted 未移除，内存泄漏 | 添加 removeEventListener |
| FG-02 | Styles.vue:38 | searchTimer 在 onUnmounted 未清除 | 添加 clearTimeout(searchTimer) |
| FG-03 | WarehouseDetail.vue:500-509 | 导入菜单文案「导当前」应为「导入当前」 | 修正文案 |
| FG-04 | Styles.vue:35 | styles 用 ref(props.initialData) 初始化但未 watch prop 变化 | 添加 watch |
| FG-05 | WarehouseHome.vue:24-42 | 4个仓库库存串行请求 | 使用 Promise.all 并行 |
| FG-06 | Styles.vue:586 | 批量修改弹窗数值字段未设 min，允许负数 | 添加 :min="0" |
| FG-07 | WarehouseDetail.vue:284-361 | 入库/出库多步流程无回滚，中间失败留下悬挂单据 | 后端合并接口或前端添加重试 |
| FG-08 | WarehouseDetail.vue:289 vs 579 | 面料入库 qty min=0 但验证拒绝 0，不一致 | 统一验证逻辑 |

---

## 四、前后端协同问题

| # | 问题 | 前端位置 | 后端位置 | 说明 |
|---|------|---------|---------|------|
| X-01 | autoSchedule 方法被覆盖 | api/index.js:63 vs 176 | server.js auto-schedule 端点 | 前端调用走错端点 |
| X-02 | Dashboard 字段名不匹配 | Dashboard.vue:326-331 | db.js main_plan 表 | 数据显示为空 |
| X-03 | 仓库入库无前后端校验对齐 | WarehouseDetail.vue 有 min 校验 | WarehouseController 无校验 | 后端缺校验是真正的防线 |
| X-04 | 错误信息格式不统一 | 前端期望 { error: "..." } | Java 后端返回 { ok: false, error: "..." } | 两套后端错误格式不同，前端需分别处理 |
| X-05 | saveStyle 行为不明确 | Styles.vue 编辑时调用 POST /styles | server.js POST /styles 是 INSERT | 编辑可能创建重复记录而非更新 |

---

## 五、待确认事项

| # | 内容 | 需要确认的信息 |
|---|------|--------------|
| T-01 | `syncActualToDaily` 按 style_no 匹配所有 master，同一款号多条排程时产量写入所有记录 | 业务上是否允许同一款号多条产线同时生产？ |
| T-02 | `recalcTaskStatus` 参数 masterId vs style_id 含义是否匹配 | style_id 是否同时也是 schedule_master.id？ |
| T-03 | `visual-schedule/unassign` 用 sm.style_id 更新 main_plan，多条排程时取消一条会影响其他 | 是否符合预期？ |
| T-04 | styles 表 embroidery_printing 旧字段仍保留 | 是否可清理？ |
| T-05 | Java 后端全 API 无认证 | 是否计划通过网关层统一鉴权？ |
| T-06 | Formula.java 实体无任何使用 | 预留功能还是废弃代码？ |
| T-07 | ScheduleEngineService 假设二次加工下线=缝制上线同一天 | 业务上是否合理？ |
| T-08 | WarehouseDetail.vue 面料/非面料出库 qty min 不一致 | 面料是否允许 0 数量出库？ |

---

## 六、已确认无问题模块

### Node.js 后端
1. CORS 中间件（server.js:39-51）：通配符和白名单正确
2. 输入校验函数（server.js:81-112）：validateStyle/validateMainPlan/validateWarehouseRecord
3. 数据库初始化与迁移（db.js:15-653）：WAL 模式、外键、迁移健壮
4. 工作日历逻辑（db.js:1012-1042）：isWorkday/addWorkdays 正确
5. ASN/DN 状态机（server.js:2193/2317）：白名单校验
6. Socket.IO 认证（server.js:2924-2932）
7. WebSocket 广播（server.js:2935-2941）：有 try-catch 保护
8. 全局错误处理器（server.js:3231-3234）
9. 出库库存检查（server.js:1996-1999）：前置充足性检查
10. colIdxToLetter 函数（server.js:1329-1338）

### Java 后端
1. 实体类定义（14个）：MyBatis-Plus 注解正确，字段与 DDL 一一对应
2. StyleController 的 list/save/delete 方法：校验完整
3. ScheduleController 的 list/daily 方法：查询逻辑清晰
4. ScheduleEngineService 倒推计算逻辑：数学正确
5. ExcelUtil 导出逻辑：样式、数据、列宽正确
6. CorsConfig/WebSocketConfig/MybatisPlusConfig：配置正确
7. DataInitializer：有 selectCount 守卫避免重复

### 前端
1. MainPlan.vue 表格筛选/排序逻辑：多条件组合正确
2. MainPlan.vue 双 div 表头同步机制：滚动/列宽同步正确
3. MainPlan.vue 拖拽滚动功能：事件处理正确
4. Styles.vue 批量操作流程：确认-执行-反馈完整
5. WarehouseDetail.vue 仓库类型适配：面料/非面料差异化清晰
6. api/index.js 通用 HTTP 方法封装
7. WarehouseHome.vue 权限占位函数（当前返回 true + TODO）

---

## 七、修复优先级建议

### P0 — 立即修复（影响功能正确性）
1. **X-01**：api/index.js autoSchedule 方法覆盖
2. **X-02**：Dashboard 字段名不匹配
3. **JS-06**：禁用 H2 控制台
4. **NS-03**：auto-schedule 事务保护

### P1 — 尽快修复（安全/数据风险）
1. **NS-02 / JS-01**：库存更新并发安全（两端都有）
2. **NS-04 / JG-09**：错误信息泄露敏感内容
3. **JS-02**：syncToDailyActual 事务保护
4. **JS-03**：入库接口入参校验
5. **JS-04**：主计划保存校验

### P2 — 计划修复（质量/体验）
1. **NG-10**：移除调试日志
2. **FG-01/FG-02**：内存泄漏修复
3. **FG-03**：文案修正
4. **NG-01**：生产环境认证加固
5. **JG-03**：批量插入优化
