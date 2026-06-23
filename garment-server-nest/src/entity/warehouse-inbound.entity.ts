import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * warehouse_inbound 表 — 仓库入库
 *
 * 与 garment-server/db.js CREATE TABLE warehouse_inbound 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建),NestJS 只读不写 schema
 *
 * Scope Freeze:Phase 7 整段照搬 Express,不优化字段(详见 §7.1)
 */
@Entity({ name: 'warehouse_inbound' })
@Index('idx_warehouse_inbound_type', ['warehouseType'])
@Index('idx_warehouse_inbound_style_no', ['styleNo'])
export class WarehouseInbound {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  warehouseType: string;

  @Column({ type: 'text', default: '' })
  refType: string;

  @Column({ type: 'integer', nullable: true })
  refId: number | null;

  @Column({ type: 'text', default: '' })
  styleNo: string;

  @Column({ type: 'text', default: '' })
  color: string;

  @Column({ type: 'text', default: '' })
  sizeSpec: string;

  @Column({ type: 'integer', default: 0 })
  qty: number;

  @Column({ type: 'text', nullable: true })
  inboundDate: string | null;

  @Column({ type: 'text', default: '' })
  operator: string;

  // 面料库扩展字段
  @Column({ type: 'text', default: '' })
  potNo: string;

  @Column({ type: 'text', default: '' })
  fabricName: string;

  @Column({ type: 'text', default: '' })
  supplier: string;

  @Column({ type: 'text', default: '' })
  customer: string;

  @Column({ type: 'text', default: '' })
  width: string;

  @Column({ type: 'text', default: '' })
  weight: string;

  @Column({ type: 'text', default: 'KG' })
  unit: string;

  @Column({ type: 'integer', default: 0 })
  totalPcs: number;

  @Column({ type: 'text', default: '匹' })
  unit2: string;

  @Column({ type: 'text', default: '' })
  remark: string;

  // ALTER 新增字段(§7.1:不优化,照搬)
  @Column({ type: 'text', default: '' })
  orderNo: string;

  @Column({ type: 'real', default: 0 })
  loadingQty: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}