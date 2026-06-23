import {
  Injectable,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Database from 'better-sqlite3';
import { ActualProduction } from '../../entity/actual-production.entity';
import { CreateActualDto, UpdateActualDto, BatchActualDto } from './actual.dto';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SessionUser } from '../../common/auth/auth.guard';
import { createSqliteConnection } from '../../common/provider/sqlite.provider';

/**
 * Phase 6 — ActualService
 *
 * 与 garment-server /api/actual 完全一致:
 *   - 单条:create / update / remove
 *   - 批量:batch(§6 验收红线)
 *   - recalcTaskStatus(简化版,§3.5 验收)
 *
 * §8 R4 — 批量报工整批 transaction:
 *   better-sqlite3 同步 db.transaction(),任何一条失败全批回滚
 *
 * recalc 移到 transaction 外:
 *   recalc 失败只 logOp,不回滚批次(避免 recalc 错误阻塞报工写入)
 */

@Injectable()
export class ActualService {
  private readonly logger = new Logger('ActualService');
  private sqliteDb: Database.Database;

  constructor(
    @InjectRepository(ActualProduction) private readonly repo: Repository<ActualProduction>,
    private readonly opLog: OperationLoggerService,
  ) {
    // Fix #7:用公共 createSqliteConnection(WAL + busy_timeout + FK 全自动)
    this.sqliteDb = createSqliteConnection();
  }

  async findAll(opts: { styleId?: number; date?: string } = {}): Promise<ActualProduction[]> {
    const where: any = {};
    if (opts.styleId) where.styleId = opts.styleId;
    if (opts.date) where.productionDate = opts.date;
    return this.repo.find({ where, order: { id: 'DESC' }, take: 500 });
  }

  async findById(id: number): Promise<ActualProduction> {
    const a = await this.repo.findOne({ where: { id } });
    if (!a) throw new NotFoundException({ message: 'error.404.report.not_found' });
    return a;
  }

  async create(dto: CreateActualDto, user: SessionUser | null): Promise<ActualProduction> {
    const entity = this.repo.create(this.dtoToEntity(dto));
    const saved = await this.repo.save(entity);
    // recalc 移到 save 外(失败不影响主流程)
    try {
      this.recalcTaskStatus(dto.style_id);
    } catch (err) {
      this.logger.warn(`recalc style_id=${dto.style_id} 失败: ${(err as Error).message}`);
    }
    await this.opLog.log({
      module: 'actual',
      action: 'create',
      targetId: saved.id,
      targetName: dto.style_no,
      detail: `qty=${dto.completed_qty ?? 0}`,
      user,
    });
    return saved;
  }

  async update(id: number, dto: UpdateActualDto, user: SessionUser | null): Promise<ActualProduction> {
    const existing = await this.findById(id);
    Object.assign(existing, this.dtoToEntity(dto));
    const saved = await this.repo.save(existing);
    try {
      this.recalcTaskStatus(dto.style_id);
    } catch (err) {
      this.logger.warn(`recalc style_id=${dto.style_id} 失败`);
    }
    await this.opLog.log({
      module: 'actual',
      action: 'update',
      targetId: saved.id,
      targetName: dto.style_no,
      detail: '',
      user,
    });
    return saved;
  }

  async remove(id: number, user: SessionUser | null): Promise<void> {
    const existing = await this.findById(id);
    await this.repo.delete(id);
    try {
      this.recalcTaskStatus(existing.styleId);
    } catch (err) {
      this.logger.warn(`recalc style_id=${existing.styleId} 失败`);
    }
    await this.opLog.log({
      module: 'actual',
      action: 'delete',
      targetId: id,
      targetName: existing.styleNo,
      detail: '',
      user,
    });
  }

