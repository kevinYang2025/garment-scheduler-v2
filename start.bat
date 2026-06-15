@echo off
echo 启动后端服务...
start "后端" cmd /c "cd garment-server && node server.js"
timeout /t 2 >nul
echo 启动前端服务...
start "前端" cmd /c "cd garment-web && npm run dev"
echo.
echo 系统启动中...
echo 后端: http://localhost:3001
echo 前端: http://localhost:5173
pause
