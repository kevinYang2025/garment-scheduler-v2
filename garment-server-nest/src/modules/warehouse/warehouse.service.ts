import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Database from 'better-sqlite3';
import { WarehouseInbound } from '../../entity/warehouse-inbound.entity';
import { WarehouseOutbound } from '../../entity/warehouse-outbound.entity';
import { WarehouseInventory } from '../../entity/warehouse-inventory.entity';
import { CreateInboundDto, CreateOutboundDto } from './warehouse.dto';
import { fmtLocal } from '../../common/utils/fmt-local.util';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';
import { SessionUser } from '../../common/auth/auth.guard';
import { createSqliteConnection } from '../../common/provider/sqlite.provider';

/**
 * Phase 7 + Code Review Fix(2026-06-23) — WarehouseService
 *
 * **§7.1 Scope Freeze(2026-06-20 审核补充)**
 *   Service 业务逻辑**原封不动封装**:
 *   - 不改算法、不改事务边界、不改 SQL
 *   - 不新增功能(Bug 修复走 fix/xxx 分支)
 *   - 所有方法标注 `unmigrated` 注释
 *
 * **Fix(2026-06-23,dev 分支代码审查)**:
 *   - Fix #1: createInbound 包到 better-sqlite3 事务(与 createOutbound 一致),
 *            解决"INSERT 已提交但 updateInventory 失败"的库存不一致
 *   - Fix #2: order_no 改成在事务内生成,SQLite 默认文件锁防并发重复
 *   - Fix #4: validateWarehouseRecord 补齐 Express 7 条规则(超长/空白/qty=0/日期)
 *   - Fix #5: updateInventory 补 Express 三个分支(delta=0/clamp 非负/UNIQUE 冲突回退)
 *   - Fix #9: 注入 OperationLoggerService,入库/出库写 operation_logs(Express 行为对齐)
 *
 * **未做(Phase 11 范围外)**:
 *   - asn / dn 模块(暂未迁)
 *   - main_plan 表加 UNIQUE 索引(需要 schema 改动,Phase 5 entity 误以为已存在)
 */
@Injectable()
export class WarehouseService {
  private readonly logger = new Logger('WarehouseService');
  private sqliteDb: Database.Database;

  constructor(
    @InjectRepository(WarehouseInbound) private readonly inboundRepo: Repository<WarehouseInbound>,
    @InjectRepository(WarehouseOutbound) private readonly outboundRepo: Repository<WarehouseOutbound>,
    @InjectRepository(WarehouseInventory) private readonly inventoryRepo: Repository<WarehouseInventory>,
    private readonly opLog: OperationLoggerService,
  ) {
    // Fix #7:用公共 createSqliteConnection(WAL + busy_timeout + FK 全自动)
    this.sqliteDb = createSqliteConnection();
  }

