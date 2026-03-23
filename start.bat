@echo off
setlocal

cd /d "%~dp0"

set "CONDA_EXE=C:\Users\kenyo\miniconda3\Scripts\conda.exe"
set "LLAMA_SERVER_EXE=%CD%\bin\llama-server\llama-b8466-bin-win-cuda-13.1-x64\llama-server.exe"
set "LLAMA_MODEL=%CD%\models\Huihui-Qwen3.5-27B-abliterated-GGUF\Huihui-Qwen3.5-27B-abliterated.Q4_K_M.gguf"
set "LLAMA_MMPROJ=%CD%\models\Huihui-Qwen3.5-27B-abliterated-GGUF\Huihui-Qwen3.5-27B-abliterated.mmproj-f16.gguf"

if not exist "%CONDA_EXE%" (
  echo conda.exe not found: %CONDA_EXE%
  exit /b 1
)

if not exist "%LLAMA_SERVER_EXE%" (
  echo llama-server.exe not found: %LLAMA_SERVER_EXE%
  exit /b 1
)

if not exist "%LLAMA_MODEL%" (
  echo GGUF model not found: %LLAMA_MODEL%
  exit /b 1
)

if not exist "%LLAMA_MMPROJ%" (
  echo mmproj model not found: %LLAMA_MMPROJ%
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found in PATH.
  exit /b 1
)

echo Starting llama-server...
start "LM Chat llama-server" /min cmd /c ""%LLAMA_SERVER_EXE%" --model "%LLAMA_MODEL%" --mmproj "%LLAMA_MMPROJ%" --host 127.0.0.1 --port 8080 --ctx-size 32768 --n-gpu-layers -1 --flash-attn on --parallel 1"

echo Starting backend...
start "LM Chat Backend" /min cmd /c "set LLAMA_SERVER_BASE_URL=http://127.0.0.1:8080 && set LLAMA_MODEL=Huihui-Qwen3.5-27B-abliterated && "%CONDA_EXE%" run --no-capture-output -n main python -m uvicorn backend.server:app --reload"

echo Starting frontend...
start "LM Chat Frontend" /min cmd /c "npm run dev"

echo Waiting for frontend on http://127.0.0.1:5173 ...
powershell -NoLogo -Command "$ProgressPreference='SilentlyContinue'; $url='http://127.0.0.1:5173'; for($i=0; $i -lt 60; $i++){ try { Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo Frontend did not become ready within 60 seconds.
  echo Please check the minimized LM Chat Frontend window.
  exit /b 1
)

echo Launching Electron...
set "VITE_DEV_SERVER_URL=http://127.0.0.1:5173"
call npm run electron:dev

echo Electron closed. Stopping backend, frontend, and llama-server...
taskkill /fi "WINDOWTITLE eq LM Chat Backend" /f /t >nul 2>nul
taskkill /fi "WINDOWTITLE eq LM Chat Frontend" /f /t >nul 2>nul
taskkill /fi "WINDOWTITLE eq LM Chat llama-server" /f /t >nul 2>nul

endlocal
exit
