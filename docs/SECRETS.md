# SECRETS — garment-scheduler-v2 生产环境密钥清单

> ⚠️ 这份文件是 **元信息**:列出每把密钥/证书在哪 + 怎么重置,**不**记录密钥值本身。
> 密钥值放在 [1Password](https://1password.com/) / LastPass / Bitwarden 等密码管理器里。
> 重装服务器或迁移时按此表重新生成。

---

## 1. 服务器 SSH

| 项 | 用途 | 存放位置 | 重置方法 |
|---|---|---|---|
| 服务器地址 | ECS 公网 IP / 域名 | 1Password + 阿里云控制台 | 不可重置,只有新购 |
| `deploy` 用户私钥 | SSH 进服务器 | owner 本机 `~/.ssh/garment-deploy` | 服务器 `~/.ssh/authorized_keys` 删对应行; owner 本机 `ssh-keygen -t ed25519` 重新生成 |
| `deploy` 用户 sudo 密码 | 临时用(SSH key 在) | 阿里云控制台 → 实例 → 重置密码 | 控制台重置 |

---

## 2. GitHub Repository Secrets

| Secret | 用途 | 重置方法 |
|---|---|---|
| `DEPLOY_HOST` | 部署目标域名/IP | 改域名解析 → 改 Secret |
| `DEPLOY_USER` | SSH 用户(`deploy`) | 改 Secret |
| `DEPLOY_SSH_KEY` | GitHub Actions 用 deploy 私钥 | 同 §1,生成后替换 Secret |
| `DEPLOY_PORT` | SSH 端口(默认 22) | 改 Secret |
| `DEPLOY_WEBHOOK_URL` | (可选) Slack/Discord 通知 | 在 Slack/Discord 建新 Webhook |

---

## 3. 应用环境变量(`/opt/garment/env/garment.env`)

服务器上文件,**不在 git 里**。`chmod 600`。

| 变量 | 用途 | 重置命令 |
|---|---|---|
| `API_TOKEN` | Bearer 令牌(CI / 外部 CLI 用) | `openssl rand -hex 32` → 替换文件 → `pm2 reload garment-server` |
| `SESSION_SECRET` | session cookie 签名 | `openssl rand -hex 32` → 替换文件 → `pm2 reload garment-server`(⚠️ 重置后所有用户要重新登录) |
| `CORS_ORIGINS` | 允许的跨域 origin | 改域名时同步更新,逗号分隔多 origin |

⚠️ `NODE_ENV=production` + `AUTH_ENABLED=true` + `API_TOKEN` 不能是默认 `'garment-dev-token'`,否则 `server.js:47-58` 会强制 exit(1)。改完后必须 `bash -c 'pm2 reload'` 验证启动日志。

---

## 4. TLS 证书

| 项 | 存放 | 重置 |
|---|---|---|
| Cloudflare Origin Certificate (`origin.crt`) | 服务器 `/etc/nginx/ssl/origin.crt` | 见 [runbook §6](./runbook.md#6-重新签发-cloudflare-origin-certificate) |
| Origin 私钥 (`origin.key`) | 服务器 `/etc/nginx/ssl/origin.key` (`chmod 600`) | 同上,必须**同时**生成一对 |
| Cloudflare Edge Cert | Cloudflare 自管,无需操作 | 自动续期 |

⚠️ **不要**把 `origin.key` 提交到 git 或粘到聊天软件。

---

## 5. 应用账号

| 账号 | 用途 | 重置 |
|---|---|---|
| `admin` | 系统管理员(初始 `admin/admin123`,首次部署后立即改) | [runbook §4](./runbook.md#4-紧急重置-admin-密码) |
| `planner × N` | 计划员日常账号 | UI → 用户管理 |
| `dispatcher` | 报工操作账号(权限小) | UI → 用户管理 |

种子用户(首次启动 `db.init()` 自动创建,共 19 个): `admin/admin123` + 18 个业务账号,密码 `123456` / PIN `1234`。**首次部署后必须全部改**。

---

## 6. 可选外部服务

| 服务 | 启用方式 | 密钥存放 |
|---|---|---|
| 阿里云 OSS 备份 | 装 `ossutil` + 在 `garment.env` 加 `OSS_BUCKET=oss://<bucket>/garment-backups` | `~/.ossutilconfig` 含 AccessKey |
| UptimeRobot 监控 | uptimerobot.com 注册 → 添加 HTTPS monitor | UptimeRobot 账号密码 |

---

## 7. 紧急联系

| 角色 | 谁 | 联系方式 |
|---|---|---|
| 项目 owner | (你) | 1Password 个人 vault |
| 服务器管理员 | (你 / 阿里云账号 holder) | 阿里云账号 + 实名手机 |
| 域名/Cloudflare | (你) | Cloudflare 账号邮箱 |
| GitHub admin | (你) | GitHub 账号 + 2FA |

⚠️ 如果 owner 不止一人,以上信息**全员同步**;2FA 推荐用 Authy / 1Password 内置,而不是短信。
