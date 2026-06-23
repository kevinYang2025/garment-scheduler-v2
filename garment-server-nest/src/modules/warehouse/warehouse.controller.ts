import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { WarehouseService } from './warehouse.service';
import { CreateInboundDto, CreateOutboundDto } from './warehouse.dto';
import { AuthGuard } from '../../common/auth/auth.guard';
import { Roles } from '../../common/auth/role.decorator';
import { RoleGuard } from '../../common/auth/role.guard';
import { SnakeCaseResponseInterceptor } from '../../common/interceptor/snake-case.interceptor';

/**
 * Phase 7 — WarehouseController
 *
 * 路由(与 garment-server /api/warehouse/:type/* 完全一致):
 *   GET    /api/warehouse/:type/inbound    列表
 *   POST   /api/warehouse/:type/inbound    创建入库
 *   GET    /api/warehouse/:type/outbound   列表
 *   POST   /api/warehouse/:type/outbound   创建出库
 *   GET    /api/warehouse/:type/inventory 库存查询
 *
 * Phase 7 验收(§3):入库/出库/库存 OK
 * Service 业务逻辑**原封不动**(§7.1 Scope Freeze),标注 unmigrated
 *
 * 不实现:export / import 端点(避免触碰导入导出逻辑)
 */

@Controller('api/warehouse/:type')
@UseGuards(AuthGuard, RoleGuard)
@UseInterceptors(SnakeCaseResponseInterceptor)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  /** GET /api/warehouse/:type/inbound — 入库列表 */
  @Get('inbound')
  inboundList(@Param('type') type: string) {
    return this.warehouseService.findInbound(type);
  }

  /** POST /api/warehouse/:type/inbound — 创建入库 */
  @Post('inbound')
  @Roles('admin', 'planning_manager', 'planner', 'supervisor')
  @HttpCode(HttpStatus.OK)
  inboundCreate(
    @Param('type') type: string,
    @Body() dto: CreateInboundDto,
    @Req() req: Request,
  ) {
    return this.warehouseService.createInbound(type, dto, req.session.user?.username ?? null, req.session.user ?? null);
  }

  /** GET /api/warehouse/:type/outbound — 出库列表 */
  @Get('outbound')
  outboundList(@Param('type') type: string) {
    return this.warehouseService.findOutbound(type);
  }

  /** POST /api/warehouse/:type/outbound — 创建出库 */
  @Post('outbound')
  @Roles('admin', 'planning_manager', 'planner', 'supervisor', 'dispatcher')
  @HttpCode(HttpStatus.OK)
  outboundCreate(
    @Param('type') type: string,
    @Body() dto: CreateOutboundDto,
    @Req() req: Request,
  ) {
    return this.warehouseService.createOutbound(type, dto, req.session.user?.username ?? null, req.session.user ?? null);
  }

  /** GET /api/warehouse/:type/inventory — 库存查询 */
  @Get('inventory')
  inventory(
    @Param('type') type: string,
    @Query('keyword') keyword?: string,
    @Query('in_stock') inStock?: string,
  ) {
    return this.warehouseService.findInventory(type, { keyword, in_stock: inStock });
  }
}