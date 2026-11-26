# Fixed S9 score provenance

`../catalog.json` is the exact audition artifact, SHA-256
`78be33e61d3613ea8532acb6670570e37c75be08beab540faa89924fddcf1c4d`.
`catalog.json` here records the input S5 files, Short/Full chart hashes, per-song score hashes and
model/terms. `prompts.md` preserves the musical instructions and review packet; a local worktree
path is omitted. See the S5 entries in `attribution/register.json` for the editions and their
separate license and source checks. The unrelated two-song pilot files are not included.

`build.mjs`, `engine.mjs` and `specs.mjs` are the deterministic authoring sources; they are not
called by any product build. `node build.mjs` here writes scratch files to `out/` when the default
I2 charts have been generated. Their `sourceHash` can differ between CRLF and LF checkouts.
The build of the website uses the exact pinned catalog, validates the actual chart JSON bytes,
and updates only the per-form envelope's `sourceHash` to the index supplied with that website;
the note arrays remain identical.

The recorded WAVs are a nine-note subset of the original VSCO-2 CE harp. `samples.json`
documents their pin, recording credits, upstream URLs, hashes, and measured sample levels.
The original upstream README and license accompany the recordings. The nine upstream WAVs in
`../samples/` are unchanged. For the S9 browser build only, `scripts/harp-derivation.mjs` averages
the stereo channels into 44.1 kHz mono PCM16, without normalizing or skipping attack frames.
Each tail is based on that sample's longest required source span across all 48 scores, including
the smallest practice speed (50%), each event's pitch rate, and the existing onset offset.
The build keeps a 20 ms margin after that span and fades 25 ms only beyond it when cutting
the source. It emits identity WAVs and their precompressed Brotli representations, and records
each limiting event, measured peak, length, hash and the Brotli version in
`legal/vsco2-ce/mono-derivation.json`. The conversion loses stereo placement and some peak level
from summing the channels; it does not change score events, cue timing or the Node audition mix.
The official GitHub Copilot terms reference and effective date are
documented as observed; this is not a legal opinion on rights. The human resemblance review
and release authorization are tracked separately in the register and ADR-0015.
