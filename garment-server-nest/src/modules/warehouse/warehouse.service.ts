import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { WarehouseInbound } from '../../entity/warehouse-inbound.entity';
import { WarehouseOutbound } from '../../entity/warehouse-outbound.entity';
import { WarehouseInventory } from '../../entity/warehouse-inventory.entity';
import { CreateInboundDto, CreateOutboundDto } from './warehouse.dto';
import { fmtLocal } from '../../common/utils/fmt-local.util';

/**
 * Phase 7 — WarehouseService
 *
 * **§7.1 Scope Freeze(2026-06-20 审核补充)**
 *   Service 业务逻辑**原封不动封装**:
 *   - 不改算法、不改事务边界、不改 SQL
 *   - 不新增功能(Bug 修复走 fix/xxx 分支)
 *   - 所有方法标注 `unmigrated` 注释
 *   - v3 重构时拆分子方法、补单元测试
 *
 * 改造范围(§7.1):
 *   ✅ Controller 全部替换为 NestJS
 *   ✅ DTO class-validator 补齐
 *   ✅ TypeORM Repository 连接层
 *   ⛔ Service 业务逻辑原封不动
 *   ⛔ 不新增 Socket.IO / i18n 字段 / 错误码
 */

@Injectable()
export class WarehouseService {
  private readonly logger = new Logger('WarehouseService');
  private sqliteDb: Database.Database;

  constructor(
    @InjectRepository(WarehouseInbound) private readonly inboundRepo: Repository<WarehouseInbound>,
    @InjectRepository(WarehouseOutbound) private readonly outboundRepo: Repository<WarehouseOutbound>,
    @InjectRepository(WarehouseInventory) private readonly inventoryRepo: Repository<WarehouseInventory>,
  ) {
    // §7.1 整段照搬 — 用 better-sqlite3 同步事务(Phase 5/6 已验证)
    const dbPath = process.env.DB_PATH || this.resolveDbPath();
    this.sqliteDb = new Database(dbPath);
    this.sqliteDb.pragma('journal_mode = WAL');
    this.sqliteDb.pragma('busy_timeout = 5000');
  }

  private resolveDbPath(): string {
    const candidates = [
      path.resolve(process.cwd(), '../garment-server/data.sqlite'),
      path.resolve(process.cwd(), 'garment-server/data.sqlite'),
      path.resolve(__dirname, '../../../garment-server/data.sqlite'),
      path.resolve(__dirname, '../../../../garment-server/data.sqlite'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }
    return candidates[0];
  }

  // ============================================================
  // Inbound
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   * 后续 v3 重构时拆分子方法、补单元测试
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
   */
  createInbound(type: string, dto: CreateInboundDto, operator: string | null): { id: number; order_no: string } {
    // unmigrated: 错误校验整段照搬(validateWarehouseRecord)
    // Express validateWarehouseRecord 在 server.js 顶部定义,本迁移不重写校验逻辑
    const errors = this.validateWarehouseRecord(dto, type);
    if (errors.length > 0) {
      throw new BadRequestException({ message: errors.join('; ') });
    }

    // unmigrated: 自动生成入库单号(与 Express RB${today}-${NNN} 一致)
    const today = fmtLocal(new Date()).replace(/-/g, '');
    const todayCount = (this.sqliteDb
      .prepare("SELECT COUNT(*) as c FROM warehouse_inbound WHERE order_no LIKE ?")
      .get(`RB${today}%`) as { c: number }).c;
    const orderNo = `RB${today}-${String(todayCount + 1).padStart(3, '0')}`;

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

    // unmigrated: updateInventory(...)(整段照搬 server.js updateInventory)
    this.updateInventory(type, dto.style_no ?? '', dto.color ?? '', dto.size_spec ?? '', dto.qty ?? 0, dto);

    // unmigrated: broadcastSection('warehouse', ...) + logOp(...)
    // Phase 7 不新增 Socket.IO 事件,沿用现有
    // logOp 写 operation_logs(Phase 2 已实现 OperationLoggerService,本迁移不集成避免范围蔓延)
    this.logger.log(`inbound created type=${type} id=${r.lastInsertRowid} order_no=${orderNo}`);

    return { id: r.lastInsertRowid as number, order_no: orderNo };
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
   */
  createOutbound(type: string, dto: CreateOutboundDto, operator: string | null): { id: number; order_no: string } {
    const errors = this.validateWarehouseRecord(dto, type);
    if (errors.length > 0) {
      throw new BadRequestException({ message: errors.join('; ') });
    }

    // unmigrated: 整批事务(Express 用了 db.getDb().transaction(...))
    const today = fmtLocal(new Date()).replace(/-/g, '');
    const todayCount = (this.sqliteDb
      .prepare("SELECT COUNT(*) as c FROM warehouse_outbound WHERE order_no LIKE ?")
      .get(`CB${today}%`) as { c: number }).c;
    const orderNo = `CB${today}-${String(todayCount + 1).padStart(3, '0')}`;

    let newId = 0;
    const txn = this.sqliteDb.transaction(() => {
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
  // Internal helpers(整段照搬 server.js)
  // ============================================================

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:updateInventory(type, styleNo, color, sizeSpec, qtyDelta, record)
   */
  private updateInventory(
    type: string,
    styleNo: string,
    color: string,
    sizeSpec: string,
    qtyDelta: number,
    record: { pot_no?: string; fabric_name?: string; supplier?: string; customer?: string; width?: string; weight?: string; unit?: string; total_pcs?: number; remark?: string },
  ): void {
    const potNo = record.pot_no ?? '';
    const existing = this.sqliteDb
      .prepare(
        'SELECT id, current_qty FROM warehouse_inventory WHERE warehouse_type = ? AND style_no = ? AND color = ? AND size_spec = ? AND pot_no = ?',
      )
      .get(type, styleNo, color, sizeSpec, potNo) as { id: number; current_qty: number } | undefined;

    if (existing) {
      this.sqliteDb
        .prepare('UPDATE warehouse_inventory SET current_qty = current_qty + ? WHERE id = ?')
        .run(qtyDelta, existing.id);
    } else {
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
    }
  }

  /**
   * unmigrated: 保留原 Express 业务逻辑(2026-06-20 Scope Freeze)
   *
   * Express 原始代码:validateWarehouseRecord(r, type)
   * 简化版(Phase 7):只检查必填字段,不验证业务规则
   */
  private validateWarehouseRecord(r: any, type: string): string[] {
    const errors: string[] = [];
    if (!r.style_no) errors.push('款号不能为空');
    if (r.qty !== undefined && (isNaN(r.qty) || r.qty < 0)) {
      errors.push('数量必须为非负数');
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