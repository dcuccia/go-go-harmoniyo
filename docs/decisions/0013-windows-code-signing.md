# 0013 — Windows code signing for the portable package

- Status: Proposed
- Date: 2026-11-09; revised 2026-11-10 to the owner's direction
- Deciders: @dcuccia (owner); proposed by the S8 spike session
- Related: [#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43) (portable Windows zip),
  [S8 report](../spikes/S8-report.md) §1,
  [release v0.1.0-alpha](https://github.com/dcuccia/go-go-harmoniyo/releases/tag/v0.1.0-alpha)

## Context

The portable Windows zip ([tools/package/windows](../../tools/package/windows/README.md)) holds
an unsigned `go-go-harmoniyo.exe` (a Node single executable app) and Cloudflare's signed
`cloudflared.exe`. The first public pre-release, v0.1.0-alpha, came out unsigned on 2026-11-10.

- **Unsigned:** SmartScreen shows "Unknown publisher" and has no reputation to carry over between
  versions. **Smart App Control blocks it with no override.**
- **Signed:** SmartScreen still says "unrecognized" at first. Microsoft, 2026: "EV certificates
  no longer bypass SmartScreen." But it names the publisher, reputation can build up, and Smart
  App Control allows it.
- Only Store-signed MSIX packages avoid SmartScreen entirely.

S8 showed the SEA exe can be signed and still works, provided Node's signature is removed before
the blob is injected.

The owner, 2026-11-10: "9.99 a month is too expensive for this hobby/oss project. SignPath sounds
like a viable alternative. Any other common options I should know about?"

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a) Stay unsigned (status quo) | Free; nothing to set up | Smart App Control blocks it; SmartScreen warns on every new version |
| (b) **SignPath Foundation** (OSS program) | Free; official GitHub Action; signs on SignPath's HSM, so there's no key to look after; publisher is "SignPath Foundation", so the owner's name stays off the certificate | Needs a code signing policy on the home and download pages, a privacy statement, MFA and "a certain verifiable reputation", a real rejection risk for a new repository; **a person approves every release**; review takes about a week (anecdotal) |
| (c) Microsoft Store (MSIX) | **No SmartScreen warning at all**; free individual registration (since 2025-09-10); Store discoverability | MSIX packaging with full trust, a firewall rule and a child process; certification on every release; a public listing waits for name clearance (ADR-0009) |
| (d) Certum Open Source Code Signing in the Cloud | About €49 a year; the certificate's subject is "Open Source Developer" plus the owner's name; builds SmartScreen reputation | Individuals only; the owner's legal name is on it; each signing session is approved with a code from the SimplySign phone app, so there's no supported unattended CI (community tools keep the TOTP seed in CI secrets); revoked if used for commercial software |
| (e) Azure Artifact Signing | Microsoft's "preferred" signer for Smart App Control; OIDC GitHub Action; validation in days | **Rejected on cost:** $9.99 a month; the owner's legal name is on the certificate |
| (f) Commercial OV/EV certificate (SSL.com, Sectigo, DigiCert) | Own name or brand | About $129 a year and up, plus an HSM or cloud key; renewal at least every ~459 days; EV no longer helps SmartScreen |

Not options for this problem: self-signed certificates (users don't trust them), winget or Scoop
(distribution channels that don't change SmartScreen), and Sigstore or GitHub artifact
attestations (they prove provenance but don't change SmartScreen or Smart App Control).

## Decision

Proposed:

1. **Apply to (b) SignPath Foundation now.** v0.1.0-alpha meets the "already released"
   condition. The README has the code signing policy and privacy sections. The application
   draft is in the [S8 report](../spikes/S8-report.md#signpath-foundation-application-ready-to-submit).
   The owner submits it.
2. When SignPath accepts:
   - `build.mjs` gains a signing step in this order: remove Node's signature → rcedit (product
     name, version, icon) → `postject` → sign. It fails the build if signing was requested and
     can't be done.
   - The release workflow builds on GitHub-hosted `windows-latest` from release tags and submits
     the exe through `signpath/github-action-submit-signing-request`. The owner approves each
     request in SignPath.
   - Signed releases tell people to start the exe itself. The `.cmd` launcher can't be signed.
3. Until SignPath signs a build, releases stay **unsigned** (a). If SignPath rejects the
   application, the fallback is **(d) Certum Open Source** (~€49 a year). The owner would sign
   each release by hand on his PC with the SimplySign app.
4. **Later: (c) Microsoft Store (MSIX).** It's the only way to remove the warning completely. A
   public listing waits for name clearance (ADR-0009).
5. **Rejected:** (e) Azure Artifact Signing, on cost (the owner, 2026-11-10), and (f) commercial
   certificates, on cost and effort.

## Consequences

- Owner:
  - Submit the SignPath application (~30 min).
  - Keep MFA on for GitHub and SignPath.
  - Add the code signing policy line to the v0.1.0-alpha release notes.
  - Approve each signing request (a few minutes per release).
- Agents (~1.5 agent-days, after SignPath accepts):
  - the `build.mjs` signing hook (~1 agent-day);
  - the SignPath release workflow (~0.5 agent-day).

  Nothing changes for `npm start`.
- Users still see SmartScreen's "unrecognized" warning on early signed releases, now with the
  publisher "SignPath Foundation" and our product name. Smart App Control PCs can run the game.
- SignPath's terms apply while we use it:
  - sign only our own binaries;
  - keep the policy and privacy sections current;
  - announce system changes (the firewall prompt);
  - give uninstall instructions.
- If SignPath rejects the application, nothing breaks: releases stay unsigned until the owner
  chooses Certum or the Store.

## Evidence

- [S8 report](../spikes/S8-report.md) §1 and the prototype
  [`spikes/s8-store-delivery/`](../../spikes/s8-store-delivery/README.md): signed in 2.4–2.6 s;
  smoke test passed; `0x00000057` / `0x800700C1` when Node's signature isn't removed before
  `postject`.
- Microsoft:
  [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
  [Smart App Control signing](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control),
  [Artifact Signing pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/),
  [free Store registration](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/).
  Accessed 2026-11-09.
- SignPath: [terms](https://signpath.org/terms.html) and the
  [apply form](https://signpath.org/apply.html), read 2026-11-10.
- Certum: [Open Source Code Signing in the Cloud](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)
  and [required documents](https://support.certum.eu/en/code-signing-required-documents/),
  accessed 2026-11-10.
