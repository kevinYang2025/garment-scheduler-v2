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
import { StyleService } from './style.service';
import { CreateStyleDto, UpdateStyleDto } from './style.dto';
import { AuthGuard } from '../../common/auth/auth.guard';
import { Roles } from '../../common/auth/role.decorator';
import { RoleGuard } from '../../common/auth/role.guard';
import { SnakeCaseResponseInterceptor } from '../../common/interceptor/snake-case.interceptor';

/**
 * Phase 4 — StyleController
 *
 * 路由(与 garment-server 完全一致):
 *   GET    /api/styles            列表(q 参数模糊搜索)
 *   GET    /api/styles/:id        详情
 *   POST   /api/styles            创建(需 admin/planning_manager/planner)
 *   PUT    /api/styles/:id        更新(同角色)
 *   DELETE /api/styles/:id        删除(同角色)
 *
 * 权限:Phase 2 RoleGuard 已实现,@Roles() 装饰器标记
 * AuthGuard 先检查 session,RoleGuard 再校验角色
 */

@Controller('api/styles')
@UseGuards(AuthGuard, RoleGuard)  // Fix #D:class-level 守卫,GET 也必须登录
@UseInterceptors(SnakeCaseResponseInterceptor)  // 响应字段 snake_case 与 Express 兼容
export class StyleController {
  constructor(private readonly styleService: StyleService) {}

  /** GET /api/styles — 列表(任意登录用户可看) */
  @Get()
  @Roles('admin', 'planning_manager', 'planner', 'supervisor', 'dispatcher')
  list(@Query('q') q?: string) {
    return this.styleService.findAll({ q });
  }

  /** GET /api/styles/:id */
  @Get(':id')
  @Roles('admin', 'planning_manager', 'planner', 'supervisor', 'dispatcher')
  async getOne(@Param('id', ParseIntPipe) id: number) {
    return this.styleService.findById(id);
  }

  /** POST /api/styles — 创建 */
  @Post()
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async create(@Body() dto: CreateStyleDto, @Req() req: Request) {
    return this.styleService.create(dto, req.session.user ?? null);
  }

  /** PUT /api/styles/:id — 更新 */
  @Put(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStyleDto,
    @Req() req: Request,
  ) {
    return this.styleService.update(id, dto, req.session.user ?? null);
  }

  /** DELETE /api/styles/:id — 删除 */
  @Delete(':id')
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('admin', 'planning_manager', 'planner')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.styleService.remove(id, req.session.user ?? null);
    return { ok: true };
  }
}