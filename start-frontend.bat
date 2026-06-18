@echo off
REM [2026-06-18] dev 模式前端启动 wrapper,自动重启
REM 崩溃 3 秒后自动拉起,跟 start-dev.bat 配对用

echo.
echo 启动 dev 模式前端(vite)
echo   端口: 5173
echo   代理: /api + /socket.io -> localhost:3001
echo.

cd garment-web

:loop
echo [%date% %time%] 启动 vite ...
call npx vite --port 5173 --host 0.0.0.0
echo [%date% %time%] vite 退出,3 秒后重启 (Ctrl+C 停止)
timeout /t 3 >nul
goto loop