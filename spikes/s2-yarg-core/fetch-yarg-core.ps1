<#
.SYNOPSIS
  Fetches YARC-Official/YARG.Core at the pinned commit into ./external/YARG.Core and
  (by default) applies a small browser patch to YargLogger.

.PARAMETER NoPatch
  Leave YARG.Core pristine. Use this to reproduce the browser-wasm failure
  (PlatformNotSupportedException from YargLogger's static constructor).
#>
param([switch]$NoPatch)

$ErrorActionPreference = 'Stop'
$Sha = '9dafd346aff908b6d5b1db250eaf3a2588810c70'
$Repo = 'https://github.com/YARC-Official/YARG.Core.git'
$Dest = Join-Path $PSScriptRoot 'external\YARG.Core'

if (-not (Test-Path (Join-Path $Dest '.git'))) {
    New-Item -ItemType Directory -Force -Path $Dest | Out-Null
    git -C $Dest init --quiet
    git -C $Dest remote add origin $Repo
}
git -C $Dest fetch --quiet --depth 1 origin $Sha
git -C $Dest checkout --quiet --force $Sha
git -C $Dest clean -fdxq
Write-Host "YARG.Core checked out at $Sha"

if ($NoPatch) { Write-Host 'Leaving YARG.Core unpatched (-NoPatch).'; return }

# Patch: don't start the log-drain thread where threads are unsupported (single-threaded browser-wasm).
# Logs are still queued and can be drained with YargLogger.FlushLogQueue().
$logger = Join-Path $Dest 'YARG.Core\Logging\YargLogger.cs'
$src = [IO.File]::ReadAllText($logger)
$anchor = 'var logOutputterThread = new Thread(LogOutputter)'
$guard = "if (System.Runtime.InteropServices.RuntimeInformation.IsOSPlatform(System.Runtime.InteropServices.OSPlatform.Create(`"BROWSER`")))`n            {`n                return; // S2 PATCH: no threads on single-threaded browser-wasm; call FlushLogQueue() manually`n            }`n`n            "
if ($src.Contains('S2 PATCH')) { Write-Host 'Patch already applied.'; return }
if (-not $src.Contains($anchor)) { throw "Patch anchor not found in $logger" }
$src = $src.Replace($anchor, $guard + $anchor)
[IO.File]::WriteAllText($logger, $src, [Text.UTF8Encoding]::new($true))
Write-Host 'Applied S2 browser patch to YargLogger.cs'
