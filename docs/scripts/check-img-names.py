"""检查 docx 里每张图的实际文件名"""
import sys
sys.stdout.reconfigure(encoding='utf-8')
from docx import Document
import os
from docx.oxml.ns import qn

for fname in ["SOP-04-报工人员.docx", "SOP-05-裁片仓管员.docx", "SOP-00-总览与登录.docx"]:
    p = os.path.join("docs/sop", fname)
    d = Document(p)
    print(f"\n=== {fname} ===")
    last_h = ""
    for i, para in enumerate(d.paragraphs):
        text = para.text.strip()
        if text.startswith(("一、", "二、", "三、", "四、", "五、", "六、", "七、", "八、", "九、", "十、")):
            last_h = text[:20]
        # docPr name 属性含图片文件名
        for blip in para._p.findall(".//" + qn("a:blip")):
            embed = blip.get(qn("r:embed"))
            if embed:
                # 从 part 拿
                try:
                    img_part = d.part.related_parts[embed]
                    img_name = os.path.basename(img_part.partname)
                    print(f"  [{last_h:20s}] {img_name}")
                except KeyError:
                    print(f"  [{last_h:20s}] (no part: {embed})")
