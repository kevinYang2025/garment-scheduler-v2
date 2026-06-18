@echo off
REM [2026-06-18] dev 模式启动 wrapper
REM 设 AUTH_ENABLED=true + API_TOKEN + NODE_ENV=development 避免 production gating 关掉服务
REM 同时用 restart-on-crash 循环,意外崩溃 3 秒后自动拉起

set AUTH_ENABLED=true
set API_TOKEN=dev-token-change-me
set NODE_ENV=development

echo.
echo 启动 dev 模式后端(自动重启)
echo   AUTH_ENABLED=true
echo   API_TOKEN=dev-token-change-me
echo   NODE_ENV=development
echo   端口: 3001
echo.

cd garment-server

:loop
echo [%date% %time%] 启动 server.js ...
node server.js
echo [%date% %time%] 进程退出,3 秒后重启 (Ctrl+C 停止)
timeout /t 3 >nul
goto loop