@echo off
REM [2026-06-19] dev 模式启动 wrapper (v2: nodemon + 崩溃兜底)
REM 行为:
REM   1) 设 AUTH_ENABLED=true + API_TOKEN + NODE_ENV=development 避免 production gating 关掉服务
REM   2) 外层 nodemon 监听 .js / .json 文件变动自动重启 (改完代码保存即生效)
REM   3) 内层 :loop 兜底 — nodemon 本身崩了,3 秒后自动拉起
REM   4) 启动方式: npm run dev (由本脚本通过 npm 调用)
REM
REM 使用:
REM   - 前端开发: 改 server.js / db.js / *.json,保存后 nodemon 自动重启
REM   - 想停: Ctrl+C (会跳出 batch loop)
REM   - 数据库改动(data.sqlite)不会触发重启 (--ignore 排除)

setlocal
set AUTH_ENABLED=true
set API_TOKEN=dev-token-change-me
set NODE_ENV=development

echo.
echo 启动 dev 模式后端 (nodemon + 崩溃兜底)
echo   AUTH_ENABLED=true
echo   API_TOKEN=dev-token-change-me
echo   NODE_ENV=development
echo   端口: 3001
echo   监听: .js / .json (忽略 data.sqlite 和日志)
echo.

cd garment-server

:loop
echo [%date% %time%] 启动 nodemon ...
call npm run dev
echo [%date% %time%] nodemon 进程退出,3 秒后重启 (Ctrl+C 停止)
timeout /t 3 >nul
goto loop
