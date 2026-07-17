@echo off
start "" /b powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~1" -PlanPath "%~2" -StatusPath "%~3" >nul 2>nul
