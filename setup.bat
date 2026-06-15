@echo off
echo === 制衣工厂生产排程系统 - 初始化 ===
echo.

echo [1/3] 安装后端依赖...
cd garment-server
call npm install
cd ..

echo.
echo [2/3] 安装前端依赖...
cd garment-web
call npm install
cd ..

echo.
echo [3/3] 完成！
echo.
echo 启动方式:
echo   终端1: cd garment-server ^&^& node server.js
echo   终端2: cd garment-web ^&^& npm run dev
echo.
echo 或直接运行 start.bat
pause
