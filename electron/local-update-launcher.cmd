@echo off
start "" /b wscript.exe "%~dp0local-update-launcher.vbs" "%~1" "%~2" "%~3" >nul 2>nul
