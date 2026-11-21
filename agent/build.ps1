# Compila el agente en Windows: carga el entorno de Visual Studio y usa los presets de CMake.
# Uso:  .\build.ps1            (configura y compila)
#       .\build.ps1 -Clean     (borra build/ antes)
param([switch]$Clean)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($Clean -and (Test-Path build)) { Remove-Item -Recurse -Force build }

# 1. Entorno de Visual Studio (compilador, ninja, vcpkg incluido)
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsPath = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Llvm.Clang -property installationPath
if (-not $vsPath) { throw "No se encontro Visual Studio con clang-cl" }
Import-Module "$vsPath\Common7\Tools\Microsoft.VisualStudio.DevShell.dll"
Enter-VsDevShell -VsInstallPath $vsPath -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64' | Out-Null

if (-not $env:VCPKG_ROOT) { $env:VCPKG_ROOT = "$vsPath\VC\vcpkg" }

# 2. Entorno virtual de Python (nanopb lo necesita para generar código)
if (-not (Test-Path venv\Scripts\python.exe)) {
    python -m venv venv
    .\venv\Scripts\python.exe -m pip install --quiet protobuf grpcio-tools requests
}

# chiaki aplica un parche a curl con "git apply" dentro de build/. Como build/ está dentro
# de nuestro repo, git se salta el parche ("Skipped patch"). El techo evita que git
# encuentre nuestro repo desde build/ y lo aplique como un parche normal.
# Techo = agent/: desde build/ git no puede subir a agent/ ni más arriba.
$env:GIT_CEILING_DIRECTORIES = $PSScriptRoot

# 3. Configurar y compilar
# En PowerShell 5.1, 'Stop' convierte cualquier aviso de CMake (stderr) en error fatal.
# Para los comandos nativos usamos 'Continue' y revisamos $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
# CMake ejecuta "git apply" desde su carpeta actual, así que configuramos desde build/
# (debajo del techo de git) indicando el código fuente con -S.
New-Item -ItemType Directory -Force build | Out-Null
Push-Location build
cmake -S $PSScriptRoot --preset windows-release
$configExit = $LASTEXITCODE
Pop-Location
if ($configExit -ne 0) { throw "Fallo la configuracion de CMake" }
cmake --build build\release
if ($LASTEXITCODE -ne 0) { throw "Fallo la compilacion" }

Write-Host "Listo: build\release\ps4-agent.exe"
