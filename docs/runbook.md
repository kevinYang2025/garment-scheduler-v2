# Operations Runbook — garment-scheduler-v2

> 7 个最常见运维场景。SSH 进服务器(deploy 用户)即可处理大部分问题。
> 服务器地址:见 [SECRETS.md](./SECRETS.md)
> 监控: UptimeRobot → `https://garment.example.com/api/health`

---

## 1. 服务挂了

**症状**: UptimeRobot 告警 / 用户反馈打不开 / `/api/health` 不返 200

```bash
# 看 pm2 状态
pm2 status
pm2 logs garment-server --lines 100 --err

# 重启
pm2 restart garment-server

# 还不行,看 Nginx
sudo nginx -t
sudo systemctl status nginx
sudo tail -50 /opt/garment/logs/nginx-error.log
```

---

## 2. 回滚到上一个版本

代码出问题(新功能坏了),但 DB 不能动:

```bash
# 1) 看有哪些 release 快照
ls -lht /opt/garment/backups/releases/ | head -10

# 2) 选一个时间戳(最新之前的那个)
TARGET=20260618_153012Z
ls /opt/garment/backups/releases/$TARGET/

# 3) 替换代码(只动 server.js,不动 DB)
sudo cp -a /opt/garment/backups/releases/$TARGET/server.js \
            /opt/garment/app/garment-scheduler-v2/garment-server/server.js
sudo cp -a /opt/garment/backups/releases/$TARGET/db.js \
            /opt/garment/app/garment-scheduler-v2/garment-server/db.js

# 4) 重载
pm2 reload garment-server
curl -fsS http://127.0.0.1:3001/api/health
```

前端回滚(几乎用不到,前端不稳一般刷新就好):
```bash
ls -lht /opt/garment/app/garment-scheduler-v2/garment-web/dist.*/ | head -3
# 把 dist 软链切到上一个时间戳(直接改 /etc/nginx/sites-available/garment 的 root 重启 nginx 也行)
```

---

## 3. 数据库恢复

**只在严重数据损坏时用**。要先停服,否则会丢写入。

```bash
# 1) 找出最近的可用备份
ls -lht /opt/garment/backups/data_*.sqlite.gz | head -5
BACKUP=/opt/garment/backups/data_20260618_021500Z.sqlite.gz

# 2) 校验完整性(必须 ok 才能用)
gunzip -c "$BACKUP" | sqlite3 ":memory:" "PRAGMA integrity_check;"
# 期望最后一行: ok

# 3) 停服
pm2 stop garment-server

# 4) 把损坏的 DB 备份到一旁(不直接删,留后路)
mv /opt/garment/data/data.sqlite /opt/garment/data/data.sqlite.broken-$(date +%s)
mv /opt/garment/data/data.sqlite-wal /opt/garment/data/data.sqlite-wal.broken-$(date +%s) 2>/dev/null || true
mv /opt/garment/data/data.sqlite-shm /opt/garment/data/data.sqlite-shm.broken-$(date +%s) 2>/dev/null || true

# 5) 解压备份
gunzip -k "$BACKUP"
cp "${BACKUP%.gz}" /opt/garment/data/data.sqlite
chown deploy:deploy /opt/garment/data/data.sqlite

# 6) 启动 + 验证
pm2 start garment-server
sleep 2
curl -fsS http://127.0.0.1:3001/api/health
```

---

## 4. 紧急重置 admin 密码

UI 找不到入口,或者 admin 也登不上了:

```bash
cd /opt/garment/app/garment-scheduler-v2/garment-server
node -e "
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const db = new Database('/opt/garment/data/data.sqlite');
const newHash = bcrypt.hashSync('NEW_PASSWORD_HERE', 10);
const result = db.prepare(\"UPDATE users SET password_hash = ? WHERE username = 'admin'\").run(newHash);
console.log('updated rows:', result.changes);
"
pm2 reload garment-server
```

⚠️ 操作完成后:
1. 立即把新密码告诉 owner(通过 1Password/电话,**不**通过聊天软件发)
2. owner 登入后立即改 UI 密码 + 启用 2FA(如果有的话)
3. 从服务器历史记录里清掉命令行(`history -c` 或直接 `~/.bash_history` 删对应行)

