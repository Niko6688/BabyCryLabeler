@echo off
:: Set clean UTF-8 encoding so Chinese characters display perfectly in Windows Command Prompt
chcp 65001 > nul
title BabyCryLabeler 一键深度卸载清理工具

echo ======================================================
echo       婴儿哭声精准标注系统 — 一键完全卸载与清理工具
echo ======================================================
echo.
echo 正在启动安全卸载程序，请稍候...
echo.

:: Check if Node.js is installed on the user's system
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] 警告: 未在当前系统中检测到 Node.js 环境！
    echo 正在尝试使用 Windows 原生指令进行本地残留清理...
    echo.
    goto :NATIVE_CLEAN
)

:: Run our perfect Node.js uninstaller
node clean-uninstall.js
goto :END

:NATIVE_CLEAN
echo ================== 自动发现本地文件 ==================
set "USER_DIR=%USERPROFILE%\BabyCryLabeler_Data"
set "APP_DATA_DIR=%APPDATA%\BabyCryLabeler"
set "LOCAL_APP_DIR=%LOCALAPPDATA%\Programs\BabyCryLabeler"

echo 1. 本地程序物理文件将要被清除: "%LOCAL_APP_DIR%"
echo 2. 软件缓存与历史记录将要被清除: "%APP_DATA_DIR%"
echo 3. 您的标注输出数据集存放处: "%USER_DIR%"
echo.
set /p confirm="确认继续一键卸载并清除以上文件夹吗？(Y/N): "
if /i "%confirm%" neq "Y" (
    echo [!] 操作已取消。
    goto :END
)

echo.
echo 正在清理本地可执行程序目录...
if exist "%LOCAL_APP_DIR%" (
    rd /s /q "%LOCAL_APP_DIR%"
    echo [+] 主程序卸载成功！
)

echo 正在清理系统应用运行数据与临时缓存...
if exist "%APP_DATA_DIR%" (
    rd /s /q "%APP_DATA_DIR%"
    echo [+] 系统运行缓存清理完毕！
)

echo.
set /p confirm_data="是否连同所有【生成的标注成果 CSV/JSON 报表】也彻底清空？(Y/N): "
if /i "%confirm_data%"=="Y" (
    if exist "%USER_DIR%" (
        rd /s /q "%USER_DIR%"
        echo [+] 所有标注成果与试听音频已彻底移除！
    )
) else (
    echo [*] 已为您保留标注结果在：%USER_DIR%
)

echo.
echo ======================================================
echo    [✓] 恭喜！BabyCryLabeler 已经从您的系统上安全卸载完成！
echo ======================================================

:END
echo.
echo 按任意键退出本窗口...
pause > nul
