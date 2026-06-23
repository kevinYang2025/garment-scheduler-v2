import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * warehouse_outbound 表 — 仓库出库
 *
 * 与 garment-server/db.js CREATE TABLE warehouse_outbound 完全一致
 */
@Entity({ name: 'warehouse_outbound' })
@Index('idx_warehouse_outbound_type', ['warehouseType'])
@Index('idx_warehouse_outbound_style_no', ['styleNo'])
export class WarehouseOutbound {
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
  outboundDate: string | null;

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
  remark: string;

  // ALTER 新增字段(§7.1:照搬)
  @Column({ type: 'text', default: '' })
  orderNo: string;
}