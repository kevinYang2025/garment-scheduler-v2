import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * actual_production 表 — 实际报工记录
 *
 * 与 garment-server/db.js CREATE TABLE actual_production + ALTER ADD 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建),NestJS 只读不写 schema
 *
 * 字段对照:
 *   id              INTEGER PK
 *   schedule_type   TEXT(cutting/sewing 等)
 *   style_id        INTEGER NOT NULL(外键 styles.id)
 *   style_no        TEXT(冗余)
 *   color           TEXT
 *   size_spec       TEXT
 *   production_date TEXT NOT NULL
 *   completed_qty   INTEGER DEFAULT 0
 *   defect_qty      INTEGER DEFAULT 0
 *   workshop        TEXT
 *   line_team       TEXT
 *   remark          TEXT
 *   recorded_at     TEXT DEFAULT (datetime('now','localtime'))
 *
 * ALTER 新增字段:
 *   worker_name        TEXT(工人姓名)
 *   start_time / end_time TEXT(起止时间)
 *   secondary_type     TEXT(二次工序类型:printing/embroidery/template/ironing)
 *   is_second_inspection INTEGER(是否二检)
 */

@Entity({ name: 'actual_production' })
@Index('idx_actual_style_id', ['styleId'])
@Index('idx_actual_production_date', ['productionDate'])
@Index('idx_actual_schedule_type', ['scheduleType'])
export class ActualProduction {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', default: '' })
  scheduleType: string;

  @Column({ type: 'integer' })
  styleId: number;

  @Column({ type: 'text', default: '' })
  styleNo: string;

  @Column({ type: 'text', default: '' })
  color: string;

  @Column({ type: 'text', default: '' })
  sizeSpec: string;

  @Column({ type: 'text' })
  productionDate: string;

  @Column({ type: 'integer', default: 0 })
  completedQty: number;

  @Column({ type: 'integer', default: 0 })
  defectQty: number;

  @Column({ type: 'text', default: '' })
  workshop: string;

  @Column({ type: 'text', default: '' })
  lineTeam: string;

  @Column({ type: 'text', default: '' })
  remark: string;

  @Column({ type: 'text', default: '' })
  workerName: string;

  @Column({ type: 'text', default: '' })
  startTime: string;

  @Column({ type: 'text', default: '' })
  endTime: string;

  @Column({ type: 'text', default: '' })
  secondaryType: string;

  @Column({ type: 'integer', default: 0 })
  isSecondInspection: number;

  @Column({ type: 'text', default: '' })
  recordedAt: string;
}