# DEPRECATED: garment-server (Express)

**状态**:DEPRECATED(自 2026-06-23 起)
**替代方案**:`garment-server-nest/` (NestJS + TypeORM + SQLite WAL + Redis Session)
**FROZEN 时间**:预计 2026-07-23(+30 天,只修 P0 bug,禁新增)
**REMOVED 时间**:v3.0.0(预计 2026-09,物理删除目录)

---

## 为什么下架

1. **维护成本**:Express + 自定义 SqliteStore session + 自定义 db.js 都是单文件 1500+ 行,新人接手成本高
2. **类型安全**:Express 无 TypeORM,字段拼写错误运行时才发现
3. **架构统一**:NestJS 模块化、TypeORM 实体、class-validator DTO、Guard、Filter 都比 Express 手写更可维护
4. **测试覆盖**:NestJS 70+ 单元测试,Express 38 个,且 NestJS §3.2 并发压测已 100% 通过
5. **SOP 文档**:架构与重构方案 §3 完整规划了 11 个 Phase,Phase 1-11 全部完成

---

## 当前状态(Phase 11 完成时)

迁移进度:**9/11 模块走 NestJS**(仅 `asn`/`dn` 暂未迁)
- ✅ Phase 1:基础设施(SQLite WAL + Redis Session + Socket.IO Adapter)
- ✅ Phase 2:common 模块(utils/auth/filter/interceptor/pipe/logger)
- ✅ Phase 3:system/auth 模块
- ✅ Phase 4:base/style 模块
- ✅ Phase 5:plan 模块(§3.2 5 并发压测通过)
- ✅ Phase 6:report 模块(§3.2 10 并发压测通过)
- ✅ Phase 7:warehouse 模块(Phase 11 解冻 Scope Freeze)
- ✅ Phase 8:Socket.IO Gateway(sectionUpdate + userList)
- ✅ Phase 9:前端动态路由 + API 模块拆分
- ✅ Phase 10:Docker 多阶段构建
- ✅ Phase 11:Nginx 分流 + Express socket.io 接 Redis Adapter
- ⏳ asn / dn(Phase 11 范围外,后续单独排期)

---

## 回退方案

如新系统出生产事故:
1. 立即 `git revert` 到当前 commit 的前一个
2. Nginx proxy 切回 3001(legacy)
3. 旧 Express 端口仍跑,业务零中断
4. 修复后重新部署

回退命令:
```bash
# 临时切回 Express
# 编辑 nginx.conf 把 /api/* 改 proxy_pass http://garment-legacy
# 或 vite.config.js 改所有 /api/* 走 3001

docker compose restart frontend
```

---

## FROZEN 阶段规则(2026-07-23 ~ 2026-09)

- ✅ 修复 P0 bug(导致生产事故的)
- ⚠️ 修 P1 bug 需架构组审批,走 `fix/xxx` 分支单独 PR
- ❌ 不修 P2/P3 bug(全部推到 v3)
- ❌ 不新增功能
- ❌ 不升级依赖(只安全补丁)

---

## REMOVED 阶段(v3.0.0,~ 2026-09)

物理删除:
- `garment-server/` 整个目录
- `garment-server-nest/src/modules/system/migration/`(migration-status 不再需要,全 nest)
- 前端 `backend-routing.js` 静态表(全 nest 时直接 hardcode 3002)
- Nginx `nginx.conf` 反代(全 nest 时只留 backend)
- Docker `docker-compose.yml` 的 legacy service

触发条件(全满足):
- NestJS 连续稳定运行 ≥ 90 天(从 2026-06-23 起)
- 所有 P0/P1 bug 修复完毕
- 70+ 单元测试 + 208 条 i18n 全部在 NestJS 跑通
- asn / dn 模块也迁完(或决定 drop)