@echo off
setlocal

cd /d "%~dp0"

set "VENV_PYTHON=%~dp0.venv\Scripts\python.exe"

if defined LM_CHAT_LLAMA_SERVER_EXE (
  set "LLAMA_SERVER_EXE=%LM_CHAT_LLAMA_SERVER_EXE%"
) else (
  for /f "usebackq delims=" %%i in (`powershell -NoLogo -NoProfile -Command "$pathsFile=Join-Path (Get-Location) 'data\llama_paths.json';if(Test-Path -LiteralPath $pathsFile){try{$paths=Get-Content -LiteralPath $pathsFile -Raw -Encoding UTF8|ConvertFrom-Json;$exe=[string]$paths.llama_exe;if($exe -and (Test-Path -LiteralPath $exe)){Write-Output $exe;exit 0}}catch{}};$roots=@((Join-Path (Get-Location) 'data\llama_cpp\versions'),(Join-Path (Get-Location) 'bin\llama-server'));$candidates=@();foreach($root in $roots){if(Test-Path -LiteralPath $root){$candidates+=Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue|ForEach-Object{$exe=Join-Path $_.FullName 'llama-server.exe';if(Test-Path -LiteralPath $exe){$build=0;if($_.Name -match 'b(\d+)'){$build=[int64]$matches[1]};[pscustomobject]@{Build=$build;LastWriteTime=$_.LastWriteTime;Exe=$exe}}}}};$candidates=$candidates|Sort-Object -Property @{Expression='Build';Descending=$true},@{Expression='LastWriteTime';Descending=$true};if(-not $candidates){exit 1};$candidates[0].Exe"`) do set "LLAMA_SERVER_EXE=%%i"
)

if not exist "%VENV_PYTHON%" (
  echo ERROR: venv python not found: %VENV_PYTHON%
  echo INFO: Create the venv with:
  echo INFO:   py -m venv .venv
  echo INFO:   .venv\Scripts\python -m pip install -r backend\requirements.txt
  pause
  exit /b 1
)

if not defined LLAMA_SERVER_EXE (
  echo INFO: llama-server.exe was not found yet.
  echo INFO: The app will start without a llama.cpp runtime. Install it from Runtime settings.
) else if not exist "%LLAMA_SERVER_EXE%" (
  echo INFO: llama-server.exe was not found: %LLAMA_SERVER_EXE%
  echo INFO: The app will start without a llama.cpp runtime. Install it from Runtime settings.
  set "LLAMA_SERVER_EXE="
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found in PATH.
  pause
  exit /b 1
)

if defined LM_CHAT_BACKEND_PORT (
  set "BACKEND_PORT=%LM_CHAT_BACKEND_PORT%"
) else (
  for /f %%i in ('powershell -NoLogo -NoProfile -Command "$start=8000;$end=8100;for($port=$start;$port -le $end;$port++){try{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port);$listener.Start();$listener.Stop();Write-Output $port;exit 0}catch{if($listener){$listener.Stop()}}};exit 1"') do set "BACKEND_PORT=%%i"
)

if defined LM_CHAT_FRONTEND_PORT (
  set "FRONTEND_PORT=%LM_CHAT_FRONTEND_PORT%"
) else (
  for /f %%i in ('powershell -NoLogo -NoProfile -Command "$start=5173;$end=5273;for($port=$start;$port -le $end;$port++){try{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port);$listener.Start();$listener.Stop();Write-Output $port;exit 0}catch{if($listener){$listener.Stop()}}};exit 1"') do set "FRONTEND_PORT=%%i"
)

if defined LM_CHAT_LLAMA_PORT (
  set "LLAMA_PORT=%LM_CHAT_LLAMA_PORT%"
) else (
  for /f %%i in ('powershell -NoLogo -NoProfile -Command "$start=8080;$end=8180;for($port=$start;$port -le $end;$port++){try{$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$port);$listener.Start();$listener.Stop();Write-Output $port;exit 0}catch{if($listener){$listener.Stop()}}};exit 1"') do set "LLAMA_PORT=%%i"
)

if not defined BACKEND_PORT (
  echo ERROR: Failed to choose backend port.
  pause
  exit /b 1
)

if not defined FRONTEND_PORT (
  echo ERROR: Failed to choose frontend port.
  pause
  exit /b 1
)

