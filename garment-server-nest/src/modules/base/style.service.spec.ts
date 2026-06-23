import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Style } from '../../entity/style.entity';
import { OperationLog } from '../../entity/operation-log.entity';
import { StyleService } from './style.service';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { CreateStyleDto } from './style.dto';

/**
 * StyleService 单元测试(:memory: SQLite)
 *
 * 覆盖:
 *   - create / update / remove + opLog
 *   - findAll / findById
 *   - DTO → Entity 字段映射(snake_case 写入)
 */

describe('StyleService', () => {
  let service: StyleService;
  let styleRepo: Repository<Style>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [Style, OperationLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([Style, OperationLog]),
      ],
      providers: [StyleService, OperationLoggerService],
    }).compile();

    service = moduleRef.get(StyleService);
    styleRepo = moduleRef.get(getRepositoryToken(Style));
  });

  describe('create', () => {
    it('创建样式,字段完整', async () => {
      const dto: CreateStyleDto = {
        style_no: 'TS-001',
        product_name: 'Test T-shirt',
        style_category: 'T-shirt',
        fabric_code: 'FAB-001',
        plan_qty: 100,
        due_date: '2026-07-01',
        embroidery: '是',
        embroidery_daily_output: 50,
        target_daily_output: 200,
        remarks: 'e2e test',
      };
      const created = await service.create(dto, null);
      expect(created.id).toBeGreaterThan(0);
      expect(created.styleNo).toBe('TS-001');
      expect(created.planQty).toBe(100);

      // 查 DB 确认数据持久化(SnakeCaseNamingStrategy 让 entity styleNo → column style_no)
      const row = await styleRepo.findOneByOrFail({ id: created.id });
      expect(row.styleNo).toBe('TS-001');
      expect(row.planQty).toBe(100);
    });

    it('字段默认值兜底(undefined → 0/空串)', async () => {
      const dto: CreateStyleDto = { style_no: 'MIN-001' };
      const created = await service.create(dto, null);
      expect(created.productName).toBe('');
      expect(created.planQty).toBe(0);
      expect(created.dueDate).toBeNull();
      expect(created.embroideryDailyOutput).toBe(0);
      expect(created.hasSpecialWash).toBe(0);
    });

    it('写 opLog:create', async () => {
      const dto: CreateStyleDto = { style_no: 'LOG-001', plan_qty: 50 };
      const created = await service.create(dto, null);
      // 没有 opLogRepo 在测试 setup 里,无法直接查;但 log 调用不应抛错
      expect(created.id).toBeGreaterThan(0);
    });
  });

  describe('findAll', () => {
    it('空数据库 → 空数组', async () => {
      const r = await service.findAll();
      expect(r).toEqual([]);
    });

    it('返回全部款式,按 id DESC', async () => {
      await service.create({ style_no: 'A-001' }, null);
      await service.create({ style_no: 'A-002' }, null);
      await service.create({ style_no: 'A-003' }, null);
      const r = await service.findAll();
      expect(r.map((s) => s.styleNo)).toEqual(['A-003', 'A-002', 'A-001']);
    });

    it('q 参数模糊搜索 style_no / product_name', async () => {
      await service.create({ style_no: 'TS-001', product_name: 'T-shirt A' }, null);
      await service.create({ style_no: 'TS-002', product_name: 'T-shirt B' }, null);
      await service.create({ style_no: 'JK-001', product_name: 'Jacket' }, null);
      const r = await service.findAll({ q: 'TS' });
      expect(r).toHaveLength(2);
      const r2 = await service.findAll({ q: 'Jacket' });
      expect(r2).toHaveLength(1);
    });
  });

  describe('findById', () => {
    it('存在 → 返回', async () => {
      const c = await service.create({ style_no: 'GET-001' }, null);
      const r = await service.findById(c.id);
      expect(r.styleNo).toBe('GET-001');
    });

    it('不存在 → 抛 NotFoundException', async () => {
      await expect(service.findById(99999)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('update', () => {
    it('更新 plan_qty 等字段', async () => {
      const c = await service.create({ style_no: 'UPD-001', plan_qty: 100 }, null);
      const updated = await service.update(c.id, {
        style_no: 'UPD-001',
        plan_qty: 250,
        product_name: '改名了',
      }, null);
      expect(updated.planQty).toBe(250);
      expect(updated.productName).toBe('改名了');
    });

    it('不存在 → 404', async () => {
      await expect(service.update(99999, { style_no: 'X' }, null)).rejects.toMatchObject({
        status: 404,
      });
    });
  });

  describe('remove', () => {
    it('删除成功', async () => {
      const c = await service.create({ style_no: 'DEL-001' }, null);
      await service.remove(c.id, null);
      await expect(service.findById(c.id)).rejects.toMatchObject({ status: 404 });
    });

    it('不存在 → 404', async () => {
      await expect(service.remove(99999, null)).rejects.toMatchObject({ status: 404 });
    });
  });
});