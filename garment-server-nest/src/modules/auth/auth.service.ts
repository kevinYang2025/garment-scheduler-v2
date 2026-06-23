import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../entity/user.entity';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SessionUser } from '../../common/auth/auth.guard';

/**
 * Phase 3 — AuthService
 *
 * 与 garment-server/server.js /api/auth/* 完全一致:
 *   - login: 账号+密码 OR 工号+PIN(dispatcher)
 *   - logout: 销毁 session(由 controller 调 req.session.destroy())
 *   - change-password: bcrypt 验证 + bcrypt 重写
 *
 * bcrypt rounds = 12(与 Express 一致),Phase 9 评估调高到 14(2026 安全标准)
 */

export interface LoginResult {
  user: SessionUser;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly opLog: OperationLoggerService,
  ) {}

  /**
   * 登录校验:账号+密码 或 工号+PIN
   * @returns 不写 session,只返回 user 对象(controller 负责 req.session.regenerate + req.session.user)
   */
  async login(
    username?: string,
    password?: string,
    pin_no?: string,
    pin?: string,
  ): Promise<LoginResult> {
    let user: User | null = null;

    // 方式 1:账号+密码
    if (username && password) {
      user = await this.userRepo.findOne({ where: { username, active: 1 } });
      if (!user) throw new UnauthorizedException({ message: 'error.401.auth.bad_credentials' });
      if (!user.passwordHash) {
        throw new UnauthorizedException({ message: 'error.401.auth.no_password' });
      }
      // bcrypt 异步,不阻塞事件循环(与 Express 一致)
      const ok = await bcrypt.compare(password, user.passwordHash);
      if (!ok) throw new UnauthorizedException({ message: 'error.401.auth.bad_credentials' });
    }
    // 方式 2:工号+PIN(dispatcher 专用)
    else if (pin_no && pin) {
      user = await this.userRepo.findOne({ where: { username: pin_no, active: 1 } });
      if (!user) throw new UnauthorizedException({ message: 'error.401.auth.bad_pin' });
      if (user.role !== 'dispatcher') {
        throw new UnauthorizedException({ message: 'error.401.auth.pin_role_not_allowed' });
      }
      if (!user.pin) {
        throw new UnauthorizedException({ message: 'error.401.auth.bad_pin' });
      }
      const ok = await bcrypt.compare(pin, user.pin);
      if (!ok) throw new UnauthorizedException({ message: 'error.401.auth.bad_pin' });
    } else {
      throw new BadRequestException({ message: 'error.400.auth.missing_credentials' });
    }

    return {
      user: {
        id: user.id,
        username: user.username,
        usernameKm: user.usernameKm,
        displayName: user.displayName,
        displayNameKm: user.displayNameKm,
        role: user.role,
        workshop: user.workshop,
        avatarUrl: user.avatarUrl ?? '',
      },
    };
  }

  /**
   * 改密:验证旧密码 + 写入新密码(不动 PIN)
   *
   * controller 负责从 req.session.user 取 id
   * service 不依赖 req,纯业务逻辑(便于测试)
   */
  async changePassword(
    userId: number,
    oldPassword: string,
    newPassword: string,
  ): Promise<void> {
    if (newPassword.length < 6) {
      throw new BadRequestException({ message: 'error.400.auth.password_too_short' });
    }
    const user = await this.userRepo.findOneByOrFail({ id: userId });
    if (!user.passwordHash) {
      throw new BadRequestException({ message: 'error.400.auth.no_password' });
    }
    const ok = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException({ message: 'error.401.auth.bad_old_password' });
    }
    const newHash = await bcrypt.hash(newPassword, 12);
    await this.userRepo.update(
      { id: userId },
      {
        passwordHash: newHash,
        // updated_at 由 @UpdateDateColumn 自动维护
      },
    );

    // 写操作日志
    await this.opLog.log({
      module: 'users',
      action: 'change_password',
      targetId: user.id,
      targetName: user.username,
      detail: '',
      user: null, // session 在 controller 里;此处仅记录事件
    });

    this.logger.log(`user ${user.username} (id=${user.id}) 改密成功`);
  }

  /**
   * 查当前用户(session 已写入)
   */
  async me(sessionUser: SessionUser): Promise<SessionUser> {
    // 重新查 DB 拿最新信息(可能用户改了角色/车间)
    const user = await this.userRepo.findOneByOrFail({ id: sessionUser.id });
    return {
      id: user.id,
      username: user.username,
      usernameKm: user.usernameKm,
      displayName: user.displayName,
      displayNameKm: user.displayNameKm,
      role: user.role,
      workshop: user.workshop,
      avatarUrl: user.avatarUrl ?? '',
    };
  }
}