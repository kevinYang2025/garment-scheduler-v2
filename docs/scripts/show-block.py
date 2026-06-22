"""查看失败 mermaid 块内容"""
import re
import os
import sys

for fname, target_idx in [("SOP-02-计划主管.md", 7), ("SOP-03-计划员.md", 4)]:
    p = os.path.join("docs/sop", fname)
    text = open(p, encoding="utf-8").read()
    blocks = re.findall(r"^```mermaid\s*\n(.*?)\n```\s*$", text, re.M | re.S)
    if target_idx <= len(blocks):
        print(f"=== {fname} block #{target_idx} (len={len(blocks[target_idx-1])}) ===")
        print(blocks[target_idx-1][:800])
        print("---")
