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
    // 直接打开 better-sqlite3 连接用于事务
    // better-sqlite3 是同步驱动,自带 db.transaction() 同步 API
    // TypeORM 的 dataSource.transaction() 走的是异步嵌套事务,跟同步驱动不兼容
    //
    // DB_PATH 优先(测试场景),否则:
    //   - 容器内:NestJS cwd 通常是 /app(同容器内 garment-server 可能在 /app/server 或 /workspace)
    //   - 开发:__dirname 是 dist/modules/plan/ 或 src/modules/plan/
    // 我们用"往上找 sibling garment-server/data.sqlite"的策略
    const dbPath = process.env.DB_PATH || this.resolveDbPath();
    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma('journal_mode = WAL');
    this.sqliteDb.pragma('busy_timeout = 5000');
  }

  private resolveDbPath(): string {
    const path = require('path');
    const fs = require('fs');
    // 尝试相对当前工作目录(garment-server-nest/)的 ../garment-server/data.sqlite
    const candidates = [
      path.resolve(process.cwd(), '../garment-server/data.sqlite'),
      path.resolve(process.cwd(), 'garment-server/data.sqlite'),
      // dist/compiled 路径向上找 sibling
      path.resolve(__dirname, '../../../garment-server/data.sqlite'),
      path.resolve(__dirname, '../../../../garment-server/data.sqlite'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    // fallback 到第一个(cwd 相对)
    return candidates[0];
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
      if (err instanceof BadRequestException) throw err;
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