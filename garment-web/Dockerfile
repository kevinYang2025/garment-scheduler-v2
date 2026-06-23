# Phase 10.2 — 前端 Dockerfile
# 多阶段构建:builder 编译 vite,运行时 nginx 提供 dist 静态服务
#
# 镜像体积参考(§2.5):
#   - nginx:1.27-alpine + dist ≈ 50MB(无 node_modules)
#   - 反例(直接 COPY . .):600MB+
#
# 关键约束:
#   - 严禁 COPY --from=builder /app/node_modules(会污染镜像)
#   - nginx SPA fallback:所有未匹配路由返回 index.html
#   - 反代 /api /socket.io 到 backend(由 nginx.conf 处理)

# ─── Stage 1: 构建 Vite ───
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─── Stage 2: nginx 提供 dist 静态服务 ───
FROM nginx:1.27-alpine

# nginx 配置:反代 /api /socket.io 到 NestJS,SPA fallback
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 只拷贝 dist(纯静态产物,严禁拷贝 node_modules)
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx 容器默认 80 端口
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]