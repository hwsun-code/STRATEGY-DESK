$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$source = Join-Path $scriptDir "index.html"
$target = "D:\Codex\equity-strategy-workstation.html"
$backup = "D:\Codex\equity-strategy-workstation.backup-before-realtime.html"

if (!(Test-Path -LiteralPath $source)) {
  Write-Host "Source file not found:" -ForegroundColor Red
  Write-Host $source -ForegroundColor Red
  Read-Host "Press Enter to exit"
  exit 1
}

if (Test-Path -LiteralPath $target) {
  Copy-Item -LiteralPath $target -Destination $backup -Force
  Write-Host "Backup created:" -ForegroundColor Yellow
  Write-Host $backup -ForegroundColor Yellow
}

Copy-Item -LiteralPath $source -Destination $target -Force
Write-Host "Updated original D drive file:" -ForegroundColor Green
Write-Host $target -ForegroundColor Green
Read-Host "Press Enter to exit"
