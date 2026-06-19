# 代码审查问题清单 — garment-scheduler-v2

> 审查日期：2026-06-19 | 覆盖文件：db.js、server.js、session-store.js、api/index.js、stores/auth.js、router/index.js、App.vue

## 严重问题（必须修）

| # | 文件 | 行号 | 问题 | 修复方向 |
|---|---|---|---|---|
| X-01 | server.js | 2811-2837 | **SQL注入**：`group_by` 参数直接拼入 GROUP BY，无白名单校验 | switch 前加 `if (!['date','style','workshop','line_team'].includes(group_by))` 拦截 |
| X-02 | server.js | 164-182 | **内存泄漏**：`loginAttempts` Map 的 key 只增不删，长时间运行后内存无限增长 | 加 `setInterval` 每 5 分钟清理过期 key，或每次请求时清理超时 key |
| X-03 | server.js | 3813-3838 | **库存更新条件不匹配**：`updateInventory` 查询缺 `pot_no`，但 UNIQUE 约束包含 `pot_no`，多锅号时更新错记录 | 查询条件加 `AND pot_no = ?`，传入 `extra?.pot_no || ''` |
| X-04 | db.js | 1107 | **引用不存在的列**：`autoSchedule` 读 `line_style_categories.daily_output`，但该表无此列 | 迁移加列 `ALTER TABLE line_style_categories ADD COLUMN daily_output INTEGER DEFAULT 0` |
| X-05 | db.js | 1236 | **错误信息泄露**：`autoSchedule` catch 块返回 `e.message`，暴露数据库结构 | 改为固定文案 `{ error: '自动排产失败，请检查数据' }` |
| X-06 | server.js | 1655 | **错误信息泄露**：`auto-schedule` 端点返回 `'Internal server error: ' + e.message` | 改为 `res.status(500).json({ error: '自动排产失败' })` |

## 一般问题（建议修）

| # | 文件 | 行号 | 问题 | 修复方向 |
|---|---|---|---|---|
| Y-01 | api/index.js | 164 & 202 | **重复定义**：`getSystemConfig`/`updateSystemConfig` 定义两次，后面的覆盖前面的 | 确认哪个路径正确，删重复；后端两个端点 `/config/system` 和 `/system-config` 功能相同，统一为一个 |
| Y-02 | server.js | 多处 | **写操作缺权限校验**：`POST/DELETE /api/styles`、`/api/main-plan`、`/api/fabric-loading`、`/api/strategies`、`PUT /api/system-config` 等端点任何已登录用户都能调，dispatcher 也能改款式/计划 | 给这些端点加 `requireRole('admin','planning_manager','planner')` |
| Y-03 | server.js | 3155-3167 | **出货计划缺日志**：`PUT/DELETE /api/shipping-plans/:id` 未调用 `logOp` | 加 `logOp(req, 'shipping', 'update', ...)` |
| Y-04 | db.js + server.js | 9 & 17 | **fmtLocal 重复定义**：两个文件各写了一遍 | db.js 导出 `fmtLocal`，server.js 直接用 `db.fmtLocal` |
| Y-05 | server.js | 156 | **session 清理只跑一次**：启动时清过期 session，之后不再清 | 加 `setInterval(() => sessionStore.cleanup(), 3600000)` 每小时清一次 |
| Y-06 | api/index.js | 12-14 | **401 跳转用 window.location**：全页面刷新丢失 Pinia 状态和 KeepAlive 缓存 | 改为 `router.push('/login')` |
| Y-07 | server.js | 2837 | **dispatch-summary 无分页**：硬编码 `LIMIT 500`，数据多时前端拿不全 | 支持 `limit`/`offset` 参数或改为真分页 |
| Y-08 | server.js | 2834 | **LIKE 通配符未转义**：`%${style_no}%` 中 `%` 和 `_` 是 LIKE 通配符 | 对 style_no 做 `replace(/[%_]/g, '\\$&')` 转义 |

## 待确认

| # | 文件 | 行号 | 疑点 |
|---|---|---|---|
| Z-01 | server.js | 1573 | `auto-schedule` 中查询 `sewing_workshop_tree` 表，但 `createTables()` 未定义该表，需确认是否有迁移创建或该查询会静默失败 |
| Z-02 | db.js | 65 | `styles` 表无 `style_no` 唯一索引，导入时无去重，需确认业务上是否需要防重复导入 |

---

共 **8 个严重 + 8 个一般 + 2 个待确认**。优先修 X-01 ~ X-06，都是安全或数据正确性问题。
