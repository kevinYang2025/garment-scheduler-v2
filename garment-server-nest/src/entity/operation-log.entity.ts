import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * operation_logs 表 — 操作日志
 *
 * 与 garment-server/db.js 中 CREATE TABLE operation_logs + ALTER ADD user_id 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建,共享),NestJS 只读不写 schema
 *
 * 注:Phase 2 表无索引(Express db.js 也没建),Phase 9 评估是否补加 idx_user_id / idx_created_at
 */
@Entity({ name: 'operation_logs' })
export class OperationLog {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  module: string;

  @Column({ type: 'text' })
  action: string;

  @Column({ type: 'integer', nullable: true, name: 'target_id' })
  targetId: number | null;

  @Column({ type: 'text', default: '' })
  targetName: string;

  @Column({ type: 'text', default: '' })
  detail: string;

  /** 历史遗留字段,默认为 'YC',新代码用 userId。B2-4 修复:改为 nullable */
  @Column({ type: 'text', default: 'YC', nullable: true })
  operator: string | null;

  @Column({ type: 'integer', nullable: true, name: 'user_id' })
  userId: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}