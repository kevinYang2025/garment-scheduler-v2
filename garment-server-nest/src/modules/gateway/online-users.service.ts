import { Injectable, Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { SessionUser } from '../../common/auth/auth.guard';
import { fmtLocalDateTime } from '../../common/utils/fmt-local.util';

/**
 * Phase 8.1 — OnlineUsersService
 *
 * 与 garment-server/server.js __onlineUsers Map 完全一致
 *
 * 功能:
 *   - track socket 连入/断开
 *   - 维护在线用户列表(去重 user.id)
 *   - 触发 'userList' 事件广播(让所有客户端刷新)
 *
 * 与 §2.2 规划 modules/gateway/online-users.service.ts 对齐
 */

export interface OnlineUserInfo {
  socketId: string;
  userId: number;
  username: string;
  displayName: string;
  role: string;
  workshop: string | null;
  ip: string;
  loginAt: string;  // 本地时间(项目 CLAUDE.md 要求不用 toISOString)
}

@Injectable()
export class OnlineUsersService {
  private readonly logger = new Logger('OnlineUsers');
  /** socketId -> OnlineUserInfo */
  private readonly bySocket = new Map<string, OnlineUserInfo>();
  /** userId -> Set<socketId> (一个用户多个 tab) */
  private readonly byUser = new Map<number, Set<string>>();

  /**
   * 客户端连接时调用
   * 必须从 session.user / API token 拿到 user,匿名用户跳过
   */
  trackConnect(socket: Socket, user: SessionUser | null): void {
    if (!user) {
      this.logger.debug(`socket ${socket.id} anonymous, skip track`);
      return;
    }

    const info: OnlineUserInfo = {
      socketId: socket.id,
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      workshop: user.workshop,
      ip: socket.handshake.address || '',
      loginAt: fmtLocalDateTime(new Date()),
    };
    this.bySocket.set(socket.id, info);

    let set = this.byUser.get(user.id);
    if (!set) {
      set = new Set();
      this.byUser.set(user.id, set);
    }
    set.add(socket.id);

    this.logger.log(`+ ${user.username} (socket=${socket.id}, total=${this.byUser.size} users)`);
  }

  /**
   * 客户端断开时调用
   */
  trackDisconnect(socket: Socket): void {
    const info = this.bySocket.get(socket.id);
    if (!info) return;

    this.bySocket.delete(socket.id);
    const set = this.byUser.get(info.userId);
    if (set) {
      set.delete(socket.id);
      if (set.size === 0) {
        this.byUser.delete(info.userId);
      }
    }
    this.logger.log(`- ${info.username} (socket=${socket.id}, total=${this.byUser.size} users)`);
  }

  /**
   * 列出当前在线用户(每个 userId 一条)
   */
  list(): OnlineUserInfo[] {
    const out: OnlineUserInfo[] = [];
    for (const [, set] of this.byUser) {
      // 取这个 user 第一个 socket 的信息(实际登录时间最早)
      const sid = [...set][0];
      const info = this.bySocket.get(sid);
      if (info) out.push(info);
    }
    return out;
  }

  /**
   * 广播 userList(Express 用 io.emit('userList', Array.from(__onlineUsers.values())))
   * @param server 来自 AppGateway.server
   */
  broadcastUserList(server: Server | undefined): void {
    if (!server) return;
    server.emit('userList', this.list());
  }

  /** 当前在线用户数(去重 user) */
  size(): number {
    return this.byUser.size;
  }
}