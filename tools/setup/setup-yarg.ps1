#Requires -Version 7.0
<#
.SYNOPSIS
    Idempotent setup for the YARG fork community track (ADR-0004): toolchain, fork checkout,
    headless Win64 build, and S5 songs prepared for YARG. Encodes what S3 Phase B and I1
    learned (docs/spikes/S3-report.md, "B0/B1 — tooling and first build").

.DESCRIPTION
    Steps (each one is skipped if it's already done):
       1. Git + Git LFS (winget; machine-wide, so it needs -AllowElevation)
       2. .NET SDK 10 (winget; needs -AllowElevation)
       3. Unity Hub (winget Unity.UnityHub installs an MSIX; the CLI lives under the package's
          InstallLocation\app\Unity Hub.exe)
       4. Unity editor 6000.3.5f2 (changeset 3fa8bc678cb0) via the Hub CLI --headless
          (writes to Program Files, so it needs -AllowElevation)
       5. Unity license: detected, never created. If missing, prints the owner step and stops
       6. Blender, portable and per-user, from a mirror with SHA-256 verification
          (download.blender.org returned 403 in S3), registered for .blend files
       7. NuGetForUnity.Cli in the tool path that the fork's build.ps1 uses
       8. Clone or fast-forward dcuccia/YARG@handbell-spike, with submodules and LFS objects
       9. Headless Win64 player build via the fork's scripts/handbell/build.ps1 (-SkipBuild)
      10. S5 songs → YARG song folders with per-ringer bell stems (S3Harness prepare; -SkipSongs)
    Prints a status table. Exit code: 0 ok, 1 failed, 2 owner action needed.
    Stores no secrets. The Unity license comes from the owner's Hub sign-in; this script only
    checks that it exists. Logs go to $env:TEMP\handbell-setup.

.EXAMPLE
    pwsh tools/setup/setup-yarg.ps1 -SkipBuild          # everything but the 2–15 min build
.EXAMPLE
    pwsh tools/setup/setup-yarg.ps1 -DryRun             # report only
.EXAMPLE
    pwsh tools/setup/setup-yarg.ps1 -AllowElevation     # new PC: allow UAC prompts for installers
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$ForkPath = 'C:\Projects\YARG-handbell',
    [string]$ForkUrl = 'https://github.com/dcuccia/YARG.git',
    [string]$Branch = 'handbell-spike',
    # Default: <ForkPath parent>\YARG-handbell-build\YARG.exe (same as the fork's build.ps1).
    [string]$BuildOutput,
    # Default: <ForkPath parent>\YARG-handbell-songs (the folder the I1 runbook adds in YARG).
    [string]$SongsPath,
    [string]$UnityVersion = '6000.3.5f2',
    [string]$UnityChangeset = '3fa8bc678cb0',
    [string]$UnityEditorRoot = 'C:\Program Files\Unity\Hub\Editor',
    [int]$UnityInstallTimeoutMinutes = 90,
    [string]$BlenderVersion = '5.2.3',
    # SHA-256 of blender-5.2.3-windows-x64.zip, verified in S3 against the mirror's checksum file.
    [string]$BlenderSha256 = '723f08a4401502561eb763cdeacf8745b31e5f3f154d287d3830d97cf75dc2fb',
    [string]$BlenderMirror = 'https://mirrors.ocf.berkeley.edu/blender/release',
    [string]$BlenderInstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs'),
    [string]$ToolPath = (Join-Path $env:LOCALAPPDATA 'yarg-handbell-tools'),
    [string]$NuGetForUnityVersion = '4.5.0',
    [switch]$SkipBuild,
    [switch]$SkipSongs,
    # Rebuild YARG and re-prepare songs even if they look up to date.
    [switch]$Force,
    # Allow steps that raise a UAC prompt (Git/Git LFS/.NET installers, Unity editor install).
    [switch]$AllowElevation,
    # Same as -WhatIf: report what would change, change nothing.
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
Initialize-Setup -Name 'setup-yarg' -DryRun ($DryRun -or $WhatIfPreference)

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectsRoot = Split-Path $ForkPath -Parent
if (-not $BuildOutput) { $BuildOutput = Join-Path $projectsRoot 'YARG-handbell-build\YARG.exe' }
if (-not $SongsPath) { $SongsPath = Join-Path $projectsRoot 'YARG-handbell-songs' }
$unityExe = Join-Path $UnityEditorRoot "$UnityVersion\Editor\Unity.exe"
$ready = @{ git = $false; lfs = $false; dotnet = $false; unity = $false; license = $false; blender = $false; nfu = $false; fork = $false }

function Finish { $code = Write-SetupSummary; exit $code }

# --- 1. Git + Git LFS ---------------------------------------------------------------------------
if (Test-Command git) {
    Add-SetupResult 'Git' ok ((git --version) -replace '^git version ', '')
    $ready.git = $true
} elseif (Install-WingetPackage -Step 'Git' -Id 'Git.Git' -NeedsElevation -AllowElevation $AllowElevation) {
    if (Test-Command git) { Add-SetupResult 'Git' done (git --version); $ready.git = $true } else { Add-SetupResult 'Git' failed 'open a new terminal and re-run' }
}
if ($ready.git) {
    git lfs version *> $null
    if ($LASTEXITCODE -eq 0) {
        Add-SetupResult 'Git LFS' ok ((git lfs version) -replace '^git-lfs/(\S+).*', '$1')
        $ready.lfs = $true
    } elseif (Install-WingetPackage -Step 'Git LFS' -Id 'GitHub.GitLFS' -NeedsElevation -AllowElevation $AllowElevation) {
        git lfs version *> $null
        if ($LASTEXITCODE -eq 0) { Add-SetupResult 'Git LFS' done 'installed'; $ready.lfs = $true } else { Add-SetupResult 'Git LFS' failed 'open a new terminal and re-run' }
    }
    if ($ready.lfs) {
        if (git config --global --get filter.lfs.process) {
            Add-SetupResult 'Git LFS hooks (global)' ok 'filter.lfs configured'
        } elseif (Invoke-SetupChange 'git lfs install --skip-repo' { git lfs install --skip-repo }) {
            Add-SetupResult 'Git LFS hooks (global)' done 'git lfs install --skip-repo'
        } else { Add-SetupResult 'Git LFS hooks (global)' would 'git lfs install --skip-repo' }
    }
} else { Add-SetupResult 'Git LFS' skipped 'needs Git' }

# --- 2. .NET SDK 10 -----------------------------------------------------------------------------
function Get-DotnetSdk10 { if (Test-Command dotnet) { dotnet --list-sdks | Where-Object { $_ -match '^10\.' } | Select-Object -Last 1 } }
$sdk = Get-DotnetSdk10
if ($sdk) {
    Add-SetupResult '.NET SDK 10' ok ($sdk -replace '\s.*$', '')
    $ready.dotnet = $true
} elseif (Install-WingetPackage -Step '.NET SDK 10' -Id 'Microsoft.DotNet.SDK.10' -NeedsElevation -AllowElevation $AllowElevation) {
    $sdk = Get-DotnetSdk10
    if ($sdk) { Add-SetupResult '.NET SDK 10' done ($sdk -replace '\s.*$', ''); $ready.dotnet = $true } else { Add-SetupResult '.NET SDK 10' failed 'open a new terminal and re-run' }
}

# --- 3. Unity Hub (MSIX) ------------------------------------------------------------------------
function Get-UnityHub { Get-AppxPackage -Name 'UnityTechnologies.UnityHub' -ErrorAction SilentlyContinue | Select-Object -First 1 }
$hub = Get-UnityHub
if ($hub) {
    Add-SetupResult 'Unity Hub (MSIX)' ok "v$($hub.Version)"
} elseif (Install-WingetPackage -Step 'Unity Hub (MSIX)' -Id 'Unity.UnityHub') {
    $hub = Get-UnityHub
    if ($hub) { Add-SetupResult 'Unity Hub (MSIX)' done "v$($hub.Version)" } else { Add-SetupResult 'Unity Hub (MSIX)' failed 'winget finished but the UnityTechnologies.UnityHub package is not registered' }
}
$hubExe = if ($hub) { Join-Path $hub.InstallLocation 'app\Unity Hub.exe' } else { $null }

# --- 4. Unity editor ----------------------------------------------------------------------------
$editorStep = "Unity $UnityVersion ($UnityChangeset)"
function Test-UnityEditor {
    (Test-Path $unityExe) -and ((Get-Item $unityExe).VersionInfo.ProductVersion -like "*$UnityChangeset*")
}
if (Test-UnityEditor) {
    Add-SetupResult $editorStep ok $unityExe
    $ready.unity = $true
} elseif (Test-Path $unityExe) {
    Add-SetupResult $editorStep failed "found $unityExe but its changeset is $((Get-Item $unityExe).VersionInfo.ProductVersion)"
} elseif (-not $hubExe) {
    $st = if (Test-SetupDryRun) { 'would' } else { 'skipped' }
    Add-SetupResult $editorStep $st 'install via the Unity Hub CLI after the Hub is installed'
} elseif (-not $AllowElevation -and -not (Test-IsAdmin)) {
    Add-SetupResult $editorStep action "8.2 GB install into Program Files needs admin (UAC). Re-run with -AllowElevation, or run: & '$hubExe' --% -- --headless install --version $UnityVersion --changeset $UnityChangeset"
} else {
    $hubArgs = "-- --headless install --version $UnityVersion --changeset $UnityChangeset"
    $ran = Invoke-SetupChange "Unity Hub --headless install $UnityVersion (~35 min, 8.2 GB)" {
        $p = Start-Process -FilePath $hubExe -ArgumentList $hubArgs -PassThru -WindowStyle Hidden
        # S3: the installer's Dism.exe child step can hang at 0 % CPU after the files are in
        # place, so stop waiting once the editor works instead of waiting for the Hub to exit.
        $deadline = (Get-Date).AddMinutes($UnityInstallTimeoutMinutes)
        while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 30
            if (Test-UnityEditor) { Start-Sleep -Seconds 60; break }
        }
    }
    if (-not $ran) { Add-SetupResult $editorStep would "Hub CLI $hubArgs" }
    elseif (Test-UnityEditor) { Add-SetupResult $editorStep done $unityExe; $ready.unity = $true }
    else { Add-SetupResult $editorStep failed "editor not found after $UnityInstallTimeoutMinutes min; check the Unity Hub" }
}

