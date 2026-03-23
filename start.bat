@echo off
setlocal

cd /d "%~dp0"

set "CONDA_EXE=C:\Users\kenyo\miniconda3\Scripts\conda.exe"
set "LLAMA_SERVER_EXE=%CD%\bin\llama-server\llama-b8466-bin-win-cuda-13.1-x64\llama-server.exe"

:: ??????????? / ???? ??????
set "DEFAULT_MODEL=%CD%\models\Huihui-Qwen3.5-27B-abliterated-GGUF\Huihui-Qwen3.5-27B-abliterated.Q4_K_M.gguf"

:: ?????????? llama_paths.json ??????
set "LLAMA_MODEL=%DEFAULT_MODEL%"
if exist "%CD%\data\llama_paths.json" (
  for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "try{(Get-Content '%CD%\data\llama_paths.json'^|ConvertFrom-Json).active_model_path}catch{}"`) do set LLAMA_MODEL=%%i
)
:: ?????????????????????????
if not exist "%LLAMA_MODEL%" (
  echo Saved model not found, falling back to default.
  set "LLAMA_MODEL=%DEFAULT_MODEL%"
)
echo Using model: %LLAMA_MODEL%

:: ????????? mmproj ?????
set "LLAMA_MMPROJ="
for %%f in ("%LLAMA_MODEL%\..\*.gguf") do (
  echo %%~nf | findstr /i "mmproj" >nul && set "LLAMA_MMPROJ=%%~ff"
)

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

if not exist "%LLAMA_MODEL%" (
  echo ERROR: GGUF model not found: %LLAMA_MODEL%
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found in PATH.
  pause
  exit /b 1
)

:: Read ctx_size from config.json (fallback: 32768)
set CTX_SIZE=32768
if exist "%CD%\data\config.json" (
  for /f "usebackq tokens=*" %%i in (`powershell -NoLogo -NoProfile -Command "try{(Get-Content '%CD%\data\config.json'^|ConvertFrom-Json).ctx_size}catch{32768}"`) do set CTX_SIZE=%%i
)
echo Context size: %CTX_SIZE%

:: Save llama-server paths for in-app model switching
mkdir "%CD%\data" 2>nul
powershell -NoLogo -NoProfile -Command "$p='%CD%\data\llama_paths.json';[ordered]@{llama_exe='%LLAMA_SERVER_EXE%';active_model_path='%LLAMA_MODEL%';mmproj_path='%LLAMA_MMPROJ%';n_gpu_layers=-1}|ConvertTo-Json|Out-File $p -Encoding ascii -Force"

:: llama-server ????????????mmproj ????????????
set "LLAMA_CMD="%LLAMA_SERVER_EXE%" --model "%LLAMA_MODEL%" --host 127.0.0.1 --port 8080 --ctx-size %CTX_SIZE% --n-gpu-layers -1 --flash-attn on --parallel 1"
if defined LLAMA_MMPROJ (
  if exist "%LLAMA_MMPROJ%" set "LLAMA_CMD=%LLAMA_CMD% --mmproj "%LLAMA_MMPROJ%""
)

echo Starting llama-server...
start "LM Chat llama-server" /min cmd /c "%LLAMA_CMD%"

echo Starting backend...
start "LM Chat Backend" /min cmd /c "set LLAMA_SERVER_BASE_URL=http://127.0.0.1:8080 && set LLAMA_MODEL=Huihui-Qwen3.5-27B-abliterated && "%CONDA_EXE%" run --no-capture-output -n main python -m uvicorn backend.server:app --reload"

echo Starting frontend...
start "LM Chat Frontend" /min cmd /c "npm run dev"

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
