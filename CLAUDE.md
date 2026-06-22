# 制衣工厂生产排程系统 — garment-scheduler-v2

> **重构进行中(2026-06-20 ~)**:Express + SQLite 正在向 NestJS 双轨迁移,详情见 `架构与重构方案.md`(v1.1)。
> 重构期间必须守住三条 P0 防线:
> 1. **Session 共享** — Phase 1 起必须 Redis 共享 store(否则双进程鉴权崩溃)
> 2. **SQLite 并发** — TypeORM `busy_timeout=5000` + WAL,Phase 5/6 必跑并发压测
> 3. **Socket.IO 跨进程广播** — `@socket.io/redis-adapter` 必装,实时强相关模块同日切完
> 违反任意一条会导致生产事故。

## 项目概要

柬埔寨制衣工厂生产计划排程系统。工厂背景：50条缝制产线，5个车间，3名计划员，目前用Excel手排。目标是用系统替代手工排程。

**仓库**: https://github.com/kevinYang2025/garment-scheduler-v2
**分支**: `develop`（日常开发）、`master`（稳定版）

## 项目结构

```
plan management project/
├── garment-web/          # Vue 3 前端 (Vite, Element Plus, ECharts, Tailwind)
├── garment-server/       # Node.js 后端 (Express + better-sqlite3 + Socket.IO)
├── garment-scheduler/    # Java Spring Boot (备用后端，当前不用)
├── DEVELOPMENT.md        # 开发规范（分支、提交格式）
├── 代码审查报告.md       # 2026-06-13 代码审查报告
└── 修复简报.md           # 审查修复简报
```

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 前端 | Vue 3 + Vite + Element Plus + ECharts 6 + Tailwind 4 + Socket.IO Client | 5173 |
| 后端 | Node.js + Express + better-sqlite3 + Socket.IO + ExcelJS | 3001 |
| 数据库 | SQLite (WAL 模式, data.sqlite) | — |
| 备用后端 | Java Spring Boot + MyBatis-Plus + H2（停用） | — |

## 启动方式

```bash
# 终端1: 后端
cd garment-server && node server.js    # http://localhost:3001

# 终端2: 前端
cd garment-web && npm run dev          # http://localhost:5173
```

## 核心架构决策

1. **三行模型**: schedule_daily 表中每个排程记录拆为三行（计划/实际/差异），row_type 区分
2. **交期倒推**: 从 due_date 倒推 sewing_end → secondary_end → cutting_end
3. **多款式共享工序**: 产能占用算法在 autoSchedule() 中
4. **Socket.IO 实时推送**: 后端数据变更自动广播到前端
5. **WAL 模式**: SQLite 启用 WAL 支持并发读写

## 数据库核心表

| 表 | 用途 | 关键字段 |
|---|---|---|
| styles | 款式主数据（订单一览） | style_no, plan_qty, due_date, status |
| main_plan | 主计划（倒推结果） | cutting/s二次/sewing 起止日期 |
| schedule_master | 排程主记录（统一模型） | schedule_type, style_id, plan_start/end |
| schedule_daily | 排程每日明细（三行模型） | master_id, schedule_date, row_type, qty |
| actual_production | 实际生产报工 | completed_qty, defect_qty, production_date |
| warehouse_inbound/outbound/inventory | 仓库三件套 | warehouse_type(面料/裁片/辅料/成品) |
| workshops / production_lines | 车间产线 | workshop_id, line_name, status |
| asn_list / asn_details | 到货通知单 | asn_code, style_no, qty |
| dn_list / dn_details | 发货通知单 | dn_code, style_no, qty |
| sewing_workshop_tree | 缝制车间三层树 | 车间→组→品类分类 |
| work_modes / work_calendars | 工作日历 | 班次、节假日 |
| scheduling_strategies | 排产策略 | 优先级规则配置 |
| fabric_loading_list | 面料装载清单 | fabric_name, pot_no, qty |

## 前端视图 (garment-web/src/views/)

