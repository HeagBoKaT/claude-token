@echo off
chcp 65001 >nul
setlocal
title token-meter installer

echo.
echo   * token-meter for Claude Code
echo   ---------------------------------------------
echo.

where claude >nul 2>nul
if errorlevel 1 (
  echo   [x] Claude Code CLI not found in PATH.
  echo       Install it first: https://docs.claude.com/claude-code
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('claude --version 2^>nul') do echo   Claude Code: %%v
echo.

echo   [1/3] Adding marketplace HeagBoKaT/claude-token ...
call claude plugin marketplace add HeagBoKaT/claude-token >nul 2>nul
call claude plugin marketplace update claude-token
if errorlevel 1 (
  echo   [x] Could not add the marketplace. Check your internet connection.
  pause
  exit /b 1
)

echo   [2/3] Installing token-meter (user scope) ...
call claude plugin install token-meter@claude-token --scope user --yes
if errorlevel 1 (
  echo   [x] Install failed.
  pause
  exit /b 1
)

echo   [3/3] Enabling ...
call claude plugin enable token-meter@claude-token >nul 2>nul

echo.
echo   [ok] Done. Restart Claude Code - the meter appears above the prompt.
echo.
pause
