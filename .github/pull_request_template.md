## What and why

<!-- One or two sentences. Link the issue, spike brief or ADR. -->

## How it was verified

<!-- Commands run, measurements, devices/browsers. -->

## Asset and IP checklist ([ADR-0008](../docs/decisions/0008-assets-ip-and-attribution.md))

- [ ] Commits are signed off (`git commit -s`, [DCO](https://developercertificate.org)).
- [ ] No YARG, Clone Hero or commercial-game code, assets, shaders, screenshots or audio are added.
- [ ] No franchise names or logos in UI, and no copied look (e.g. a fixed fret-colour order). Colours follow the [pitch-class palette](../docs/design/visual-identity.md).
- [ ] Every new asset has an entry in `attribution/register.json`, and the generated files are committed (`node tools/licensing/attribution.mjs`).
- [ ] Third-party files are unmodified, keep their notices, and have a pinned source URL, SHA-256 and license evidence.
- [ ] AI-generated assets record the tool, model, version, terms URL and date, and the full prompt (no franchise or artist names, no img2img from copyrighted art). A human resemblance review was done: reviewer: ____ date: ____
- [ ] New dependencies are allowlisted or have an ADR exception, and `THIRD_PARTY_NOTICES.md` is regenerated (`node tools/licensing/license-gate.mjs`).
- [ ] `reuse lint` passes.
- [ ] Not applicable: no assets, dependencies or third-party material changed.
