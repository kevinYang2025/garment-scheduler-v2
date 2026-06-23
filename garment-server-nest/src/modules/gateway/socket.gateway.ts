import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../config/redis.config';
import { Inject } from '@nestjs/common';

/**
 * Phase 1.6 — Socket.IO Gateway(空壳)
 *
 * Phase 1 目标:只验证跨进程广播(R5)
 *   - A 连 3001(Express),B 连 3002(NestJS)
 *   - B 触发 broadcast('test:pong')
 *   - A 必须收到(通过 Redis pub/sub adapter)
 *
 * Phase 2 起注入业务事件:
 *   - dispatch:saved → 报工变更
 *   - schedule:updated → 排程变更
 *   - production-line:updated → ETag 冲突
 *   - user:online / user:offline
 *
 * 鉴权沿用 garment-server/utils/socket-auth.js 的 timingSafeEqual(Phase 8 集成)
 */
@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  // 强制走同一 namespace '/',与 Express 一致
  namespace: '/',
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('AppGateway');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  handleConnection(client: Socket) {
    // 防御性:handleConnection 可能在 server 完全初始化前调用
    const total = this.server?.sockets?.sockets?.size ?? '?';
    this.logger.log(`client connected: ${client.id} (total: ${total})`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`client disconnected: ${client.id}`);
  }

  /**
   * 测试用广播:Phase 1 e2e 用
   * 前端 / curl 调 POST /health/broadcast-pong,这里 emit test:pong
   */
  emitTestPong(payload: Record<string, unknown>) {
    this.server.emit('test:pong', payload);
    return { emitted: true, payload };
  }
}