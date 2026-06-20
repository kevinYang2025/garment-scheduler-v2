# 制衣工厂生产排程系统 (garment-scheduler-v2)

为柬埔寨制衣工厂定制的生产计划排程系统,用于替代工厂当前以 Excel 手工排产的方式。工厂规模约 50 条缝制产线、5 个车间、3 名计划员。

仓库地址: https://github.com/kevinYang2025/garment-scheduler-v2

---

## 项目结构

```
plan management project/
├── garment-web/        # Vue 3 前端 (Vite + Element Plus + ECharts + Tailwind 4)
├── garment-server/     # Node.js 后端 (Express + better-sqlite3 + Socket.IO)
├── garment-scheduler/  # Java Spring Boot 后端 (已停用,代码保留)
├── DEVELOPMENT.md      # 开发规范(分支、提交格式、文件分工)
└── CLAUDE.md           # 项目架构、数据库表、视图说明
```

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 前端 | Vue 3 + Vite + Element Plus + ECharts 6 + Tailwind 4 + Socket.IO Client | 5173 |
| 后端 | Node.js + Express + better-sqlite3 + Socket.IO + ExcelJS | 3001 |
| 数据库 | SQLite (WAL 模式) | — |
| 备用后端 | Java Spring Boot + MyBatis-Plus + H2 (已停用) | — |

## 核心功能

- **款式管理**:款式主数据(订单一览),支持 Excel 导入导出
- **主计划倒推**:从交期(due_date)倒推 缝制结束 → 二次加工结束 → 裁剪结束
- **三行模型排程**:每条排程记录拆为 计划 / 实际 / 差异 三行,按 `row_type` 区分
- **缝制车间三层树**:车间 → 组 → 品类分类,支持产能配置
- **仓库三件套**:面料 / 裁片 / 辅料 / 成品 的入库、出库、库存
- **工作日历**:班次与节假日管理
- **ASN / DN 工作流**:到货通知单与发货通知单
- **目视化甘特图**:VisualSchedule 排程甘特图
- **自动排产**:`autoSchedule()` 基于产能预检和工作日历自动排产
- **交期预估模拟**:模拟不同交期下的产能占用
- **报工汇总与操作日志**:实际生产报工与系统操作审计
- **Socket.IO 实时推送**:后端数据变更自动广播到前端

## 快速开始

环境要求:Node.js 18+、npm 或 pnpm。

```bash
# 1. 克隆并切到 develop 分支
git clone https://github.com/kevinYang2025/garment-scheduler-v2.git
cd garment-scheduler-v2
git checkout develop

# 2. 安装依赖
cd garment-server && npm install
cd ../garment-web && npm install

# 3. 启动(两个终端)
# 终端 1:后端
cd garment-server && node server.js    # http://localhost:3001

# 终端 2:前端
cd garment-web && npm run dev          # http://localhost:5173
```

启动后浏览器打开 http://localhost:5173 即可访问。

## 数据库

默认使用 SQLite,数据库文件 `garment-server/data.sqlite`(已在 `.gitignore` 中排除)。

启动后端时会自动执行 `db.js` 中的 `init()` 初始化 schema。核心表:

- `styles` / `main_plan` — 款式主数据与主计划
- `schedule_master` / `schedule_daily` — 排程主记录与每日明细(三行模型)
- `actual_production` — 实际生产报工
- `warehouse_inbound` / `outbound` / `inventory` — 仓库三件套
- `workshops` / `production_lines` / `sewing_workshop_tree` — 车间与产线
- `asn_list` / `dn_list` — 到货 / 发货通知单
- `work_modes` / `work_calendars` / `scheduling_strategies` — 排产基础数据

详细字段说明见 `CLAUDE.md`。

## 开发规范

- **分支**:`develop`(日常开发) / `master`(稳定版,仅通过 PR 合并) / `feature/*`(新功能) / `fix/*`(修 bug)
- **提交格式**:`类型: 简短描述`,类型支持 `feat` / `fix` / `style` / `refactor` / `docs`
- **文件分工**:前端视图在 `garment-web/`,后端 API 在 `garment-server/`
- **日期处理**:统一使用 `db.js` 中的 `fmtLocal()`(UTC+8),不要用 `toISOString()`

详见 `DEVELOPMENT.md`。

## 项目状态 (2026-06-14)

已实现功能:款式 CRUD、导入导出、主计划倒推、三行模型排程、仓库三件套、缝制车间三层树、目视化甘特图、工作日历、ASN/DN 工作流、面料装载清单、出货计划、排产策略、交期预估、操作日志、报工汇总、Socket.IO 实时推送。

## 许可证

本项目为未授权私有项目(UNLICENSED),保留所有权利。详见 [LICENSE](./LICENSE)。
