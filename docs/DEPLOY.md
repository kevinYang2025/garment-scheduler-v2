# 部署文档 — garment-scheduler-v2

> 适用版本: v2.0 (develop 分支)
> 部署目标: 工厂内网单机部署
> 最后更新: 2026-06-19

## 1. 部署架构

```
┌─────────────────────────────────────────────┐
│         Nginx (反代, HTTPS, 静态资源)         │
│         :443  ←  :80 自动跳转                 │
└────────────┬────────────────────────────────┘
             │
             ├─ /              → 前端 dist 静态文件
             ├─ /assets/*      → 前端 dist/assets
             └─ /api/*, /socket.io/* → Node.js 后端 :3001
                                       (内部监听 127.0.0.1)
                                                │
                                                ▼
                                       SQLite (WAL 模式)
                                       data.sqlite + .wal/.shm
                                       路径: /opt/garment/data/
                                       备份: 每天 02:00
```

## 2. 服务器要求

| 项 | 要求 | 备注 |
|---|---|---|
| OS | Windows Server 2019+ 或 Linux (Ubuntu 22.04 LTS 推荐) | |
| CPU | 2 核+ | 50 条产线并发场景 |
| RAM | 4 GB+ | SQLite 缓存 + Node.js heap |
| 磁盘 | 50 GB+ SSD | 数据库 + WAL + 备份 |
| Node.js | 20.x LTS | 必须 LTS,不要用 18 |
| 反向代理 | Nginx 1.24+ | Windows 可用 IIS ARR,但推荐 Nginx |
| HTTPS 证书 | 自签 / 内网 CA / 公共 CA | 浏览器信任即可 |

## 3. 环境变量 (.env)

**复制 `.env.example` 为 `.env`,填实际值。**

```bash
# 必填 - 认证
NODE_ENV=production
AUTH_ENABLED=true
SESSION_SECRET=<openssl rand -hex 32 生成的 64 字符串>
API_TOKEN=<openssl rand -hex 32>

# 可选 - 数据库
DB_PATH=/opt/garment/data/data.sqlite

# 可选 - 服务监听(默认 3001)
PORT=3001
HOST=127.0.0.1

# 可选 - 日志
LOG_LEVEL=info
```

**生成密钥命令**:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**关键点**:
- `NODE_ENV=production` 时若 `AUTH_ENABLED !== 'true'`,server 直接退出(server.js:48 硬保护)
- `SESSION_SECRET` 必须每次部署都不同,否则重启后所有 session 失效,用户需重新登录
- `.env` 在 `.gitignore` 中,**不要提交到仓库**

## 4. 首次部署

### 4.1 拉代码
```bash
cd /opt/garment
git clone https://github.com/kevinYang2025/garment-scheduler-v2.git app
cd app
git checkout develop
```

### 4.2 装依赖
```bash
cd garment-server && npm ci --omit=dev
cd ../garment-web && npm ci
```

### 4.3 构前端
```bash
cd garment-web
npm run build      # 产物在 dist/,由 Nginx 服务
```

### 4.4 初始化数据库
```bash
cd ../garment-server
# 复制 .env
cp ../../.env.example ../../.env  # 编辑填值
# 启动一次以自动建表 + 种子数据
node -e "require('./db').init()"   # 等价于首次启动时自动跑
# 19 个种子用户: admin/admin123, 其他 123456 / PIN 1234
# ⚠️ 首次部署后立即改 admin 密码 + 修改所有种子密码
```

### 4.5 配 Nginx

`/etc/nginx/sites-available/garment`:

