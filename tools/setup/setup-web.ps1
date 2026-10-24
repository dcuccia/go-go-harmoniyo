#Requires -Version 7.0
<#
.SYNOPSIS
    Idempotent setup for the web stack carried forward by ADR-0004/0005: the S1 phone host and
    controller, S4 web host, S5 chart pipeline, and I2 web game.

.DESCRIPTION
    Steps (each one is skipped if it's already done):
      1. Node.js 22+ (winget OpenJS.NodeJS.LTS; machine-wide MSI, so it needs -AllowElevation)
      2. npm ci per project, skipped when node_modules matches package-lock.json
      3. Build (S4, I2), skipped when dist/ is newer than every tracked input
      4. Smoke test: typecheck + unit tests per project (always runs unless -SkipSmoke)
    Prints a status table at the end. Exit code: 0 ok, 1 failed, 2 owner action needed.
    Stores no secrets. Logs go to $env:TEMP\handbell-setup.

.EXAMPLE
    pwsh tools/setup/setup-web.ps1                 # set up everything, then smoke-test
.EXAMPLE
    pwsh tools/setup/setup-web.ps1 -DryRun         # report what would change
.EXAMPLE
    pwsh tools/setup/setup-web.ps1 -Project i2-web-phones -Force
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    # Projects to set up (default: all carried-forward web projects).
    [ValidateSet('s1-phone-bell', 's5-chart-pipeline', 's4-web-host', 'i2-web-phones')]
    [string[]]$Project = @('s1-phone-bell', 's5-chart-pipeline', 's4-web-host', 'i2-web-phones'),
    [switch]$SkipBuild,
    [switch]$SkipSmoke,
    # Re-run npm ci and builds even if they look up to date.
    [switch]$Force,
    # Allow steps that raise a UAC prompt (Node.js MSI install).
    [switch]$AllowElevation,
    # Same as -WhatIf: report what would change, change nothing.
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
Initialize-Setup -Name 'setup-web' -DryRun ($DryRun -or $WhatIfPreference)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$minNode = 22

# Build inputs include sibling spikes that a project imports from (I2 imports S1, S4, S5 code).
$catalog = [ordered]@{
    's1-phone-bell'     = @{ Build = $null; Smoke = @('typecheck', 'test'); Inputs = @() }
    # S5's build.mjs regenerates tracked charts/exports, so setup doesn't run it.
    's5-chart-pipeline' = @{ Build = $null; Smoke = @('test'); Inputs = @() }
    's4-web-host'       = @{ Build = 'build'; Smoke = @('test'); Inputs = @() }
    'i2-web-phones'     = @{ Build = 'build'; Smoke = @('typecheck', 'test'); Inputs = @('spikes/s4-web-host/src', 'spikes/s1-phone-bell/src', 'spikes/s5-chart-pipeline/charts', 'spikes/s5-chart-pipeline/src') }
}
# I2 builds against S4's node_modules (three.js resolves from the S4 source it imports).
if ($Project -contains 'i2-web-phones' -and $Project -notcontains 's4-web-host') { $Project += 's4-web-host' }
$selected = @($catalog.Keys | Where-Object { $Project -contains $_ })

function Get-NodeMajor {
    if (-not (Test-Command node)) { return 0 }
    $v = (node --version) -replace '^v', ''
    return [int]($v.Split('.')[0])
}

# Newest LastWriteTimeUtc among git-tracked build inputs under the given repo-relative paths
# (results/ and Markdown are outputs or docs, not inputs).
function Get-NewestTrackedWrite {
    param([string[]]$Paths)
    $files = git -C $repo ls-files -- @Paths | Where-Object { $_ -notmatch '/results/' -and $_ -notmatch '\.md$' }
    $newest = [datetime]::MinValue
    foreach ($f in $files) {
        $p = Join-Path $repo $f
        if (Test-Path -LiteralPath $p) {
            $t = (Get-Item -LiteralPath $p).LastWriteTimeUtc
            if ($t -gt $newest) { $newest = $t }
        }
    }
    return $newest
}

# --- 1. Node.js -------------------------------------------------------------------------------
$nodeOk = $false
$major = Get-NodeMajor
if ($major -ge $minNode) {
    Add-SetupResult 'Node.js' ok "$(node --version) (npm $(npm --version))"
    $nodeOk = $true
} else {
    $why = if ($major -eq 0) { 'not found' } else { "v$major is older than $minNode" }
    Write-Host "  Node.js $why."
    if (Install-WingetPackage -Step 'Node.js' -Id 'OpenJS.NodeJS.LTS' -NeedsElevation -AllowElevation $AllowElevation) {
        $major = Get-NodeMajor
        if ($major -ge $minNode) { Add-SetupResult 'Node.js' done "installed $(node --version)"; $nodeOk = $true }
        else { Add-SetupResult 'Node.js' failed 'install finished but node >= 22 is not on PATH; open a new terminal and re-run' }
    }
}

# --- 2. npm ci ----------------------------------------------------------------------------------
$depsOk = @{}
foreach ($name in $selected) {
    $dir = Join-Path $repo "spikes\$name"
    $step = "deps: $name"
    if (-not $nodeOk) { Add-SetupResult $step skipped 'needs Node.js'; continue }
    $lock = Join-Path $dir 'package-lock.json'
    if (-not (Test-Path $lock)) {
        $pkg = Get-Content (Join-Path $dir 'package.json') -Raw | ConvertFrom-Json -AsHashtable
        if (-not $pkg['dependencies'] -and -not $pkg['devDependencies']) {
            Add-SetupResult $step ok 'zero-dependency package'
            $depsOk[$name] = $true
        } else {
            Add-SetupResult $step failed 'package.json has dependencies but no package-lock.json'
        }
        continue
    }
    $hash = Get-Sha256 $lock
    $stamp = Join-Path $dir 'node_modules\.handbell-setup.sha256'
    $hidden = Join-Path $dir 'node_modules\.package-lock.json'
    $current = (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq $hash)
    # Installs made before this script existed have no stamp. npm's hidden lockfile being newer
    # than package-lock.json is the same freshness test npm itself uses.
    $hiddenFresh = (Test-Path $hidden) -and ((Get-Item $hidden).LastWriteTimeUtc -ge (Get-Item $lock).LastWriteTimeUtc)
    if (-not $Force -and ($current -or $hiddenFresh)) {
        if (-not $current -and -not (Test-SetupDryRun)) { Set-Content -LiteralPath $stamp -Value $hash -NoNewline -WhatIf:$false }
        Add-SetupResult $step ok 'node_modules matches package-lock.json'
        $depsOk[$name] = $true
        continue
    }
    try {
        $ran = Invoke-SetupChange "npm ci in spikes/$name" {
            Invoke-Logged -LogName "npm-ci-$name" -WorkingDirectory $dir -Command { npm ci --no-audit --no-fund } | Out-Null
            Set-Content -LiteralPath $stamp -Value $hash -NoNewline -WhatIf:$false
        }
        if ($ran) { Add-SetupResult $step done 'npm ci'; $depsOk[$name] = $true } else { Add-SetupResult $step would 'npm ci' }
    } catch {
        Add-SetupResult $step failed "npm ci: $_"
    }
}

# --- 3. Build -----------------------------------------------------------------------------------
foreach ($name in $selected) {
    $entry = $catalog[$name]
    if (-not $entry.Build) { continue }
    $step = "build: $name"
    if ($SkipBuild) { Add-SetupResult $step skipped '-SkipBuild'; continue }
    $deps = @($name) + $(if ($name -eq 'i2-web-phones') { @('s4-web-host') } else { @() })
    if (@($deps | Where-Object { -not $depsOk[$_] }).Count) {
        $st = if (Test-SetupDryRun) { 'would' } else { 'skipped' }
        Add-SetupResult $step $st 'after dependencies are installed'
        continue
    }
    $dir = Join-Path $repo "spikes\$name"
    $out = Join-Path $dir 'dist\index.html'
    $newest = Get-NewestTrackedWrite (@("spikes/$name") + $entry.Inputs)
    if (-not $Force -and (Test-Path $out) -and (Get-Item $out).LastWriteTimeUtc -gt $newest) {
        Add-SetupResult $step ok 'dist/ is newer than its sources'
        continue
    }
    try {
        $ran = Invoke-SetupChange "npm run build in spikes/$name" {
            Invoke-Logged -LogName "build-$name" -WorkingDirectory $dir -Command { npm run build } | Out-Null
        }
        if ($ran) { Add-SetupResult $step done 'dist/ built' } else { Add-SetupResult $step would 'npm run build' }
    } catch {
        Add-SetupResult $step failed "build: $_"
    }
}

# --- 4. Smoke test ------------------------------------------------------------------------------
foreach ($name in $selected) {
    $step = "smoke: $name"
    $scripts = $catalog[$name].Smoke -join ' + '
    if ($SkipSmoke) { Add-SetupResult $step skipped '-SkipSmoke'; continue }
    if (Test-SetupDryRun) { Add-SetupResult $step would "npm run $scripts"; continue }
    if (-not $depsOk[$name]) { Add-SetupResult $step skipped 'dependencies not installed'; continue }
    $dir = Join-Path $repo "spikes\$name"
    try {
        $summary = foreach ($s in $catalog[$name].Smoke) {
            $log = Invoke-Logged -LogName "smoke-$name-$s" -WorkingDirectory $dir -Command { npm run $s }
            # node:test prints "# pass N"; vitest prints "Tests  N passed".
            $text = (Get-Content $log -Raw) -replace "`e\[[0-9;]*m", ''
            if ($text -match '# pass (\d+)') { "$s $($Matches[1]) passed" }
            elseif ($text -match 'Tests\s+(\d+) passed') { "$s $($Matches[1]) passed" }
            else { "$s ok" }
        }
        Add-SetupResult $step ok ($summary -join ', ')
    } catch {
        Add-SetupResult $step failed "$_"
    }
}

$code = Write-SetupSummary
if ($code -eq 0 -and -not (Test-SetupDryRun)) {
    Write-Host ''
    Write-Host 'Next: play the I2 web game on the TV with phones:' -ForegroundColor Cyan
    Write-Host '  npm start   # at the repo root; allow Node.js on Private networks if Windows asks'
}
exit $code