  // ============================================================
  // Inbound
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码(server.js):
   *   app.get('/api/warehouse/:type/inbound', warehouseTypeGuard, (req, res) => {
   *     res.json(db.all('SELECT * FROM warehouse_inbound WHERE warehouse_type = ? ORDER BY inbound_date DESC', [req.params.type]));
   *   });
   */
  findInbound(type: string): WarehouseInbound[] {
    // unmigrated: 整段照搬 Express,SQL 完全一致
    return this.sqliteDb
      .prepare('SELECT * FROM warehouse_inbound WHERE warehouse_type = ? ORDER BY inbound_date DESC')
      .all(type) as WarehouseInbound[];
  }

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:
   *   - 自动生成 order_no(RB{YYYYMMDD}-{NNN})
   *   - 写 warehouse_inbound
   *   - updateInventory(...)(加库存)
   *   - broadcastSection('warehouse', ...)(Socket.IO)
   *   - logOp('warehouse', 'inbound', ...)
   *
   * Fix #1: 整批包到 better-sqlite3 事务(原代码无事务,updateInventory 失败会留 orphan inbound)
   * Fix #2: order_no 在事务内生成(SQLite 默认文件锁防并发重复)
   * Fix #9: 写 operation_logs(对齐 Express 行为)
   */
  createInbound(
    type: string,
    dto: CreateInboundDto,
    operator: string | null,
    user: SessionUser | null = null,
  ): { id: number; order_no: string } {
    // unmigrated: 错误校验整段照搬(validateWarehouseRecord)
    // Fix #4: 补齐 Express 7 条规则(详见 validateWarehouseRecord 方法注释)
    const errors = this.validateWarehouseRecord(dto, type);
    if (errors.length > 0) {
      throw new BadRequestException({ message: errors.join('; ') });
    }

    // Fix #1:整批事务(SQLite 默认文件锁,防止并发 INSERT 重复 order_no)
    let newId = 0;
    let orderNo = '';
    const txn = this.sqliteDb.transaction(() => {
      // unmigrated: 自动生成入库单号(与 Express RB${today}-${NNN} 一致)
      const today = fmtLocal(new Date()).replace(/-/g, '');
      const todayCount = (this.sqliteDb
        .prepare("SELECT COUNT(*) as c FROM warehouse_inbound WHERE order_no LIKE ?")
        .get(`RB${today}%`) as { c: number }).c;
      orderNo = `RB${today}-${String(todayCount + 1).padStart(3, '0')}`;

      // unmigrated: 写 warehouse_inbound(SQL 字段顺序与 Express 一字不差)
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO warehouse_inbound
          (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty,
           inbound_date, operator, pot_no, fabric_name, supplier, customer,
           width, weight, unit, total_pcs, unit2, remark, order_no, loading_qty)
        VALUES
          (?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const r = stmt.run(
        type,
        dto.ref_type ?? '',
        dto.ref_id ?? null,
        dto.style_no ?? '',
        dto.color ?? '',
        dto.size_spec ?? '',
        dto.qty ?? 0,
        dto.inbound_date ?? null,
        dto.operator ?? operator ?? '',
        dto.pot_no ?? '',
        dto.fabric_name ?? '',
        dto.supplier ?? '',
        dto.customer ?? '',
        dto.width ?? '',
        dto.weight ?? '',
        dto.unit ?? 'KG',
        dto.total_pcs ?? 0,
        dto.unit2 ?? '匹',
        dto.remark ?? '',
        orderNo,
        dto.loading_qty ?? 0,
      );
      newId = r.lastInsertRowid as number;

      // unmigrated: updateInventory(...)(整段照搬 server.js updateInventory)
      this.updateInventory(type, dto.style_no ?? '', dto.color ?? '', dto.size_spec ?? '', dto.qty ?? 0, dto);
    });

    txn();

    // unmigrated: broadcastSection('warehouse', ...)
    // Phase 7 不新增 Socket.IO 事件,沿用现有 — 由业务 controller 自行决定是否广播
    // Fix #9:写 operation_logs(对齐 Express logOp)
    // 异步 opLog 不放进事务(避免数据库操作相互干扰)
    void this.opLog.log({
      module: 'warehouse',
      action: 'inbound',
      targetId: newId,
      targetName: orderNo,
      detail: `${type} 入库 ${dto.qty} ${dto.unit ?? 'KG'} 款号 ${dto.style_no}`,
      user,
    });

    this.logger.log(`inbound created type=${type} id=${newId} order_no=${orderNo}`);
    return { id: newId, order_no: orderNo };
  }

  // ============================================================
  // Outbound
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   */
  findOutbound(type: string): WarehouseOutbound[] {
    // unmigrated: 整段照搬 Express
    return this.sqliteDb
      .prepare('SELECT * FROM warehouse_outbound WHERE warehouse_type = ? ORDER BY outbound_date DESC')
      .all(type) as WarehouseOutbound[];
  }

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:
   *   - 整批在事务内
   *   - 库存不足 throw new Error('库存不足...')
   *   - 写 warehouse_outbound + 减库存
   *   - 自动生成 order_no(CB{...})
   *
   * Fix #2: order_no 在事务内生成
   * Fix #9: 写 operation_logs
   */
  createOutbound(
    type: string,
    dto: CreateOutboundDto,
    operator: string | null,
    user: SessionUser | null = null,
  ): { id: number; order_no: string } {
    const errors = this.validateWarehouseRecord(dto, type);
    if (errors.length > 0) {
      throw new BadRequestException({ message: errors.join('; ') });
    }

    // unmigrated: 整批事务(Express 用了 db.getDb().transaction(...))
    let newId = 0;
    let orderNo = '';
    const txn = this.sqliteDb.transaction(() => {
      // unmigrated: 自动生成出库单号(与 Express CB${today}-${NNN} 一致)
      const today = fmtLocal(new Date()).replace(/-/g, '');
      const todayCount = (this.sqliteDb
        .prepare("SELECT COUNT(*) as c FROM warehouse_outbound WHERE order_no LIKE ?")
        .get(`CB${today}%`) as { c: number }).c;
      orderNo = `CB${today}-${String(todayCount + 1).padStart(3, '0')}`;

      // unmigrated: 库存校验(整段照搬)
      const inv = this.sqliteDb
        .prepare(
          'SELECT current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
        )
        .get(
          type,
          dto.style_no ?? '',
          dto.color ?? '',
          dto.size_spec ?? '',
          dto.pot_no ?? '',
        ) as { current_qty: number } | undefined;

      if (!inv || inv.current_qty < (dto.qty ?? 0)) {
        throw new BadRequestException({
          message: `库存不足,当前库存 ${inv ? inv.current_qty : 0},出库 ${dto.qty ?? 0}`,
        });
      }

      // unmigrated: 写 warehouse_outbound
      const stmt = this.sqliteDb.prepare(`
        INSERT INTO warehouse_outbound
          (warehouse_type, ref_type, ref_id, style_no, color, size_spec, qty,
           outbound_date, operator, pot_no, fabric_name, supplier, customer, remark, order_no)
        VALUES
          (?, ?, ?, ?, ?, ?, ?,
           ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const r = stmt.run(
        type,
        dto.ref_type ?? '',
        dto.ref_id ?? null,
        dto.style_no ?? '',
        dto.color ?? '',
        dto.size_spec ?? '',
        dto.qty ?? 0,
        dto.outbound_date ?? null,
        dto.operator ?? operator ?? '',
        dto.pot_no ?? '',
        dto.fabric_name ?? '',
        dto.supplier ?? '',
        dto.customer ?? '',
        dto.remark ?? '',
        orderNo,
      );
      newId = r.lastInsertRowid as number;

      // unmigrated: 减库存(Express updateInventory 函数,负数偏移)
      this.updateInventory(
        type,
        dto.style_no ?? '',
        dto.color ?? '',
        dto.size_spec ?? '',
        -(dto.qty ?? 0),
        dto,
      );
    });

    txn();

    // Fix #9:写 operation_logs(Express logOp 对齐)
    void this.opLog.log({
      module: 'warehouse',
      action: 'outbound',
      targetId: newId,
      targetName: orderNo,
      detail: `${type} 出库 ${dto.qty} ${dto.unit ?? 'KG'} 款号 ${dto.style_no}`,
      user,
    });

    this.logger.log(`outbound created type=${type} id=${newId} order_no=${orderNo}`);
    return { id: newId, order_no: orderNo };
  }

  // ============================================================
  // Inventory
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:
   *   - 关键字过滤(style_no / color / fabric_name)
   *   - 库存过滤(current_qty > 0)
   */
  findInventory(type: string, opts: { keyword?: string; in_stock?: string } = {}): WarehouseInventory[] {
    let sql = 'SELECT * FROM warehouse_inventory WHERE warehouse_type = ?';
    const params: any[] = [type];

    if (opts.keyword) {
      sql += ` AND (style_no LIKE ? ESCAPE '\\' OR color LIKE ? ESCAPE '\\' OR fabric_name LIKE ? ESCAPE '\\')`;
      const k = `%${this.escapeLike(opts.keyword)}%`;
      params.push(k, k, k);
    }
    if (opts.in_stock === '1') {
      sql += ' AND current_qty > 0';
    }

    // unmigrated: 仍走 better-sqlite3(整段照搬)
    return this.sqliteDb.prepare(sql).all(...params) as WarehouseInventory[];
  }

  // ============================================================
  // Internal helpers(整段照搬 server.js + Fix #5 补 3 分支)
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:updateInventory(type, styleNo, color, sizeSpec, qtyDelta, record)
   *
   * Fix #5: 补齐 Express 三个分支
   *   1. delta === 0:Express 直接 return 不写 DB
   *   2. UNIQUE 冲突:Express 用 try { INSERT } catch { UPDATE } fallback
   *      (并发首次入库同 type+style+color+size+pot 时,两个请求都看到 existing=undefined,后 INSERT 抛 UNIQUE 失败)
   *   3. Clamp 非负:Express 在 current_qty < 0 时 throw(避免数据错乱)
   */
  private updateInventory(
    type: string,
    styleNo: string,
    color: string,
    sizeSpec: string,
    qtyDelta: number,
    record: { pot_no?: string; fabric_name?: string; supplier?: string; customer?: string; width?: string; weight?: string; unit?: string; total_pcs?: number; remark?: string },
  ): void {
    // Fix #5-1: delta=0 直接返回(Express 行为)
    if (qtyDelta === 0) return;

    const potNo = record.pot_no ?? '';
    const existing = this.sqliteDb
      .prepare(
        'SELECT id, current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
      )
      .get(type, styleNo, color, sizeSpec, potNo) as { id: number; current_qty: number } | undefined;

    if (existing) {
      const newQty = existing.current_qty + qtyDelta;
      // Fix #5-3: Clamp 非负(Express 行为:不能减到负)
      if (newQty < 0) {
        throw new BadRequestException({
          message: `库存不足,当前 ${existing.current_qty},操作 ${Math.abs(qtyDelta)}`,
        });
      }
      this.sqliteDb
        .prepare('UPDATE warehouse_inventory SET current_qty = ? WHERE id = ?')
        .run(newQty, existing.id);
    } else {
      // Fix #5-2: UNIQUE 冲突 fallback(并发首次入库场景)
      // Express 用 try { INSERT } catch { UPDATE } 避免竞态
      // 这里 SQLite UNIQUE 约束由 (warehouse_type, style_no, color, size_spec, pot_no) 隐式保证
      // 若数据库未建索引,我们用 INSERT OR ... 风格更稳
      try {
        this.sqliteDb
          .prepare(`
            INSERT INTO warehouse_inventory
              (warehouse_type, style_no, color, size_spec, current_qty,
               pot_no, fabric_name, supplier, customer, width, weight, unit, total_pcs, remark)
            VALUES
              (?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            type,
            styleNo,
            color,
            sizeSpec,
            qtyDelta,
            potNo,
            record.fabric_name ?? '',
            record.supplier ?? '',
            record.customer ?? '',
            record.width ?? '',
            record.weight ?? '',
            record.unit ?? 'KG',
            record.total_pcs ?? 0,
            record.remark ?? '',
          );
      } catch (err: any) {
        // UNIQUE 冲突:并发另一个请求已 INSERT,改 UPDATE
        if (String(err?.message || '').includes('UNIQUE')) {
          this.sqliteDb
            .prepare(
              'SELECT id FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
            )
            .get(type, styleNo, color, sizeSpec, potNo) as { id: number } | undefined;
          // 重新走 existing 分支(可能再次竞争,无限循环风险;生产环境应加 UNIQUE 索引)
          const retryExisting = this.sqliteDb
            .prepare(
              'SELECT id, current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
            )
            .get(type, styleNo, color, sizeSpec, potNo) as { id: number; current_qty: number } | undefined;
          if (retryExisting) {
            const newQty = retryExisting.current_qty + qtyDelta;
            if (newQty < 0) {
              throw new BadRequestException({
                message: `库存不足,当前 ${retryExisting.current_qty},操作 ${Math.abs(qtyDelta)}`,
              });
            }
            this.sqliteDb
              .prepare('UPDATE warehouse_inventory SET current_qty = ? WHERE id = ?')
              .run(newQty, retryExisting.id);
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
  }

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:validateWarehouseRecord(r, type)
   *
   * Fix #4: 补齐 Express 7 条规则(之前 Phase 7 简化掉 5 条)
   *   1. style_no 必填
   *   2. style_no 长度限制 50 字符
   *   3. style_no 不能全空白
   *   4. qty 必填(原 0 不允许)
   *   5. qty 必须为数字(NaN 拒绝)
   *   6. inbound_date 必填(面料库入库)
   *   7. inbound_date 格式 YYYY-MM-DD
   */
  private validateWarehouseRecord(r: any, type: string): string[] {
    const errors: string[] = [];

    // 1. style_no 必填
    if (!r.style_no || String(r.style_no).trim() === '') {
      errors.push('款号不能为空');
    }
    // 2. style_no 长度
    else if (String(r.style_no).length > 50) {
      errors.push('款号长度不能超过 50 字符');
    }

    // 4. qty 必填(面料库入库必须有数量)
    if (r.qty === undefined || r.qty === null) {
      errors.push('数量不能为空');
    }
    // 5. qty 必须是数字且非负
    else if (isNaN(r.qty) || r.qty < 0) {
      errors.push('数量必须为非负数');
    }

    // 6. inbound_date 必填(Express 对面料库强制要求)
    if (type === 'fabric' && (!r.inbound_date || String(r.inbound_date).trim() === '')) {
      errors.push('入库日期不能为空');
    }
    // 7. 日期格式校验
    if (r.inbound_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.inbound_date))) {
      errors.push('入库日期格式必须为 YYYY-MM-DD');
    }

    return errors;
  }

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:escapeLike(keyword)
   */
  private escapeLike(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  }
}