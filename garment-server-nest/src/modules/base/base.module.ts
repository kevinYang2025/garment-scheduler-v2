import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Style } from '../../entity/style.entity';
import { StyleController } from './style.controller';
import { StyleService } from './style.service';

/**
 * Phase 4 — BaseModule(目前只含款式)
 *
 * 未来追加(每个 Phase 4 子模块):
 *   - WorkshopController (Phase 4.5)
 *   - ProductionLineController (Phase 4.5)
 *   - FabricLoadingController (Phase 4.5)
 *
 * Phase 4 验收:款式 CRUD OK(POST/PUT/DELETE + GET list/by-id)
 */

@Module({
  imports: [TypeOrmModule.forFeature([Style])],
  controllers: [StyleController],
  providers: [StyleService],
  exports: [StyleService],
})
export class BaseModule {}