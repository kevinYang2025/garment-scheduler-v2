import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WarehouseInbound } from '../../entity/warehouse-inbound.entity';
import { WarehouseOutbound } from '../../entity/warehouse-outbound.entity';
import { WarehouseInventory } from '../../entity/warehouse-inventory.entity';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

/**
 * Phase 7 — WarehouseModule
 *
 * Scope Freeze(§7.1):Service 业务逻辑原封不动,Controller + TypeORM Repository 走 NestJS。
 * 不实现 export/import 端点(避免范围蔓延)。
 */

@Module({
  imports: [TypeOrmModule.forFeature([WarehouseInbound, WarehouseOutbound, WarehouseInventory])],
  controllers: [WarehouseController],
  providers: [WarehouseService],
  exports: [WarehouseService],
})
export class WarehouseModule {}