  /**
   * 批量报工(§6 验收红线)
   *
   * 整批在一个 better-sqlite3 transaction 内:
   *   - 任一条 INSERT 失败,全批回滚
   *   - 校验失败抛 BadRequestException 也会回滚
   *
   * recalc 移到事务外:
   *   - 每个不同 style_id 触发一次 recalc
   *   - 失败只 logOp,不回滚批次
   *
   * 返回:{ inserted, total, styleIds }
   */
  async batch(dto: BatchActualDto, user: SessionUser | null): Promise<{
    inserted: number;
    total: number;
    styleIds: number[];
  }> {
    if (!dto.records?.length) {
      throw new BadRequestException({ message: 'error.400.report.batch_empty' });
    }

    // 整批事务(§8 R4 防半提交)
    const styleIdsSet = new Set<number>();
    let inserted = 0;

    const txn = this.sqliteDb.transaction(() => {
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO actual_production
          (schedule_type, secondary_type, style_id, style_no, color, size_spec,
           production_date, completed_qty, defect_qty, workshop, line_team, remark,
           worker_name, start_time, end_time, is_second_inspection)
        VALUES
          (?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?)
      `);
      for (const r of dto.records) {
        if (!r.style_no || !r.production_date) {
          throw new BadRequestException({
            message: 'error.400.report.style_no_or_date_missing',
          });
        }
        stmt.run(
          r.schedule_type ?? '',
          r.secondary_type ?? '',
          r.style_id,
          r.style_no,
          r.color ?? '',
          r.size_spec ?? '',
          r.production_date,
          r.completed_qty ?? 0,
          r.defect_qty ?? 0,
          r.workshop ?? '',
          r.line_team ?? '',
          r.remark ?? '',
          r.worker_name ?? '',
          r.start_time ?? '',
          r.end_time ?? '',
          r.is_second_inspection ?? 0,
        );
        // Fix #8:用显式 !== null 代替 falsy 检查,避免漏掉 style_id=0
        // (虽然正常 style_id > 0,但 DTO @IsInt 不挡 0,要兜底)
        if (r.style_id !== null && r.style_id !== undefined) {
          styleIdsSet.add(r.style_id);
        }
        inserted++;
      }
    });

    txn();  // 执行事务(任一抛错即回滚)

    // recalc 移到事务外(失败不阻塞主流程)
    const styleIdsArr = Array.from(styleIdsSet) as number[];
    for (const sid of styleIdsArr) {
      try {
        this.recalcTaskStatus(sid);
      } catch (err) {
        this.logger.warn(`recalc style_id=${sid} 失败: ${(err as Error).message}`);
      }
    }

    await this.opLog.log({
      module: 'actual',
      action: 'batch',
      targetId: null,
      targetName: '',
      detail: `inserted=${inserted} styles=${styleIdsArr.length}`,
      user,
    });

    this.logger.log(`batch 报工: inserted=${inserted} styles=${styleIdsArr.length}`);
    return { inserted, total: dto.records.length, styleIds: styleIdsArr };
  }

  /**
   * recalcTaskStatus(简化版,§3.5 验收)
   *
   * 与 garment-server/db.js recalcTaskStatus 等价(简化):
   *   1. 累计该 style 的报工总量 = Σ actual.completed_qty (按 schedule_type 过滤)
   *   2. 与 main_plan.plan_qty 对比
   *   3. 若 ≥ 80% → 更新 main_plan.is_scheduled = 2(完成状态)
   *
   * 完整 Express 版有状态机:待排→已排→部分完成→完成→关闭,Phase 6 简化
   */
  private recalcTaskStatus(styleId: number): void {
    // 累计 cutting 报工
    const row = this.sqliteDb
      .prepare(
        `SELECT COALESCE(SUM(completed_qty), 0) AS total
         FROM actual_production
         WHERE style_id = ? AND schedule_type = 'cutting'`,
      )
      .get(styleId) as { total: number };

    // 拿主计划 plan_qty
    const plan = this.sqliteDb
      .prepare(`SELECT plan_qty FROM main_plan WHERE style_id = ?`)
      .get(styleId) as { plan_qty: number } | undefined;

    if (!plan) {
      // 没有主计划,跳过
      return;
    }

    const completion = plan.plan_qty > 0 ? row.total / plan.plan_qty : 0;
    if (completion >= 0.8) {
      this.sqliteDb
        .prepare('UPDATE main_plan SET is_scheduled = 2 WHERE style_id = ?')
        .run(styleId);
      this.logger.log(`recalc style_id=${styleId}: 完成度 ${(completion * 100).toFixed(1)}% → is_scheduled=2`);
    } else if (row.total > 0) {
      this.sqliteDb
        .prepare('UPDATE main_plan SET is_scheduled = 1 WHERE style_id = ?')
        .run(styleId);
      this.logger.log(`recalc style_id=${styleId}: 完成度 ${(completion * 100).toFixed(1)}% → is_scheduled=1(部分)`);
    }
  }

  private dtoToEntity(dto: CreateActualDto | UpdateActualDto): Partial<ActualProduction> {
    return {
      scheduleType: dto.schedule_type ?? '',
      styleId: dto.style_id,
      styleNo: dto.style_no ?? '',
      color: dto.color ?? '',
      sizeSpec: dto.size_spec ?? '',
      productionDate: dto.production_date,
      completedQty: dto.completed_qty ?? 0,
      defectQty: dto.defect_qty ?? 0,
      workshop: dto.workshop ?? '',
      lineTeam: dto.line_team ?? '',
      remark: dto.remark ?? '',
      workerName: dto.worker_name ?? '',
      startTime: dto.start_time ?? '',
      endTime: dto.end_time ?? '',
      secondaryType: dto.secondary_type ?? '',
      isSecondInspection: dto.is_second_inspection ?? 0,
    };
  }
}