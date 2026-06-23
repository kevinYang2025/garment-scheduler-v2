import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Phase 2.2 — AuthGuard
 *
 * 验证请求已登录(session.user 存在)
 *
 * 与 garment-server/server.js requireAuth 完全一致:
 *   1. session.user 存在 → 通过(设置 req.user)
 *   2. 已有 req.user(API token 中间件注入)→ 通过
 *   3. 否则 401
 *
 * 用法:
 *   @UseGuards(AuthGuard)
 *   @Controller('api/users')
 *   class UserController {}
 *
 * Phase 5 接入:
 *   - global JwtAuthGuard(API token, Bearer header)
 *   - 此 Guard 仍负责 session 验证
 */

export interface SessionUser {
  id: number;
  username: string;
  username_km?: string | null;
  display_name: string;
  display_name_km?: string | null;
  role: string;
  workshop: string | null;
  avatar_url?: string;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    // 1. session 登录
    if (req.session?.user) {
      (req as any).user = req.session.user;
      return true;
    }

    // 2. API token 中间件已注入(Phase 8 接入)
    const user = (req as any).user;
    if (user && user.role) {
      return true;
    }

    // 3. 未登录
    throw new UnauthorizedException({
      message: 'error.401.auth.not_logged_in',
    });
  }
}