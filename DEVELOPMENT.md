# 开发规范 — garment-scheduler-v2 v1.0.0

## 项目结构(分工边界)

| 目录 | 职责 | 主要技术 |
|---|---|---|
| `garment-server/server.js` | Express 路由 + Socket.IO 推送 | Node.js + Express |
| `garment-server/db.js` | better-sqlite3 + schema + migration | SQLite WAL |
| `garment-web/src/views/*.vue` | 业务页面(40+ 视图) | Vue 3 + Element Plus |
| `garment-web/src/api/index.js` | axios 封装 + 全部 API 方法 | Axios |
| `garment-web/src/composables/` | 组合式函数 | Vue 3 |
| `scripts/` | 部署 / 运维 / 扫描脚本 | Shell + Node |
| `docs/` | 文档 | Markdown |

修改文件前先确认属于哪个目录,避免跨域改动。

---

## 本地开发

### 准备

```bash
# 依赖
cd garment-server && npm install
cd ../garment-web && npm install

# 后端启动
cd garment-server && node server.js          # 监听 :3001

# 前端启动(另一个终端)
cd garment-web && npm run dev                # 监听 :5173,代理 /api → :3001
```

### Windows 快捷脚本(项目根)

```bash
./setup.bat            # 首次安装依赖
./start.bat            # 先后端再前端
./start-dev.bat        # 仅开发模式
./start-frontend.bat   # 仅前端
```

### 调试技巧

- **后端日志**: `garment-server/backend-err.log` / `backend-out.log`(生产 pm2 同目录)
- **前端 devtools**: Vue DevTools + Element Plus 组件审查
- **数据库**: `sqlite3 garment-server/data.sqlite` 直接查表
- **Socket.IO**: 浏览器 devtools Network → WS → 看推送事件
- **API 测试**: `curl -b cookies.txt -c cookies.txt http://localhost:3001/api/auth/login -d '...'`(session cookie 鉴权)

---

## 分支策略

`master` 是发布分支,云端部署前 push 到这里。新改动通过 worktree 临时分支做,改完后合回 master 再清理。

历史分支(`develop` / `feature/*` / `claude/*`)在 v1.0.0 收尾时已全部清理,长期不再保留。

### 日常流程(直接在工作目录)

小改动(v1.0.0 收尾类、文档修订、bug 单点修复)直接在 master 改完 push:

```bash
git pull origin master
# 改文件
git add <具体文件>     # 别用 -A
git commit -m "fix: xxx"
git push origin master
```

### 大改动(走 worktree)

涉及多文件、可能要分多次 commit、或者并行多个 agent 改不同模块时,开 worktree 隔离:

```bash
# 1. 拉新 worktree(在项目根目录)
git worktree add ../garment-scheduler-v2-<任务名> -b <任务分支名> master

# 2. 在 worktree 里改 + commit
cd ../garment-scheduler-v2-<任务名>
# 改文件
git add <具体文件>
git commit -m "feat: xxx"

# 3. 拉回 master(快进合并)
cd ../../garment-scheduler-v2    # 回主项目
git merge --ff-only <任务分支名>  # 任务分支已包含 master 所有 commit 时才能 ff

# 4. push + 清理
git push origin master
git worktree remove ../garment-scheduler-v2-<任务名>
git branch -d <任务分支名>        # 本地
git push origin --delete <任务分支名>  # 远程(如曾 push 过)
```

分支命名:<任务描述>-<短哈希> 之类(Claude Code 自动生成的 `claude/<worktree-id>` 也行,清理时一并删)。

如果将来恢复多人协作,再切回 `develop + feature/* + PR` 模式。

---

## 提交信息规范

格式:**`type(scope): 简短描述`**(可加段号 + 优先级前缀)

### type

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 重构(不改功能) |
| `style` | 样式 / UI 调整 |
| `docs` | 文档更新 |
| `chore` | 杂项(清理 / 依赖 / 配置) |
| `perf` | 性能优化 |
| `test` | 测试 |

### scope(可选)

| scope | 说明 |
|---|---|
| `server` | 后端 server.js / db.js |
| `web` | 前端 .vue / .js |
| `api` | api/index.js |
| `i18n` | 国际化文案 |
| `db` | 数据库 schema / 迁移 |
| `ops` | 部署 / 运维脚本 |
| `docs` | docs/ 目录 |

### 前缀约定

内部使用段号追踪问题修复链,提交时可加可不加:

- `fix(段73 业务-P1-#): xxx` — 段号 73 + 业务 P1 优先级
- `feat(段50 web-P2-#): xxx` — 段号 50 + 前端 P2 优先级
- `chore: 清理段72 临时调试文件` — 清理

段号是私有序号,只在团队内部使用,不需要追溯或对齐到外部 issue。

### 示例

```bash
fix(段74 业务-P1-#): MainPlan autoCalcDates 改用工作日历
feat(段50 web-P2-#): 仓库 sidebar 跳转
chore: 移除 3 个临时审计报告
docs: 架构与重构方案 v1
```

