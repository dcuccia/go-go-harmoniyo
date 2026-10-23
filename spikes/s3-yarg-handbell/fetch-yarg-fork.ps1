# Fetches the fork's Unity-free HGP code + its YARG.Core submodule into external/YARG.
# Sparse, blob-filtered clone: no LFS assets, no Unity project needed.
param(
    [string]$Branch = "handbell-spike",
    [string]$Repo = "https://github.com/dcuccia/YARG.git"
)
$ErrorActionPreference = "Stop"
$dest = Join-Path $PSScriptRoot "external\YARG"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }

$env:GIT_LFS_SKIP_SMUDGE = "1"
git clone --quiet --filter=blob:none --no-checkout --depth 1 -b $Branch $Repo $dest
git -C $dest sparse-checkout set --no-cone "/Assets/Script/Integration/Hgp/Core/" "/.gitmodules"
git -C $dest checkout --quiet $Branch
git -C $dest submodule update --init --quiet YARG.Core
Write-Host "Fork:      $(git -C $dest rev-parse HEAD) ($Branch)"
Write-Host "YARG.Core: $(git -C (Join-Path $dest 'YARG.Core') rev-parse HEAD)"
