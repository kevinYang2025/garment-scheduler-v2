"""单独渲染一个块,完整 stderr"""
import subprocess
from pathlib import Path

OUT = Path("docs/sop/_images/mermaid")
puppeteer_cfg = OUT / "puppeteer.json"

# 提取块
import re
text = open("docs/sop/SOP-02-计划主管.md", encoding="utf-8").read()
blocks = re.findall(r"^```mermaid\s*\n(.*?)\n```\s*$", text, re.M | re.S)
target = blocks[6]  # 7th block (0-indexed)
print("=== SOP-02 block 7 (len %d) ===" % len(target))
print(target)
print("---")

mmd = OUT / "test02_07.mmd"
mmd.write_text(target, encoding="utf-8")
png = OUT / "test02_07.png"
cmd = ["cmd", "/c", "mmdc", "-i", str(mmd), "-o", str(png),
       "-w", "1400", "-H", "900", "-b", "white",
       "-p", str(puppeteer_cfg), "-t", "default"]
r = subprocess.run(cmd, capture_output=True, timeout=60)
print("STDOUT:", r.stdout.decode("utf-8", errors="replace"))
print("STDERR:", r.stderr.decode("utf-8", errors="replace"))
print("RC:", r.returncode)
