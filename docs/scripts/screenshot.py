"""
Playwright 批量截图脚本
- 启动 chromium headless
- 登录 5 角色
- 截每个角色有权限的页面
- 输出到 docs/sop/_images/screenshots/<role>/<page>.png
"""
import asyncio
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = "http://localhost:5173"
IMG_ROOT = Path("docs/sop/_images/screenshots")
IMG_ROOT.mkdir(parents=True, exist_ok=True)

# 账号配置
USERS = {
    "admin": {"username": "admin", "password": "admin123", "tab": "account"},
    "manager": {"username": "manager01", "password": "123456", "tab": "account"},
    "planner": {"username": "planner01", "password": "123456", "tab": "account"},
    "supervisor_sewing": {"username": "sup_sewing_01", "password": "123456", "tab": "account"},
    "dispatcher_sewing": {"username": "201", "pin_no": "201", "pin": "1234", "tab": "pin"},
    "dispatcher_cutting": {"username": "101", "pin_no": "101", "pin": "1234", "tab": "pin"},
}

# 路由→文件名
ROUTES = {
    "00-login": "/#/login",
    "01-dashboard": "/#/dashboard",
    "02-basic-data": "/#/basic-data",
    "03-styles": "/#/styles",
    "04-style-color-size": "/#/style-color-size",
    "05-fabric-list": "/#/fabric-list",
    "06-sewing-workshop": "/#/sewing-workshop",
    "07-pre-workshop-output": "/#/pre-workshop-output",
    "08-plan-management": "/#/plan-management",
    "09-main-plan": "/#/main-plan",
    "10-cutting-schedule": "/#/cutting",
    "11-secondary-home": "/#/secondary",
    "12-printing-plan": "/#/printing-plan",
    "13-embroidery-plan": "/#/embroidery-plan",
    "14-template-plan": "/#/template-plan",
    "15-ironing-plan": "/#/ironing-plan",
    "16-sewing-home": "/#/sewing",
    "17-sewing-plan-detail": "/#/sewing/plan",
    "18-sewing-visual": "/#/sewing/visual",
    "19-dispatch-home": "/#/dispatch",
    "20-dispatch-report": "/#/dispatch/report",
    "21-cutting-dispatch": "/#/cutting-dispatch",
    "22-cutting-second-dispatch": "/#/cutting-second-dispatch",
    "23-printing-dispatch": "/#/printing-dispatch",
    "24-embroidery-dispatch": "/#/embroidery-dispatch",
    "25-template-dispatch": "/#/template-dispatch",
    "26-ironing-dispatch": "/#/ironing-dispatch",
    "27-sewing-dispatch-select": "/#/sewing-dispatch",
    "28-sewing-dispatch-detail": "/#/sewing-dispatch/detail?workshop=sewing",
    "29-warehouse-home": "/#/warehouse",
    "30-warehouse-cutting-piece": "/#/warehouse/cutting_piece",
    "31-warehouse-fabric": "/#/warehouse/fabric",
    "32-warehouse-finished": "/#/warehouse/finished",
    "33-warehouse-accessory": "/#/warehouse/accessory",
    "34-capacity-config": "/#/config",
    "35-work-calendar": "/#/work-calendar",
    "36-strategy": "/#/strategy",
    "37-system-params": "/#/system-params",
    "38-operation-logs": "/#/logs",
    "39-user-management": "/#/users",
    "40-actual-review": "/#/actual-review",
    "41-user-settings": "/#/user-settings",
    "42-403": "/#/403",
    "43-home-entry": "/#/",
}

