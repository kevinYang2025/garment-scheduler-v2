import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { MainPlanService } from './main-plan.service';
import { CreateMainPlanDto, UpdateMainPlanDto, AutoScheduleDto } from './main-plan.dto';
import { AuthGuard } from '../../common/auth/auth.guard';
import { Roles } from '../../common/auth/role.decorator';
import { RoleGuard } from '../../common/auth/role.guard';
import { SnakeCaseResponseInterceptor } from '../../common/interceptor/snake-case.interceptor';

/**
 * Phase 5 — MainPlanController
 *
 * 路由(与 garment-server /api/main-plan 完全一致):
 *   GET    /api/main-plan              列表(可选 ?style_id)
 *   GET    /api/main-plan/:id          详情
 *   POST   /api/main-plan              创建(需 admin/planning_manager/planner)
 *   PUT    /api/main-plan/:id          更新(同角色)
 *   DELETE /api/main-plan/:id          删除(同角色)
 *   POST   /api/main-plan/auto-schedule 自动排产(三行模型,验收红线)
 */

@Controller('api/main-plan')
@UseInterceptors(SnakeCaseResponseInterceptor)
export class MainPlanController {
  constructor(private readonly mainPlanService: MainPlanService) {}

  /** GET /api/main-plan — 列表 */
  @Get()
  list(@Query('style_id') styleIdStr?: string) {
    const styleId = styleIdStr ? Number(styleIdStr) : undefined;
    return this.mainPlanService.findAll({ styleId });
  }

  /** GET /api/main-plan/:id */
  @Get(':id')
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.mainPlanService.findById(id);
  }

  /** POST /api/main-plan — 创建 */
  @Post()
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateMainPlanDto, @Req() req: Request) {
    return this.mainPlanService.create(dto, req.session.user ?? null);
  }

  /** PUT /api/main-plan/:id */
  @Put(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMainPlanDto,
    @Req() req: Request,
  ) {
    return this.mainPlanService.update(id, dto, req.session.user ?? null);
  }

  /** DELETE /api/main-plan/:id */
  @Delete(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.mainPlanService.remove(id, req.session.user ?? null);
    return { ok: true };
  }

  /**
   * POST /api/main-plan/auto-schedule
   * 三行模型自动排产,§3 验收红线
   */
  @Post('auto-schedule')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async autoSchedule(@Body() dto: AutoScheduleDto, @Req() req: Request) {
    return this.mainPlanService.autoSchedule(dto, req.session.user ?? null);
  }
}