@echo off
rem Go Go HarmoniYo: double-click to start the game on this PC (the TV) and let phones join.
rem Options, e.g. for guest Wi-Fi: "Play Go Go HarmoniYo.cmd" --tunnel   (--help lists them all)
setlocal
title Go Go HarmoniYo
if not exist "%~dp0go-go-harmoniyo.exe" (
  echo.
  echo   Go Go HarmoniYo can't start from inside the zip file.
  echo   Right-click the zip, choose "Extract All...", then open the extracted folder
  echo   and double-click "Play Go Go HarmoniYo.cmd" there.
  echo.
  pause
  exit /b 1
)
"%~dp0go-go-harmoniyo.exe" %*
set "code=%errorlevel%"
if not "%code%"=="0" (
  echo.
  echo   Go Go HarmoniYo stopped ^(code %code%^). The messages above say why.
  echo   Help: README.txt in this folder.
  echo.
  pause
)
endlocal & exit /b %code%
