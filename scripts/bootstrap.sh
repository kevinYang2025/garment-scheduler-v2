#!/usr/bin/env bash
# 一次性服务器初始化 - 阿里云 ECS Ubuntu 22.04 香港
# 由 deploy 用户手工跑一次: bash /opt/garment/scripts/bootstrap.sh
# 幂等: 可重复跑(跳过已做步骤)

set -euo pipefail

log() { echo "[$(date -Iseconds)] $*"; }
require_root() {
  [ "$(id -u)" = "0" ] || { echo "请用 sudo 或 root 跑此脚本"; exit 1; }
}

require_root

# ============ 1) 基础包 ============
log "apt update + 基础工具"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  curl wget git build-essential python3 make g++ \
  libsqlite3-dev \
  ufw fail2ban unattended-upgrades apt-listchanges \
  ca-certificates gnupg

# ============ 2) 时区 ============
log "时区 → Asia/Phnom_Penh"
timedatectl set-timezone Asia/Phnom_Penh || true

# ============ 3) 非 root 用户 deploy ============
if ! id deploy &>/dev/null; then
  log "创建 deploy 用户"
  adduser --disabled-password --gecos "" deploy
  usermod -aG sudo deploy
  echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy
fi

# SSH 公钥(部署机第一次 SSH 上来时已经写入)
mkdir -p /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
if [ ! -f /home/deploy/.ssh/authorized_keys ]; then
  touch /home/deploy/.ssh/authorized_keys
fi
chmod 600 /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh

# ============ 4) SSH 加固 ============
log "SSH 加固"
SSHD=/etc/ssh/sshd_config
cp -a "$SSHD" "${SSHD}.bak.$(date +%s)" 2>/dev/null || true
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' "$SSHD"
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' "$SSHD"
if ! grep -q '^AllowUsers deploy' "$SSHD"; then
  echo "AllowUsers deploy" >> "$SSHD"
fi
systemctl restart ssh

# ============ 5) UFW 防火墙 ============
log "UFW 防火墙"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
# 80/443 仅在需要时开(若 Cloudflare 代理,可限制 CF IP)
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable
ufw status verbose

# ============ 6) fail2ban + 自动安全更新 ============
log "fail2ban + unattended-upgrades"
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive -plow unattended-upgrades || true

# ============ 7) Node.js 20 LTS ============
log "Node.js 20.x"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

# ============ 8) pm2 + pm2-logrotate ============
log "pm2"
npm install -g pm2
# 让 deploy 用户能跑 pm2
sudo -u deploy bash -c 'pm2 install pm2-logrotate && \
  pm2 set pm2-logrotate:max_size 50M && \
  pm2 set pm2-logrotate:retain 30 && \
  pm2 set pm2-logrotate:compress true && \
  pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm && \
  pm2 set pm2-logrotate:workerInterval 60 && \
  pm2 set pm2-logrotate:rotateInterval "0 0 * * *"'
sudo -u deploy bash -c 'pm2 startup systemd -u deploy --hp /home/deploy' || true

# ============ 9) 应用目录 ============
log "/opt/garment 目录树"
mkdir -p /opt/garment/{app,data,backups/releases,logs,scripts,env}
chown -R deploy:deploy /opt/garment
chmod 700 /opt/garment/env

# ============ 10) crontab 模板 ============
if [ ! -f /etc/cron.d/garment-backup ]; then
  cat > /etc/cron.d/garment-backup <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin

# 每天 02:15 跑 SQLite 备份
15 2 * * * deploy /opt/garment/scripts/backup.sh >> /opt/garment/logs/backup.log 2>&1

# 每周日 03:00 WAL checkpoint + VACUUM
0 3 * * 0 deploy /usr/bin/sqlite3 /opt/garment/data/data.sqlite "PRAGMA wal_checkpoint(TRUNCATE); VACUUM;" >> /opt/garment/logs/vacuum.log 2>&1

# 每 5 分钟健康检查
*/5 * * * * deploy /opt/garment/scripts/healthcheck.sh >> /opt/garment/logs/healthcheck.log 2>&1
EOF
  chmod 644 /etc/cron.d/garment-backup
fi

# ============ 11) 系统日志目录 ============
mkdir -p /var/log/garment
chown deploy:deploy /var/log/garment

log "===== bootstrap 完成 ====="
log "下一步:"
log "  1) 把 SSH 公钥发给 owner,让他 SSH 上服务器"
log "  2) 让 owner 编辑 /opt/garment/env/garment.env (用 openssl rand -hex 32 生成两个密钥)"
log "  3) 跑 scripts/manual-deploy.sh (首次手动启动,验证 boot)"
log "  4) 配 GitHub Secrets 后,推 master 触发 CI 自动部署"
