@echo off
chcp 65001 >nul 2>&1
title 制衣工厂生产排程系统
echo.
echo ========================================
echo   制衣工厂生产排程系统
echo ========================================
echo.
echo   正在启动服务器...
echo.

cd /d "%~dp0"

:: Check if node_modules exists
if not exist "node_modules" (
    echo   首次运行，正在安装依赖...
    npm install
    echo.
)

:: Start server
node server.js

:: If server exits, pause to see error
echo.
echo 服务器已停止
pause
