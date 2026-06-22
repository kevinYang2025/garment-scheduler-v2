import re
text = open('docs/sop/_images/docx.log', encoding='utf-8').read()
for m in re.finditer(r"heading='([^']+)'.*?route_key='([^']+)'", text):
    print(f"{m.group(1)[:30]:30s} -> {m.group(2)}")
