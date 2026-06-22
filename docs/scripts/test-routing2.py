"""直接测 SOP-04 视图 6 模板报工 的 ASCII 框图"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

# 复用 find_route_key
exec(open('docs/scripts/md-to-docx.py', encoding='utf-8').read().split("if __name__")[0])

# 模拟: 视图 6 模板报工 line 494-495 ASCII 框图
ascii_first_line = "侧边栏 → ✂️ 报工 → 模板报工"
text_before = ""  # 前 3 行(空)
heading = "十、视图 6:模板报工"
rk = find_route_key(text_before, heading, ascii_first_line)
print(f"十、视图 6 模板报工 (内含'模板报工') -> {rk}")

# 模拟: 二、权限范围(line 82-92)
ascii_first_line = "│  ✍️ 报工员 看到的菜单 │"
heading = "二、权限范围"
text_before = "报工员看到的菜单 最少,只有:"
# inside_text 前 3 行
inside = "│  ✍️ 报工员 看到的菜单 │ │  🏠 工作台 ✅ │ │  ✂️ 报工管理 ✅ │"
rk = find_route_key(text_before, heading, ascii_first_line + " " + inside)
print(f"二、权限范围 (含'报工员'和'工作台') -> {rk}")

# SOP-05 三、登录系统
heading = "三、登录系统"
text_before = "排程系统支持 账号密码登录 和 PIN 登录 两种方式,管理员建议使用账号密码。"
inside = "│  登录系统: 账号密码登录 / PIN 登录                              │"
rk = find_route_key(text_before, heading, inside)
print(f"三、登录系统 (含'登录') -> {rk}")
