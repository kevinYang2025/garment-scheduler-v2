import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MainPlan } from '../../entity/main-plan.entity';
import { Style } from '../../entity/style.entity';
import { MainPlanController } from './main-plan.controller';
import { MainPlanService } from './main-plan.service';

/**
 * Phase 5 — PlanModule(目前只含主计划 + 自动排产)
 *
 * 未来追加(每个 Phase 5 子模块):
 *   - ScheduleController / ScheduleDaily / ScheduleMaster(Phase 5.5)
 *   - VisualScheduleController(Phase 5.5)
 *   - SchedulingStrategyController(Phase 5.5)
 *
 * Phase 5 验收:
 *   - autoSchedule 三行模型 OK
 *   - 5 并发不同 style_id 不报 database is locked
 */

@Module({
  imports: [TypeOrmModule.forFeature([MainPlan, Style])],
  controllers: [MainPlanController],
  providers: [MainPlanService],
  exports: [MainPlanService],
})
export class PlanModule {}