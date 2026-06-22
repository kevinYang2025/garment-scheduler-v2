"""
提取所有 SOP 文件中的 mermaid 块,渲染为 PNG
- 输出: docs/sop/_images/mermaid/<sop-key>__<index>.png
- 用 mmdc 渲染
"""
import re
import os
import subprocess
from pathlib import Path

SOP_DIR = Path("docs/sop")
OUT_DIR = SOP_DIR / "_images" / "mermaid"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# mmdc 路径(全局安装)
MMDC = "mmdc"

# SOP 文件名 → 短 key
SOP_KEY = {
    "SOP-00-总览与登录.md": "SOP-00",
    "SOP-01-系统管理员.md": "SOP-01",
    "SOP-02-计划主管.md": "SOP-02",
    "SOP-03-计划员.md": "SOP-03",
    "SOP-04-报工人员.md": "SOP-04",
    "SOP-05-裁片仓管员.md": "SOP-05",
    "SOP-06-缝制车间主任.md": "SOP-06",
}

# mermaid 块正则: ```mermaid\n...内容...\n```
MERMAID_RE = re.compile(r"^```mermaid\s*\n(.*?)\n```\s*$", re.M | re.S)


def extract_mermaid_blocks(text):
    return MERMAID_RE.findall(text)


def render_one(sop_key, idx, content):
    """用 mmdc 渲染单块"""
    name = f"{sop_key}__{idx:02d}"
    mmd_path = OUT_DIR / f"{name}.mmd"
    png_path = OUT_DIR / f"{name}.png"
    mmd_path.write_text(content, encoding="utf-8")
    # mmdc 命令: mmdc -i input.mmd -o output.png -w 1200 -b white
    # 用 puppeteerConfigFile 避免 sandbox
    puppeteer_cfg = OUT_DIR / "puppeteer.json"
    if not puppeteer_cfg.exists():
        puppeteer_cfg.write_text('{"args": ["--no-sandbox", "--disable-setuid-sandbox"]}')
    cmd = ["cmd", "/c", MMDC, "-i", str(mmd_path), "-o", str(png_path),
           "-w", "1400", "-H", "900", "-b", "white",
           "-p", str(puppeteer_cfg), "-t", "default"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            return f"FAIL {name}: {r.stderr[:200]}"
        if not png_path.exists():
            return f"FAIL {name}: no output png"
        # 删除中间 mmd 文件
        mmd_path.unlink()
        return f"OK {name}.png ({png_path.stat().st_size // 1024}KB)"
    except Exception as e:
        return f"FAIL {name}: {e}"


def main():
    total = 0
    for fname, key in SOP_KEY.items():
        fpath = SOP_DIR / fname
        if not fpath.exists():
            print(f"SKIP {fname} (not found)")
            continue
        text = fpath.read_text(encoding="utf-8")
        blocks = extract_mermaid_blocks(text)
        print(f"{fname}: {len(blocks)} mermaid")
        for i, b in enumerate(blocks, 1):
            r = render_one(key, i, b)
            print(f"  {r}")
            total += 1
    print(f"Total: {total} blocks processed")


if __name__ == "__main__":
    main()