if not defined LLAMA_PORT (
  echo ERROR: Failed to choose llama-server port.
  pause
  exit /b 1
)

if "%BACKEND_PORT%"=="%FRONTEND_PORT%" (
  echo ERROR: backend and frontend ports resolved to the same value.
  pause
  exit /b 1
)

if "%BACKEND_PORT%"=="%LLAMA_PORT%" (
  echo ERROR: backend and llama ports resolved to the same value.
  pause
  exit /b 1
)

if "%FRONTEND_PORT%"=="%LLAMA_PORT%" (
  echo ERROR: frontend and llama ports resolved to the same value.
  pause
  exit /b 1
)

set "BACKEND_URL=http://127.0.0.1:%BACKEND_PORT%"
set "FRONTEND_URL=http://127.0.0.1:%FRONTEND_PORT%"
set "LLAMA_BASE_URL=http://127.0.0.1:%LLAMA_PORT%"
set "BACKEND_TITLE=LM Chat Backend %BACKEND_PORT%"
set "FRONTEND_TITLE=LM Chat Frontend %FRONTEND_PORT%"
set "LLAMA_SERVER_BASE_URL=%LLAMA_BASE_URL%"
set "LLAMA_MODEL=Huihui-Qwen3.5-27B-abliterated"
set "VITE_API_BASE_URL=%BACKEND_URL%"
set "LM_CHAT_API_BASE_URL=%BACKEND_URL%"

echo Using backend  : %BACKEND_URL%
echo Using frontend : %FRONTEND_URL%
echo Using llama    : %LLAMA_BASE_URL%
if defined LLAMA_SERVER_EXE (
  echo Llama server   : %LLAMA_SERVER_EXE%
) else (
  echo Llama server   : not configured
)

mkdir "%CD%\data" 2>nul
powershell -NoLogo -NoProfile -Command "$p='%CD%\data\llama_paths.json';$data=[ordered]@{llama_exe='%LLAMA_SERVER_EXE%';active_model_path='';mmproj_path='';n_gpu_layers=-1;llama_server_pid=$null;llama_server_base_url='%LLAMA_BASE_URL%'};if(Test-Path -LiteralPath $p){try{$old=Get-Content -LiteralPath $p -Raw -Encoding UTF8|ConvertFrom-Json;foreach($prop in $old.PSObject.Properties){$data[$prop.Name]=$prop.Value}}catch{}};$data['llama_exe']='%LLAMA_SERVER_EXE%';$data['llama_server_pid']=$null;$data['llama_server_base_url']='%LLAMA_BASE_URL%';$data|ConvertTo-Json|Out-File $p -Encoding utf8 -Force"

echo Starting backend...
start "%BACKEND_TITLE%" /min "%VENV_PYTHON%" -m uvicorn backend.server:app --reload --host 127.0.0.1 --port %BACKEND_PORT%

echo Starting frontend...
start "%FRONTEND_TITLE%" /min cmd /c "call npm run dev -- --port %FRONTEND_PORT%"

echo Waiting for backend on %BACKEND_URL% ...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue';$url='%BACKEND_URL%/health';for($i=0;$i-lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2|Out-Null;exit 0}catch{Start-Sleep -Seconds 1}};exit 1"
if errorlevel 1 (
  echo ERROR: Backend did not become ready within 60 seconds.
  pause
  exit /b 1
)

echo Waiting for frontend on %FRONTEND_URL% ...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue';$url='%FRONTEND_URL%';for($i=0;$i-lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2|Out-Null;exit 0}catch{Start-Sleep -Seconds 1}};exit 1"
if errorlevel 1 (
  echo ERROR: Frontend did not become ready within 60 seconds.
  pause
  exit /b 1
)

echo Launching Electron...
set "VITE_DEV_SERVER_URL=%FRONTEND_URL%"
call npm run electron:dev

echo Electron closed. Stopping this app's processes...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue';$url='%BACKEND_URL%/llama/eject';try{Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -TimeoutSec 10|Out-Null;Write-Host 'llama-server ejected.'}catch{Write-Host ('WARNING: Failed to request llama-server eject: '+$_.Exception.Message)}"
taskkill /fi "WINDOWTITLE eq %BACKEND_TITLE%" /f /t >nul 2>nul
taskkill /fi "WINDOWTITLE eq %FRONTEND_TITLE%" /f /t >nul 2>nul

endlocal
exit

