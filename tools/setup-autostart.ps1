<#
  Создаёт (или пересоздаёт) ярлык автозапуска в папке автозагрузки Windows.
  Ярлык открывает браузер сразу с загруженным расширением, в свёрнутом виде.

  Запуск:  powershell -ExecutionPolicy Bypass -File tools/setup-autostart.ps1
  Удалить: powershell -ExecutionPolicy Bypass -File tools/setup-autostart.ps1 -Remove
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$extPath = Join-Path $projectRoot 'dist\twitch-drops-farmer'
$manifest = Join-Path $extPath 'manifest.json'

if (-not (Test-Path $manifest)) {
    throw "Расширение не собрано. Сначала выполните: node tools\build.mjs"
}

$startup = [Environment]::GetFolderPath('Startup')
$link = Join-Path $startup 'Twitch Drops Farmer.lnk'

if ($Remove) {
    if (Test-Path $link) { Remove-Item $link -Force; "Ярлык автозапуска удалён: $link" }
    else { "Ярлык не найден, удалять нечего" }
    return
}

$browsers = @(
    @{ Name = 'Chrome'; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
    @{ Name = 'Chrome (x86)'; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" },
    @{ Name = 'Chrome (local)'; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" },
    @{ Name = 'Edge'; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
    @{ Name = 'Edge (x86)'; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
)
$browser = $browsers | Where-Object { Test-Path $_.Path } | Select-Object -First 1
if (-not $browser) { throw 'Не найден ни Chrome, ни Edge' }

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $browser.Path
$shortcut.Arguments = "--load-extension=`"$extPath`""
$shortcut.WorkingDirectory = Split-Path -Parent $browser.Path
$shortcut.WindowStyle = 7          # свёрнуто: не мешает при входе в Windows
$shortcut.Description = "Twitch Drops Farmer: запуск браузера с расширением"
$shortcut.IconLocation = "$($browser.Path),0"
$shortcut.Save()

"Автозапуск настроен."
"  Ярлык:     $link"
"  Браузер:   $($browser.Name) -> $($browser.Path)"
"  Расширение: $extPath"
