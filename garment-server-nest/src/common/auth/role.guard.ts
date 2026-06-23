import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_METADATA_KEY } from './role.decorator';

/**
 * Phase 2.2 — RoleGuard
 *
 * 配合 @Roles() 装饰器使用:
 *   - 无 @Roles() 标记 → 任何已登录用户都通过
 *   - 有 @Roles() → 用户 role 在列表中通过(admin 自动 bypass)
 *   - 不在列表中 → 403 权限不足
 *
 * 与 garment-server/server.js requireRole 完全一致:
 *   - admin 自动通过所有角色检查(kevin 2026-06-18 决定)
 *   - 未登录返回 401(防御性,实际 AuthGuard 已先拦截)
 */

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_METADATA_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as any).user ?? req.session?.user;
    if (!user) {
      throw new UnauthorizedException({
        message: 'error.401.auth.not_logged_in',
      });
    }
    if (user.role === 'admin') return true; // admin bypass
    if (roles.includes(user.role)) return true;

    throw new ForbiddenException({
      message: 'error.403.auth.role_not_allowed',
    });
  }
}