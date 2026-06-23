import { broadcastDispatchSaved, broadcastScheduleUpdated, broadcastProductionLineUpdated, broadcastUserPresence, broadcastConfigChanged } from './broadcast.util';

describe('broadcast helpers', () => {
  let mockServer: any;
  let events: Array<{ name: string; payload: any }>;

  beforeEach(() => {
    events = [];
    mockServer = {
      emit: (name: string, payload: any) => events.push({ name, payload }),
    };
  });

  it('broadcastDispatchSaved 发出 dispatch:saved', () => {
    broadcastDispatchSaved(mockServer, { id: 1, qty: 100 });
    expect(events).toEqual([{ name: 'dispatch:saved', payload: { id: 1, qty: 100 } }]);
  });

  it('broadcastScheduleUpdated 发出 schedule:updated', () => {
    broadcastScheduleUpdated(mockServer, { style_id: 5 });
    expect(events[0].name).toBe('schedule:updated');
  });

  it('broadcastProductionLineUpdated 发出 production-line:updated', () => {
    broadcastProductionLineUpdated(mockServer, { line_id: 3 });
    expect(events[0].name).toBe('production-line:updated');
  });

  it('broadcastUserPresence 发出 user:online/offline 带 ts', () => {
    broadcastUserPresence(mockServer, 'online', 7, 'admin');
    expect(events[0].name).toBe('user:online');
    expect(events[0].payload).toMatchObject({ userId: 7, username: 'admin' });
    expect(events[0].payload.ts).toBeGreaterThan(0);
  });

  it('broadcastConfigChanged 发出 config:changed', () => {
    broadcastConfigChanged(mockServer, 'busy_timeout');
    expect(events[0]).toEqual({
      name: 'config:changed',
      payload: expect.objectContaining({ key: 'busy_timeout' }),
    });
  });

  it('server 未初始化不抛错', () => {
    // 不抛异常即可
    expect(() => broadcastDispatchSaved(undefined as any, {})).not.toThrow();
  });
});