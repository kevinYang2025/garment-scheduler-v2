"""手动测试 find_route_key"""
import sys
sys.stdout.reconfigure(encoding='utf-8')

# 复制 find_route_key 和 ROUTE_PNG
ROUTE_PNG = {
    "dashboard": "01-dashboard",
    "仪表盘": "01-dashboard",
    "首页": "01-dashboard",
    "工作台": "01-dashboard",
    "款式管理": "03-styles",
    "款式": "03-styles",
    "styles": "03-styles",
    "订单": "03-styles",
    "报工首页": "19-dispatch-home",
    "报工汇总": "20-dispatch-report",
    "报工总览": "19-dispatch-home",
    "裁剪一检": "21-cutting-dispatch",
    "裁剪二检": "22-cutting-second-dispatch",
    "裁剪报工": "21-cutting-dispatch",
    "印花报工": "23-printing-dispatch",
    "刺绣报工": "24-embroidery-dispatch",
    "模板报工": "25-template-dispatch",
    "烫标报工": "26-ironing-dispatch",
    "缝制报工": "27-sewing-dispatch-select",
    "报工详情": "28-sewing-dispatch-detail",
    "报工员": "19-dispatch-home",
    "工作台": "01-dashboard",
    "登录": "00-login",
    "login": "00-login",
    "403": "42-403",
}

def find_route_key(text_before, current_heading="", ascii_first_line=""):
    haystack = (text_before + " " + current_heading + " " + ascii_first_line).lower()
    best = None
    best_score = 0
    sorted_keys = sorted(ROUTE_PNG.items(), key=lambda x: -len(x[0]))
    for keyword, png_key in sorted_keys:
        if keyword.lower() in haystack:
            score = len(keyword)
            if score > best_score:
                best_score = score
                best = png_key
    return best

# 测试 二、权限范围
inside_text = "│  ✍️ 报工员 看到的菜单                                        │ │  🏠 工作台              ✅                                   │ │  ✂️ 报工管理            ✅ (本工序入口)                      │"
heading = "二、权限范围"
text_before = "报工员看到的菜单 最少,只有:"

rk = find_route_key(text_before, heading, inside_text)
print(f"二、权限范围 -> {rk} (期望 19-dispatch-home)")

# 五、视图 1 报工总览(工作台) - line 217
inside_text = "│  🏠 工作台                                          2026-06-22│ │  今日待办:                                                   │ │  ┌─────────────────────┐                                    │"
heading = "五、视图 1:报工总览(工作台)"
text_before = "**报工员看到的首页**,显示 **今日待办** 和 **最近报工**。"

rk = find_route_key(text_before, heading, inside_text)
print(f"五、视图 1 -> {rk} (期望 19-dispatch-home)")
