import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * users 表
 *
 * 与 garment-server/db.js CREATE TABLE users + ALTER ADD (avatar_url/username_km/display_name_km) 完全一致
 * 表结构不在 NestJS 端创建(Express db.js 已建),NestJS 只读不写 schema
 *
 * 字段对照:
 *   id                INTEGER PK
 *   username          TEXT UNIQUE — 账号
 *   username_km       TEXT — 高棉文账号(dispatcher)
 *   pin               TEXT — 4 位 PIN(dispatcher 用)
 *   password_hash     TEXT — bcrypt 哈希
 *   display_name      TEXT NOT NULL — 中文姓名
 *   display_name_km   TEXT — 高棉文姓名
 *   role              TEXT CHECK(admin/planning_manager/planner/dispatcher/supervisor)
 *   workshop          TEXT CHECK(cutting/printing/embroidery/template/ironing/sewing)
 *   active            INTEGER DEFAULT 1 — 软删除
 *   avatar_url        TEXT
 *   created_at        TEXT DEFAULT (datetime('now','localtime'))
 *   updated_at        TEXT DEFAULT (datetime('now','localtime'))
 */

export type UserRole = 'admin' | 'planning_manager' | 'planner' | 'dispatcher' | 'supervisor';
export type Workshop = 'cutting' | 'printing' | 'embroidery' | 'template' | 'ironing' | 'sewing';

@Entity({ name: 'users' })
@Index('idx_users_username', ['username'], { unique: true })
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  username: string;

  @Column({ type: 'text', nullable: true, name: 'username_km' })
  usernameKm: string | null;

  /** 4 位 PIN(dispatcher 用),NULL 表示无 PIN */
  @Column({ type: 'text', nullable: true })
  pin: string | null;

  /** bcrypt 哈希;NULL 表示无密码(只用 PIN 登录) */
  @Column({ type: 'text', nullable: true, name: 'password_hash' })
  passwordHash: string | null;

  @Column({ type: 'text', name: 'display_name' })
  displayName: string;

  @Column({ type: 'text', nullable: true, name: 'display_name_km' })
  displayNameKm: string | null;

  @Column({ type: 'text' })
  role: UserRole;

  @Column({ type: 'text', nullable: true })
  workshop: Workshop | null;

  @Column({ type: 'integer', default: 1 })
  active: number;

  @Column({ type: 'text', nullable: true, name: 'avatar_url' })
  avatarUrl: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}