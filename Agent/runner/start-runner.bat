@echo off
setlocal
cd /d "%~dp0\..\.."
node Agent\runner\service\start.js
