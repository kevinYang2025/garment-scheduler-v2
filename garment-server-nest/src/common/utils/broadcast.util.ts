import { Server } from 'socket.io';
import { Logger } from '@nestjs/common';

/**
 * Socket.IO 广播 helper
 *
 * Phase 2 起任何 NestJS service 可注入 server,然后调用 broadcastXxx
 *
 * 用法(在 controller/service 里):
 *   constructor(@WebSocketServer() private server: Server) {}
 *   this.server = server;
 *   broadcastDispatchSaved(this.server, dispatchRecord);
 *
 * Phase 8 接入 Express 端 socket.io 后,通过 Redis Adapter 同步广播
 * 当前 NestJS 进程内 broadcast 已通;跨进程依赖 @socket.io/redis-adapter(Phase 1 已装)
 */

const logger = new Logger('Broadcast');

/**
 * 报工变更通知
 * event: 'dispatch:saved'
 */
export function broadcastDispatchSaved(server: Server, payload: Record<string, unknown>) {
  safeEmit(server, 'dispatch:saved', payload);
}

/**
 * 排程变更通知
 * event: 'schedule:updated'
 */
export function broadcastScheduleUpdated(server: Server, payload: Record<string, unknown>) {
  safeEmit(server, 'schedule:updated', payload);
}

/**
 * 产线变更通知(含 ETag 冲突)
 * event: 'production-line:updated'
 */
export function broadcastProductionLineUpdated(server: Server, payload: Record<string, unknown>) {
  safeEmit(server, 'production-line:updated', payload);
}

/**
 * 用户在线状态
 * event: 'user:online' | 'user:offline'
 */
export function broadcastUserPresence(
  server: Server,
  status: 'online' | 'offline',
  userId: number,
  username: string,
) {
  safeEmit(server, `user:${status}`, { userId, username, ts: Date.now() });
}

/**
 * 系统配置变更(缓存刷新)
 * event: 'config:changed'
 */
export function broadcastConfigChanged(server: Server, key: string) {
  safeEmit(server, 'config:changed', { key, ts: Date.now() });
}

function safeEmit(server: Server | undefined, event: string, payload: unknown) {
  if (!server) {
    logger.warn(`server 未初始化,跳过广播 event=${event}`);
    return;
  }
  try {
    server.emit(event, payload);
    logger.debug(`emitted ${event}`);
  } catch (err) {
    logger.error(`广播 ${event} 失败: ${(err as Error).message}`);
  }
}