# 代码审查报告 — garment-scheduler-v2

## 审查摘要

**审查日期**: 2026-06-15  
**审查范围**: 全项目代码（前端 + 后端 + 配置）  
**发现问题**: 23 个 (P0: 4, P1: 8, P2: 11)

---

## P0 问题 (必须修复 — 安全漏洞)

### 1. 认证默认关闭
- **文件**: `garment-server/server.js:9-10`
- **问题**: `AUTH_ENABLED` 默认为 `false`，`API_TOKEN` 使用硬编码默认值 `garment-dev-token`
- **影响**: 生产环境无认证保护，任何人可访问所有 API
- **修复**: 
  ```bash
  # 环境变量设置
  AUTH_ENABLED=true
  API_TOKEN=<生成强随机值>
  ```

### 2. SQL 拼接风险
- **文件**: `garment-server/db.js:868-872`
- **问题**: `ORDER BY ${orderBy}` 直接拼接来自 JSON config 的 `sortField`
- **影响**: 虽然目前有白名单映射，但属于间接字符串拼接，存在注入风险
- **修复**: 使用参数化查询或硬编码白名单映射

### 3. 库存更新字段不匹配
- **文件**: `garment-server/server.js:1709`
- **问题**: 查询条件使用 4 字段 `warehouse_type + style_no + color + size_spec`，但 UNIQUE 索引是 5 字段（包含 `pot_no`）
- **影响**: 可能匹配到错误的库存记录，导致数据不一致
- **修复**: 查询条件加上 `pot_no`

### 4. CORS 默认允许所有源
- **文件**: `garment-server/server.js:39`
- **问题**: `CORS_ORIGINS` 默认为 `*`
- **影响**: 任何域名都可跨域访问 API
- **修复**: 生产环境限制为特定域名

---

## P1 问题 (重要 — 架构和性能)

### 5. 巨型单文件 server.js
- **文件**: `garment-server/server.js` (2353 行)
- **问题**: 所有路由、业务逻辑、工具函数都在一个文件
- **影响**: 难以维护、测试、协作
- **修复**: 按业务域拆分为路由模块（styles.js, warehouse.js 等）

### 6. 无代码质量工具
- **文件**: 项目根目录
- **问题**: 无 ESLint、Prettier、TypeScript、测试框架
- **影响**: 代码质量完全依赖人工审查
- **修复**: 引入 ESLint + Prettier + Vitest

### 7. 无速率限制
- **文件**: `garment-server/server.js`
- **问题**: 无 `express-rate-limit` 中间件
- **影响**: 易受 DDoS 攻击、暴力破解
- **修复**: 添加速率限制中间件

### 8. 无 helmet 中间件
- **文件**: `garment-server/server.js`
- **问题**: 缺少安全头（X-Content-Type-Options, X-Frame-Options 等）
- **影响**: 易受点击劫持、MIME 嗅探攻击
- **修复**: 添加 `helmet` 中间件

### 9. 错误信息泄露
- **文件**: `garment-server/server.js:1340`
- **问题**: `res.status(400).json({ error: e.message })` 暴露内部错误
- **影响**: 可能泄露数据库结构、文件路径等敏感信息
- **修复**: 返回通用错误消息

### 10. 庞大前端视图文件
- **文件**: `garment-web/src/views/SewingPlanDetail.vue` (826行)
- **问题**: 6 个视图文件超过 600 行，混合多种职责
- **影响**: 难以维护、测试、复用
- **修复**: 拆分为子组件和 composables

### 11. 手动模块切换
- **文件**: `garment-web/src/App.vue`
- **问题**: 无 vue-router，使用 v-if 条件渲染
- **影响**: 不支持浏览器历史、URL 分享、深层链接
- **修复**: 迁移到 vue-router

### 12. 无分页支持
- **文件**: `garment-server/server.js` 多个 GET 路由
- **问题**: 大部分列表 API 返回全表数据
- **影响**: 数据量大时性能差、内存占用高
- **修复**: 添加 LIMIT/OFFSET 分页参数

---

## P2 问题 (改进 — 代码质量)

### 13. toISOString 违规
- **文件**: `garment-web/src/views/ShippingPlan.vue:62`
- **问题**: 使用 `new Date().toISOString().slice(0, 10)` 获取日期
- **影响**: UTC+8 时区会偏移一天
- **修复**: 使用 `fmtLocal()` 函数

