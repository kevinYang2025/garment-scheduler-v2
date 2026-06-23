import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * warehouse_inventory 表 — 仓库库存
 *
 * 与 garment-server/db.js CREATE TABLE warehouse_inventory 完全一致
 */
@Entity({ name: 'warehouse_inventory' })
@Index('idx_warehouse_inventory_type', ['warehouseType'])
@Index('idx_warehouse_inventory_style_no', ['styleNo'])
export class WarehouseInventory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  warehouseType: string;

  @Column({ type: 'text', default: '' })
  styleNo: string;

  @Column({ type: 'text', default: '' })
  color: string;

  @Column({ type: 'text', default: '' })
  sizeSpec: string;

  @Column({ type: 'integer', default: 0 })
  currentQty: number;

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

  @Column({ type: 'text', default: '' })
  remark: string;
}