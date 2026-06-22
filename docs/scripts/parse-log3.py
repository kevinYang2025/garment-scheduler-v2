import re, sys
sys.stdout.reconfigure(encoding='utf-8')
text = open('docs/sop/_images/docx.log', encoding='utf-8').read()
for m in re.finditer(r'DEBUG heading=(.+?) inside=(.+?) -> route_key=(.+?)', text):
    h = m.group(1)[:40]
    ins = m.group(2)[:60]
    rk = m.group(3).strip()
    print(f"{h:42s} | {ins:65s} -> {rk}")