---

## 5. 手动备份

`cron.d/garment-backup` 已经每天 02:15 自动跑,但有时你想立刻跑:

```bash
sudo -u deploy bash /opt/garment/scripts/backup.sh
# 期望: [backup] OK: /opt/garment/backups/data_20260619_xxx.sqlite.gz (6.2M)

# 校验
LATEST=$(ls -t /opt/garment/backups/data_*.sqlite.gz | head -1)
gunzip -c "$LATEST" | sqlite3 ":memory:" "PRAGMA integrity_check;"
```

---

## 6. 重新签发 Cloudflare Origin Certificate

证书到期(15 年后)或者服务器被攻破:

1. Cloudflare 控制台 → SSL/TLS → Origin Server → Create Certificate
2. 覆盖 `*.garment.example.com` + `garment.example.com`
3. 保存新 PEM 到 `/etc/nginx/ssl/origin.crt` + `origin.key`
4. `sudo chmod 600 /etc/nginx/ssl/origin.key`
5. `sudo nginx -t && sudo systemctl reload nginx`
6. `curl -vI https://garment.example.com 2>&1 | grep -i 'subject\|issuer'`

---

## 7. 升级 Node.js

大版本升级(20 → 22)或 minor patch:

```bash
# 1) 升级 Node(以 22 为例)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # 确认新版本

# 2) 重新编译 better-sqlite3 native binding
cd /opt/garment/app/garment-scheduler-v2/garment-server
sudo -u deploy npm rebuild better-sqlite3

# 3) 重载
pm2 reload garment-server
curl -fsS http://127.0.0.1:3001/api/health

# 4) 验证 Socket.IO 没坏
# 浏览器打开 UI 看实时数据有没有推送
```

---

## 8. 磁盘满了

```bash
# 看什么占空间
sudo du -sh /opt/garment/* | sort -h | tail -10

# 清理旧 dist
ls -1dt /opt/garment/app/garment-scheduler-v2/garment-web/dist.*/ | tail -n +4 | xargs -r rm -rf

# 清理旧 release 快照(保留最近 3 个)
ls -1dt /opt/garment/backups/releases/*/ | tail -n +4 | xargs -r rm -rf

# 清理旧 DB 备份(>14 天)
find /opt/garment/backups -name 'data_*.sqlite.gz' -mtime +14 -delete

# 清理 pm2 日志(pm2-logrotate 已经自动,但保险起见)
find /opt/garment/logs -name '*.gz' -mtime +30 -delete

# 强制 WAL checkpoint
sqlite3 /opt/garment/data/data.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
```

---

## 9. 工厂网络出问题了: 计划员打不开

```bash
# 1) 服务器自己能开吗?
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://garment.example.com/api/health   # 从服务器 curl 自己,绕过 CF

# 2) 公网能开吗?(从家里电脑跑)
curl -I https://garment.example.com/api/health

# 3) Cloudflare 状态
# https://www.cloudflarestatus.com/

# 4) ECS 公网 IP 通不通?
ping <ECS_IP>

# 5) UFW 是不是挡了?
sudo ufw status verbose

# 6) 临时跳 CF 测试: 在 Cloudflare DNS → Records → 关闭代理(灰色云朵)→ 直接走 ECS 公网
#    测试 OK 后开回代理
```

---

## 10. 添加新计划员账号

**走 UI**(admin 账号 → 用户管理 → 新增),不要 SSH 改 SQLite。

如果 UI 也有问题,临时命令行加:
```bash
cd /opt/garment/app/garment-scheduler-v2/garment-server
node -e "
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const db = new Database('/opt/garment/data/data.sqlite');
const hash = bcrypt.hashSync('NEW_USER_PASSWORD', 10);
db.prepare(\"INSERT INTO users (username, password_hash, role, full_name, created_at) VALUES (?, ?, 'planner', ?, datetime('now'))\")
  .run('newusername', hash, '真实姓名');
console.log('created');
"
```

⚠️ 角色(role)可选:`admin` / `planning_manager` / `planner` / `dispatcher`,不在此列会插失败。先 `sqlite3 ... ".schema users"` 看现有 role 约定。