| 文件 | 功能 | 行数 |
|---|---|---|
| Dashboard.vue | 首页仪表盘 | ~21K |
| Styles.vue | 款式管理（订单一览） | ~30K |
| MainPlan.vue | 主计划（交期倒推） | ~28K |
| ScheduleView.vue | 排程总览 | ~10K |
| SewingPlanDetail.vue | 缝制排程详情 | ~36K |
| SewingHome.vue | 缝制排程首页 | ~4K |
| SewingWorkshopManage.vue | 缝制车间管理（三层树） | ~24K |
| SecondaryHome.vue | 二次加工首页 | ~5K |
| SecondaryDetail.vue | 二次加工详情 | ~16K |
| VisualSchedule.vue | 目视化排程甘特图 | ~12K |
| WarehouseHome.vue | 仓库首页 | ~5K |
| WarehouseDetail.vue | 仓库详情 | ~31K |
| FabricLoadingList.vue | 面料装载清单 | ~25K |
| CapacityConfig.vue | 产能配置 | ~4K |
| ShippingPlan.vue | 出货计划 | ~5K |
| SchedulingStrategy.vue | 排产策略 | ~7K |
| DeliveryEstimation.vue | 交期预估 | ~9K |
| WorkCalendar.vue | 工作日历 | ~16K |
| DispatchReport.vue | 报工汇总 | ~6K |
| OperationLogs.vue | 操作日志 | ~4K |
| ASNWorkflow.vue | ASN 到货流程 | ~9K |
| DNWorkflow.vue | DN 发货流程 | ~8K |

## 后端核心文件

| 文件 | 用途 | 行数 |
|---|---|---|
| server.js | 所有 API 路由 (~100+ 端点) | ~2,054 |
| db.js | 数据库初始化、schema、核心逻辑函数 | ~873 |

**db.js 关键函数**: `init()`, `getDb()`, `fmtLocal()` (本地日期), `autoSchedule()` (自动排产), `capacityPrecheck()` (产能预检), `addWorkdays()` (工作日计算)

## 当前开发状态 (2026-06-14)

- ✅ 款式 CRUD、导入导出
- ✅ 主计划倒推
- ✅ 三行模型排程（裁剪/二次加工/缝制）
- ✅ 仓库三件套（面料/裁片/辅料/成品）
- ✅ 缝制车间三层树管理
- ✅ 目视化排程甘特图
- ✅ 工作日历（班次+节假日）
- ✅ ASN/DN 工作流
- ✅ 面料装载清单
- ✅ 出货计划
- ✅ 排产策略 + 自动排产
- ✅ 交期预估模拟
- ✅ 操作日志
- ✅ 报工汇总
- ✅ Socket.IO 实时推送

## 注意事项

1. **不要改 Java 项目** — garment-scheduler 已停用，只维护 Node.js 版
2. **日期用 fmtLocal()** — 不要用 toISOString()，UTC+8 会偏移一天
3. **分支规范** — 功能开发用 feature/xxx，修 bug 用 fix/xxx，提 PR 合入 develop
4. **提交格式** — `类型: 描述`（feat/fix/style/refactor/docs）
5. **端口** — 后端 3001，前端 5173，不要用 Spring Boot 的端口
6. **数据库** — 只用 SQLite (data.sqlite)，不用 H2

## Scope Freeze (2026-06-16)

> 本次开发周期内,以下模块 **不主动维护**(代码保留运行,不删不重构):
> 其他 agent 进入本项目时,先看本章节,避免浪费精力。

### 🟡 仓库功能(暂缓维护)

**范围**:`garment-server/server.js` 中所有 `/api/warehouse/*` 端点 + `garment-web/src/views/WarehouseHome.vue` / `WarehouseDetail.vue` / `FabricLoadingList.vue`

**状态**:工厂在用,功能保留运行;**本次不开发新功能、不审查、不修复 bug**

**原因**:项目 owner 本次开发周期时间紧,仓库功能已满足当前业务,优先保证核心排程稳定。

**恢复条件**:owner 明确说"恢复仓库开发" → 把本章节删掉一行即可。

### 🔴 Java 后端(永久退役)

**范围**:`garment-scheduler/` 整个目录(24 个 Java 文件 + Spring Boot 配置)

**状态**:**永久退役**。详细说明见 `garment-scheduler/DEPRECATED.md`。

**原因**:Node.js 版已完全覆盖功能,Spring Boot + H2 对当前业务规模过度设计,修复成本等同于重写。

**任何引用 Java 后端 API 的代码 → 必须改为调用 Node.js 后端**(`http://localhost:3001`)。

### 代码审查报告处理

`code-review-2026-06-16-v2.md` 中:
- **JS-*** 编号(Java 后端相关)= **WONTFIX**(Java 已退役)
- **NS-02** 库存并发、**FG-*** 中仓库视图相关 = **WONTFIX**(仓库 freeze)
- **本次必修** = X-01 / X-02 / NS-03 / NS-04(非仓库部分)
- 详见 `.harness/review-checklist.md`
