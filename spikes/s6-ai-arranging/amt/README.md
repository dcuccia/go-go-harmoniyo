# S6 AMT accompaniment container

Batch workload for the household AI node (cuccia-infra contract v0): the
[Anticipatory Music Transformer](https://github.com/jthickstun/anticipation) (AMT) writes an
accompaniment for a melody.

```text
/inputs/melody.mid + /inputs/args.json  ->  /outputs/accompaniment.mid, combined.mid, report.json
```

| File | What |
|---|---|
| [`Dockerfile`](Dockerfile) | Base image pinned by digest; weights downloaded at build time and checked against a pinned SHA-256; runs as UID 10001 with no network; works on a read-only root filesystem |
| [`amt_accompany.py`](amt_accompany.py) | The runner. `args.json` keys: `top_p`, `seed`, `end_seconds`, `history_seconds`, `drop_drums`, `keep_programs`, `device`. Over-long sampled durations (anticipation's sampler can emit the REST token as a duration) are clamped to 9.99 s instead of crashing; `report.json` counts them in `clamped_durations` |
| [`test_amt_accompany.py`](test_amt_accompany.py) | Regression tests (`python -m unittest discover` here; needs `mido` and `anticipation`, not torch). CI runs them in the `s6-ai-arranging` workflow |
| [`requirements.txt`](requirements.txt) | Pinned Python dependencies (torch is installed from the CUDA 12.4 or CPU wheel index) |
| [`manifest.json`](manifest.json) | Workload manifest for cuccia-infra: image digest, command, GPU class, limits, model version, hash and license |

The node client that submits jobs is in [`../src/client.ts`](../src/client.ts) (zero
dependencies, Node ≥ 22.18). Run `node --test test/*.test.ts` in `spikes/s6-ai-arranging` for its
offline tests, and `node scripts/smoke.ts [--mock]` to check a live node. The S6 experiments,
report, AI candidates and ADR-0011 are in PR #54, which builds on this folder.

## Publishing the image

The [`s6-amt-image`](../../../.github/workflows/s6-amt-image.yml) workflow builds the GPU image
and pushes it to `ghcr.io/dcuccia/go-go-harmoniyo-amt`, signed in with the workflow's
`GITHUB_TOKEN` (`packages: write`). No personal token is needed. It runs only when started by
hand (**Actions → s6-amt-image → Run workflow**, or `gh workflow run s6-amt-image.yml`), never on
pull requests.

Each run:

1. builds `linux/amd64` with BuildKit and pushes the tag you give it (default
   `0.1.0-cu124-medium`) plus `sha-<commit>`, with OCI labels (source, revision, version,
   licenses), an SPDX SBOM and a SLSA provenance attestation;
2. pulls the pushed digest and runs it with the node's sandbox flags (`--network none
   --read-only --cap-drop ALL`, non-root) to check the imports and the baked-in weights' SHA-256;
3. writes the digest to the job summary and to the `amt-image-digest` artifact (`digest.txt`,
   `image.json`).

Then copy the digest into `workload.image` in `manifest.json` and send the manifest to
infrastructure. **Pin the digest, not the tag**: tags move when the workflow runs again. The
digest is the image index, which holds the `linux/amd64` image and its attestations;
`docker pull` and `docker run` resolve it to the image. `image.json` also records the
platform-manifest digest in case infrastructure prefers that.

To build locally instead (CPU smoke tests and so on), see the comments at the top of the
`Dockerfile`.

### Current image

Published 2026-10-27 by [run 40565289683](https://github.com/dcuccia/go-go-harmoniyo/actions/runs/40565289683)
from commit `f5787be` (about 10 minutes on `ubuntu-latest`). This build includes the
duration clamp (`clamped_durations` in `report.json`):

```text
ghcr.io/dcuccia/go-go-harmoniyo-amt@sha256:93e86a83279711321a9e85c931ba5e0107c36fe621862acd24879c8578fcec21
```

4.5 GB compressed, 7.0 GB unpacked; `linux/amd64` manifest
`sha256:2d0319b8bef8e0137b4c1e56fc3c9c4a29bc8d395552608f2a9fd01f51c7565a`. The workflow checked
the pulled digest: UID 10001, torch 2.6.0+cu124, transformers 4.51.3, and the
`music-medium-800k` weights' SHA-256 matches. The first node job records `max_vram_mib` in
`report.json`.

The previous image (`sha256:a3df2566…f097`, run 40237996285, commit `cf4e96e`) lacks the clamp:
it fails with `AssertionError` in `events_to_compound` whenever the model samples an
over-long duration. Don't use it.

### Handing off to infrastructure

Send [`manifest.json`](manifest.json) with a note like this:

> Please register the `go-go-harmoniyo-amt` batch workload (contract v0). Manifest:
> `spikes/s6-ai-arranging/amt/manifest.json` in dcuccia/go-go-harmoniyo. Image
> `ghcr.io/dcuccia/go-go-harmoniyo-amt@sha256:93e86a83279711321a9e85c931ba5e0107c36fe621862acd24879c8578fcec21`
> (public on GHCR, no pull credential; built by GitHub Actions with SBOM and provenance).
> Command `python /app/amt_accompany.py`, `gpu: exclusive`, about 3 GiB VRAM (fp16 360M
> model), memory 8g, 4 CPUs, timeout 900 s, no caches, no network. Weights are baked in:
> stanford-crfm/music-medium-800k at revision `93b6eb7e09bad33be6cb2ebd50ce5279cbfde7f6`,
> `pytorch_model.bin` SHA-256 `7af65dbabb2f6b7df9df03c2ea5b1909b74043591ba578fb663d80fcf82241ad`,
> Apache-2.0; code jthickstun/anticipation `af37397` (Apache-2.0). Runs as UID 10001, read-only
> root filesystem OK, writes only `/outputs`. Inputs: `melody.mid` plus optional `args.json`;
> outputs: `accompaniment.mid`, `combined.mid`, `report.json`.

If the workflow is run again, update the digest here, in `manifest.json`, and in the note.

### Package visibility

The first run created the package under the owner's account, and it inherited **public**
visibility (an anonymous pull of the digest works, checked 2026-10-25). Change it in
**github.com/users/dcuccia/packages/container/go-go-harmoniyo-amt/settings**; the workflow
never changes it.

- **Public** (simplest): the AI node pulls by digest with no credentials. This is acceptable
  under [ADR-0008](../../../docs/decisions/0008-assets-ip-and-attribution.md): our code is MIT,
  the AMT code and weights are Apache-2.0 with no use restrictions, and the rest of the image
  is redistributable open-source software (Debian, Python, torch BSD-3-Clause, transformers
  Apache-2.0, mido MIT, numpy BSD-3-Clause, tqdm MPL-2.0 AND MIT). The CUDA builds of torch pull
  in NVIDIA's CUDA runtime libraries (`nvidia-*` wheels), which NVIDIA allows to be
  redistributed with applications; their license files stay in the image (under
  `site-packages/nvidia_*.dist-info/`), and the SBOM attestation lists every package. The model
  was trained on the Lakh MIDI Dataset (CC BY 4.0 as a dataset; the MIDI files themselves have
  mixed provenance), which is why its outputs get a human resemblance review before use.
- **Private**: the node then needs a pull credential, a classic token with `read:packages`
  (or a fine-grained token with package read access) from an account that can see the package,
  given to infrastructure through their secret store. Nothing else changes.

## Platform notes

The image is `linux/amd64` with CUDA 12.4 wheels, which run on the node's CUDA 13.x driver.
Docker Desktop on Windows/macOS (Intel) can run it on the CPU; on Apple Silicon it runs under
emulation and is very slow. A CPU-only image (`--build-arg TORCH_INDEX=https://download.pytorch.org/whl/cpu`)
is about 2.6 GB; the GPU image is 7.0 GB unpacked.
