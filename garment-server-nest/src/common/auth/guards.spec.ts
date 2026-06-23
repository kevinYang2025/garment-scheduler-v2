import { AuthGuard } from './auth.guard';
import { RoleGuard } from './role.guard';
import { WorkshopGuard } from './workshop.guard';
import { ROLES_METADATA_KEY } from './role.decorator';
import { ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';

/**
 * 构造一个 mock ExecutionContext,带可控的 req
 * 用 plain object mock,避免 ts-jest 编译时 class 语法问题
 */
function makeCtx(req: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => () => {},
    }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any as ExecutionContext;
}

describe('AuthGuard', () => {
  const guard = new AuthGuard();

  it('session.user 存在 → 通过,设置 req.user', () => {
    const req: any = { session: { user: { id: 1, role: 'admin' } } };
    expect(guard.canActivate(makeCtx(req))).toBe(true);
    expect(req.user).toEqual({ id: 1, role: 'admin' });
  });

  it('req.user 已存在(API token 中间件注入)→ 通过', () => {
    const req: any = { user: { id: 2, role: 'planner' } };
    expect(guard.canActivate(makeCtx(req))).toBe(true);
  });

  it('未登录 → 抛 UnauthorizedException', () => {
    const req: any = {};
    expect(() => guard.canActivate(makeCtx(req))).toThrow(UnauthorizedException);
  });

  it('session 存在但 user 不存在 → 401', () => {
    const req: any = { session: {} };
    expect(() => guard.canActivate(makeCtx(req))).toThrow(UnauthorizedException);
  });
});

describe('RoleGuard', () => {
  function makeRoleGuard(roles: string[] | undefined) {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_METADATA_KEY ? roles : undefined),
    };
    return new RoleGuard(reflector as any);
  }

  it('无 @Roles 装饰器 → 任何已登录用户通过', () => {
    const guard = makeRoleGuard(undefined);
    const ctx = makeCtx({ user: { role: 'planner' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Roles("admin") admin 通过', () => {
    const guard = makeRoleGuard(['admin']);
    const ctx = makeCtx({ user: { role: 'admin' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Roles("planner") planner 通过', () => {
    const guard = makeRoleGuard(['planner']);
    const ctx = makeCtx({ user: { role: 'planner' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Roles("admin","planner") 普通 user 拒绝', () => {
    const guard = makeRoleGuard(['admin', 'planner']);
    const ctx = makeCtx({ user: { role: 'dispatcher' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('未登录 → 401', () => {
    const guard = makeRoleGuard(['admin']);
    const ctx = makeCtx({});
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });

  it('admin bypass 所有角色检查', () => {
    const guard = makeRoleGuard(['anyrole']);
    const ctx = makeCtx({ user: { role: 'admin' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('WorkshopGuard', () => {
  function makeWsGuard() {
    return new WorkshopGuard({ getAllAndOverride: () => null } as any);
  }

  it('admin 不受 workshop 限制', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'admin', workshop: null }, query: { workshop: 'cutting' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('同 workshop → 通过', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'cutting' }, query: { workshop: 'cutting' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('不同 workshop → 403', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'cutting' }, query: { workshop: 'sewing' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('secondary 可管 printing/embroidery/template', () => {
    const guard = makeWsGuard();
    for (const target of ['printing', 'embroidery', 'template']) {
      const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'secondary' }, query: { workshop: target } });
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });

  it('secondary 不可管 ironing', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'secondary' }, query: { workshop: 'ironing' } });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('body 里的 workshop 也能校验', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'sewing' }, body: { workshop: 'sewing' } });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('请求无 workshop 字段 → 不限制', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ user: { role: 'supervisor', workshop: 'cutting' }, query: {}, body: {} });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('未登录 → 401', () => {
    const guard = makeWsGuard();
    const ctx = makeCtx({ query: { workshop: 'cutting' } });
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
  });
});