# 角色 → 路由白名单(未列出的尝试后跳 403)
ROUTE_ACCESS = {
    "00-login": ["admin", "manager", "planner", "supervisor_sewing", "dispatcher_sewing", "dispatcher_cutting"],
    "42-403": ["admin", "manager", "planner", "supervisor_sewing", "dispatcher_sewing", "dispatcher_cutting"],
    "43-home-entry": ["admin", "manager", "planner", "supervisor_sewing", "dispatcher_sewing", "dispatcher_cutting"],
    "01-dashboard": ["admin", "manager", "planner", "supervisor_sewing"],
    "02-basic-data": ["admin", "manager", "planner", "supervisor_sewing"],
    "03-styles": ["admin", "manager", "planner"],
    "04-style-color-size": ["admin", "manager", "planner"],
    "05-fabric-list": ["admin", "manager", "planner"],
    "06-sewing-workshop": ["admin", "manager", "planner", "supervisor_sewing"],
    "07-pre-workshop-output": ["admin", "manager", "planner"],
    "08-plan-management": ["admin", "manager", "planner"],
    "09-main-plan": ["admin", "manager", "planner"],
    "10-cutting-schedule": ["admin", "manager", "planner"],
    "11-secondary-home": ["admin", "manager", "planner"],
    "12-printing-plan": ["admin", "manager", "planner"],
    "13-embroidery-plan": ["admin", "manager", "planner"],
    "14-template-plan": ["admin", "manager", "planner"],
    "15-ironing-plan": ["admin", "manager", "planner"],
    "16-sewing-home": ["admin", "manager", "planner", "supervisor_sewing"],
    "17-sewing-plan-detail": ["admin", "manager", "planner", "supervisor_sewing"],
    "18-sewing-visual": ["admin", "manager", "planner", "supervisor_sewing"],
    "19-dispatch-home": ["admin", "manager", "planner", "supervisor_sewing", "dispatcher_sewing", "dispatcher_cutting"],
    "20-dispatch-report": ["admin", "manager", "planner", "supervisor_sewing"],
    "21-cutting-dispatch": ["dispatcher_cutting"],
    "22-cutting-second-dispatch": ["dispatcher_cutting"],
    "23-printing-dispatch": ["admin", "manager", "planner", "supervisor_sewing"],
    "24-embroidery-dispatch": ["admin", "manager", "planner", "supervisor_sewing"],
    "25-template-dispatch": ["admin", "manager", "planner", "supervisor_sewing"],
    "26-ironing-dispatch": ["admin", "manager", "planner", "supervisor_sewing"],
    "27-sewing-dispatch-select": ["dispatcher_sewing"],
    "28-sewing-dispatch-detail": ["dispatcher_sewing"],
    "29-warehouse-home": ["admin", "manager", "planner"],
    "30-warehouse-cutting-piece": ["admin", "manager", "planner"],
    "31-warehouse-fabric": ["admin", "manager", "planner"],
    "32-warehouse-finished": ["admin", "manager", "planner"],
    "33-warehouse-accessory": ["admin", "manager", "planner"],
    "34-capacity-config": ["admin", "manager"],
    "35-work-calendar": ["admin", "manager", "planner", "supervisor_sewing"],
    "36-strategy": ["admin", "manager"],
    "37-system-params": ["admin", "manager"],
    "38-operation-logs": ["admin", "manager"],
    "39-user-management": ["admin"],
    "40-actual-review": ["admin", "supervisor_sewing"],
    "41-user-settings": ["admin", "manager", "planner", "supervisor_sewing", "dispatcher_sewing", "dispatcher_cutting"],
}


async def do_login(page, role):
    """通过 API 登录,直接把 session cookie 注入浏览器"""
    import json
    user = USERS[role]
    # 先访问一次,让浏览器拿到后端域
    await page.goto(BASE + "/#/login", wait_until="domcontentloaded", timeout=15000)
    await page.wait_for_timeout(500)

    # 调后端 API 登录,获取 Set-Cookie 中的 session cookie
    if user["tab"] == "account":
        login_data = {"username": user["username"], "password": user["password"]}
    else:
        login_data = {"pin_no": user["pin_no"], "pin": user["pin"]}

    api_resp = await page.evaluate(
        """async (data) => {
            const r = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                credentials: 'include',
                body: JSON.stringify(data)
            });
            return { ok: r.ok, status: r.status, body: await r.text() };
        }""",
        login_data,
    )
    if not api_resp.get("ok"):
        return False
    # 重新访问,触发 /me 拉取
    try:
        await page.goto(BASE + "/#/", wait_until="domcontentloaded", timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(1500)
    # 调一次 /me 确认 session 有
    me = await page.evaluate(
        """async () => {
            const r = await fetch('/api/auth/me', { credentials: 'include' });
            return { ok: r.ok, status: r.status };
        }"""
    )
    return me.get("ok", False)


async def take_screenshot(page, role, page_key, url):
    """截一张图(全页)"""
    safe_key = page_key
    out_dir = IMG_ROOT / role
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{safe_key}.png"
    try:
        await page.goto(BASE + url, wait_until="networkidle", timeout=20000)
        await page.wait_for_timeout(1500)  # 等图表渲染
        await page.screenshot(path=str(out_path), full_page=True)
        return f"OK {out_path}"
    except Exception as e:
        return f"FAIL {safe_key}: {e}"


async def main(target_role=None):
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for role, user in USERS.items():
            if target_role and role != target_role:
                continue
            ctx = await browser.new_context(
                viewport={"width": 1440, "height": 900},
                locale="zh-CN",
            )
            page = await ctx.new_page()

            ok = await do_login(page, role)
            if not ok:
                results.append(f"[{role}] LOGIN FAILED, skip all")
                await ctx.close()
                continue

            results.append(f"[{role}] LOGIN OK")
            for page_key, url in ROUTES.items():
                if role not in ROUTE_ACCESS.get(page_key, []):
                    continue
                r = await take_screenshot(page, role, page_key, url)
                results.append(r)
            await ctx.close()
        await browser.close()
    for r in results:
        print(r)
    return results


if __name__ == "__main__":
    role_arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(role_arg))
