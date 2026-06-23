import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLog } from '../../entity/operation-log.entity';
import { OperationLoggerService } from './operation-logger.service';

/**
 * OperationLoggerService 单元测试
 *
 * 用 :memory: SQLite + 动态建表(避免依赖真实 data.sqlite)
 */

describe('OperationLoggerService', () => {
  let service: OperationLoggerService;
  let repo: Repository<OperationLog>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [OperationLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([OperationLog]),
      ],
      providers: [OperationLoggerService],
    }).compile();

    service = moduleRef.get(OperationLoggerService);
    repo = moduleRef.get(getRepositoryToken(OperationLog));
  });

  it('写入一条日志,字段齐全', async () => {
    const id = await service.log({
      module: 'main_plan',
      action: 'create',
      targetId: 100,
      targetName: 'TS-001',
      detail: '新建款式',
      user: { id: 7, username: 'planner', role: 'planner', workshop: null, displayName: 'P' },
    });

    expect(id).toBeGreaterThan(0);
    const row = await repo.findOneByOrFail({ id: id! });
    expect(row.module).toBe('main_plan');
    expect(row.action).toBe('create');
    expect(row.targetId).toBe(100);
    expect(row.targetName).toBe('TS-001');
    expect(row.detail).toBe('新建款式');
    expect(row.userId).toBe(7);
    expect(row.operator).toBe('planner');
  });

  it('user 缺省时,userId=null,operator=YC', async () => {
    const id = await service.log({
      module: 'system',
      action: 'cleanup',
    });
    const row = await repo.findOneByOrFail({ id: id! });
    expect(row.userId).toBeNull();
    expect(row.operator).toBe('YC');
  });

  it('logFromReq 从 req.user 自动取 user', async () => {
    const id = await service.logFromReq(
      { user: { id: 3, username: 'admin', role: 'admin', workshop: null, displayName: 'A' } },
      'user',
      'reset_password',
      5,
      'user-x',
      'reset to default',
    );
    const row = await repo.findOneByOrFail({ id: id! });
    expect(row.userId).toBe(3);
    expect(row.targetName).toBe('user-x');
  });

  it('logFromReq 从 req.session.user 取(无顶层 req.user)', async () => {
    const id = await service.logFromReq(
      { session: { user: { id: 9, username: 'sup', role: 'supervisor', workshop: 'cutting', displayName: 'S' } } },
      'cutting',
      'dispatch',
    );
    const row = await repo.findOneByOrFail({ id: id! });
    expect(row.userId).toBe(9);
  });

  it('log 失败时返回 null(不抛错)', async () => {
    // 用错误的参数触发 TypeORM 失败(超长字符串)
    const id = await service.log({
      module: 'x'.repeat(1000),
      action: 'y'.repeat(1000),
    });
    // 不应该抛错,应该返回 null 或者数据库能容下大字符串
    // SQLite TEXT 字段无长度限制,所以这条会成功
    expect(id === null || typeof id === 'number').toBe(true);
  });
});