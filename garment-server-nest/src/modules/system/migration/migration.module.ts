import { Module } from '@nestjs/common';
import { MigrationController } from './migration.controller';

/**
 * Phase 9.2 — Migration Module
 *
 * 提供 GET /api/system/migration-status
 * 前端根据此动态决定请求走 NestJS(3002)还是 Express(3001)
 */

@Module({
  controllers: [MigrationController],
})
export class MigrationModule {}