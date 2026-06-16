# DEPRECATED — Java Spring Boot 后端(garment-scheduler)

> 退役日期:2026-06-16
> 决策人:Kevin (项目 owner)
> 建议:由 Mavis 提出,经项目 owner 确认

## 状态

**本目录已退役,不再维护。**

最终运行版本是 `../garment-server/`(Node.js + Express + better-sqlite3 + Socket.IO)。
本 Java Spring Boot 后端的所有功能已由 Node.js 版本覆盖。

## 退役原因

1. **业务规模不匹配**:50 条缝制产线 + 5 车间 + 3 名计划员的场景,Spring Boot + H2 过度设计
2. **Node.js 版已稳定**:生产在跑,2,054 行 server.js + 873 行 db.js,功能完整
3. **修复成本高**:全 API 无认证、H2 控制台暴露、并发超卖、事务缺失等问题修复工作量等同于重写
4. **重写无业务收益**:Node.js 版已能完成所有现有业务,无功能缺失

## 本目录处置建议

| 操作 | 建议 |
|------|------|
| 删除 | **不删** —— 留作参考实现,可能有教学/历史价值 |
| 重构 | **不做** —— 不投入维护成本 |
| 重启维护 | 如未来业务量大幅增长需要再评估,届时基于本目录代码 + Node.js 业务理解重新设计 |

## 注意事项

- 不要向本目录提交新代码
- 启动服务只跑 `cd ../garment-server && node server.js`
- 本目录的 H2 数据库、MyBatis-Plus 配置等不再使用
- 任何引用本目录 API 的前端代码,都应改为调用 Node.js 后端(`http://localhost:3001`)

## 关联文档

- 项目主文档:`../CLAUDE.md` 的 "Scope Freeze" 章节
- 代码审查报告:`../code-review-2026-06-16-v2.md` 中所有 JS-* 编号 = WONTFIX
