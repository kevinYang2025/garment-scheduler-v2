import { Controller, Get } from '@nestjs/common';

/**
 * Phase 9.2 — 模块迁移状态端点
 *
 * GET /api/system/migration-status
 *
 * 返回各模块是走 NestJS 还是 Express,前端根据此动态路由
 *
 * 当前状态(2026-06-23):
 *   - Phase 2/3:auth + system → nest
 *   - Phase 4:styles → nest
 *   - Phase 5:main-plan + schedule → nest
 *   - Phase 6:report + actual → nest
 *   - Phase 7:warehouse → express(Scope Freeze,Phase 11 下线前保持)
 *   - asn / dn → express(未迁移)
 *
 * 任何模块"已迁 NestJS 且经测试通过"后改这里
 */

const MIGRATION_STATUS = {
  modules: {
    '/api/auth': 'nest',
    '/api/system': 'nest',
    '/api/styles': 'nest',
    '/api/main-plan': 'nest',
    '/api/schedule': 'nest',
    '/api/report': 'nest',
    '/api/actual': 'nest',
    '/api/warehouse': 'express',
    '/api/asn': 'express',
    '/api/dn': 'express',
  },
  // 兼容前端字段
  // 整体迁移进度:已迁 nest 模块数 / 总模块数
  // frontend 通过此展示迁移状态(可选)
  // 这里的 7/10 来自 MIGRATION_STATUS.modules 中 'nest' 数量
};

@Controller('api/system')
export class MigrationController {
  @Get('migration-status')
  status() {
    const modules = MIGRATION_STATUS.modules;
    const total = Object.keys(modules).length;
    const nestCount = Object.values(modules).filter((v) => v === 'nest').length;
    return {
      modules,
      total,
      migrated: nestCount,
      progress: `${nestCount}/${total}`,
    };
  }
}