# 制衣工厂生产排程系统 v1.0.0

为柬埔寨制衣工厂定制的生产计划排程系统,用于替代工厂当前以 Excel 手工排产的方式。工厂规模约 50 条缝制产线、5 个车间、3 名计划员。

- 仓库: https://github.com/kevinYang2025/garment-scheduler-v2
- 当前版本: **v1.0.0** (2026-06-20 tag)
- 分支: `master` 唯一活跃分支

---

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 前端 | Vue 3 + Vite + Element Plus + ECharts 6 + Tailwind 4 + Socket.IO Client | 5173 (开发) / 443 (生产经 Nginx) |
| 后端 | Node.js + Express + better-sqlite3 + Socket.IO + ExcelJS | 3001 |
| 数据库 | SQLite (WAL 模式) | — |
| 反代 | Nginx + HTTPS (生产) | 443 |

`garment-scheduler/` 是早期 Java Spring Boot 版本,2026-06-16 退役,代码仅作历史保留,不再使用也不再部署。

---

## 项目结构

```
plan management project/
├── garment-web/                       # Vue 3 前端
│   ├── src/views/                     # 业务页面(40+ 视图)
│   ├── src/api/                       # axios 封装 + 全部 API 方法
│   ├── src/composables/               # 组合式函数(useVirtualScroll 等)
│   └── vite.config.js
├── garment-server/                    # Node.js 后端
│   ├── server.js                      # Express 路由 + Socket.IO(2,054 行)
│   ├── db.js                          # better-sqlite3 + schema(873 行)
│   ├── data.sqlite                    # 数据库文件(.gitignore)
│   └── public/                        # 前端 build 产物(.gitignore,部署时生成)
├── garment-scheduler/                 # [DEPRECATED] Java Spring Boot,2026-06-16 退役
├── scripts/                           # 部署/运维脚本
│   ├── deploy.sh                      # 生产部署
│   ├── healthcheck.sh                 # 健康检查
│   ├── backup.sh                      # SQLite 备份
│   └── scan-i18n.js                   # i18n 覆盖率扫描
├── docs/                              # 文档
│   ├── DEPLOY.md                      # 生产部署步骤
│   ├── runbook.md                     # 运维 runbook(7 个常见场景)
│   ├── SMOKE-TEST.md                  # 上线冒烟测试清单
│   ├── SECRETS.md                     # 密钥清单元信息
│   ├── main-plan-scheduling-logic.md  # 主计划排产逻辑详解
│   └── warehouse-development-guide.md # 仓库模块开发指南
├── README.md                          # 本文件
├── DEVELOPMENT.md                     # 开发规范与工作流
└── CLAUDE.md                          # 项目架构、数据库表、视图说明
```

---

## 核心功能

| 模块 | 说明 |
|---|---|
| 款式管理 | 款式主数据(订单一览),支持 Excel 导入导出 |
| 主计划倒推 | 从交期 `due_date` 倒推 缝制结束 → 二次加工结束 → 裁剪结束,基于工作日历扣除休息日 |
| 三行模型排程 | 排程统一三行(计划 / 实际 / 差异),按 `row_type` 区分,覆盖所有工序 |
| 缝制车间三层树 | 车间 → 组 → 品类分类,产能配置 |
| 仓库四类 | 面料 / 裁片 / 辅料 / 成品,入库、出库、库存 |
| 工作日历 | 班次与节假日管理,主计划倒推自动扣除非工作日 |
| ASN / DN 工作流 | 到货通知单与发货通知单 |
| 目视化甘特图 | 缝制产线排程可视化,自动排除已排款式 |
| 自动排产 | `autoSchedule()` 基于产能预检和工作日历 |
| 交期预估模拟 | 模拟不同交期下的产能占用 |
| 报工汇总 | 实际生产报工 + 计划 vs 实际对比 + 告警 |
| 操作日志 | 系统操作审计(按 user 隔离) |
| Socket.IO 实时推送 | 后端数据变更自动广播到前端 |
| 用户系统 | 登录、会话、角色(admin / supervisor / dispatcher) |
| ETag 乐观锁 | `api.etagPut` helper,412 自动重试 |

---

## 快速开始(本地开发)

环境要求:Node.js 18+、npm 或 pnpm。

```bash
# 1. 克隆
git clone https://github.com/kevinYang2025/garment-scheduler-v2.git
cd garment-scheduler-v2

# 2. 安装依赖
cd garment-server && npm install
cd ../garment-web && npm install

# 3. 启动(两个终端)
# 终端 1:后端
cd garment-server && node server.js    # http://localhost:3001

# 终端 2:前端
cd garment-web && npm run dev          # http://localhost:5173
```

启动后浏览器打开 http://localhost:5173 即可。

### 一键脚本(Windows)

```bash
# 项目根目录
./start.bat          # 先后端再前端,两个窗口
./start-dev.bat      # 仅启动开发模式(后端 + 前端)
./setup.bat          # 首次安装依赖
```

### 默认登录

`AUTH_ENABLED=true` 时,启动后端会检查 `users` 表(启动日志会打印默认密码)。首次部署后请立即改密码。

---

## 数据库

默认使用 SQLite,文件 `garment-server/data.sqlite`(`.gitignore` 排除)。启动后端时自动执行 `db.js` 的 `init()` 初始化 schema。核心表:

- `styles` / `main_plan` — 款式主数据与主计划
- `schedule_master` / `schedule_daily` — 排程主记录与每日明细(三行模型)
- `actual_production` — 实际生产报工
- `warehouse_inbound` / `outbound` / `inventory` — 仓库四类
- `workshops` / `production_lines` / `sewing_workshop_tree` — 车间与产线
- `asn_list` / `dn_list` — 到货 / 发货通知单
- `work_modes` / `work_calendars` / `calendar_exceptions` — 排产基础数据
- `users` / `operation_logs` — 用户与审计日志
- `scheduling_strategies` — 排产策略

详细字段说明见 `CLAUDE.md`。

---

## 部署

生产部署走 `docs/DEPLOY.md`(Nginx + pm2 + SQLite + 自动备份)。

```bash
# 一键部署(服务器)
cd /opt/garment
./scripts/deploy.sh
```

部署后必跑 `docs/SMOKE-TEST.md` 冒烟清单。

日常运维场景见 `docs/runbook.md`(7 个最常见故障处理)。

---

## 开发

详见 `DEVELOPMENT.md`(分支策略、提交规范、调试技巧)。

单人开发项目,`master` 是唯一活跃分支,所有提交直接 push 到 master,不打 feature/* 分支。

---

## 状态(2026-06-21,v1.0.0)

- v1.0.0 已发布,云端部署待执行
- 排产基础链路(款式 → 主计划 → 缝制/二次/裁剪排程 → 报工 → 仓库)全部贯通
- 工作日历集成主计划倒推,缝制目视化甘特图自动排除已排款式
- 用户系统 + ETag 乐观锁 + 操作日志上线
- 仓库四类(面料/裁片/辅料/成品)入库/出库/库存 + ASN/DN 流程
- i18n 100% 覆盖(208/208 key)
- CI: `npm test` + i18n scan + db.js load 验证(3 jobs)

下一步进入 v2 开发(架构与重构方案见 `架构与重构方案.md`):

- 后端迁移 NestJS(模块化 + 装饰器)
- 前端拆分为多个子应用
- Docker 容器化部署

---

## 许可证

UNLICENSED — 私有项目,保留所有权利。详见 [LICENSE](./LICENSE)。