### 14. fmtLocal 函数重复定义
- **文件**: `server.js:12` 和 `db.js:8`
- **问题**: 相同函数在两个文件中各定义一次
- **影响**: 修改一处忘改另一处会产生不一致
- **修复**: 只在 db.js 定义，server.js 引用

### 15. 空 catch 块
- **文件**: 9 处（WorkCalendar, ShippingPlan, DeliveryEstimation, DNWorkflow, ASNWorkflow）
- **问题**: `catch {}` 完全吞没错误
- **影响**: 难以调试、错误被静默忽略
- **修复**: 至少添加 console.error 或用户提示

### 16. hasPermission 占位函数
- **文件**: 5 个视图文件
- **问题**: `hasPermission()` 全部返回 `true`
- **影响**: 权限系统完全未实现
- **修复**: 实现真正的权限检查或移除占位代码

### 17. 大量重复代码模式
- **涉及文件**: 多个视图文件
- **问题**: `computeFilterOptions()`、批量选择删除、表头滚动同步等模式重复
- **影响**: 代码冗余、维护成本高
- **修复**: 抽取为公共 composables 和组件

### 18. API 层缺乏错误处理
- **文件**: `garment-web/src/api/index.js`
- **问题**: 无 axios 拦截器，每个视图各自 try/catch
- **影响**: 错误处理不一致
- **修复**: 添加统一的错误拦截器

### 19. Tailwind CSS 引入但未使用
- **文件**: `garment-web/src/style.css`
- **问题**: 仅 `@import "tailwindcss"`，实际未使用
- **影响**: 增加 bundle 大小
- **修复**: 移除或实际使用

### 20. Element Plus 图标全量注册
- **文件**: `garment-web/src/main.js`
- **问题**: 循环注册全部图标组件，增加约 200KB+
- **影响**: bundle 大小膨胀
- **修复**: 按需导入

### 21. 迁移机制无限增长
- **文件**: `garment-server/db.js:500-597`
- **问题**: 每次加字段都在 migrateStyles() 里追加 ALTER TABLE
- **影响**: 长期维护困难
- **修复**: 引入版本号 + 迁移文件

### 22. 无测试覆盖
- **文件**: 项目根目录
- **问题**: 无任何单元测试、集成测试、E2E 测试
- **影响**: 代码变更容易引入回归 bug
- **修复**: 添加 Vitest 单元测试

### 23. 缺少项目文档
- **文件**: 项目根目录
- **问题**: 无 README.md、API 文档、部署文档
- **影响**: 新开发者难以入门
- **修复**: 补充文档

---

## 修复优先级建议

### 阶段一：安全加固 (P0) — 立即执行
1. 修复认证配置（AUTH_ENABLED、API_TOKEN）
2. 修复 updateInventory pot_no 问题
3. 限制 CORS 源
4. 修复 SQL 拼接风险

### 阶段二：架构优化 (P1) — 本周内
1. 添加 helmet 和速率限制
2. 引入 ESLint + Prettier
3. 拆分 server.js 为路由模块
4. 添加分页支持

### 阶段三：质量提升 (P2) — 下周
1. 修复 toISOString 违规
2. 抽取公共函数和组件
3. 添加单元测试框架
4. 补充项目文档

---

## 验证方式

1. **安全测试**: 使用 curl 测试未认证访问
2. **功能测试**: 验证关键业务流程（入库、出库、排程）
3. **性能测试**: 测试大文件导入（1000+ 行）
4. **代码扫描**: 运行 ESLint 检查代码规范
5. **依赖审计**: 运行 `npm audit` 检查漏洞

---

## 附录：关键文件索引

| 文件 | 路径 | 检查重点 |
|------|------|----------|
| server.js | garment-server/server.js | 认证、CORS、错误处理 |
| db.js | garment-server/db.js | SQL 拼接、迁移机制 |
| App.vue | garment-web/src/App.vue | 路由、状态管理 |
| ShippingPlan.vue | garment-web/src/views/ShippingPlan.vue | toISOString 违规 |
| SewingPlanDetail.vue | garment-web/src/views/SewingPlanDetail.vue | 最大视图文件 |
| api/index.js | garment-web/src/api/index.js | API 层、错误处理 |
