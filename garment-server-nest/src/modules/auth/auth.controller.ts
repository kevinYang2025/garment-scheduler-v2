import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './auth.dto';
import { AuthGuard } from '../../common/auth/auth.guard';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SnakeCaseResponseInterceptor } from '../../common/interceptor/snake-case.interceptor';

/**
 * Phase 3 — AuthController
 *
 * 路由(与 garment-server 完全一致):
 *   POST /api/auth/login           登录
 *   POST /api/auth/logout          登出
 *   GET  /api/auth/me              当前用户
 *   POST /api/auth/change-password 改密(需登录)
 *
 * session 由 Phase 1 的 express-session + connect-redis 桥接,
 * 这里通过 @Req() 拿到 req.session
 */

@Controller('api/auth')
@UseInterceptors(SnakeCaseResponseInterceptor)  // 响应字段 snake_case 与 Express 兼容
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly opLog: OperationLoggerService,
  ) {}

  /**
   * 登录
   * 成功后 regenerate session id 防 fixation,并把 user 写入 session
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const result = await this.authService.login(
      dto.username,
      dto.password,
      dto.pin_no,
      dto.pin,
    );

    // session.regenerate 是异步 callback,包成 Promise
    await new Promise<void>((resolve, reject) => {
      req.session.regenerate((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
    req.session.user = result.user;

    // session.save 强制持久化(否则 res.json 触发的 end 不一定会自动 save)
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    await this.opLog.log({
      module: 'auth',
      action: 'login',
      targetId: result.user.id,
      targetName: result.user.username,
      detail: '',
      user: result.user,
    });

    return { ok: true, user: result.user };
  }

  /**
   * 登出
   * 销毁 session,清 cookie
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request) {
    const user = req.session?.user;
    if (req.session) {
      await new Promise<void>((resolve) => {
        req.session.destroy(() => resolve());
      });
    }
    if (user) {
      await this.opLog.log({
        module: 'auth',
        action: 'logout',
        targetId: user.id,
        targetName: user.username,
        detail: '',
        user,
      });
    }
    return { ok: true };
  }

  /**
   * 当前用户
   * 不需 AuthGuard(可选),session 有就返,没有就 401
   */
  @Get('me')
  me(@Req() req: Request) {
    const user = req.session?.user;
    if (!user) {
      return { error: 'not_logged_in', statusCode: 401 };
    }
    return { user };
  }

  /**
   * 改密
   * 需登录,从 session 取 user.id
   */
  @Post('change-password')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(@Body() dto: ChangePasswordDto, @Req() req: Request) {
    const user = req.session.user!;
    await this.authService.changePassword(user.id, dto.old_password, dto.new_password);
    return { ok: true };
  }
}