# --- 5. Unity license (detect only) -------------------------------------------------------------
# The Hub stores the entitlement license per user. For the MSIX Hub, Windows redirects it into
# the package's LocalCache. Only the product name is read; nothing is copied or printed.
function Find-UnityLicense {
    $candidates = @()
    if ($hub) { $candidates += Join-Path $env:LOCALAPPDATA "Packages\$($hub.PackageFamilyName)\LocalCache\Local\Unity\licenses\UnityEntitlementLicense.xml" }
    $candidates += Join-Path $env:LOCALAPPDATA 'Unity\licenses\UnityEntitlementLicense.xml'
    foreach ($f in $candidates) {
        if (-not (Test-Path $f)) { continue }
        try {
            [xml]$x = Get-Content -LiteralPath $f -Raw
            $editor = $x.SelectNodes('//EntitlementGroup') | Where-Object { $_.GetAttribute('Type') -eq 'EDITOR' } | Select-Object -First 1
            if ($editor) { return "$($editor.GetAttribute('Product')) (Hub sign-in)" }
        } catch { continue }
    }
    $ulf = Join-Path $env:ProgramData 'Unity\Unity_lic.ulf'
    if (Test-Path $ulf) { return 'serial license (Unity_lic.ulf)' }
    return $null
}
$license = Find-UnityLicense
if ($license) {
    Add-SetupResult 'Unity license' ok $license
    $ready.license = $true
} else {
    Add-SetupResult 'Unity license' action 'Owner: open Unity Hub, sign in, then Preferences > Licenses > Add > "Get a free personal license" (Unity Personal). Re-run this script afterwards.'
    Write-Host ''
    Write-Host 'Stopping: Unity batch-mode builds need an activated license, and only the owner can sign in.' -ForegroundColor Yellow
    Finish
}

