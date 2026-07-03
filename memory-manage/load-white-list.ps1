$ErrorActionPreference = "Stop"

$configPath = Join-Path $PSScriptRoot "WhiteList.json"
$runtimePath = Join-Path $PSScriptRoot "WhiteList.runtime.js"
$domains = @()

try {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if ($null -eq $config.white_list) {
    throw "Missing white_list array."
  }
  if ($config.white_list -isnot [System.Array]) {
    throw "white_list must be a JSON array."
  }

  foreach ($item in @($config.white_list)) {
    if ($item -isnot [string]) {
      throw "Every white_list item must be a domain string."
    }

    $value = $item.Trim()
    if ($value) {
      $domains += $value
    }
  }
} catch {
  Write-Warning "WhiteList.json is invalid; continuing with an empty white list. $($_.Exception.Message)"
  $domains = @()
}

if ($domains.Count -eq 0) {
  $json = "[]"
} else {
  $json = ConvertTo-Json -InputObject $domains -Compress
  if ($domains.Count -eq 1 -and -not $json.StartsWith("[")) {
    $json = "[$json]"
  }
}

$runtimeSource = "window.__FREE_CANVAS_MEMORY_WHITE_LIST__ = $json;"
Set-Content -LiteralPath $runtimePath -Value $runtimeSource -Encoding UTF8

Write-Host "[Memory Manager] Loaded $($domains.Count) white-list domain(s)."
