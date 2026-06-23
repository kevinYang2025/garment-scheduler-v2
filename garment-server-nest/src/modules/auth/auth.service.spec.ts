import { Test } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../../entity/user.entity';
import { OperationLog } from '../../entity/operation-log.entity';
import { AuthService } from './auth.service';
import { OperationLoggerService } from '../../common/logger/operation-logger.service';

/**
 * AuthService 单元测试(用 :memory: SQLite)
 *
 * 覆盖:
 *   - 账号+密码登录(正确/错误/不存在)
 *   - 工号+PIN 登录
 *   - 改密(成功/旧密码错/密码太短)
 *   - me(返回最新 user 信息)
 */

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: Repository<User>;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [User, OperationLog],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, OperationLog]),
      ],
      providers: [AuthService, OperationLoggerService],
    }).compile();

    service = moduleRef.get(AuthService);
    userRepo = moduleRef.get(getRepositoryToken(User));
  });

  async function seedUser(opts: Partial<User> & { username: string }) {
    const hash = bcrypt.hashSync(opts.passwordHash ?? 'pass1234', 4);
    const pin = opts.pin ? bcrypt.hashSync(opts.pin, 4) : null;
    const user = userRepo.create({
      username: opts.username,
      passwordHash: opts.username === 'no_password_user' ? null : hash,
      pin,
      displayName: opts.username,
      role: opts.role ?? 'admin',
      workshop: opts.workshop ?? null,
      active: opts.active ?? 1,
    });
    return userRepo.save(user);
  }

  describe('login', () => {
    it('账号+密码 正确 → 返回 user', async () => {
      await seedUser({ username: 'admin', passwordHash: 'secret123' });
      const r = await service.login('admin', 'secret123');
      expect(r.user.username).toBe('admin');
      expect(r.user.role).toBe('admin');
    });

    it('账号不存在 → 401', async () => {
      await expect(service.login('nope', 'x')).rejects.toMatchObject({
        status: 401,
      });
    });

    it('密码错 → 401', async () => {
      await seedUser({ username: 'admin', passwordHash: 'secret123' });
      await expect(service.login('admin', 'wrong')).rejects.toMatchObject({ status: 401 });
    });

    it('active=0 用户 → 401', async () => {
      await seedUser({ username: 'disabled', passwordHash: 'x', active: 0 });
      await expect(service.login('disabled', 'x')).rejects.toMatchObject({ status: 401 });
    });

    it('用户无 password_hash → 401 (no_password)', async () => {
      await seedUser({ username: 'no_password_user' });
      await expect(service.login('no_password_user', 'x')).rejects.toMatchObject({ status: 401 });
    });

    it('工号+PIN 正确(dispatcher) → 返回 user', async () => {
      await seedUser({
        username: 'worker1',
        passwordHash: null,
        pin: '1234',
        role: 'dispatcher',
      });
      const r = await service.login(undefined, undefined, 'worker1', '1234');
      expect(r.user.username).toBe('worker1');
    });

    it('工号+PIN 角色非 dispatcher → 401', async () => {
      await seedUser({
        username: 'admin_pin',
        passwordHash: null,
        pin: '1234',
        role: 'admin',
      });
      await expect(
        service.login(undefined, undefined, 'admin_pin', '1234'),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('工号+PIN 错 → 401', async () => {
      await seedUser({
        username: 'worker2',
        passwordHash: null,
        pin: '1234',
        role: 'dispatcher',
      });
      await expect(
        service.login(undefined, undefined, 'worker2', '9999'),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('账号密码 + 工号PIN 都缺 → 400', async () => {
      await expect(service.login()).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('changePassword', () => {
    it('成功改密,新 hash 不等于旧', async () => {
      const u = await seedUser({ username: 'admin', passwordHash: 'old123456' });
      await service.changePassword(u.id, 'old123456', 'new123456');
      const after = await userRepo.findOneByOrFail({ id: u.id });
      expect(bcrypt.compareSync('new123456', after.passwordHash!)).toBe(true);
      expect(bcrypt.compareSync('old123456', after.passwordHash!)).toBe(false);
    });

    it('旧密码错 → 401', async () => {
      const u = await seedUser({ username: 'admin', passwordHash: 'old' });
      await expect(
        service.changePassword(u.id, 'wrong', 'new123456'),
      ).rejects.toMatchObject({ status: 401 });
    });

    it('新密码 < 6 位 → 400', async () => {
      const u = await seedUser({ username: 'admin', passwordHash: 'old123456' });
      await expect(
        service.changePassword(u.id, 'old123456', '12345'),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('无 password_hash 用户 → 400', async () => {
      const u = await seedUser({ username: 'no_password_user' });
      await expect(
        service.changePassword(u.id, 'anything', 'new123456'),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('me', () => {
    it('返回 session 用户最新信息', async () => {
      const u = await seedUser({
        username: 'admin',
        passwordHash: 'x',
        role: 'planning_manager',
        workshop: 'cutting',
      });
      const r = await service.me({ id: u.id, username: u.username, role: 'admin', workshop: null, displayName: u.displayName });
      expect(r.role).toBe('planning_manager');
      expect(r.workshop).toBe('cutting');
    });
  });
});