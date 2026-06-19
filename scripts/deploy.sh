#!/usr/bin/env bash
# 部署脚本 - 由 CI (.github/workflows/deploy.yml) 调起
# 也可 SSH 到服务器手动跑: sudo /opt/garment/scripts/deploy.sh
# 幂等: 可重复跑(覆盖式部署)

set -euo pipefail

APP_DIR=/opt/garment/app/garment-scheduler-v2
INBOX=/tmp/garment-deploy
STAMP=$(date -u +%Y%m%d_%H%M%SZ)
BACKUP_DIR=/opt/garment/backups/releases
LOG=/opt/garment/logs/deploy.log

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG")"
log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOG"; }

# ---------- 0) 预检查 ----------
log "preflight"
[ -f "$APP_DIR/garment-server/server.js" ] || { log "FATAL: existing app dir missing ($APP_DIR)"; exit 1; }
[ -f /opt/garment/env/garment.env ]        || { log "FATAL: env file missing (/opt/garment/env/garment.env)"; exit 1; }

# env 文件必填项校验(对应 server.js:47-58 fatal-exit 守卫)
grep -q '^AUTH_ENABLED=true'   /opt/garment/env/garment.env || { log "FATAL: AUTH_ENABLED != true"; exit 1; }
grep -q '^NODE_ENV=production' /opt/garment/env/garment.env || { log "FATAL: NODE_ENV != production"; exit 1; }
grep -qE '^API_TOKEN=[a-f0-9]{32,}'       /opt/garment/env/garment.env || { log "FATAL: API_TOKEN missing/weak"; exit 1; }
grep -qE '^SESSION_SECRET=[a-f0-9]{32,}'  /opt/garment/env/garment.env || { log "FATAL: SESSION_SECRET missing/weak"; exit 1; }
grep -qE '^CORS_ORIGINS=https?://'        /opt/garment/env/garment.env || { log "FATAL: CORS_ORIGINS must be https URL"; exit 1; }

# ---------- 1) 快照旧版本 ----------
log "snapshot previous release → $BACKUP_DIR/$STAMP"
mkdir -p "$BACKUP_DIR/$STAMP"
cp -a "$APP_DIR/garment-server/server.js"      "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
cp -a "$APP_DIR/garment-server/db.js"          "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
cp -a "$APP_DIR/garment-server/session-store.js" "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
cp -a "$APP_DIR/garment-server/ecosystem.config.js" "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
cp -a "$APP_DIR/garment-server/package.json"   "$BACKUP_DIR/$STAMP/" 2>/dev/null || true
# 仅保留最近 5 个 release 快照
ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n +6 | xargs -r rm -rf

# ---------- 2) 原子换装 ----------
log "staging new code into $APP_DIR"

# 后端关键文件
cp -a "$INBOX/build/server.js"      "$APP_DIR/garment-server/server.js"
cp -a "$INBOX/build/db.js"          "$APP_DIR/garment-server/db.js"
[ -f "$INBOX/build/session-store.js" ] && cp -a "$INBOX/build/session-store.js" "$APP_DIR/garment-server/session-store.js"
cp -a "$INBOX/build/ecosystem.config.js" "$APP_DIR/garment-server/ecosystem.config.js"
cp -a "$INBOX/build/package.json"   "$APP_DIR/garment-server/package.json"
cp -a "$INBOX/build/package-lock.json" "$APP_DIR/garment-server/package-lock.json"
# node_modules 同步(大目录, rsync + delete 节约)
if [ -d "$INBOX/build/node_modules" ]; then
  rsync -a --delete "$INBOX/build/node_modules/" "$APP_DIR/garment-server/node_modules/"
fi

# 前端 dist 原子换装(Nginx root 跟着切)
NEW_DIST="$APP_DIR/garment-web/dist.$STAMP"
mkdir -p "$APP_DIR/garment-web"
cp -a "$INBOX/build/dist" "$NEW_DIST"
# 切 symlink: 写 .new → mv -T 原子
ln -sfn "$NEW_DIST" "$APP_DIR/garment-web/dist.new"
mv -T "$APP_DIR/garment-web/dist.new" "$APP_DIR/garment-web/dist"
# 清理旧 dist.* (保留最近 3 个)
ls -1dt "$APP_DIR"/garment-web/dist.*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

# ---------- 3) 语法校验(失败中止,旧版本继续服务) ----------
log "syntax check"
node --check "$APP_DIR/garment-server/server.js" || { log "FATAL: server.js syntax error"; exit 1; }

# ---------- 4) 零停机重载 ----------
log "pm2 reload"
cd "$APP_DIR/garment-server"
sudo -u deploy pm2 reload ecosystem.config.js --update-env

# ---------- 5) 本机健康检查 ----------
log "health check"
sleep 2
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:3001/api/health || echo 000)
if [ "$HTTP" != "200" ]; then
  log "WARN: /api/health returned $HTTP (process may still be starting)"
fi

# ---------- 6) Nginx 配置变更才 reload ----------
if nginx -t 2>/dev/null; then
  systemctl reload nginx || true
fi

# ---------- 7) 清理 ----------
rm -rf "$INBOX"

log "DEPLOY OK ($STAMP)"
