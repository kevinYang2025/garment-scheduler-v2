import re, sys
sys.stdout.reconfigure(encoding='utf-8')
text = open('docs/sop/_images/docx.log', encoding='utf-8').read()
pat = re.compile(r"DEBUG heading='([^']+)' inside='([^']+)' -> route_key='([^']+)'")
for m in pat.finditer(text):
    h = m.group(1)[:30]
    ins = m.group(2)[:50].replace(chr(10), ' ')
    rk = m.group(3)
    print(f"{h:30s} | {ins:50s} -> {rk}")
