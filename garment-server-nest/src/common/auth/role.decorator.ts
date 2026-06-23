import { SetMetadata } from '@nestjs/common';

export const ROLES_METADATA_KEY = 'roles';

/**
 * 标记 Controller/Handler 允许的角色列表
 *
 * 用法:
 *   @Roles('admin', 'planning_manager')
 *   @UseGuards(AuthGuard, RoleGuard)
 *   @Post()
 *   create() {}
 *
 * 与 garment-server/server.js requireRole('admin', 'planner') 等价
 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_METADATA_KEY, roles);