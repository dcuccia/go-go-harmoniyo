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
| [`amt_accompany.py`](amt_accompany.py) | The runner. `args.json` keys: `top_p`, `seed`, `end_seconds`, `history_seconds`, `drop_drums`, `keep_programs`, `device` |
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

### Package visibility

The first run creates the package under the owner's account. Choose its visibility in
**github.com/users/dcuccia/packages/container/go-go-harmoniyo-amt/settings**; the workflow
doesn't change it.

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
is about 2.6 GB; the GPU image is several times larger.
