# 上线冒烟测试清单

> 部署后必跑一遍。每个用例给出"通过判定"和"快速验证 curl/UI 操作"。
> 顺序: 1→2→3→...,前一步失败不要继续。

## 0. 环境就绪

```bash
# 服务在跑 + 鉴权启用
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain/api/auth/me
# 期望: 401
```

- [ ] HTTPS 可访问首页
- [ ] 浏览器无证书警告
- [ ] 后端日志无 ERROR

## 1. 登录 / 会话

| # | 操作 | 期望 |
|---|---|---|
| 1.1 | 浏览器访问 `/login` | 看到登录页(双语) |
| 1.2 | 用 `admin` / `admin123` 登录 | 跳转到 `/dashboard`,顶栏显示"系统管理员" |
| 1.3 | F12 → Application → Cookies | 看到 `connect.sid` cookie,`HttpOnly=true`, `Secure=true`(HTTPS 下) |
| 1.4 | 点退出 | 回到 `/login`,cookie 清除 |
| 1.5 | 故意输错密码 5 次 | 第 6 次返回"登录尝试过于频繁" |
| 1.6 | 等 1 分钟后重试 | 可以登录 |
| 1.7 | 用 dispatcher 账号(`101` / PIN `1234`)登录 | 进入工作台,左侧导航只看到本车间菜单 |

## 2. 权限边界(关键安全用例)

| # | 操作者 | 操作 | 期望 |
|---|---|---|---|
| 2.1 | dispatcher (`101`) | 访问 `/system-config` 页面 | 403 / 跳转回首页 |
| 2.2 | dispatcher | 直接 curl `POST /api/styles` | 403 |
| 2.3 | dispatcher | 直接 curl `POST /api/auto-schedule` | 403 |
| 2.4 | planner | `POST /api/styles` 创建款式 | 200 |
| 2.5 | planner | `PUT /api/system-config/cutting_daily_capacity` | 403 |
| 2.6 | planning_manager | `PUT /api/system-config/cutting_daily_capacity` | 200 |
| 2.7 | admin | 任意写端点 | 200 |

curl 验证脚本:
```bash
# admin 登录
curl -s -X POST https://your-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<新密码>"}' \
  -c /tmp/c.txt

# dispatcher 登录
curl -s -X POST https://your-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"pin_no":"101","pin":"1234"}' \
  -c /tmp/c-d.txt

# 2.3 验证
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST https://your-domain/api/auto-schedule \
  -b /tmp/c-d.txt -H "Content-Type: application/json" -d '{}'
# 期望: 403
```

## 3. 款式管理

| # | 操作 | 期望 |
|---|---|---|
| 3.1 | 手动创建一个款式:`STYLE-T001` / product_name / plan_qty / due_date | 列表显示该款式 |
| 3.2 | Excel 导入 3 条款式 | 列表显示 3 条,无重复 |
| 3.3 | 编辑刚才创建的款式 | 字段更新,日志记录 |
| 3.4 | 删除款式 | 列表移除,日志记录 |
| 3.5 | 操作日志页面 | 看到创建/更新/删除记录 |

## 4. 主计划倒推

| # | 操作 | 期望 |
|---|---|---|
| 4.1 | 创建款式时填 due_date = 2026-07-31 | |
| 4.2 | 点"生成主计划" | 主计划自动算 cutting/sewing/secondary 起止日期 |
| 4.3 | 修改 system_config 的 `sewing_buffer_days` 为 20 | 重新生成主计划,sewing_start 提前 5 天 |
| 4.4 | 主计划列表打开,Socket.IO 实时推送 | 改任何一条立即广播 |

## 5. 自动排产

| # | 操作 | 期望 |
|---|---|---|
| 5.1 | 先确保有未排产款式 | `main_plan` 有 `is_scheduled = 0` |
| 5.2 | 进入排产策略页,新建/激活一个策略 | 策略列表显示 |
| 5.3 | 点"一键自动排产" | 弹进度,完成后看到 schedule_master 新增记录 |
| 5.4 | 数据库检查 | `SELECT COUNT(*) FROM schedule_master WHERE schedule_type='sewing'` > 0 |
| 5.5 | 多款式分类测试 | 同一分类被分配到不同产线(负载均衡) |

