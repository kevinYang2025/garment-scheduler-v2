import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';

/**
 * Phase 1.6 — Socket.IO Gateway(空壳)
 *
 * Phase 1 目标:验证跨进程广播(R5)— 实际跨进程广播验证需 Phase 8
 * 完整接入(Express 也要接 @socket.io/redis-adapter)。
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
})
export class AppGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger('AppGateway');

  constructor() {}

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