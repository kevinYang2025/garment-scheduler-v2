"""单次重渲染 2 个修复后的 mermaid 块"""
import re
import subprocess
from pathlib import Path

OUT = Path("docs/sop/_images/mermaid")
puppeteer_cfg = OUT / "puppeteer.json"

for fname, key, target_idx in [
    ("SOP-02-计划主管.md", "SOP-02", 7),
    ("SOP-03-计划员.md", "SOP-03", 4),
]:
    text = open(f"docs/sop/{fname}", encoding="utf-8").read()
    blocks = re.findall(r"^```mermaid\s*\n(.*?)\n```\s*$", text, re.M | re.S)
    if target_idx > len(blocks):
        print(f"SKIP {key} (only {len(blocks)} blocks)")
        continue
    target = blocks[target_idx - 1]
    mmd = OUT / f"{key}__{target_idx:02d}.mmd"
    png = OUT / f"{key}__{target_idx:02d}.png"
    mmd.write_text(target, encoding="utf-8")
    cmd = ["cmd", "/c", "mmdc", "-i", str(mmd), "-o", str(png),
           "-w", "1400", "-H", "900", "-b", "white",
           "-p", str(puppeteer_cfg), "-t", "default"]
    r = subprocess.run(cmd, capture_output=True, timeout=60)
    if r.returncode == 0 and png.exists():
        print(f"OK {key}__{target_idx:02d}.png ({png.stat().st_size // 1024}KB)")
        mmd.unlink()
    else:
        print(f"FAIL {key}__{target_idx:02d}: {r.stderr.decode('utf-8', errors='replace')[:300]}")
