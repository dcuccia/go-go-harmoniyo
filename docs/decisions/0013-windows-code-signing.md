# 0013 — Windows code signing for the portable package

- Status: Proposed
- Date: 2026-11-09
- Deciders: @dcuccia (owner); proposed by the S8 spike session
- Related: [#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43) (portable Windows zip),
  [S8 report](../spikes/S8-report.md) §1

## Context

The portable Windows zip ([tools/package/windows](../../tools/package/windows/README.md)) holds
an unsigned `go-go-harmoniyo.exe` (Node single executable app) and Cloudflare's signed
`cloudflared.exe`.

- **Unsigned:** SmartScreen shows "Unknown publisher" and has no reputation to carry over between
  versions. **Smart App Control blocks it with no override.**
- **Signed:** SmartScreen still says "unrecognized" at first. Microsoft, 2026: "EV certificates
  no longer bypass SmartScreen." But it names the publisher, reputation can build up, and Smart
  App Control allows it.
- Only Store-signed MSIX packages avoid SmartScreen entirely.

S8 showed the SEA exe can be signed and still works, provided Node's signature is removed before
the blob is injected.

The owner asked to evaluate SignPath "or similar". The repository is public and MIT-licensed, but
new: created 2026-10-23, one contributor, no GitHub Releases yet.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a) Stay unsigned | Free; nothing to set up | SAC blocks it; SmartScreen warns on every new version; the firewall prompt shows Node's name |
| (b) **Azure Artifact Signing** (Basic) | US/Canada individuals eligible; validation in days; $9.99/month; first-party GitHub Action with OIDC (no stored key); short-lived, timestamped certificates; Microsoft's "preferred" signer for SAC; unattended tag-triggered signing | **The owner's legal name is on the certificate**; monthly fee; needs a personal Azure billing account of type Individual |
| (c) SignPath Foundation (OSS) | Free; publisher "SignPath Foundation" keeps the owner's name off; official GitHub Action | Needs an existing public release, a code-signing-policy section, a privacy statement and "verifiable reputation" (rejection risk for a new repo); **manual approval for every release**; ~1 week to approve |
| (d) OV/EV certificate (incl. Certum Open Source, ~€49/year) | Own name or brand; no Azure | HSM/cloud-key setup, renewal at least every ~459 days, no first-party Action; EV no longer helps SmartScreen |
| (e) Microsoft Store (MSIX) | No SmartScreen at all; free individual registration; discoverability | MSIX packaging with full trust, a firewall rule and a child process; review on every release; a public listing needs trademark clearance (ADR-0009) |

## Decision

Proposed:

1. Sign release builds with **(b) Azure Artifact Signing** in a release workflow on
   `windows-latest`, triggered by release tags.
2. `build.mjs` gains a signing step in this order: remove Node's signature → rcedit (product
   name, version, icon) → `postject` → sign. The step fails the build if signing was requested
   and can't be done.
3. Signed releases document starting the exe itself. The `.cmd` launcher can't be signed.
4. After the first public GitHub Release, the owner may apply to **(c) SignPath Foundation**
   (draft in the S8 report) and switch if accepted.
5. **(e) Microsoft Store** stays a later option, after trademark clearance.

## Consequences

- Owner: a personal Azure Individual billing account, identity validation and a certificate
  profile (~1–2 h + a few business days), and $9.99/month while signing.
- Agents: the `build.mjs` signing hook (~1 agent-day) and the release workflow (~0.5 agent-day).
  Nothing changes for `npm start`.
- Users still see SmartScreen's "unrecognized" warning on early signed releases, now with a
  publisher name. Smart App Control PCs can run the game.
- The certificate names a person. If the owner later forms an entity, it can switch to an
  organisation profile (Azure organisations need 3+ years of history) or to SignPath.

## Evidence

- [S8 report](../spikes/S8-report.md) §1 and the prototype
  [`spikes/s8-store-delivery/`](../../spikes/s8-store-delivery/README.md): signed in 2.4–2.6 s;
  smoke test passed; `0x00000057` / `0x800700C1` when Node's signature isn't removed before
  `postject`.
- Microsoft:
  [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
  [Smart App Control signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control),
  [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart).
- SignPath: [terms](https://signpath.org/terms.html). All accessed 2026-11-09.
