# 修复审查 Checklist — Mavis 验证用

> 来源:`code-review-2026-06-16-v2.md`
> 状态:用户主攻手修,Mavis 做独立验证
> 决策:**Java 后端 garment-scheduler 退役** + **仓库功能 freeze** → 大量项目 WONTFIX

---

## 本次实际修复范围(4 项,3 个文件)

| # | 问题 | 文件 | 验证方法 |
|---|------|------|---------|
| **X-01** | `autoSchedule` 方法被覆盖 | `garment-web/src/api/index.js` | grep `autoSchedule` 全文,确认只有 1 个定义;调用走 `/main-plan/auto-schedule` |
| **X-02** | Dashboard 字段名不匹配 | `garment-web/src/views/Dashboard.vue:326-331` | 改回 `style_no` / `plan_qty` / `due_date`;启前后端,登录后看 Dashboard 三列有数据 |
| **NS-03** | `auto-schedule` 缺事务 | `garment-server/server.js:1028` | grep `db.transaction()` 包裹 DELETE + INSERT;并发触发 2 个请求,验证只产生一组完整数据 |
| **NS-04** | 错误信息泄露(非仓库部分) | `garment-server/server.js:266/1126/1270/1324` | 生产模式不返回 `e.message`;只 log 到服务端。**第 2015 行仓库入库跳过** |

---

## WONTFIX 列表(本次不修)

### Java 后端退役 → JS-* 全部 WONTFIX
- JS-01 仓库并发、JS-02 syncToDailyActual 事务、JS-03 入参校验、JS-04 主计划校验、JS-05 甘特图、JS-06 H2 控制台
- 详细:见 `garment-scheduler/DEPRECATED.md`

### 仓库功能 freeze → 仓库相关 WONTFIX
- NS-01 入库并发、NS-02 库存更新、NG-13 DN 库存检查、FG-* 仓库视图相关(7/8/9)
- 原因:项目 owner 本次没时间做仓库,工厂在用,不破坏现状

### 低优先级 / 范围外
- NG-01~NG-12(除 NG-13)中非仓库部分:P2 级别,不在本次 scope
- FG-01/02/03/04/05/06(非仓库):P2 级别,自行决定
- JG-* (Java):退役相关,见上

---

## 我的验证流程(收到完工通知后)

1. 拉 `git diff develop..feature/fix-branch` 看改动范围
2. **不**相信"已修复"自述,只信代码
3. 每个 P0 项,跑对应的最小复现 / 并发测试
4. 跑 `npm run build`(前端) + `node -c server.js`(后端语法检查)
5. 输出 PASS/FAIL 报告 + 还能继续优化的点

---

## Token 预算控制

- Mavis 不主动开 worker session,只在主 session 验证
- 每个 P0 验证估计 2-4k token
- 全部 4 项验证完大约 8-12k token
- 真不够就停,告诉用户哪些验了、哪些没验
