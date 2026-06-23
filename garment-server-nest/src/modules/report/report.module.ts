import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActualProduction } from '../../entity/actual-production.entity';
import { ActualController } from './actual.controller';
import { ActualService } from './actual.service';

/**
 * Phase 6 — ReportModule(目前只含 Actual 报工)
 *
 * 未来追加(Phase 6.5):
 *   - 报工汇总 controller
 *   - 5 工序细分(cutting-dispatch / printing-dispatch 等)
 *
 * Phase 6 验收:
 *   - 报工 + recalc OK
 *   - 批量报工 10 并发不冲突
 */

@Module({
  imports: [TypeOrmModule.forFeature([ActualProduction])],
  controllers: [ActualController],
  providers: [ActualService],
  exports: [ActualService],
})
export class ReportModule {}