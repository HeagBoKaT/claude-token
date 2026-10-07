@echo off
chcp 65001 >nul
echo.
echo   Removing token-meter ...
call claude plugin uninstall token-meter@claude-token
call claude plugin marketplace remove claude-token
echo.
echo   [ok] Removed. Restart Claude Code.
echo.
pause
