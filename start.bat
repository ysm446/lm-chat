@echo off
setlocal

cd /d "%~dp0"

set "CONDA_EXE=C:\Users\kenyo\miniconda3\Scripts\conda.exe"
set "LLAMA_SERVER_EXE=%CD%\bin\llama-server\llama-b8466-bin-win-cuda-13.1-x64\llama-server.exe"

if not exist "%CONDA_EXE%" (
  echo ERROR: conda.exe not found: %CONDA_EXE%
  pause
  exit /b 1
)

if not exist "%LLAMA_SERVER_EXE%" (
  echo ERROR: llama-server.exe not found: %LLAMA_SERVER_EXE%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found in PATH.
  pause
  exit /b 1
)

:: llama-server の exe パスを保存（モデルは起動せず空のまま）
mkdir "%CD%\data" 2>nul
powershell -NoLogo -NoProfile -Command "$p='%CD%\data\llama_paths.json';[ordered]@{llama_exe='%LLAMA_SERVER_EXE%';active_model_path='';mmproj_path='';n_gpu_layers=-1}|ConvertTo-Json|Out-File $p -Encoding ascii -Force"

echo Starting backend...
start "LM Chat Backend" /min cmd /c "set LLAMA_SERVER_BASE_URL=http://127.0.0.1:8080 && set LLAMA_MODEL=Huihui-Qwen3.5-27B-abliterated && "%CONDA_EXE%" run --no-capture-output -n main python -m uvicorn backend.server:app --reload"

echo Starting frontend...
start "LM Chat Frontend" /min cmd /c "npm run dev"

echo Waiting for backend on http://127.0.0.1:8000 ...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue';$url='http://127.0.0.1:8000/health';for($i=0;$i-lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2|Out-Null;exit 0}catch{Start-Sleep -Seconds 1}};exit 1"
if errorlevel 1 (
  echo ERROR: Backend did not become ready within 60 seconds.
  pause
  exit /b 1
)

echo Waiting for frontend on http://127.0.0.1:5173 ...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue';$url='http://127.0.0.1:5173';for($i=0;$i-lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2|Out-Null;exit 0}catch{Start-Sleep -Seconds 1}};exit 1"
if errorlevel 1 (
  echo ERROR: Frontend did not become ready within 60 seconds.
  pause
  exit /b 1
)

echo Launching Electron...
set "VITE_DEV_SERVER_URL=http://127.0.0.1:5173"
call npm run electron:dev

echo Electron closed. Stopping all processes...
taskkill /fi "WINDOWTITLE eq LM Chat Backend" /f /t >nul 2>nul
taskkill /fi "WINDOWTITLE eq LM Chat llama-server" /f /t >nul 2>nul
powershell -NoLogo -NoProfile -Command "try{$p=(Get-NetTCPConnection -LocalPort 5173 -EA Stop).OwningProcess|Select -First 1;if($p){Stop-Process -Id $p -Force -EA SilentlyContinue}}catch{}"

endlocal
exit