## 6. 缝制排程详情

| # | 操作 | 期望 |
|---|---|---|
| 6.1 | 进入缝制排程详情页 | 看到甘特图,显示 plan/actual/差异三行 |
| 6.2 | 修改某行 daily_target | 保存后甘特图立即更新 |
| 6.3 | 报工录入 50 件某日 | ACTUAL 行更新,差异减少 |

## 7. 仓库(注: 仓库功能 freeze,只跑基础流程)

| # | 操作 | 期望 |
|---|---|---|
| 7.1 | ASN 入库流程: 创建 → 到货确认 → 入库 | 库存数量增加 |
| 7.2 | DN 发货: 创建 → 拣货 → 发货 | 库存数量减少 |
| 7.3 | 库存查询 | 数据准确,无负数 |

## 8. 报工

| # | 操作 | 期望 |
|---|---|---|
| 8.1 | dispatcher 用 PIN 登录 | 看到本车间报工入口 |
| 8.2 | 录入 5 件某款式、某产线、某日 | 报工记录出现 |
| 8.3 | supervisor 复核通过 | 锁释放,数据进入 ACTUAL |
| 8.4 | 报工汇总页 | 数字与录入一致 |

## 9. 系统参数

| # | 操作者 | 操作 | 期望 |
|---|---|---|---|
| 9.1 | admin | 改 `default_daily_target` | 保存,刷新仍生效 |
| 9.2 | planning_manager | 改任意参数 | 同上 |
| 9.3 | planner | 尝试改 | 403 |
| 9.4 | 全部用户 | 查看参数 | 200,可见 |

## 10. 出货计划

| # | 操作 | 期望 |
|---|---|---|
| 10.1 | 创建出货计划 | 列表显示 |
| 10.2 | 修改状态 | 日志记录(`logOp`) |
| 10.3 | 删除 | 日志记录 |

## 11. 操作日志 + 排产日志

| # | 操作 | 期望 |
|---|---|---|
| 11.1 | 操作日志页 | 显示最近 50 条记录,含用户、操作类型、时间 |
| 11.2 | 按用户筛选 | 仅显示该用户操作 |
| 11.3 | 排产日志 | 看到 auto-schedule 的策略、款式数、跳过原因 |

## 12. 性能 & 稳定性

| # | 操作 | 期望 |
|---|---|---|
| 12.1 | 连续刷新 dashboard 10 次 | 总耗时 < 3 秒(achievement-rate 有缓存) |
| 12.2 | F12 → Network → achievement-rate | 第二次起响应头有 `X-Cache: HIT` |
| 12.3 | 多浏览器同时打开(3+ 个) | Socket.IO 推送不漏数据 |
| 12.4 | 长时间挂机 1 小时 | 不掉线(session rolling) |

## 13. 安全硬测试

| # | 操作 | 期望 |
|---|---|---|
| 13.1 | 删除 cookie 后访问受保护页面 | 跳 `/login`(**不是 window.location 全刷**) |
| 13.2 | 搜索款式输入 `100%` | 不会匹配所有 100 开头的款 |
| 13.3 | SQL 注入尝试: `style_no=' OR 1=1 --` | 返回空结果或 400 |
| 13.4 | 上传 10MB base64 头像 | 400 "头像文件过大" |

## 14. 数据完整性

| # | 操作 | 期望 |
|---|---|---|
| 14.1 | 检查 `data.sqlite-wal` 文件存在 | 是(WAL 模式正常) |
| 14.2 | 手动跑备份脚本 | 产物可解压,`sqlite3 data.sqlite "PRAGMA integrity_check"` 返回 `ok` |
| 14.3 | 备份恢复测试(在测试库) | 业务数据完整 |

## 通过判定

- 全部用例通过 → 上线成功
- 任一 HIGH 用例(权限 / 安全 / 备份恢复)失败 → **回滚**
- 仅 MEDIUM/LOW 失败 → 记录 issue,带病上线但 7 天内修

## 测试记录模板

| 用例 | 测试人 | 时间 | 结果 | 备注 |
|---|---|---|---|---|
| 1.1 登录 | | | ☐ | |
| 1.2 admin 登录 | | | ☐ | |
| ... | | | | |