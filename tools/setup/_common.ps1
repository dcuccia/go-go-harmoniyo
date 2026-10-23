# Shared helpers for tools/setup/*.ps1. Dot-source this file; don't run it directly.
# Results are collected in a list and printed as a status table at the end.
# Status values:
#   ok      already in place (no change)
#   done    changed by this run
#   would   a change that -DryRun / -WhatIf skipped
#   skipped skipped by a switch
#   action  needs the owner (manual or admin step)
#   failed  failed

Set-StrictMode -Version 3.0

$script:SetupResults = [System.Collections.Generic.List[object]]::new()
$script:SetupDryRun = $false
$script:SetupName = 'setup'
$script:SetupLogDir = Join-Path ([IO.Path]::GetTempPath()) 'handbell-setup'
$script:SetupStart = Get-Date

function Initialize-Setup {
    param([Parameter(Mandatory)][string]$Name, [bool]$DryRun)
    $script:SetupName = $Name
    $script:SetupDryRun = $DryRun
    $script:SetupStart = Get-Date
    if (-not $IsWindows) {
        Write-Warning "$Name targets Windows. macOS/Linux variants are follow-ups (see tools/setup/README.md)."
    }
    New-Item -ItemType Directory -Force -Path $script:SetupLogDir -WhatIf:$false | Out-Null
    $mode = if ($DryRun) { ' (dry run: no changes will be made)' } else { '' }
    Write-Host "== $Name$mode ==" -ForegroundColor Cyan
}

function Add-SetupResult {
    param(
        [Parameter(Mandatory)][string]$Step,
        [Parameter(Mandatory)][ValidateSet('ok', 'done', 'would', 'skipped', 'action', 'failed')][string]$Status,
        [string]$Detail = ''
    )
    $script:SetupResults.Add([pscustomobject]@{ Step = $Step; Status = $Status; Detail = $Detail })
    $color = switch ($Status) { 'ok' { 'Green' } 'done' { 'Green' } 'would' { 'Yellow' } 'skipped' { 'DarkGray' } 'action' { 'Yellow' } 'failed' { 'Red' } }
    Write-Host ("  [{0,-7}] {1}{2}" -f $Status, $Step, $(if ($Detail) { " - $Detail" } else { '' })) -ForegroundColor $color
}

function Test-SetupDryRun { $script:SetupDryRun }

# Runs $Action unless this is a dry run. Returns $true when the action ran.
function Invoke-SetupChange {
    param([Parameter(Mandatory)][string]$Description, [Parameter(Mandatory)][scriptblock]$Action)
    if ($script:SetupDryRun) {
        Write-Host "  (dry run) would: $Description" -ForegroundColor DarkYellow
        return $false
    }
    Write-Host "  -> $Description" -ForegroundColor DarkCyan
    & $Action | Out-Host
    return $true
}

# Runs a native command with its output in a log file. Throws on a non-zero exit code.
function Invoke-Logged {
    param([Parameter(Mandatory)][string]$LogName, [Parameter(Mandatory)][scriptblock]$Command, [string]$WorkingDirectory)
    $log = Join-Path $script:SetupLogDir "$LogName.log"
    if ($WorkingDirectory) { Push-Location $WorkingDirectory }
    try {
        & $Command *> $log
        $code = $LASTEXITCODE
    } finally {
        if ($WorkingDirectory) { Pop-Location }
    }
    if ($code -ne 0) { throw "exit code $code; see $log" }
    return $log
}

function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (@($machine, $user) | Where-Object { $_ }) -join ';'
}

function Test-Command { param([string]$Name) [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Test-IsAdmin {
    if (-not $IsWindows) { return $false }
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Installs a winget package. Machine-scope installers raise a UAC prompt, so they only run
# with -AllowElevation (or from an elevated shell). Otherwise the step is reported as an
# owner action. Returns $true when the install ran.
function Install-WingetPackage {
    param(
        [Parameter(Mandatory)][string]$Step,
        [Parameter(Mandatory)][string]$Id,
        [switch]$NeedsElevation,
        [bool]$AllowElevation
    )
    $cmd = "winget install --id $Id -e --accept-source-agreements --accept-package-agreements"
    if (-not (Test-Command winget)) {
        Add-SetupResult $Step action "winget not found; install App Installer from the Microsoft Store, then run: $cmd"
        return $false
    }
    if ($NeedsElevation -and -not $AllowElevation -and -not (Test-IsAdmin)) {
        Add-SetupResult $Step action "needs admin (UAC). Re-run with -AllowElevation, or run: $cmd"
        return $false
    }
    $ran = Invoke-SetupChange $cmd {
        winget install --id $Id -e --silent --accept-source-agreements --accept-package-agreements
        Update-SessionPath
    }
    if (-not $ran) { Add-SetupResult $Step would $cmd; return $false }
    return $true
}

function Get-Sha256 { param([string]$Path) (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

# Prints the status table. Returns the exit code: 1 if anything failed, 2 if an owner action
# is pending, else 0.
function Write-SetupSummary {
    $elapsed = (Get-Date) - $script:SetupStart
    Write-Host ''
    Write-Host ("== {0} summary ({1:mm\:ss}) ==" -f $script:SetupName, $elapsed) -ForegroundColor Cyan
    $script:SetupResults | Format-Table -AutoSize -Wrap Step, Status, Detail | Out-String -Width 160 | Write-Host
    Write-Host "Logs: $script:SetupLogDir"
    if (@($script:SetupResults | Where-Object Status -EQ 'failed').Count) { return 1 }
    if (@($script:SetupResults | Where-Object Status -EQ 'action').Count) { return 2 }
    return 0
}
