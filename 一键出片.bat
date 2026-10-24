@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM ============================================================
REM  高频踩点视频生成器 - 拖拽即用
REM  把音频文件拖到本文件图标上，或放进 assets 后双击
REM ============================================================

set "AUDIO=%~1"

if "%AUDIO%"=="" (
    echo.
    echo   ============================================
    echo      高频踩点视频生成器
    echo   ============================================
    echo.
    echo   请把音频文件拖到本文件图标上，或直接输入路径
    echo   支持 mp3 / wav / m4a / flac / aac / ogg
    echo.
    set /p AUDIO=  音频路径（直接回车读取 assets 里第一个音频）: 
    if "!AUDIO!"=="" (
        for %%F in (assets\*.mp3 assets\*.wav assets\*.m4a assets\*.flac) do (
            if exist "%%F" (
                set "AUDIO=%%F"
                goto :got
            )
        )
        echo.
        echo   [错误] assets 里没有找到音频文件
        echo   把音频放进 assets 文件夹后再试
        echo.
        pause
        exit /b 1
    )
    REM 去掉可能带的引号
    set "AUDIO=!AUDIO:"=!"
)
:got

echo.
echo   音频: !AUDIO!
echo.

set /p TITLE=  标题文字（回车跳过）: 
set /p SIZE=  尺寸 h横屏 / v竖屏 / s方形 / all全出（回车=h横屏）: 
if "!SIZE!"=="" set "SIZE=h"

echo.
echo   开始处理...
echo.

set "ARGS=!AUDIO! --size !SIZE!"
if not "!TITLE!"=="" set "ARGS=!ARGS! --title !TITLE!"

node make.mjs !ARGS!

if errorlevel 1 (
    echo.
    echo   [失败] 请查看上面的错误信息
    echo.
    pause
    exit /b 1
)

echo.
echo   ============================================
echo      完成！成品在 out 文件夹
echo   ============================================
echo.
if exist out start "" explorer "out"
pause