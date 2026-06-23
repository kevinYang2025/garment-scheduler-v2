import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * main_plan 表 — 主计划
 *
 * 与 garment-server/db.js CREATE TABLE main_plan + 多个 ALTER ADD 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建),NestJS 只读不写 schema
 *
 * 字段对照:
 *   id                  INTEGER PK
 *   style_id            INTEGER NOT NULL(外键 styles.id)
 *   style_no            TEXT(冗余,避免 join)
 *   product_name        TEXT
 *   plan_qty            INTEGER DEFAULT 0
 *   due_date            TEXT
 *   cutting_start/end    TEXT(三行模型:裁剪阶段)
 *   secondary_start/end TEXT(二次工序:印花/刺绣/烫标/模板 合计窗口)
 *   sewing_remind_date  TEXT(缝制提醒)
 *   sewing_start/end    TEXT(三行模型:缝制阶段)
 *   ironing_start/end   TEXT(ALTER 新增,烫标)
 *   printing_start/end  TEXT(ALTER 新增,印花)
 *   embroidery_start/end TEXT(ALTER 新增,刺绣)
 *   template_start/end  TEXT(ALTER 新增,模板)
 *   pipeline_count      INTEGER DEFAULT 1(产线条数)
 *   is_scheduled        INTEGER DEFAULT 0(是否已排程)
 *   workshop            TEXT(缝制车间)
 *   line_team           TEXT(产线组)
 *   priority            INTEGER DEFAULT 3(ALTER 新增)
 *   conflict_flag       INTEGER DEFAULT 0(ALTER 新增,排程冲突标记)
 *   created_at          TEXT DEFAULT (datetime('now','localtime'))
 */

@Entity({ name: 'main_plan' })
@Index('idx_main_plan_style_id', ['styleId'])
@Index('idx_main_plan_due_date', ['dueDate'])
@Index('idx_main_plan_is_scheduled', ['isScheduled'])
export class MainPlan {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  styleId: number;

  @Column({ type: 'text', default: '' })
  styleNo: string;

  @Column({ type: 'text', default: '' })
  productName: string;

  @Column({ type: 'integer', default: 0 })
  planQty: number;

  @Column({ type: 'text', nullable: true })
  dueDate: string | null;

  @Column({ type: 'text', nullable: true })
  cuttingStart: string | null;

  @Column({ type: 'text', nullable: true })
  cuttingEnd: string | null;

  @Column({ type: 'text', nullable: true })
  secondaryStart: string | null;

  @Column({ type: 'text', nullable: true })
  secondaryEnd: string | null;

  @Column({ type: 'text', nullable: true })
  sewingRemindDate: string | null;

  @Column({ type: 'text', nullable: true })
  sewingStart: string | null;

  @Column({ type: 'text', nullable: true })
  sewingEnd: string | null;

  @Column({ type: 'text', default: '' })
  ironingStart: string;

  @Column({ type: 'text', default: '' })
  ironingEnd: string;

  @Column({ type: 'text', default: '' })
  printingStart: string;

  @Column({ type: 'text', default: '' })
  printingEnd: string;

  @Column({ type: 'text', default: '' })
  embroideryStart: string;

  @Column({ type: 'text', default: '' })
  embroideryEnd: string;

  @Column({ type: 'text', default: '' })
  templateStart: string;

  @Column({ type: 'text', default: '' })
  templateEnd: string;

  @Column({ type: 'integer', default: 1 })
  pipelineCount: number;

  @Column({ type: 'integer', default: 0 })
  isScheduled: number;

  @Column({ type: 'text', default: '' })
  workshop: string;

  @Column({ type: 'text', default: '' })
  lineTeam: string;

  @Column({ type: 'integer', default: 3 })
  priority: number;

  @Column({ type: 'integer', default: 0 })
  conflictFlag: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}