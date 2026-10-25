# OWNER ACTION (not run by agents): build the GPU image, push it to GHCR and print the digest for
# amt/manifest.json. Needs Docker and a GHCR login with write:packages (owner credentials).
#   pwsh spikes/s6-ai-arranging/amt/publish.ps1 [-Tag 0.1.0-cu124-medium] [-Push]
# Without -Push it only builds and prints what it would do. Keep the GHCR package private unless
# the owner decides otherwise (the image bundles NVIDIA CUDA runtime libraries; see the S6 report).
param(
  [string]$Image = 'ghcr.io/dcuccia/go-go-harmoniyo-amt',
  [string]$Tag = '0.1.0-cu124-medium',
  [switch]$Push
)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
docker build -t "${Image}:${Tag}" $here
if (-not $Push) {
  Write-Host "Built ${Image}:${Tag}. Re-run with -Push after: docker login ghcr.io -u dcuccia (token with write:packages)."
  exit 0
}
docker push "${Image}:${Tag}"
$digest = (docker buildx imagetools inspect "${Image}:${Tag}" --format '{{json .Manifest}}' | ConvertFrom-Json).digest
Write-Host "Pushed. Put this in amt/manifest.json workload.image:"
Write-Host "  ${Image}@${digest}"
