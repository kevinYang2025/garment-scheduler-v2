import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../entity/user.entity';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Phase 3 — AuthModule
 *
 * 装配:
 *   - User entity(给 AuthService 用)
 *   - AuthController(4 端点)
 *   - AuthService(bcrypt 验证 + 改密)
 *
 * 注意:
 *   - 不依赖 CommonModule(因为 @Global() 跨 module 注入会自动可用)
 *   - OperationLoggerService 通过 @Global() CommonModule 自动注入
 *   - AuthGuard / RoleGuard 也通过 CommonModule 自动注入
 */

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}