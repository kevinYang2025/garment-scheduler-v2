# garment-server-nest

制衣工厂生产排程系统 — NestJS 后端(重构中)。

> ⚠️ **重构进行中**(2026-06 起)。与 `garment-server/` (Express) 双轨并行,共享 `data.sqlite` + Redis session。
> 详见仓库根 `架构与重构方案.md` v1.2。

## 当前状态:Phase 1 — 基础设施

- ✅ NestJS 10 + TypeORM + SQLite WAL
- ✅ Redis (ioredis + connect-redis)
- ✅ Socket.IO + @socket.io/redis-adapter
- ✅ /health、/health/db、/health/redis 端点
- ⏳ 跨进程 e2e 验证(等 Node 20 LTS 装好后跑)

## 端口

- **3002** NestJS(本项目)
- **3001** Express 旧后端(`../garment-server/`,迁移期保留)

## 启动

### 前置

```bash
# 1. 起 Redis(共享 Session + Socket.IO)
docker compose up -d redis

# 2. 复制环境变量
cp .env.example .env
# 编辑 .env,确认 DB_PATH 和 SESSION_SECRET 与 garment-server 一致

# 3. 装依赖(需 Node 20 LTS)
npm install
```

### 开发

```bash
# 起 NestJS(3002)
npm run start:dev

# 起 Express 旧后端(另开终端,3001)
cd ../garment-server && npm start
```

### 验证

```bash
# 单端点
curl http://localhost:3002/health
curl http://localhost:3002/health/db
curl http://localhost:3002/health/redis

# 跨进程 e2e(同 session 跨 3001/3002)
npm run test:phase1
```

## 目录结构

```
src/
├── common/              # 公共能力(Phase 2 起填)
│   ├── auth/            # 鉴权守卫
│   ├── filter/          # 全局异常(含 http-exception.filter.ts 占位)
│   ├── interceptor/
│   ├── pipe/
│   ├── logger/          # operation-log 横切 service
│   └── utils/
├── config/              # 配置
│   ├── database.config.ts    # TypeORM + SQLite WAL(§3.3)
│   ├── redis.config.ts       # ioredis 单例
│   └── session.config.ts     # connect-redis(§8 R2)
├── entity/              # TypeORM Entity(Phase 2 起填)
├── modules/
│   ├── health/          # /health 端点
│   └── gateway/         # Socket.IO @WebSocketGateway(§8 R5)
├── app.module.ts
└── main.ts              # bootstrap + Redis Adapter + session
```

## 关键技术决策

| 决策 | 文档引用 | 备注 |
|------|----------|------|
| `synchronize: false` | §3.3 / §8.1 | 严禁 auto-sync,丢数据 |
| WAL + `busy_timeout=5000` | §3.3 / §8.1 | 双进程并发写不锁 |
| Redis Session 共享 | §8 R2 | 双轨并行基石 |
| Socket.IO Redis Adapter | §8 R5 | 跨进程广播 |
| 端口 3002 | §6.1 | 与 Express 3001 共存 |
| HttpExceptionFilter 占位 | §3.5 | Phase 2 接 i18n |

## 下一步

- Phase 2:common 模块(auth/filter/utils/logger/broadcast)
- Phase 3:system 模块(用户/角色/日志)
- ...
- 详见 `架构与重构方案.md` §3 总览