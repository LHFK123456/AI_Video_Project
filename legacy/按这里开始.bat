@echo off
chcp 65001 >nul
cd /d "%~dp0"

title 音频转视频

rem ---- 把临时文件也引导到 D 盘，避免占用 C 盘 ----
if not exist "%~dp0.tmp" mkdir "%~dp0.tmp"
set TEMP=%~dp0.tmp
set TMP=%~dp0.tmp

rem ---- 找 python：先项目自带，再系统，最后 PATH ----
set PY=
if exist "%~dp0python\python.exe" (
    set PY=%~dp0python\python.exe
)
if not defined PY (
    for %%P in (python.exe py.exe) do (
        if not defined PY (
            where %%P >nul 2>&1 && set PY=%%P
        )
    )
)
if not defined PY (
    echo [错误] 找不到 Python，无法运行。
    echo 需要 Python 3.9 以上，装好后重新双击本文件。
    pause
    exit /b 1
)

rem ---- 检查 ffmpeg ----
if not exist "D:\ffmpeg\bin\ffmpeg.exe" (
    where ffmpeg >nul 2>&1
    if errorlevel 1 (
        echo [错误] 找不到 ffmpeg。
        echo 应该放在 D:\ffmpeg\bin\ffmpeg.exe
        pause
        exit /b 1
    )
)

if "%~1"=="" goto auto

echo ============================================================
echo   处理拖入的文件
echo ============================================================
echo.
"%PY%" a2v.py %*
goto finish

:auto
echo ============================================================
echo   音频转视频
echo ============================================================
echo.
echo   正在处理 input 文件夹里的音频...
echo   （也可以直接把音频文件拖到这个 bat 图标上）
echo.
"%PY%" a2v.py

:finish
echo.
if exist "output\*.mp4" (
    echo 打开成品文件夹...
    start "" "%~dp0output"
) else (
    echo 没有生成成品，请检查上面的提示信息。
)
echo.
echo 按任意键关闭窗口。
pause >nul