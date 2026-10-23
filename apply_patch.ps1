param(
  [Parameter(Mandatory=$false)]
  [string]$RepoPath = "."
)

$ErrorActionPreference = "Stop"
$RepoPath = (Resolve-Path $RepoPath).Path
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FilesRoot = Join-Path $PatchRoot "files"

if (-not (Test-Path (Join-Path $RepoPath "api"))) {
  throw "Nie znaleziono folderu api w: $RepoPath"
}

$delete = @(
  "api/access.js",
  "api/admin/sheets-check.js",
  "api/overview.js",
  "api/self-service.js",
  "overview.js",
  "self-service.js"
)

foreach ($rel in $delete) {
  $target = Join-Path $RepoPath $rel
  if (Test-Path $target) {
    Remove-Item -Force $target
    Write-Host "Usunieto: $rel"
  } else {
    Write-Host "Brak (OK): $rel"
  }
}

$copy = @(
  "api/_lib/access.js",
  "api/accounts/self-service.js",
  "api/admin/overview.js",
  "api/admin/accounts.js"
)

foreach ($rel in $copy) {
  $src = Join-Path $FilesRoot $rel
  $dst = Join-Path $RepoPath $rel
  $dstDir = Split-Path -Parent $dst
  New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
  Copy-Item -Force $src $dst
  Write-Host "Zapisano: $rel"
}

Write-Host "Gotowe. Teraz sprawdz zmiany w GitHub Desktop / git diff i wykonaj commit + push."
