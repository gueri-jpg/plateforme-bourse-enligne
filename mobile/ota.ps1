# ============================================================================
# ota.ps1 — Publier une OTA sur la branche preview avec les URLs Azure
#
# Usage : .\ota.ps1 "message de la mise a jour"
#
# EXPO_NO_DOTENV=1  → désactive le chargement du .env local
# Les vars Azure ci-dessous sont injectées directement dans le processus
# Metro les lit depuis process.env et les inline dans le bundle.
# ============================================================================

param(
    [Parameter(Mandatory=$true)]
    [string]$Message
)

# ── Auto-bump APP_VERSION (patch) dans config.ts ─────────────────────────────
$configPath = Join-Path $PSScriptRoot "constants\config.ts"
$configContent = Get-Content $configPath -Raw
if ($configContent -match "APP_VERSION = '(\d+)\.(\d+)\.(\d+)'") {
    $major = [int]$Matches[1]
    $minor = [int]$Matches[2]
    $patch = [int]$Matches[3] + 1
    $newVersion = "$major.$minor.$patch"
    $configContent = $configContent -replace "APP_VERSION = '\d+\.\d+\.\d+'", "APP_VERSION = '$newVersion'"
    Set-Content $configPath $configContent -Encoding utf8 -NoNewline
    Write-Host "Version → $newVersion" -ForegroundColor Green
}

$env:EXPO_NO_DOTENV                   = "1"
$env:EXPO_PUBLIC_API_URL              = "https://api.cfconsultancy.org"
$env:EXPO_PUBLIC_KEYCLOAK_URL         = "https://auth.cfconsultancy.org"
$env:EXPO_PUBLIC_KEYCLOAK_REALM       = "bourse-en-ligne"
$env:EXPO_PUBLIC_KEYCLOAK_CLIENT_ID   = "mobile-app"
$env:EXPO_PUBLIC_MARKET_OPEN_HOUR     = "9"
$env:EXPO_PUBLIC_MARKET_CLOSE_HOUR    = "15"
$env:EXPO_PUBLIC_MARKET_CLOSE_MIN     = "30"
$env:EXPO_PUBLIC_BANQUE_DASHBOARD_URL = "https://banquedigitale.cfconsultancy.org"

Write-Host "OTA → branch: preview | API: $($env:EXPO_PUBLIC_API_URL)" -ForegroundColor Cyan
eas update --branch preview --message $Message
