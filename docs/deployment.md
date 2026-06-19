# Cloud Deployment — garment-scheduler-v2

> 适用: 阿里云 ECS 香港 / AWS Singapore / Cloudflare 代理
> 工厂内网单机部署参见 [DEPLOY.md](./DEPLOY.md),本文档只覆盖云端特有部分
> 最后更新: 2026-06-19

## 0. 准备

- 一个域名(本例 `garment.example.com`,请替换)
- Cloudflare 账号(免费层即可)
- 阿里云账号
- GitHub 仓库 admin 权限(配 Secrets)

## 1. 阿里云 ECS 选购

| 项 | 推荐 |
|---|---|
| 实例 | 共享型 s6,2 vCPU / 4 GB RAM / 40 GB SSD |
| 镜像 | Ubuntu 22.04 LTS 64位 |
| 带宽 | 5 Mbps BGP(3 用户够用) |
| 区域 | 中国(香港) |
| 可用区 | 香港 B |
| 安全组 | 入方向:22/80/443 全开,或限制为公司公网 IP |

购买后:
1. 控制台 → ECS → 重置实例密码 → 设置 deploy 用户的初始密码(临时)
2. 通过 Workbench / VNC 第一次连入
3. 把 owner 的 SSH 公钥发给服务器(粘到 `~/.ssh/authorized_keys`,第一次手工即可)

## 2. 跑 bootstrap.sh

从本仓库拷贝 `scripts/bootstrap.sh` 到服务器并执行:

```bash
# 在本地:rsync 给服务器
rsync -avz scripts/bootstrap.sh deploy@<ECS_IP>:/tmp/
ssh deploy@<ECS_IP>
chmod +x /tmp/bootstrap.sh && sudo bash /tmp/bootstrap.sh
```

bootstrap.sh 会做:
- 装 apt 包、设时区 Asia/Phnom_Penh
- 加 deploy 用户、SSH 加固、UFW 防火墙、fail2ban
- 装 Node.js 20 + pm2 + pm2-logrotate
- 建 `/opt/garment/{app,data,backups,logs,scripts,env}` 目录
- 装 `/etc/cron.d/garment-backup`(每日备份 + 5 分钟 watchdog)
- 配置 pm2 systemd 自启

## 3. Cloudflare 配置

### 3.1 域名解析
1. Cloudflare 控制台 → 添加站点 `example.com`(假设你已有域名托管在 CF)
2. DNS → Records → 添加:
   - 类型 `A`, 名称 `garment`, 内容 `<ECS 公网 IP>`, 代理状态**开启**(橙色云朵)
3. SSL/TLS → Overview → 模式选 **Full (Strict)**
4. SSL/TLS → Edge Certificates → 启用:
   - Always Use HTTPS
   - Minimum TLS Version: TLS 1.2
   - HSTS: max-age 12 个月 + includeSubDomains + preload
5. (可选) hstspreload.org 提交域名

### 3.2 Origin Certificate
1. SSL/TLS → Origin Server → Create Certificate
2. 选 `*.garment.example.com` 和 `garment.example.com`,有效期 15 年
3. 把 PEM 块分别保存为:
   ```
   /etc/nginx/ssl/origin.crt
   /etc/nginx/ssl/origin.key
   ```
4. `chmod 600 /etc/nginx/ssl/origin.key`

### 3.3 WAF & 缓存
- Security → WAF → Managed Rules: 启用 Cloudflare Managed Ruleset(免费层含基础集)
- Security → WAF → Custom Rules 加 3 条:
  1. `(http.request.uri.path contains "/.env") or (http.request.uri.path contains "/wp-admin") or (http.request.uri.path contains "/phpmyadmin")` → Block
  2. `(http.user_agent contains "masscan") or (http.user_agent contains "zgrab") or (cf.client.bot eq false and http.user_agent eq "")` → Managed Challenge
  3. `(starts_with(http.request.uri.path, "/api/auth/login")) and (rate > 5 in 5 minutes)` → Challenge
- Security → Bots → Bot Fight Mode: 开启(免费)
- Caching → Cache Rules:
  1. `(starts_with(http.request.uri.path, "/api/")) or (starts_with(http.request.uri.path, "/socket.io/"))` → **Bypass cache**
  2. `(http.request.uri.path matches "^/assets/.*$")` → Cache eligible, Edge TTL 1y, Browser TTL 1y
  3. 默认 → Bypass

## 4. 服务器端首次部署

### 4.1 拉代码
```bash
sudo -u deploy git clone https://github.com/kevinYang2025/garment-scheduler-v2.git /opt/garment/app/garment-scheduler-v2
cd /opt/garment/app/garment-scheduler-v2
sudo -u deploy git checkout master
```

### 4.2 装依赖
```bash
cd /opt/garment/app/garment-scheduler-v2/garment-server
sudo -u deploy npm ci --omit=dev
cd ../garment-web
sudo -u deploy npm ci
sudo -u deploy npm run build
```

