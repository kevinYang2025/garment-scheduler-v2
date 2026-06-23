# Phase 10.3 — Express 旧后端 Dockerfile
#
# Express 直接 node server.js,无需编译步骤
# 但仍然多阶段(避免 node_modules 进镜像)
#
# 镜像体积参考(§2.5):180MB(prod deps only)
# 反例(直接 COPY . .):800MB+

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    REDIS_URL=redis://redis:6379 \
    DB_PATH=/app/data/data.sqlite \
    AUTH_ENABLED=true

# 只装 prod deps
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 拷贝源码(Express 直接 node server.js,无需 dist)
COPY . .

# 数据目录
RUN mkdir -p /app/data

EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server.js"]