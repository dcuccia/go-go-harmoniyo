<#
.SYNOPSIS
  S8 feasibility check: can the Windows package's Node SEA exe be Authenticode-signed (and given
  our own name/icon) and still run? Uses a THROWAWAY self-signed certificate. Nothing is published.

.DESCRIPTION
  Needs a finished `node tools/package/windows/build.mjs` (it reuses out/cache/*node.exe and
  out/work/sea-prep.blob) and signtool.exe (Windows SDK, or the Microsoft.Windows.SDK.BuildTools
  NuGet package). Steps, mirroring what a real signing step in build.mjs would do:
    1. copy the pinned node.exe, `signtool remove /s` (BEFORE injection),
    2. optionally rcedit our version strings and icon (BEFORE injection),
    3. postject the SEA blob,
    4. sign with a throwaway self-signed code-signing cert (CurrentUser\My, 1-day validity),
    5. report the signature status and run tools/package/windows/smoke.mjs on the copy,
    6. delete the throwaway cert.
  Run from the repo root:  pwsh spikes/s8-store-delivery/sign-sea-test.ps1 [-Rcedit] [-KeepCopy]
#>
param([switch]$Rcedit, [switch]$KeepCopy, [string]$Signtool)
$ErrorActionPreference = 'Stop'
$root = (Get-Location).Path
$pkg = Join-Path $root 'tools\package\windows'
$out = Join-Path $pkg 'out'
if (-not (Test-Path "$out\stage\GoGoHarmoniYo")) { throw 'Run node tools/package/windows/build.mjs first.' }

if (-not $Signtool) {
  $cands = @()
  $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
  if (Test-Path $kits) { $cands += Get-ChildItem $kits -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' }
  $nuget = Join-Path $env:USERPROFILE '.nuget\packages\microsoft.windows.sdk.buildtools'
  if (Test-Path $nuget) { $cands += Get-ChildItem $nuget -Recurse -Filter signtool.exe | Where-Object FullName -match '\\x64\\' }
  $Signtool = ($cands | Sort-Object FullName -Descending | Select-Object -First 1).FullName
}
if (-not $Signtool) { throw 'signtool.exe not found (install the Windows SDK or pass -Signtool).' }
Write-Host "signtool: $Signtool"

$nodeExe = Get-ChildItem "$out\cache" -Filter '*node.exe' | Select-Object -First 1 -ExpandProperty FullName
$blob = "$out\work\sea-prep.blob"
$test = Join-Path $env:TEMP 's8-sign-test\GoGoHarmoniYo'
Remove-Item -Recurse -Force (Split-Path $test) -ErrorAction SilentlyContinue
Copy-Item -Recurse "$out\stage\GoGoHarmoniYo" $test
$exe = Join-Path $test 'go-go-harmoniyo.exe'

Write-Host "`nAs built: $((Get-AuthenticodeSignature $exe).Status)   cloudflared.exe: $((Get-AuthenticodeSignature "$test\cloudflared.exe").SignerCertificate.Subject)"

Copy-Item $nodeExe $exe -Force
& $Signtool remove /s $exe | Out-Null
if ($LASTEXITCODE) { throw 'signtool remove failed' }

if ($Rcedit) {
  $tmp = Join-Path $env:TEMP 's8-rcedit'
  if (-not (Test-Path "$tmp\node_modules\rcedit")) {
    New-Item -ItemType Directory -Force $tmp | Out-Null
    Push-Location $tmp; npm init -y --silent | Out-Null; npm install rcedit@4.0.1 --silent | Out-Null; Pop-Location
  }
  $ico = Join-Path $root 'spikes\i2-web-phones\public\brand\favicon.ico'
  & "$tmp\node_modules\rcedit\bin\rcedit-x64.exe" $exe `
    --set-version-string FileDescription 'Go Go HarmoniYo' --set-version-string ProductName 'Go Go HarmoniYo' `
    --set-version-string CompanyName 'Go Go HarmoniYo contributors' --set-version-string OriginalFilename 'go-go-harmoniyo.exe' `
    --set-version-string InternalName 'go-go-harmoniyo' --set-file-version '0.0.0.1' --set-product-version '0.0.0.1' --set-icon $ico
  if ($LASTEXITCODE) { throw 'rcedit failed' }
}

Push-Location $pkg
npx --no-install postject $exe NODE_SEA_BLOB $blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 | Out-Null
Pop-Location
if ($LASTEXITCODE) { throw 'postject failed' }

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject 'CN=Go Go HarmoniYo S8 test (self-signed, throwaway)' `
  -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddDays(1)
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  & $Signtool sign /fd SHA256 /sha1 $cert.Thumbprint /s My $exe | Out-Null
  if ($LASTEXITCODE) { throw 'signtool sign failed' }
  Write-Host "Signed in $($sw.ElapsedMilliseconds) ms (no timestamp server)"
  $sig = Get-AuthenticodeSignature $exe
  Write-Host "Signature: $($sig.Status) - $($sig.StatusMessage)"
  Write-Host '(Expected: UnknownError / untrusted root. HashMismatch or NotSigned would mean failure.)'
  (Get-Item $exe).VersionInfo | Format-List FileDescription, ProductName, CompanyName, FileVersion | Out-String | Write-Host
  node "$pkg\smoke.mjs" $test
  if ($LASTEXITCODE) { throw 'smoke test failed on the signed exe' }
} finally {
  Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force
  if (-not $KeepCopy) { Remove-Item -Recurse -Force (Split-Path $test) -ErrorAction SilentlyContinue }
}
