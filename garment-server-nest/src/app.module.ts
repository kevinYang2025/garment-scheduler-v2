import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { RedisModule } from './config/redis.config';
import { HealthController } from './modules/health/health.controller';
import { AppGateway } from './modules/gateway/socket.gateway';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { BaseModule } from './modules/base/base.module';
import { PlanModule } from './modules/plan/plan.module';
import { ReportModule } from './modules/report/report.module';

/**
 * Phase 1 — AppModule 骨架
 *
 * 装配:
 *   1. ConfigModule(env 加载)
 *   2. TypeOrmModule(SQLite + WAL,详见 database.config.ts)
 *   3. RedisModule(全局单例,详见 redis.config.ts)
 *   4. HealthController(/health/* 端点)
 *   5. AppGateway(Socket.IO + Redis Adapter)
 *
 * Phase 2 起在 imports 追加 AuthModule、SystemModule、...
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => databaseConfig(),
    }),
    RedisModule,
    CommonModule,
    AuthModule,
    BaseModule,
    PlanModule,
    ReportModule,
  ],
  controllers: [HealthController],
  providers: [AppGateway],
})
export class AppModule {}