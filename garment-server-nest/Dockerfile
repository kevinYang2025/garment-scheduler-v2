# Phase 10.1 — NestJS 后端 Dockerfile
# 多阶段构建:builder 装 devDeps 编译 TS,运行时只装 prod deps
#
# 镜像体积参考(§2.5):
#   - node:20-alpine + dist + prod deps ≈ 180MB
#   - 反例(直接 COPY . .):800MB+
#
# 与 garment-server/(Express) Dockerfile 关键差异:
#   - NestJS 用 nest build,产物在 /app/dist
#   - Express 直接 node server.js,无需编译
#   - Redis adapter 让 NestJS 端可以独立接受连接(无 Express 进程也能工作)

# ─── Stage 1: 构建(含 devDeps 用于编译 TS)──
FROM node:20-alpine AS builder

WORKDIR /app

# 先 copy package 单独装依赖,利用 Docker layer cache
# 后续修改源码不会触发依赖重装
COPY package*.json ./
COPY tsconfig*.json ./
RUN npm ci

# 复制源码并编译
COPY . .
RUN npm run build

# 修剪 devDeps,准备产物
RUN npm prune --production

# ─── Stage 2: 运行时(只装 prod deps)──
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3002 \
    REDIS_URL=redis://redis:6379 \
    DB_PATH=/app/data/data.sqlite

# B8-2 修复:runtime 阶段不重装 deps,直接从 builder 拷贝已 prune 的 node_modules
# builder 阶段 line 29 已 npm prune --production,prod-only 了
# 再 npm ci --omit=dev 是重复操作,增加镜像体积 + 构建时间
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# 数据目录(SQLite 文件 + sessions.db)
# 生产环境用 volume 挂载(见 docker-compose.yml)
RUN mkdir -p /app/data

EXPOSE 3002

# 健康检查:每 30s 探一次 /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3002/health || exit 1

CMD ["node", "dist/main.js"]