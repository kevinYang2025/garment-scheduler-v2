import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Database from 'better-sqlite3';
import { MainPlan } from '../../entity/main-plan.entity';
import { Style } from '../../entity/style.entity';
import { CreateMainPlanDto, UpdateMainPlanDto, AutoScheduleDto } from './main-plan.dto';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SessionUser } from '../../common/auth/auth.guard';
import { fmtLocal } from '../../common/utils/fmt-local.util';
import { createSqliteConnection } from '../../common/provider/sqlite.provider';

/**
 * Phase 5 — MainPlanService
 *
 * 提供:
 *   - findAll / findById
 *   - create / update / remove
 *   - autoSchedule:三行模型自动排产(简化版)
 *
 * **autoSchedule 简化版**(Phase 5 验收红线):
 *   输入:style_id
 *   逻辑:
 *     1. 查 styles 拿 plan_qty + due_date
 *     2. 倒推三行模型(裁剪 / 二次 / 缝制)
 *        - due_date = 缝制结束
 *        - sewing_end = due_date
 *        - sewing_start = sewing_end - N 天(sewing days = qty / daily_target)
 *        - cutting_end = sewing_start - sewing_buffer
 *        - cutting_start = cutting_end - cutting days(qty / daily_target)
 *     3. INSERT INTO main_plan
 *     4. 写 opLog
 *
 * 与 Express server.js autoSchedule 的关系:
 *   - Express 是完整 200+ 行,考虑面料/产线/工作日
 *   - Phase 5 简化版只验证"三行模型 + 倒推 + 不锁库"
 *   - Phase 5.5 或 Phase 8 补完整逻辑(等 plan/visual-schedule 等子模块)
 *
 * **并发安全**(§3.2 / §8 R4):
 *   - autoSchedule 整个在 dataSource.transaction() 内
 *   - 每个 style_id 用 unique 索引(已存在)防重复排
 *   - 5 并发请求不同 style_id,各自事务互不干扰
 */

const SEWING_BUFFER_DAYS = 5;  // 缝制前缓冲
const DEFAULT_DAILY_TARGET = 200; // 缝制日产(简化)

@Injectable()
export class MainPlanService {
  private readonly logger = new Logger('MainPlanService');

