import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import type { Request } from 'express';
import { OnlineUsersService } from './online-users.service';

/**
 * Phase 8 — AppGateway(完整接入)
 *
 * Phase 1 装了 @socket.io/redis-adapter + Redis 共享,客户端连接已通。
 * Phase 8 接入业务事件:
 *   - sectionUpdate { section, data }  ← Express broadcastSection 用的统一事件
 *   - userList                       ← Express 用户在线列表
 *
 * 路由兼容:
 *   - 与 Express /api/auth/login 鉴权一致(session 共享)
 *   - 连接时从 socket.handshake.session 取 user
 *
 * 跨进程广播(§8 R5 / §3 验收):
 *   - A 连 3001(Express),B 连 3002(NestJS)
 *   - 任何一方 emit('sectionUpdate', ...)
 *   - 另一方 socket.io-client 通过 Redis pub/sub 自动收到
 */

/**
 * §2.2 P2-3:section 名白名单(防 req.params 污染)
 * 与 garment-server/server.js ALLOWED_BROADCAST_SECTIONS 完全一致
 */
const ALLOWED_SECTIONS = new Set([
  'styles', 'productionLines', 'mainPlan', 'actual', 'warehouse', 'capacityConfig',
  'systemConfig', 'dailyReports', 'inventory', 'schedule_cutting', 'schedule_sewing',
  'schedule_printing', 'schedule_embroidery', 'schedule_ironing', 'schedule_template',
  'schedule_secondary', 'asn', 'dn', 'users',
]);

@WebSocketGateway({
  // Fix #E(2026-06-23):cors.origin '*' 配合 credentials 让任何站点可连接 + 发请求
  // 现在从环境变量读白名单,默认只允许同源 + localhost
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // 同源 / SSR / curl
      // B6-1 修复:与 main.ts CORS 默认值统一(否则运维只设一处就漏放)
const allowed = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001')
        .split(',')
        .map((s) => s.trim());
      if (allowed.includes(origin)) return cb(null, true);
      cb(new Error(`Socket.IO CORS blocked: ${origin}`), false);
    },
    credentials: true,
  },
})
export class AppGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('AppGateway');

  constructor(private readonly onlineUsers: OnlineUsersService) {}

  /**
   * Phase 8:服务启动后立即广播当前用户列表
   * (初始化时可能没有连接,但保留 hook 以便 Phase 9 接入用户系统)
   */
  afterInit(server: Server) {
    this.logger.log('AppGateway initialized');
    // 把 server 暴露给 OnlineUsersService(避免循环依赖,延迟注入)
    this.server = server;
  }

  handleConnection(client: Socket) {
    const total = this.server?.sockets?.sockets?.size ?? '?';
    this.logger.log(`client connected: ${client.id} (total sockets=${total})`);

    // §8 R5:从 session 拿 user(Phase 1 Redis session 共享已生效)
    const req = client.request as Request & { session?: { user?: any } };
    const user = req?.session?.user ?? null;

    if (user) {
      this.onlineUsers.trackConnect(client, user);
      // 触发 userList 广播(Express 行为一致)
      this.onlineUsers.broadcastUserList(this.server);
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client disconnected: ${client.id}`);
    this.onlineUsers.trackDisconnect(client);
    // 断开也广播 userList(保持列表新鲜)
    this.onlineUsers.broadcastUserList(this.server);
  }

  /**
   * 业务端调用的广播 helper
   * Express broadcastSection(section, data) 的 NestJS 等价物
   *
   * 用法(在任何 service / controller 中):
   *   constructor(@WebSocketServer() private server: Server) {}
   *   this.server = server;
   *   broadcastSection(this.server, 'styles', styles);
   */
  broadcastSection(section: string, data: unknown): { emitted: boolean; reason?: string } {
    if (!this.server) return { emitted: false, reason: 'server 未初始化' };
    if (!ALLOWED_SECTIONS.has(section)) {
      this.logger.error(`拒绝未知 section: ${section}`);
      return { emitted: false, reason: `未知 section: ${section}` };
    }
    this.server.emit('sectionUpdate', { section, data });
    this.logger.debug(`broadcast sectionUpdate ${section}`);
    return { emitted: true };
  }

  /**
   * 用户列表广播(直接对外暴露,Phase 9 业务用)
   */
  broadcastUserList(): { emitted: boolean; count: number } {
    if (!this.server) return { emitted: false, count: 0 };
    const list = this.onlineUsers.list();
    this.server.emit('userList', list);
    return { emitted: true, count: list.length };
  }
}