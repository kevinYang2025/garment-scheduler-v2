#!/usr/bin/env bash
# SQLite 每日备份 - 保留 14 天,可选 OSS 同步
# 用 sqlite3 .backup 命令(WAL 模式下 cp 会拿到半页)

set -euo pipefail

DB="/opt/garment/data/data.sqlite"
BACKUP_DIR="/opt/garment/backups"
DATE=$(date -u +%Y%m%d_%H%M%SZ)
DEST="${BACKUP_DIR}/data_${DATE}.sqlite"
GZ="${DEST}.gz"

mkdir -p "$BACKUP_DIR"

# 1) 热快照
sqlite3 "$DB" ".timeout 5000" ".backup '${DEST}'"

# 2) 完整性校验
if ! sqlite3 "$DEST" "PRAGMA integrity_check;" | grep -q '^ok$'; then
  echo "[backup] integrity_check FAILED for $DEST" >&2
  rm -f "$DEST"
  exit 1
fi

# 3) 压缩
gzip -9 "$DEST"

# 4) 本地保留 14 天
find "$BACKUP_DIR" -name 'data_*.sqlite.gz' -mtime +14 -delete

# 5) 可选 OSS 同步(ossutil 不存在则跳过)
if command -v ossutil >/dev/null 2>&1; then
  OSS_BUCKET="${OSS_BUCKET:-oss://your-bucket/garment-backups}"
  ossutil cp "$GZ" "${OSS_BUCKET}/$(basename "$GZ")" || true
fi

echo "[backup] OK: $GZ ($(du -h "$GZ" | cut -f1))"
