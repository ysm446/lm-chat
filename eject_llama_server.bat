@echo off
setlocal

cd /d "%~dp0"

set "LLAMA_PATHS_JSON=%CD%\data\llama_paths.json"
set "PAUSE_ON_EXIT=1"

if /i "%~1"=="--no-pause" set "PAUSE_ON_EXIT=0"
if /i "%~1"=="/no-pause" set "PAUSE_ON_EXIT=0"

if not exist "%LLAMA_PATHS_JSON%" (
  echo INFO: llama_paths.json was not found. Nothing to eject.
  goto :finish
)

for /f "usebackq delims=" %%i in (`powershell -NoLogo -NoProfile -Command "$p='%LLAMA_PATHS_JSON%';try{$raw=Get-Content -LiteralPath $p -Raw -Encoding UTF8}catch{exit 1};if($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF){$raw=$raw.Substring(1)};$json=$raw|ConvertFrom-Json;$pid=$json.llama_server_pid;if($pid -is [int] -and $pid -gt 0){Write-Output $pid}"`) do set "LLAMA_PID=%%i"

if not defined LLAMA_PID (
  echo INFO: No tracked llama-server PID was found. Nothing to eject.
  goto :finish
)

echo Stopping llama-server PID %LLAMA_PID% ...
taskkill /F /T /PID %LLAMA_PID%
if errorlevel 1 (
  echo WARNING: taskkill failed. The tracked process may already be stopped.
)

powershell -NoLogo -NoProfile -Command "$p='%LLAMA_PATHS_JSON%';$raw=Get-Content -LiteralPath $p -Raw -Encoding UTF8;if($raw.Length -gt 0 -and $raw[0] -eq [char]0xFEFF){$raw=$raw.Substring(1)};$json=$raw|ConvertFrom-Json;$json.active_model_path='';$json.mmproj_path='';$json.llama_server_pid=$null;$json|ConvertTo-Json|Out-File -LiteralPath $p -Encoding utf8 -Force"

echo Done. llama-server was ejected and VRAM should be released.
goto :finish

:finish
if "%PAUSE_ON_EXIT%"=="1" pause
exit /b 0
