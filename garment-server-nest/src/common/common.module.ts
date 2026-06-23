import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLog } from '../entity/operation-log.entity';
import { OperationLoggerService } from './logger/operation-logger.service';
import { AuthGuard } from './auth/auth.guard';
import { RoleGuard } from './auth/role.guard';
import { WorkshopGuard } from './auth/workshop.guard';

/**
 * Phase 2.5 — CommonModule
 *
 * 装配 common/ 下所有 Phase 2 子模块:
 *   - OperationLoggerService(横切,任何 module 可注入)
 *   - AuthGuard / RoleGuard / WorkshopGuard(@UseGuards 直接用)
 *   - OperationLog entity(给 TypeOrmModule.forFeature 注册)
 *
 * 标记 @Global() — Guard 不需要每次 import,但 Service 要能跨 module 注入
 *
 * 注意:HttpExceptionFilter / EtagConflictFilter / LoggingInterceptor / ValidationPipe
 * 这些全局中间件不在 module 里注册,而是在 main.ts 里用 app.useGlobalXxx()
 * (NestJS 限制:Filter/Interceptor/Pipe 必须是具体实例,@Global() module 不方便注册)
 */

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OperationLog])],
  providers: [
    OperationLoggerService,
    AuthGuard,
    RoleGuard,
    WorkshopGuard,
  ],
  exports: [
    OperationLoggerService,
    AuthGuard,
    RoleGuard,
    WorkshopGuard,
  ],
})
export class CommonModule {}