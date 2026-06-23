import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export const WORKSHOP_METADATA_KEY = 'workshop';

/**
 * Phase 2.2 — WorkshopGuard
 *
 * 数据隔离:non-admin 用户只能访问自己车间的数据
 *
 * 用法:
 *   @WorkshopAccess()  // 默认从请求 body.query 取 workshop 字段
 *   @UseGuards(AuthGuard, WorkshopGuard)
 *   @Post()
 *   create() {}
 *
 * 与 garment-server/server.js workshop 权限逻辑一致:
 *   - admin 不受限制
 *   - 其他用户:user.workshop 必须等于请求中的 workshop 字段
 *   - secondary workshop 可管三个工序:printing/embroidery/template
 *     (但不管 ironing,ironing 独立)
 */

@Injectable()
export class WorkshopGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const user = (req as any).user ?? req.session?.user;
    if (!user) {
      throw new UnauthorizedException({
        message: 'error.401.auth.not_logged_in',
      });
    }
    if (user.role === 'admin') return true;

    // 从 body.query.params 取目标 workshop
    // Phase 2 简化:从 query.workshop 或 body.workshop 取(后续可扩展 @WorkshopAccess(field))
    const target =
      (req.query?.workshop as string) ||
      (req.body?.workshop as string) ||
      null;

    // 无目标 workshop 时不限制(由业务 controller 自己校验)
    if (!target) return true;

    const userWorkshop = user.workshop;
    if (!userWorkshop) {
      throw new ForbiddenException({
        message: 'error.403.auth.no_workshop',
      });
    }

    // secondary 主任管三个二次工序
    if (
      userWorkshop === 'secondary' &&
      ['printing', 'embroidery', 'template'].includes(target)
    ) {
      return true;
    }

    // 直接匹配
    if (userWorkshop === target) return true;

    throw new ForbiddenException({
      message: 'error.403.auth.workshop_mismatch',
    });
  }
}