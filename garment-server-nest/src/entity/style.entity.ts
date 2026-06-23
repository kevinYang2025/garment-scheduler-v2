import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * styles 表 — 款式
 *
 * 与 garment-server/db.js CREATE TABLE styles + 多个 ALTER ADD 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建),NestJS 只读不写 schema
 *
 * 字段对照:
 *   id                          INTEGER PK
 *   style_no                    TEXT NOT NULL
 *   product_name                TEXT
 *   fabric_code                 TEXT
 *   plan_qty                    INTEGER DEFAULT 0
 *   due_date                    TEXT
 *   order_date                  TEXT
 *   embroidery_printing         TEXT(老字段,新代码已拆成 embroidery/printing)
 *   embroidery                  TEXT
 *   printing                    TEXT
 *   ironing_label               TEXT(烫标)
 *   template                    TEXT(模板)
 *   tt_time                     TEXT(TT 时间)
 *   target_daily_output         INTEGER DEFAULT 0(默认日产)
 *   production_lines            INTEGER DEFAULT 0
 *   remarks                     TEXT
 *   category                    TEXT(legacy)
 *   color                       TEXT(legacy)
 *   size_spec                   TEXT(legacy)
 *   customer                    TEXT(legacy)
 *   secondary_types             TEXT(legacy)
 *   status                      TEXT DEFAULT '待排'
 *   priority                    INTEGER DEFAULT 3(ALTER 新增)
 *   style_category              TEXT(ALTER 新增,款式分类)
 *   has_special_wash            INTEGER DEFAULT 0(特殊水洗,ALTER 新增)
 *   embroidery_daily_output     INTEGER DEFAULT 0(ALTER 新增)
 *   printing_daily_output       INTEGER DEFAULT 0(ALTER 新增)
 *   ironing_daily_output        INTEGER DEFAULT 0(ALTER 新增)
 *   template_daily_output       INTEGER DEFAULT 0(ALTER 新增)
 *   created_at                  TEXT DEFAULT (datetime('now','localtime'))
 *
 * 注:同一 style_no 可有多条(同一款多订单),所以无 UNIQUE 索引
 * 索引由 Express db.js 不建,Phase 9 评估是否加 idx_style_no / idx_due_date
 */

@Entity({ name: 'styles' })
@Index('idx_styles_style_no', ['styleNo'])
@Index('idx_styles_due_date', ['dueDate'])
export class Style {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  styleNo: string;

  @Column({ type: 'text', default: '' })
  productName: string;

  @Column({ type: 'text', default: '' })
  fabricCode: string;

  @Column({ type: 'integer', default: 0 })
  planQty: number;

  @Column({ type: 'text', nullable: true })
  dueDate: string | null;

  @Column({ type: 'text', default: '' })
  orderDate: string;

  @Column({ type: 'text', default: '' })
  embroideryPrinting: string;

  @Column({ type: 'text', default: '' })
  embroidery: string;

  @Column({ type: 'text', default: '' })
  printing: string;

  @Column({ type: 'text', default: '' })
  ironingLabel: string;

  @Column({ type: 'text', default: '' })
  template: string;

  @Column({ type: 'text', default: '' })
  ttTime: string;

  @Column({ type: 'integer', default: 0 })
  targetDailyOutput: number;

  @Column({ type: 'integer', default: 0 })
  productionLines: number;

  @Column({ type: 'text', default: '' })
  remarks: string;

  // Legacy
  @Column({ type: 'text', default: '' })
  category: string;

  @Column({ type: 'text', default: '' })
  color: string;

  @Column({ type: 'text', default: '' })
  sizeSpec: string;

  @Column({ type: 'text', default: '' })
  customer: string;

  @Column({ type: 'text', default: '' })
  secondaryTypes: string;

  @Column({ type: 'text', default: '待排' })
  status: string;

  // ALTER 新增
  @Column({ type: 'integer', default: 3 })
  priority: number;

  @Column({ type: 'text', default: '' })
  styleCategory: string;

  @Column({ type: 'integer', default: 0 })
  hasSpecialWash: number;

  @Column({ type: 'integer', default: 0 })
  embroideryDailyOutput: number;

  @Column({ type: 'integer', default: 0 })
  printingDailyOutput: number;

  @Column({ type: 'integer', default: 0 })
  ironingDailyOutput: number;

  @Column({ type: 'integer', default: 0 })
  templateDailyOutput: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}