### 提交粒度

- **小步提交**:每个 commit 单一目的,别攒一堆改动
- **可回滚**:任何 commit 单独 revert 都不破坏构建
- **带 Co-Authored-By**:`Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

---

## 代码规范

### 后端(Node.js)

- **日期处理**:统一用 `db.js` 的 `fmtLocal()`(UTC+8),禁止 `toISOString().slice(0,10)`
- **SQL 注入**:全部用 prepared statement(`db.prepare().get/all/run()`)
- **错误处理**:路由 try-catch,错误日志带 endpoint + 参数
- **鉴权**:所有 `/api/*` 走 `requireAuth`(白名单: `/api/auth/*` / `/api/health`)
- **ETag 乐观锁**:更新走 `api.etagPut`(前端) / 后端 `If-Match` 头(后端)
- **日志**:用 `logOp(req, module, action, ...)` 记操作日志,带 user_id
- **事务**:多表写操作用 `db.transaction(() => {...})`

### 前端(Vue 3)

- **API 调用**:走 `api/index.js` 封装,禁止直接 `axios.get(...)`
- **状态**:本地用 `ref` / `computed` / `reactive`,跨页面用 Pinia store 或 URL params
- **路由**:named route,带 type/schedule_type 时用 `params` 显式传
- **i18n**:所有用户可见文案走 `$t('key')`,禁止硬编码中文/英文字符串
- **组件**:Element Plus 优先,自定义组件放 `src/composables/` 或 `src/components/`
- **样式**:Tailwind 4 utility + Element Plus 主题变量,不要 inline `style="..."`
- **错误提示**:`ElMessage.error(...)` 统一处理,别用 `alert()`
- **下载文件**:统一用 `api.downloadFile(url, params)`,别自己写 blob+a.click

### 数据库

- **schema 变更**:在 `db.js` 顶部加 `migrate()` 函数,幂等
- **索引**:大表(>10000 行)查询字段加索引
- **外键**:开启 `PRAGMA foreign_keys = ON`
- **WAL**:`PRAGMA journal_mode = WAL` 已开,不要改

---

## 测试与验证

### 上线前必跑

1. `npm run build`(前端) — 检查能否构建
2. `node server.js` 启动后端,检查 `backend-err.log` 无错误
3. `docs/SMOKE-TEST.md` 冒烟清单全部通过

### CI

`.github/workflows/` 三个 job:

- `npm test` — 后端单测
- `i18n scan` — `scripts/scan-i18n.js`,要求 100% 覆盖
- `db.js load` — 验证 db.js 能加载无语法错误

任何 commit push 前本地跑过一遍。

### i18n 扫描

```bash
node scripts/scan-i18n.js
```

新加文案必须加中英双语 key,扫描器会报漏掉的中文/英文字符串。

---

## 调试常见问题

| 症状 | 排查 |
|---|---|
| 前端 404 / API 404 | 检查 vite proxy `server.proxy` + 后端是否在 :3001 |
| `/api/*` 401 | session cookie 没带,axios `withCredentials: true` 是否保留 |
| `/api/*` 412 | ETag 冲突,前端 `api.etagPut` 应自动重试,若仍冲突需刷新 |
| 日期偏一天 | UTC 时区,后端用 `fmtLocal()`,前端别用 `toISOString().slice(0,10)` |
| 主计划倒推没扣休息日 | `work_calendars` 是否启用 + `calendar_exceptions` 是否有覆盖 |
| 仓库数据加载失败 | sidebar 跳仓库要带 `params: { type: 'cutting_piece' }`,`WarehouseDetail` 有 effectiveType 兜底 |
| Socket.IO 断连 | Nginx `proxy_set_header Upgrade $http_upgrade;` 漏配 |

---

## 文件分工(协作者)

| 负责人 | 主要文件 |
|--------|----------|
| kevinYang2025 (owner) | `garment-web/src/views/*.vue`、`garment-web/src/App.vue` |
| Kyle-lmy | `garment-server/server.js`、`garment-server/db.js` |

如果需要改对方的文件,先沟通,或者在自己的分支上改完合 master 时再处理冲突。

---

## 注意事项

1. **不要直接 `git add .` / `git add -A`** — 会误把 `.env` / `*.sqlite` / `.scratch/` / 临时调试文件 commit 进去。用 `git status` 先看。
2. **改 schema 要写迁移** — 别直接 `DROP TABLE` / `ALTER TABLE`,幂等迁移
3. **生产数据库先备份** — `scripts/backup.sh` 跑一遍再改
4. **敏感信息不提交** — `.env` / `cookies.txt` 已在 `.gitignore`
5. **审计报告 / 重构方案不进 master** — 放 `.scratch/` 或 `docs/`,别 commit 根目录 md

---

## 项目状态(2026-06-21)

- v1.0.0 已发布,云端部署待执行
- 下一步:进入 v2 开发(架构与重构方案见 `架构与重构方案.md`)
- 单人开发,master 唯一分支