```nginx
upstream garment_backend {
    server 127.0.0.1:3001;
    keepalive 16;
}

server {
    listen 80;
    server_name _;  # 改成你的域名/IP
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name _;

    ssl_certificate     /etc/nginx/ssl/garment.crt;
    ssl_certificate_key /etc/nginx/ssl/garment.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # 前端静态资源
    root /opt/garment/app/garment-web/dist;
    index index.html;

    # SPA fallback - 所有前端路由返回 index.html
    location / {
        try_files $uri $uri/ /index.html;
        expires 1h;
    }

    # 静态资源长期缓存(文件名带 hash)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 后端 API
    location /api/ {
        proxy_pass http://garment_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # Socket.IO
    location /socket.io/ {
        proxy_pass http://garment_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;   # 长连接
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/garment /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 5. 进程守护

### 5.1 PM2 (推荐 - 跨平台)

```bash
npm install -g pm2
```

`/opt/garment/ecosystem.config.cjs`:
```js
module.exports = {
  apps: [{
    name: 'garment-server',
    cwd: '/opt/garment/app/garment-server',
    script: 'server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      AUTH_ENABLED: 'true'
    },
    max_memory_restart: '512M',
    error_file: '/var/log/garment/error.log',
    out_file: '/var/log/garment/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    autorestart: true,
    cron_restart: '0 3 * * *',  // 每天凌晨 3 点重启清内存
  }]
};
```

启动:
```bash
mkdir -p /var/log/garment
pm2 start /opt/garment/ecosystem.config.cjs
pm2 save
pm2 startup    # 跟着提示设开机自启
```

### 5.2 Windows 服务 (NSSM)

如果用 Windows Server,推荐 NSSM:
```cmd
nssm install GarmentServer "C:\Program Files\nodejs\node.exe" "server.js"
nssm set GarmentServer AppDirectory "C:\AIsaving\plan management project\garment-server"
nssm set GarmentServer AppEnvironmentExtra NODE_ENV=production AUTH_ENABLED=true
nssm set GarmentServer DisplayName "Garment Server"
nssm start GarmentServer
```

## 6. 数据库备份

**SQLite 单文件,坏了就全没了。必须每天备份。**

### 6.1 Linux (cron + sqlite3 .backup)

`/opt/garment/scripts/backup.sh`:
```bash
#!/bin/bash
set -e
DB="/opt/garment/data/data.sqlite"
BACKUP_DIR="/opt/garment/backup"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# 用 sqlite3 .backup 而不是 cp -r (避免锁 + 拿到一致快照)
sqlite3 "$DB" ".backup '$BACKUP_DIR/data_${DATE}.sqlite'"

# 压缩
gzip "$BACKUP_DIR/data_${DATE}.sqlite"

# 保留最近 14 天
find "$BACKUP_DIR" -name "data_*.sqlite.gz" -mtime +14 -delete

echo "$(date) backup done: $BACKUP_DIR/data_${DATE}.sqlite.gz"
```

```bash
chmod +x /opt/garment/scripts/backup.sh
# crontab -e
0 2 * * * /opt/garment/scripts/backup.sh >> /var/log/garment/backup.log 2>&1
```

### 6.2 Windows (任务计划程序 + PowerShell)

`C:\AIsaving\backup\backup.ps1`:
```powershell
$dbPath = "C:\AIsaving\plan management project\garment-server\data.sqlite"
$backupDir = "C:\AIsaving\backup"
$date = Get-Date -Format "yyyyMMdd_HHmmss"
$dest = "$backupDir\data_$date.sqlite"

if (!(Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir }

# 用 sqlite3.exe .backup 命令 (更安全)
& sqlite3.exe $dbPath ".backup '$dest'"

# 压缩
Compress-Archive -Path $dest -DestinationPath "$dest.zip"
Remove-Item $dest

# 保留 14 天
Get-ChildItem $backupDir\data_*.zip | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } | Remove-Item

Write-Host "$(Get-Date) backup done: $dest.zip"
```

任务计划程序 → 创建任务 → 每天 02:00 触发 → 运行 powershell.exe -File `backup.ps1`

## 7. 健康检查

**Nginx 加健康检查 endpoint 或直接探 /api/auth/me**:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://your-domain/api/auth/me
# 401 表示服务在跑(未登录预期返回 401)
# 502/503 表示后端挂了
```

## 8. 监控告警 (可选)

最小监控脚本 (cron 每 5 分钟):
```bash
#!/bin/bash
URL="https://your-domain/api/auth/me"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" -k)
if [ "$CODE" != "401" ] && [ "$CODE" != "200" ]; then
  echo "[$(date)] ALERT: garment server returned $CODE" | mail -s "Garment Alert" admin@example.com
fi
```

## 9. 回滚方案

```bash
# 1. 回滚代码
cd /opt/garment/app
git log --oneline -5
git checkout <previous-good-commit>

# 2. 重启
pm2 restart garment-server

# 3. 必要时回滚数据库
cp /opt/garment/backup/data_<date>.sqlite.gz /tmp/
gunzip /tmp/data_<date>.sqlite.gz
# ⚠️ 停服再换
pm2 stop garment-server
cp /tmp/data_<date>.sqlite /opt/garment/data/data.sqlite
pm2 start garment-server

# 4. 通知用户清浏览器缓存 (Ctrl+Shift+R)
```

## 10. 上线检查清单

- [ ] `.env` 已配,`SESSION_SECRET` 是随机字符串
- [ ] `NODE_ENV=production`,`AUTH_ENABLED=true`
- [ ] server 启动日志显示 `Auth: ENABLED`,无 WARNING
- [ ] Nginx HTTPS 证书有效
- [ ] `/api/auth/me` 返回 401
- [ ] 备份脚本已配 cron,手动跑一次确认产物可用
- [ ] PM2 / NSSM 已配开机自启
- [ ] admin 密码已改,种子用户密码已重置
- [ ] smoke test 全部通过(见 SMOKE-TEST.md)