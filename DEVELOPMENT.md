# 开发规范 — garment-scheduler-v2

## 项目简介

制衣工厂生产排程系统 V2，包含：
- **garment-web** — Vue3前端（Vite）
- **garment-server** — Node.js后端（Express + SQLite）
- **garment-scheduler** — Java后端（Spring Boot，备用）

## 环境搭建

```bash
# 1. 克隆仓库
git clone https://github.com/kevinYang2025/garment-scheduler-v2.git
cd garment-scheduler-v2

# 2. 切到develop分支（日常开发用这个）
git checkout develop

# 3. 安装依赖
cd garment-server && npm install
cd ../garment-web && npm install

# 4. 启动
# 终端1：后端
cd garment-server && node server.js    # http://localhost:3001

# 终端2：前端
cd garment-web && npm run dev          # http://localhost:5173
```

## 分支规范

| 分支 | 用途 | 谁能push |
|------|------|----------|
| `master` | 稳定版，只通过PR合并 | 仅管理员 |
| `develop` | 日常开发集成 | 所有协作者 |
| `feature/xxx` | 新功能开发 | 开发者本人 |
| `fix/xxx` | Bug修复 | 开发者本人 |

### 分支命名示例

```
feature/sewing-inline-edit     # 缝制排程内联编辑
feature/warehouse-export       # 仓库导出功能
fix/timezone-date-bug          # 修复时区日期bug
```

## 开发流程

### 开始新功能

```bash
# 1. 确保develop是最新的
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/你要做的功能

# 3. 开发、测试

# 4. 提交
git add -A
git commit -m "feat: 简短描述做了什么"

# 5. 推送到远程
git push -u origin feature/你要做的功能

# 6. 去GitHub提Pull Request → 合并到develop
```

### 修复Bug

```bash
git checkout develop
git pull origin develop
git checkout -b fix/bug描述
# 修复...
git add -A
git commit -m "fix: 修复了什么"
git push -u origin fix/bug描述
# 提PR合并到develop
```

## 提交信息规范

格式：`类型: 简短描述`

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug修复 |
| `style` | 样式调整 |
| `refactor` | 重构（不改功能） |
| `docs` | 文档更新 |

示例：
```
feat: 缝制排程支持内联编辑
fix: 修复日期时区偏移一天的问题
style: 优化表格hover效果
```

## 文件分工（避免冲突）

| 负责人 | 主要文件 |
|--------|----------|
| kevinYang2025 | `garment-web/src/views/*.vue`、`garment-web/src/App.vue` |
| Kyle-lmy | `garment-server/server.js`、`garment-server/db.js` |

> 如果需要改对方的文件，先沟通，或者在自己的分支上改完合develop时再处理冲突。

## 常用命令速查

```bash
# 拉取最新代码
git pull origin develop

# 查看当前分支
git branch

# 切换分支
git checkout develop

# 查看提交历史
git log --oneline -10

# 放弃本地修改
git checkout -- 文件路径

# 查看谁改了什么
git blame 文件路径
```

## 注意事项

1. **不要直接push到master** — 必须通过PR
2. **改代码前先pull** — 避免冲突
3. **小步提交** — 别攒一堆改动一次提交
4. **提交前检查** — 确保能编译通过（`npm run build`）
5. **敏感信息不要提交** — `.env`文件已在`.gitignore`中排除