  constructor(
    @InjectRepository(MainPlan) private readonly repo: Repository<MainPlan>,
    @InjectRepository(Style) private readonly styleRepo: Repository<Style>,
    private readonly opLog: OperationLoggerService,
  ) {
    // Fix #7:用公共 createSqliteConnection(WAL + busy_timeout + FK 全自动)
    this.sqliteDb = createSqliteConnection();

    // Fix #3(dev 分支代码审查 2026-06-23):
    // main_plan 表缺 UNIQUE(style_id) 索引,导致并发 autoSchedule 同 style 会重复排
    // entity 加 @Index({ unique: true }) 在 synchronize=false 时不生效(不会自动建)
    // 这里用 raw SQL 保证索引存在(幂等)
    // Express 时代没有这个 UNIQUE 约束,这里新增(向后兼容:已存在的重复数据无法加 UNIQUE)
    try {
      this.sqliteDb.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_main_plan_style_id_unique ON main_plan(style_id)',
      );
    } catch (err) {
      // 已有重复 style_id 的 main_plan 行 → UNIQUE 创建失败
      // 这种情况需要人工清理(SELECT style_id, COUNT(*) FROM main_plan GROUP BY style_id HAVING COUNT(*) > 1)
      this.logger.warn(
        `main_plan UNIQUE 索引创建失败(可能存在重复 style_id): ${(err as Error).message}`,
      );
    }
  }

  private sqliteDb: Database.Database;

  async findAll(opts: { styleId?: number } = {}): Promise<MainPlan[]> {
    if (opts.styleId) {
      return this.repo.find({ where: { styleId: opts.styleId }, order: { id: 'DESC' } });
    }
    return this.repo.find({ order: { id: 'DESC' }, take: 500 });
  }

  async findById(id: number): Promise<MainPlan> {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException({ message: 'error.404.plan.not_found' });
    return p;
  }

  async create(dto: CreateMainPlanDto, user: SessionUser | null): Promise<MainPlan> {
    const entity = this.repo.create(this.dtoToEntity(dto));
    const saved = await this.repo.save(entity);
    await this.opLog.log({
      module: 'main_plan',
      action: 'create',
      targetId: saved.id,
      targetName: saved.styleNo,
      detail: '',
      user,
    });
    return saved;
  }

  async update(id: number, dto: UpdateMainPlanDto, user: SessionUser | null): Promise<MainPlan> {
    const existing = await this.findById(id);
    Object.assign(existing, this.dtoToEntity(dto));
    const saved = await this.repo.save(existing);
    await this.opLog.log({
      module: 'main_plan',
      action: 'update',
      targetId: saved.id,
      targetName: saved.styleNo,
      detail: '',
      user,
    });
    return saved;
  }

  async remove(id: number, user: SessionUser | null): Promise<void> {
    const existing = await this.findById(id);
    await this.repo.delete(id);
    await this.opLog.log({
      module: 'main_plan',
      action: 'delete',
      targetId: id,
      targetName: existing.styleNo,
      detail: '',
      user,
    });
  }

  /**
   * 自动排产(三行模型简化版)
   *
   * 注意:本方法标 async 但核心事务是 better-sqlite3 同步 API。
   * async 仅让 await this.repo.findOneByOrFail / this.opLog.log 可用,
   * 事务块(同步)完成后才执行异步部分,不存在跨 await 的 data race。
   *
   * 用 dataSource.transaction() 包裹,确保并发安全:
   *   - 多个 autoSchedule 同一 style_id:后到者会撞 unique 冲突(或主键冲突)被回滚
   *   - 不同 style_id:互不干扰,各自独立事务
   *
   * 倒推算法:
   *   due_date            → sewing_end
   *   sewing_start        → sewing_end - sewingDays(qty / daily_target)
   *   cutting_end         → sewing_start - SEWING_BUFFER_DAYS
   *   cutting_start       → cutting_end - cuttingDays(qty / daily_target)
   *   secondary_window    → cutting_start ~ cutting_end(预留)
   */
  async autoSchedule(dto: AutoScheduleDto, user: SessionUser | null): Promise<MainPlan> {
    const style = await this.styleRepo.findOne({ where: { id: dto.style_id } });
    if (!style) {
      throw new NotFoundException({ message: 'error.404.plan.style_not_found' });
    }

    // 用 better-sqlite3 同步事务(§8 R4:避免半提交)
    // 事务内:SELECT 查重 + INSERT(同 style 第二次排会因 unique 冲突回滚)
    const txn = this.sqliteDb.transaction(() => {
      const existing = this.sqliteDb
        .prepare('SELECT id FROM main_plan WHERE style_id = ?')
        .get(dto.style_id);
      if (existing) {
        throw new BadRequestException({
          message: 'error.400.plan.already_scheduled',
        });
      }
      const plan = this.computeThreeLineModel(style);
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO main_plan
          (style_id, style_no, product_name, plan_qty, due_date,
           cutting_start, cutting_end,
           secondary_start, secondary_end,
           sewing_remind_date, sewing_start, sewing_end,
           pipeline_count, is_scheduled, priority)
        VALUES
          (@style_id, @style_no, @product_name, @plan_qty, @due_date,
           @cutting_start, @cutting_end,
           @secondary_start, @secondary_end,
           @sewing_remind_date, @sewing_start, @sewing_end,
           @pipeline_count, 1, @priority)
      `);
      const r = stmt.run({
        style_id: plan.styleId,
        style_no: plan.styleNo,
        product_name: plan.productName,
        plan_qty: plan.planQty,
        due_date: plan.dueDate,
        cutting_start: plan.cuttingStart,
        cutting_end: plan.cuttingEnd,
        secondary_start: plan.secondaryStart,
        secondary_end: plan.secondaryEnd,
        sewing_remind_date: plan.sewingRemindDate,
        sewing_start: plan.sewingStart,
        sewing_end: plan.sewingEnd,
        pipeline_count: plan.pipelineCount ?? 1,
        priority: plan.priority ?? 3,
      });
      return r.lastInsertRowid as number;
    });

    let newId: number;
    try {
      newId = txn();
    } catch (err) {
      // B3-1 修复:用 better-sqlite3 标准 err.code === 'SQLITE_CONSTRAINT_UNIQUE'
      // 替代 String(message).includes('UNIQUE') 脆弱字符串匹配
      if (
        err instanceof BadRequestException ||
        (err as any)?.code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        throw new BadRequestException({
          message: 'error.400.plan.already_scheduled',
        });
      }
      throw err;
    }

    // 重新查实体(TypeORM)用于返回
    const saved = await this.repo.findOneByOrFail({ id: newId });

    await this.opLog.log({
      module: 'main_plan',
      action: 'auto_schedule',
      targetId: saved.id,
      targetName: saved.styleNo,
      detail: '',
      user,
    });

    this.logger.log(`autoSchedule style_id=${dto.style_id} → main_plan id=${saved.id}`);
    return saved;
  }

  /**
   * 三行模型倒推算法
   * 输入 style(planQty, dueDate)
   * 输出 MainPlan 字段(裁剪 / 二次 / 缝制 三行)
   */
  private computeThreeLineModel(style: Style): Partial<MainPlan> {
    const qty = style.planQty || 0;
    const dueDate = style.dueDate;

    if (!dueDate) {
      throw new BadRequestException({
        message: 'error.400.plan.style_missing_due_date',
      });
    }

    const sewingDays = Math.max(1, Math.ceil(qty / DEFAULT_DAILY_TARGET));
    const cuttingDays = Math.max(1, Math.ceil(qty / DEFAULT_DAILY_TARGET));

    // 倒推:due_date = sewing_end
    const sewingEnd = new Date(dueDate + 'T00:00:00');
    const sewingStart = new Date(sewingEnd);
    sewingStart.setDate(sewingStart.getDate() - sewingDays);

    const cuttingEnd = new Date(sewingStart);
    cuttingEnd.setDate(cuttingEnd.getDate() - SEWING_BUFFER_DAYS);
    const cuttingStart = new Date(cuttingEnd);
    cuttingStart.setDate(cuttingStart.getDate() - cuttingDays);

    return {
      styleId: style.id,
      styleNo: style.styleNo,
      productName: style.productName,
      planQty: qty,
      dueDate,
      cuttingStart: fmtLocal(cuttingStart),
      cuttingEnd: fmtLocal(cuttingEnd),
      secondaryStart: fmtLocal(cuttingStart),
      secondaryEnd: fmtLocal(cuttingEnd),
      sewingRemindDate: fmtLocal(sewingStart),
      sewingStart: fmtLocal(sewingStart),
      sewingEnd: fmtLocal(sewingEnd),
      pipelineCount: 1,
      isScheduled: 1,
      priority: style.priority || 3,
    };
  }

  private dtoToEntity(dto: CreateMainPlanDto | UpdateMainPlanDto): Partial<MainPlan> {
    return {
      styleId: dto.style_id,
      styleNo: dto.style_no ?? '',
      productName: dto.product_name ?? '',
      planQty: dto.plan_qty ?? 0,
      dueDate: dto.due_date ?? null,
      cuttingStart: dto.cutting_start ?? null,
      cuttingEnd: dto.cutting_end ?? null,
      sewingStart: dto.sewing_start ?? null,
      sewingEnd: dto.sewing_end ?? null,
      workshop: dto.workshop ?? '',
      lineTeam: dto.line_team ?? '',
      pipelineCount: dto.pipeline_count ?? 1,
      priority: dto.priority ?? 3,
    };
  }
}