### 4.3 创建生产环境变量
```bash
sudo -u deploy bash -c '
API_TOKEN=$(openssl rand -hex 32)
SESSION_SECRET=$(openssl rand -hex 32)
cat > /opt/garment/env/garment.env <<EOF
NODE_ENV=production
AUTH_ENABLED=true
API_TOKEN=$API_TOKEN
SESSION_SECRET=$SESSION_SECRET
CORS_ORIGINS=https://garment.example.com
PORT=3001
HOST=127.0.0.1
EOF
chmod 600 /opt/garment/env/garment.env
'
cat /opt/garment/env/garment.env  # 确认值已替换
```

⚠️ 把这两个密钥备份到 1Password / LastPass(见 [SECRETS.md](./SECRETS.md))

### 4.4 首次启动 pm2
```bash
sudo -u deploy bash -c '
cd /opt/garment/app/garment-scheduler-v2/garment-server
pm2 start ecosystem.config.js
pm2 save
'
sudo systemctl enable pm2-deploy   # 开机自启
sudo systemctl start pm2-deploy
```

验证:
```bash
sudo -u deploy pm2 status
curl -fsS http://127.0.0.1:3001/api/health
# 期望: {"ok":true,"ts":...,"uptime":...,"auth":true,"node_env":"production"}
```

### 4.5 部署 Nginx 配置
```bash
# 把仓库的 scripts/nginx-garment.conf 拷贝到服务器
sudo cp /opt/garment/app/garment-scheduler-v2/scripts/nginx-garment.conf /etc/nginx/sites-available/garment
sudo ln -s /etc/nginx/sites-available/garment /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

验证:
```bash
curl -fsS https://garment.example.com/api/health
# 期望: {"ok":true,...}(200 OK,经 Cloudflare 边缘)
```

### 4.6 手动备份验证
```bash
sudo -u deploy bash /opt/garment/scripts/backup.sh
ls -lht /opt/garment/backups/data_*.sqlite.gz | head -1
sqlite3 /opt/garment/backups/data_*.sqlite.gz "PRAGMA integrity_check;"
# 期望: ok
```

## 5. GitHub 配置

### 5.1 仓库 Secrets
进入 GitHub → 仓库 → Settings → Secrets and variables → Actions → New repository secret:

| Name | 示例值 |
|---|---|
| `DEPLOY_HOST` | `garment.example.com` |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_SSH_KEY` | (deploy 用户私钥全文,含 BEGIN/END 行) |
| `DEPLOY_PORT` | `22`(可选) |
| `DEPLOY_WEBHOOK_URL` | (Discord/Slack Webhook URL,可选) |

### 5.2 SSH 密钥
在 owner 本地生成 deploy 专用 key(不要用 owner 自己的私钥):
```bash
ssh-keygen -t ed25519 -C "github-deploy-garment" -f ~/.ssh/garment-deploy
# 公钥写到服务器的 /home/deploy/.ssh/authorized_keys
cat ~/.ssh/garment-deploy.pub | ssh deploy@<ECS_IP> "cat >> ~/.ssh/authorized_keys"
# 私钥(~/.ssh/garment-deploy)全文复制到 GitHub Secrets 的 DEPLOY_SSH_KEY
```

### 5.3 触发部署
合并 PR 到 master → Actions 自动跑 build + deploy。
或在 Actions tab → Deploy workflow → Run workflow 手动触发。

## 6. 验收清单

部署完成必跑:
- [ ] `curl -fsS https://garment.example.com/api/health` → 200
- [ ] 浏览器登录 → 主计划 → 排程视图 正常
- [ ] DevTools → Network → WS 看到 `/socket.io/` 101 Switching Protocols
- [ ] `curl -I https://garment.example.com/` 看到 HSTS / X-Frame-Options / CSP 头
- [ ] 手动 `backup.sh` 跑通 + `PRAGMA integrity_check` 返 `ok`
- [ ] UptimeRobot 配置监控 `https://garment.example.com/api/health`(间隔 5 分钟)

---

## 进阶

- **异地备份**: 装 `ossutil`,配 `OSS_BUCKET=oss://<bucket>/garment-backups` 环境变量,`backup.sh` 会自动上传
- **错误追踪**: V1 不上 SaaS,有问题 SSH 看 `/opt/garment/logs/pm2-error.log`
- **升级 Node.js**: 跑 NodeSource 22.x setup + `apt install nodejs` + 在 `garment-server/` 跑 `npm rebuild better-sqlite3`
- **多服务器**: 当前架构是单实例;如未来 >10 用户需要 cluster,改 MySQL/Postgres + 改 `ecosystem.config.js` `instances: 'max'`,但不在本文档范围

详细运维场景见 [runbook.md](./runbook.md)
