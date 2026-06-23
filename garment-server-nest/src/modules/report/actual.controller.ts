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
import { ActualService } from './actual.service';
import { CreateActualDto, UpdateActualDto, BatchActualDto } from './actual.dto';
import { AuthGuard } from '../../common/auth/auth.guard';
import { Roles } from '../../common/auth/role.decorator';
import { RoleGuard } from '../../common/auth/role.guard';
import { SnakeCaseResponseInterceptor } from '../../common/interceptor/snake-case.interceptor';

/**
 * Phase 6 — ActualController
 *
 * 路由(与 garment-server /api/actual 完全一致):
 *   GET    /api/actual              列表(可选 ?style_id, ?date)
 *   GET    /api/actual/:id          详情
 *   POST   /api/actual              创建(需 dispatcher/supervisor/admin)
 *   PUT    /api/actual/:id          更新(同角色)
 *   DELETE /api/actual/:id          删除(需 supervisor/admin)
 *   POST   /api/actual/batch        批量报工(§6 验收红线)
 */

@Controller('api/actual')
@UseGuards(AuthGuard, RoleGuard)  // Fix #D:class-level 守卫
@UseInterceptors(SnakeCaseResponseInterceptor)
export class ActualController {
  constructor(private readonly actualService: ActualService) {}

  /** GET /api/actual — 列表 */
  @Get()
  @Roles('admin', 'planning_manager', 'planner', 'supervisor', 'dispatcher')
  list(
    @Query('style_id') styleIdStr?: string,
    @Query('date') date?: string,
  ) {
    const styleId = styleIdStr ? Number(styleIdStr) : undefined;
    return this.actualService.findAll({ styleId, date });
  }

  /** GET /api/actual/:id */
  @Get(':id')
  @Roles('admin', 'planning_manager', 'planner', 'supervisor', 'dispatcher')
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.actualService.findById(id);
  }

  /** POST /api/actual — 单条创建 */
  @Post()
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('dispatcher', 'supervisor', 'admin')
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateActualDto, @Req() req: Request) {
    return this.actualService.create(dto, req.session.user ?? null);
  }

  /** PUT /api/actual/:id — 更新 */
  @Put(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('dispatcher', 'supervisor', 'admin')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateActualDto,
    @Req() req: Request,
  ) {
    return this.actualService.update(id, dto, req.session.user ?? null);
  }

  /** DELETE /api/actual/:id — 删除 */
  @Delete(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('supervisor', 'admin')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.actualService.remove(id, req.session.user ?? null);
    return { ok: true };
  }

  /**
   * POST /api/actual/batch — 批量报工
   * §6 验收红线 + 10 并发压测
   */
  @Post('batch')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('dispatcher', 'supervisor', 'admin')
  @HttpCode(HttpStatus.OK)
  async batch(@Body() dto: BatchActualDto, @Req() req: Request) {
    return this.actualService.batch(dto, req.session.user ?? null);
  }
}