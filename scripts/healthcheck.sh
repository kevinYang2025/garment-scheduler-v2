#!/usr/bin/env bash
# 本地 watchdog - 每 5 分钟跑(由 cron.d/garment-backup 调度)
# 失败: pm2 自动重启;磁盘满: 告警到日志

set -e
URL="http://127.0.0.1:3001/api/health"
HTTP=$(curl -s -o /dev/null -w "%{http_code}" -m 5 "$URL" || echo 000)

if [ "$HTTP" != "200" ]; then
  echo "[$(date -Iseconds)] WARN: $URL → $HTTP — restart garment-server"
  /usr/bin/pm2 restart garment-server || true
fi

USAGE=$(df -P /opt/garment | awk 'NR==2 {gsub("%",""); print $5}')
if [ "$USAGE" -gt 80 ]; then
  echo "[$(date -Iseconds)] WARN: disk usage ${USAGE}%"
fi