# --- 6. Blender (portable, per-user) ------------------------------------------------------------
$blenderName = "blender-$BlenderVersion-windows-x64"
$blenderDir = Join-Path $BlenderInstallRoot $blenderName
$blenderExe = Join-Path $blenderDir 'blender.exe'
function Get-BlendHandler {
    $progId = (Get-ItemProperty -Path 'Registry::HKEY_CLASSES_ROOT\.blend' -ErrorAction SilentlyContinue).'(default)'
    if (-not $progId) { return $null }
    $cmd = (Get-ItemProperty -Path "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
    if ($cmd -and $cmd -match '^"([^"]+)"') { if (Test-Path $Matches[1]) { return $Matches[1] } }
    return $null
}
$handler = Get-BlendHandler
if (Test-Path $blenderExe) {
    Add-SetupResult "Blender $BlenderVersion" ok $blenderDir
    $ready.blender = $true
} elseif ($handler) {
    Add-SetupResult "Blender $BlenderVersion" ok "using the registered Blender: $handler"
    $ready.blender = $true
} else {
    $series = 'Blender' + ($BlenderVersion -replace '^(\d+\.\d+).*', '$1')
    $zipUrl = "$BlenderMirror/$series/$blenderName.zip"
    $zip = Join-Path ([IO.Path]::GetTempPath()) "$blenderName.zip"
    try {
        $ran = Invoke-SetupChange "download $zipUrl (~400 MB), verify SHA-256, extract to $BlenderInstallRoot" {
            if (-not (Test-Path $zip) -or (Get-Sha256 $zip) -ne $BlenderSha256) {
                Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
            }
            $actual = Get-Sha256 $zip
            if ($actual -ne $BlenderSha256) { Remove-Item $zip -Force; throw "SHA-256 mismatch: expected $BlenderSha256, got $actual" }
            # Cross-check the mirror's own checksum file. The pinned hash above is authoritative.
            try {
                $r = Invoke-WebRequest -Uri "$BlenderMirror/$series/blender-$BlenderVersion.sha256" -UseBasicParsing
                $sums = if ($r.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($r.Content) } else { $r.Content }
                if ($sums -notmatch "(?m)^$BlenderSha256\s+$blenderName\.zip") { Write-Warning 'mirror checksum file does not list the pinned hash' }
            } catch { Write-Warning "could not fetch the mirror checksum file: $_" }
            New-Item -ItemType Directory -Force $BlenderInstallRoot | Out-Null
            Expand-Archive -LiteralPath $zip -DestinationPath $BlenderInstallRoot -Force
        }
        if (-not $ran) { Add-SetupResult "Blender $BlenderVersion" would "portable zip from the mirror, SHA-256 $($BlenderSha256.Substring(0, 8))…" }
        elseif (Test-Path $blenderExe) { Add-SetupResult "Blender $BlenderVersion" done "$blenderDir (SHA-256 verified)"; $ready.blender = $true }
        else { Add-SetupResult "Blender $BlenderVersion" failed "extracted, but $blenderExe is missing" }
    } catch {
        Add-SetupResult "Blender $BlenderVersion" failed "$_"
    }
}
# Unity imports .blend models by launching the registered handler, so registration matters.
if ($ready.blender -and -not (Get-BlendHandler)) {
    if (Invoke-SetupChange "$blenderExe --register (per-user .blend association)" { Start-Process -FilePath $blenderExe -ArgumentList '--register' -Wait -WindowStyle Hidden }) {
        if (Get-BlendHandler) { Add-SetupResult '.blend file association' done 'blender --register' } else { Add-SetupResult '.blend file association' failed 'blender --register did not register .blend' }
    } else { Add-SetupResult '.blend file association' would 'blender --register' }
} elseif ($ready.blender) {
    Add-SetupResult '.blend file association' ok (Get-BlendHandler)
}

# --- 7. NuGetForUnity.Cli -----------------------------------------------------------------------
# NuGetForUnity's restore-on-load doesn't run in batch mode, so the fork's build.ps1 restores
# with this CLI first. Installed in the build.ps1 default -ToolPath so build.ps1 finds it.
$nfuExe = Join-Path $ToolPath 'nugetforunity.exe'
if (-not $ready.dotnet) {
    Add-SetupResult "NuGetForUnity.Cli $NuGetForUnityVersion" skipped 'needs the .NET SDK'
} else {
    $installed = if (Test-Path $nfuExe) { (dotnet tool list --tool-path $ToolPath | Select-String -Pattern '^nugetforunity\.cli\s+(\S+)' | ForEach-Object { $_.Matches[0].Groups[1].Value }) } else { $null }
    if ($installed -eq $NuGetForUnityVersion) {
        Add-SetupResult "NuGetForUnity.Cli $NuGetForUnityVersion" ok $nfuExe
        $ready.nfu = $true
    } else {
        $verb = if ($installed) { 'update' } else { 'install' }
        try {
            $ran = Invoke-SetupChange "dotnet tool $verb NuGetForUnity.Cli --version $NuGetForUnityVersion --tool-path $ToolPath" {
                Invoke-Logged -LogName 'nugetforunity-cli' -Command { dotnet tool $verb NuGetForUnity.Cli --version $NuGetForUnityVersion --tool-path $ToolPath } | Out-Null
            }
            if ($ran) { Add-SetupResult "NuGetForUnity.Cli $NuGetForUnityVersion" done $nfuExe; $ready.nfu = $true } else { Add-SetupResult "NuGetForUnity.Cli $NuGetForUnityVersion" would "dotnet tool $verb" }
        } catch { Add-SetupResult "NuGetForUnity.Cli $NuGetForUnityVersion" failed "$_" }
    }
}

# --- 8. Fork checkout ---------------------------------------------------------------------------
# Note: LFS downloads from a fork count against YARC-Official's LFS quota (S3 R12), so LFS is
# only pulled when objects are missing.
$forkStep = "Fork $Branch"
if (-not $ready.lfs) {
    Add-SetupResult $forkStep skipped 'needs Git LFS'
} elseif (-not (Test-Path (Join-Path $ForkPath '.git'))) {
    if (Test-Path $ForkPath) {
        Add-SetupResult $forkStep action "$ForkPath exists but is not a git checkout; move it or pass -ForkPath"
    } else {
        try {
            $ran = Invoke-SetupChange "git clone --filter=blob:none --recurse-submodules -b $Branch $ForkUrl $ForkPath (+ git lfs pull)" {
                Invoke-Logged -LogName 'fork-clone' -Command { git clone --filter=blob:none --recurse-submodules -b $Branch $ForkUrl $ForkPath } | Out-Null
                Invoke-Logged -LogName 'fork-lfs-pull' -Command { git -C $ForkPath lfs pull } | Out-Null
            }
            if ($ran) { Add-SetupResult $forkStep done "cloned at $((git -C $ForkPath rev-parse --short HEAD))"; $ready.fork = $true } else { Add-SetupResult $forkStep would "clone to $ForkPath" }
        } catch { Add-SetupResult $forkStep failed "$_" }
    }
} else {
    $origin = git -C $ForkPath remote get-url origin
    if (($origin -replace '\.git$', '') -ne ($ForkUrl -replace '\.git$', '')) {
        Add-SetupResult $forkStep action "origin is $origin, expected $ForkUrl; not touching it"
    } else {
        $remoteSha = ((git ls-remote $ForkUrl "refs/heads/$Branch") -split '\s+')[0]
        $head = git -C $ForkPath rev-parse HEAD
        $current = git -C $ForkPath rev-parse --abbrev-ref HEAD
        $dirty = git -C $ForkPath status --porcelain --untracked-files=no
        if (-not $remoteSha) {
            Add-SetupResult $forkStep failed "branch $Branch not found on $ForkUrl"
        } elseif ($head -eq $remoteSha) {
            Add-SetupResult $forkStep ok "$ForkPath at $($head.Substring(0, 8)) = origin/$Branch"
            $ready.fork = $true
        } elseif ($current -ne $Branch) {
            Add-SetupResult $forkStep action "checked out '$current', not '$Branch'; switch it yourself"
        } elseif ($dirty) {
            Add-SetupResult $forkStep action 'tracked files have local changes; commit or stash, then re-run'
        } else {
            try {
                $ran = Invoke-SetupChange "fetch origin $Branch and fast-forward" {
                    Invoke-Logged -LogName 'fork-fetch' -Command { git -C $ForkPath fetch origin $Branch } | Out-Null
                    git -C $ForkPath merge-base --is-ancestor HEAD "origin/$Branch"
                    if ($LASTEXITCODE -ne 0) { throw "local $Branch has commits that are not on origin; not fast-forwarding" }
                    Invoke-Logged -LogName 'fork-merge' -Command { git -C $ForkPath merge --ff-only "origin/$Branch" } | Out-Null
                }
                if ($ran) { Add-SetupResult $forkStep done "fast-forwarded to $($remoteSha.Substring(0, 8))"; $ready.fork = $true } else { Add-SetupResult $forkStep would "fast-forward $($head.Substring(0, 8)) → $($remoteSha.Substring(0, 8))" }
            } catch { Add-SetupResult $forkStep action "$_" }
        }
    }
}
if ($ready.fork -or ((Test-SetupDryRun) -and (Test-Path (Join-Path $ForkPath '.git')))) {
    $sub = git -C $ForkPath submodule status --recursive | Where-Object { $_ -match '^[-+U]' }
    if (-not $sub) {
        Add-SetupResult 'Fork submodules' ok ((git -C $ForkPath submodule status | ForEach-Object { ($_.Trim() -split '\s+')[1] }) -join ', ')
    } elseif (Invoke-SetupChange 'git submodule update --init --recursive' { Invoke-Logged -LogName 'fork-submodules' -Command { git -C $ForkPath submodule update --init --recursive } | Out-Null }) {
        Add-SetupResult 'Fork submodules' done 'updated'
    } else { Add-SetupResult 'Fork submodules' would 'git submodule update --init --recursive' }

    $lfsFiles = @(git -C $ForkPath lfs ls-files)
    $missing = @($lfsFiles | Where-Object { $_ -match '^\S+ - ' }).Count
    if ($missing -eq 0) {
        Add-SetupResult 'Fork LFS objects' ok "$($lfsFiles.Count) files present"
    } elseif (Invoke-SetupChange "git lfs pull ($missing missing)" { Invoke-Logged -LogName 'fork-lfs-pull' -Command { git -C $ForkPath lfs pull } | Out-Null }) {
        Add-SetupResult 'Fork LFS objects' done "pulled $missing"
    } else { Add-SetupResult 'Fork LFS objects' would "git lfs pull ($missing missing)" }
}

# --- 9. Build -----------------------------------------------------------------------------------
$buildStep = 'YARG Win64 build'
$buildScript = Join-Path $ForkPath 'scripts\handbell\build.ps1'
$buildDll = Join-Path (Split-Path $BuildOutput -Parent) ("{0}_Data\Managed\Assembly-CSharp.dll" -f [IO.Path]::GetFileNameWithoutExtension($BuildOutput))
if ($SkipBuild) {
    $state = if (Test-Path $BuildOutput) { "existing build: $BuildOutput" } else { 'no build yet' }
    Add-SetupResult $buildStep skipped "-SkipBuild ($state)"
} elseif (-not ($ready.unity -and $ready.license -and $ready.blender -and $ready.nfu -and $ready.fork)) {
    $missingPre = @('unity', 'license', 'blender', 'nfu', 'fork') | Where-Object { -not $ready[$_] }
    $st = if (Test-SetupDryRun) { 'would' } else { 'skipped' }
    Add-SetupResult $buildStep $st "after: $($missingPre -join ', ')"
} else {
    # Up to date when the build's game assembly is newer than every code/settings file. Unity
    # rewrites ProjectSettings during a build, before it writes the assembly.
    $newestSrc = Get-ChildItem (Join-Path $ForkPath 'Assets\Script'), (Join-Path $ForkPath 'ProjectSettings'), (Join-Path $ForkPath 'Packages'), (Join-Path $ForkPath 'YARG.Core\YARG.Core') -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' } |
        Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    if (-not $Force -and (Test-Path $buildDll) -and (Get-Item $buildDll).LastWriteTimeUtc -gt $newestSrc.LastWriteTimeUtc) {
        Add-SetupResult $buildStep ok "$BuildOutput is newer than the fork sources"
    } elseif (Test-Path (Join-Path $ForkPath 'Temp\UnityLockfile')) {
        Add-SetupResult $buildStep action 'the Unity Editor has the project open; close it and re-run'
    } else {
        try {
            $log = Join-Path $script:SetupLogDir 'yarg-build.log'
            $ran = Invoke-SetupChange "fork build.ps1 → $BuildOutput (1.3 min incremental, ~13 min full)" {
                & $buildScript -Unity $unityExe -Output $BuildOutput -ToolPath $ToolPath *> $log
            }
            if ($ran) { Add-SetupResult $buildStep done "$BuildOutput (log: $log)" } else { Add-SetupResult $buildStep would 'scripts\handbell\build.ps1' }
        } catch { Add-SetupResult $buildStep failed "$_ (Unity logs: $ForkPath\Logs\handbell-build)" }
    }
}

# --- 10. Songs ----------------------------------------------------------------------------------
$songStep = 'YARG songs (S5 + bell stems)'
$exports = Join-Path $repo 'spikes\s5-chart-pipeline\exports'
if ($SkipSongs) {
    Add-SetupResult $songStep skipped '-SkipSongs'
} else {
    $songs = @(Get-ChildItem $exports -Directory)
    $stale = @($songs | Where-Object {
            $dst = Join-Path $SongsPath $_.Name
            $ok = (Test-Path (Join-Path $dst 'notes.mid')) -and (Test-Path (Join-Path $dst 'song.ini')) -and @(Get-ChildItem $dst -Filter '*.wav' -ErrorAction SilentlyContinue).Count -gt 0
            if ($ok) { $ok = (Get-Sha256 (Join-Path $_.FullName 'notes.mid')) -eq (Get-Sha256 (Join-Path $dst 'notes.mid')) -and (Get-Sha256 (Join-Path $_.FullName 'song.ini')) -eq (Get-Sha256 (Join-Path $dst 'song.ini')) }
            -not $ok
        })
    if (-not $Force -and $stale.Count -eq 0) {
        Add-SetupResult $songStep ok "$($songs.Count) songs up to date in $SongsPath"
    } elseif (-not ($ready.dotnet -and ($ready.fork -or (Test-SetupDryRun)))) {
        Add-SetupResult $songStep skipped 'needs the .NET SDK and the fork checkout (YARG.Core)'
    } else {
        $harness = Join-Path $repo 'spikes\s3-yarg-handbell\src\S3Harness'
        $harnessExe = Join-Path $harness 'bin\Release\net10.0\S3Harness.exe'
        try {
            $ran = Invoke-SetupChange "build S3Harness, then prepare $($stale.Count) song(s) into $SongsPath" {
                Invoke-Logged -LogName 's3harness-build' -Command { dotnet build $harness -c Release "-p:YargForkDir=$ForkPath" -nologo } | Out-Null
                Invoke-Logged -LogName 's3harness-prepare' -Command { & $harnessExe prepare $exports $SongsPath } | Out-Null
            }
            if ($ran) { Add-SetupResult $songStep done "$($songs.Count) songs in $SongsPath" } else { Add-SetupResult $songStep would "S3Harness prepare ($($stale.Count) stale)" }
        } catch { Add-SetupResult $songStep failed "$_" }
    }
}

$code = Write-SetupSummary
if ($code -eq 0 -and -not (Test-SetupDryRun)) {
    Write-Host ''
    Write-Host 'Play with phones (docs/spikes/I1-yarg-phones.md#owner-runbook-phones--yarg):' -ForegroundColor Cyan
    Write-Host "  1. cd spikes\s1-phone-bell; npm run yarg      (run tools/setup/setup-web.ps1 first)"
    Write-Host "  2. & '$BuildOutput' -hgp -hgp-budget-ms 60"
    Write-Host "  3. First launch: YARG Settings > Songs > add '$SongsPath', then scan."
}
exit $code
