# S8 — Store delivery and code signing: report

- Brief: [S8-store-delivery-and-signing.md](S8-store-delivery-and-signing.md)
- Date: 2026-11-09. **Revised 2026-11-10 after the owner's feedback on PR #84** (see
  [Owner decisions](#owner-decisions-and-to-dos)). Sources were accessed on 2026-11-09 unless a
  different date is given.
- Prototype: [`spikes/s8-store-delivery/`](../../spikes/s8-store-delivery/README.md), run on
  Windows 11 x64 with Node 22.18 (build) and Node 22.23.4 (inside the exe), cloudflared
  2026.10.7.
- Proposed ADRs:
  - [ADR-0013](../decisions/0013-windows-code-signing.md): Windows code signing.
  - [ADR-0014](../decisions/0014-store-era-host-architecture.md): store-era host architecture.
  - Both are `Proposed`. The owner accepts them.
- Nothing was registered, applied for, bought or published.

## Summary

- **Signing works.** The portable exe signs in ~2.5 s and still passes the full smoke test. Two
  conditions: Node's own signature must be removed *before* the SEA blob is injected, and
  `cloudflared.exe` is already signed by Cloudflare.
  - **No signing option removes SmartScreen's "unrecognized app" warning on day one.** Microsoft's
    current doc says "EV certificates no longer bypass SmartScreen". Signing replaces "Unknown
    publisher" with a name, lets reputation build up across releases, and stops **Smart App
    Control** blocking the exe outright.
  - Only Microsoft Store (MSIX) distribution has no warning at all.
- **Recommended signing path: apply to SignPath Foundation now** (Proposed ADR-0013).
  - It's free. The publisher is "SignPath Foundation", so the owner's name stays off the
    certificate.
  - The public pre-release v0.1.0-alpha (2026-11-10) meets the "already released" condition.
  - This PR adds the README's code signing policy and privacy sections.
  - The [application is ready to submit](#signpath-foundation-application-ready-to-submit). The
    owner submits it.
  - The weak point is SignPath's "verifiable reputation" condition: the repository is new.
  - Every release needs the owner's approval in SignPath.
  - **Later: a Microsoft Store (MSIX) listing.** Individual registration is free, and it's the
    only option with no SmartScreen warning.
  - **Fallback if SignPath says no: Certum Open Source** (~€49 a year, owner's name, signing
    approved from a phone app, so no unattended CI).
  - **Azure Artifact Signing** ($9.99 a month) is rejected on cost.
- **In a store world the TV or tablet app is the host. There is no PC** (the owner's direction,
  2026-11-10; Proposed ADR-0014).
  - The app (Android TV/Gemini, Android tablet, iPad) runs the game and the TypeScript host logic
    in its WebView.
  - Phones scan a QR to a trusted public web page (the web controller).
  - A small free cloud service (signalling) connects them over WebRTC data channels.
  - The PC zip and `npm start` stay the offline option.
  - Running today's Node + werift + cloudflared host *inside* an app would need fragile or
    unmaintained pieces:
    - nodejs-mobile's official release is still on Node 18;
    - cloudflared has no Android build;
    - tvOS has no web view at all.
  - **S9 is now a working prototype**, run by a separate session. Its results inform ADR-0014.
- **The DIRECTV Gemini is an Android TV box with Google Play** on every model found. The owner
  thinks his is the V2 (Android TV 14). It has **no browser**, so it needs the app. Sideloading
  (Developer Options/ADB) is plausible but unverified for DIRECTV's build. The owner is checking.
- **Keep the web controller via QR.** "No install" is the E02 goal. Native controller apps add
  App Store 4.2 risk and a local-network prompt, and gain little (iOS haptics).
- **Accounts:** the owner's Play Console and Apple Developer accounts are both personal. The Play
  Console also holds a separate work organization; a personal setup separate from it is fine.
  Distribution is test-only for now. The open questions are the publisher name, IP ownership and
  Play's 12-tester rule (production only). See [§4](#4-account-and-ownership).
  - Trademark clearance (ADR-0009) must come before any **public** store listing. Test builds
    don't wait for it.
- **Realistic before Dec 18:**
  - SignPath-signed Windows releases, if SignPath accepts within about a week;
  - an S9 prototype;
  - **test builds**: a sideloaded APK on GitHub Releases for the Gemini and Android tablets, and
    an iPad TestFlight build. The owner did both in under a week for stripe-m2-pos.

  Public store listings come after name clearance.

## Prototype: can we sign the SEA exe?

Full method and output: [`spikes/s8-store-delivery/README.md`](../../spikes/s8-store-delivery/README.md).

| Check | Result |
|---|---|
| Package build (`node tools/package/windows/build.mjs`) | 79 s; exe 89.4 MB; zip 56.1 MB |
| Sign after `postject` without removing Node's signature | **Fails:** `signtool remove /s` → `0x00000057`, `signtool sign` → `0x800700C1` |
| `signtool remove /s` → `postject` → `signtool sign /fd SHA256` (throwaway self-signed certificate) | **Works**, 2.4–2.6 s with no timestamp server. Status `UnknownError` (untrusted root, as expected), not `HashMismatch` |
| rcedit 4.0.1 (MIT) before `postject`: name "Go Go HarmoniYo", company "Go Go HarmoniYo contributors", version, our icon | Works; VersionInfo shows our strings |
| Signed exe: full `tools/package/windows/smoke.mjs` (tunnel, WebRTC/werift, 16 charts, controller, state dir) | **Passed** |
| `cloudflared.exe` in the zip | Already **Valid**: "Cloudflare, Inc." (DigiCert Trusted G4 chain). Only our exe needs signing |
| `Play Go Go HarmoniYo.cmd` | Batch files can't carry an Authenticode signature. With a signed exe, tell people to start the exe |

Changes `build.mjs` needs before real signing. **None of them are made in this PR**; this spike
only reports them.

1. Accept a signtool path (`SIGNTOOL` env var or flag) and also look in the NuGet
   `microsoft.windows.sdk.buildtools` package. Today it searches only `Windows Kits`, and when it
   finds nothing it warns and carries on.
2. **Fail the build** when signing is requested and the signature can't be removed or applied.
   Otherwise the result is an exe that can't be signed.
3. Run rcedit (name, version, icon) before `postject`; sign last; then zip. Node's
   [SEA docs](https://nodejs.org/api/single-executable-applications.html) describe signing after
   injection.
4. Add a CI job on `windows-latest` (the SDK is already there) that signs through the chosen
   service. Only release tags should trigger it.

## 1. Code signing for the Windows zip

### What signing does and doesn't change

Source: Microsoft, *SmartScreen reputation for Windows app developers*
([learn.microsoft.com](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation),
dated 2026-05-04, updated 2026-08-17).

- SmartScreen looks at publisher reputation and the reputation of each file's hash.
- An unsigned file starts at zero for every new version.
- A signed file from a new publisher still says "unrecognized" until reputation builds up, but
  the dialog shows the publisher's name instead of "Unknown publisher".
- "**EV certificates no longer bypass SmartScreen.**"
- Store-signed MSIX packages avoid SmartScreen.

Source: Microsoft, *Code signing for Smart App Control*
([learn.microsoft.com](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control),
2026-09-25).

- SAC allows apps signed with a certificate from a trusted provider.
- "Artifact Signing is the preferred way to sign your app."
- Today SAC **blocks** our unsigned exe outright: there is no "run anyway".

### Comparison

Revised 2026-11-10: the owner rejected Azure's $9.99 a month as too expensive for a hobby/OSS
project and asked about other common options. Columns are in order of recommendation.

| | **SignPath Foundation** (OSS) | **Microsoft Store (MSIX)** | **Certum Open Source** (cloud) | **Azure Artifact Signing** | **Commercial OV/EV** |
|---|---|---|---|---|---|
| Cost | Free | Individual registration **free since 2025-09-10** ([Windows blog](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)) | **From €49.00** a year ([Certum shop](https://shop.certum.eu/open-source-code-signing-on-simplysign.html), 2026-11-10) | Basic $9.99/month ([pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)). **Rejected by the owner on cost** | OV from ~$129/year (SSL.com, secondary) to several hundred (Sectigo, DigiCert); EV more; HSM or cloud key often extra |
| Name on the certificate / publisher | **"SignPath Foundation"**; product name and version from file metadata ([terms](https://signpath.org/terms.html)) | Microsoft re-signs the package; the Store shows the developer's display name | Owner's legal name with the prefix **"Open Source Developer"** in the CN; O is "Open Source Developer" ([Certum](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)) | Owner's legal name, matching a government ID ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart)) | Owner's name or company |
| Eligibility | OSI licence, no proprietary parts, maintained, **already released** in the form to be signed, functionality documented on the download page, MFA, **"a certain verifiable reputation"** for executables | Anyone who passes ID + selfie verification. Our app needs `runFullTrust`, a firewall rule and a child process (cloudflared): more review scrutiny (inference) | **Individuals only**; a public OSS project that clearly shows the subscriber's role; revoked if used for commercially distributed software ([Certum](https://shop.certum.eu/open-source-code-signing-on-simplysign.html)) | US/Canada individuals; organisations need 3+ years of history | Anyone who passes validation |
| Owner effort | Submit the application (draft below); keep the README policy current; **approve every release by hand** | Register; reserve the name; listing, privacy policy, age rating; certification on every release | Buy; identity verification (automatic, notary or photos with an ID), a utility bill and proof of the project relationship ([documents](https://support.certum.eu/en/code-signing-required-documents/)); install SimplySign Desktop and the SimplySign phone app; **sign each release by hand on his PC** | Azure Individual billing account, identity validation, certificate profile, OIDC app registration | Buy, validate, set up an HSM or cloud key, renew at least every ~459 days ([DigiCert](https://knowledge.digicert.com/alerts/code-signing-certificates-459-day-validity)) |
| CI fit | Official [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request); must build on GitHub-hosted runners ([origin verification](https://docs.signpath.io/origin-verification)); the run waits for the owner's approval | Package MSIX in CI; submit through Partner Center (by hand or the Store submission API) | **Poor.** Each session is approved with a code from the phone app; no vendor-supported headless mode. Community tools ([Le-Syl21/ssign](https://github.com/Le-Syl21/ssign), [IvanHanloth/super-simply-sign](https://github.com/IvanHanloth/super-simply-sign)) put the TOTP seed in CI secrets, which defeats the second factor | Best: [`azure/artifact-signing-action`](https://github.com/Azure/artifact-signing-action) with OIDC, unattended | No first-party Action; vendor cloud-HSM tools or a self-hosted runner |
| SmartScreen | Named publisher ("SignPath Foundation"); "unrecognized" at first; reputation builds | **No SmartScreen** (Store-signed) | Named publisher; reputation builds | Same as SignPath | Same (EV gets no bypass) |
| Smart App Control | Allowed once signed | Allowed | Allowed once signed | Allowed (Microsoft's "preferred" signer) | Allowed once signed |
| Time to first signed build | Review ~1 week (anecdotal, [amd/gaia#732](https://github.com/amd/gaia/issues/732)), then ~1.5 agent-days for the build hook and workflow. **Late November to early December if accepted.** Rejection is possible on reputation | MSIX packaging and test ~3–5 agent-days + certification up to 3 business days ([Microsoft](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)). A public listing waits for name clearance | Days (document checks; not timed) + ~1 agent-day for the build hook | 3–7 days | Days to ~2 weeks |
| Fits Go Go HarmoniYo? | **Yes: apply now** | **Yes, later**: the only way to remove the warning | **Fallback** if SignPath says no | No (cost) | No (cost, effort) |

Notes:

- The repository is public and MIT-licensed, created 2026-10-23, one contributor, 0 stars. The
  v0.1.0-alpha pre-release (2026-11-10) had 2 zip downloads when checked on 2026-11-10. The
  "released" condition is now met; **"reputation" is the risk.**
- SignPath also asks signed programs to:
  - announce system changes (we add a firewall rule only when the user accepts Windows' prompt);
  - give uninstall instructions (the README's Privacy section and the zip's `README.txt` have
    them);
  - disclose data sent to systems the user didn't choose. **The Cloudflare quick tunnel is on by
    default**, so the privacy text names it and the `--lan-only` way to turn it off.

    SignPath also wants the privacy policy **shown during install**. The zip has no installer, so
    a follow-up should add the privacy paragraph to `README.txt` and the launcher's first-run
    output.
- SignPath enforces file metadata (product name and version). The rcedit step above is required.
- SignPath signs only our own binaries. `cloudflared.exe` is already signed by Cloudflare.

### Other common options

The owner asked, "Any other common options I should know about?" The answer, as of 2026-11-10:

| Option | What it is | Verdict |
|---|---|---|
| Stay unsigned | Today's v0.1.0-alpha: SmartScreen → *More info* → *Run anyway*; Smart App Control blocks it | Acceptable for friends and family until SignPath lands |
| Certum Open Source (above) | The common paid OSS certificate, ~€49/year | Fallback |
| Commercial OV (SSL.com eSigner, Sectigo, DigiCert, GlobalSign) | ~$129+/year plus cloud HSM fees | Too expensive for a hobby project |
| EV certificate | Higher price; **no SmartScreen bypass** any more (Microsoft's current doc) | No benefit over OV for us |
| Microsoft Store MSIX (above) | Free; Store re-signs | Later |
| winget / Scoop / Chocolatey | Package-manager distribution; winget doesn't require signing | Useful channels later; **don't change SmartScreen** |
| Sigstore / GitHub artifact attestations | Free signed provenance (`gh attestation verify`) | Good to add for transparency; **no effect on SmartScreen or Smart App Control** |
| Self-signed certificate | Works only on PCs that trust our root | Not for end users |

### Recommendation

**Apply to SignPath Foundation now** (Proposed [ADR-0013](../decisions/0013-windows-code-signing.md)).
It's free, keeps the owner's name off the certificate, and has an official GitHub Action. The
manual approval per release suits our release rhythm.

- Until it's accepted, releases stay unsigned (the v0.1.0-alpha experience).
- If SignPath rejects the application, the fallback is **Certum Open Source**. The owner signs
  each release by hand on his PC, approving the session in the SimplySign app.
- Add a **Microsoft Store (MSIX)** listing later, after name clearance. It's the only option with
  no SmartScreen warning.
- **Azure Artifact Signing is rejected on cost.**

What the owner must do, in this order:

1. **Merge this PR** (or at least the README part). The README's
   [Code signing policy](../../README.md#code-signing-policy) and [Privacy](../../README.md#privacy)
   sections are the homepage and privacy-policy URLs the application points to.
2. **Add one line to the v0.1.0-alpha release notes.** SignPath requires the download page to
   mention it.

   > Code signing: Windows builds are being moved to free code signing by
   > [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org);
   > this release is unsigned. See the
   > [code signing policy](https://github.com/dcuccia/go-go-harmoniyo#code-signing-policy).

   Future release notes (`docs/release/<tag>.md`) carry the same section. An agent adds it with
   the signing workflow.
3. Check that **MFA is on** for his GitHub account. SignPath requires it for every team member.
4. **Submit the application** below at [signpath.org/apply](https://signpath.org/apply.html).
5. When accepted, follow SignPath's onboarding (organisation, project, artifact configuration,
   GitHub connector). An agent then wires up `build.mjs` and the release workflow (~1.5
   agent-days).

### SignPath Foundation application (ready to submit)

The form's fields were read on 2026-11-10 from [signpath.org/apply](https://signpath.org/apply.html)
(a HubSpot form with reCAPTCHA). Nothing was submitted. Required fields are marked \*.

| Field | Suggested answer |
|---|---|
| Project Name\* ("a Google search for this name should clearly identify your project") | Go Go HarmoniYo |
| Repository URL\* | https://github.com/dcuccia/go-go-harmoniyo |
| Homepage URL\* | https://github.com/dcuccia/go-go-harmoniyo (the README, which has the code signing policy) |
| Download URL ("must mention that the project uses the SignPath Foundation for code signing") | https://github.com/dcuccia/go-go-harmoniyo/releases (after the release-notes line above) |
| Privacy Policy URL ("required if the software collects user data") | https://github.com/dcuccia/go-go-harmoniyo#privacy |
| Wikipedia URL | (leave blank) |
| Tagline\* (one sentence) | A free, open-source party rhythm game where phones become handbells and families ring carols together on the TV. |
| Category\* | Gaming (Educational also fits) |
| Description\* (a short paragraph; no version-specific features) | Go Go HarmoniYo is a free, MIT-licensed handbell rhythm game for families and classrooms. A Windows PC shows the game on the TV, and players join by scanning a QR code with their phones, which become handbells: swing the phone when your bell reaches the line. Nothing is installed on the phones. Windows releases ship as a portable zip built from source by GitHub Actions; the program we'd sign is `go-go-harmoniyo.exe`, a Node.js single executable app with the game and its local host. All art, audio and songs are original or openly licensed, with provenance in the repository. |
| Reputation\* (links showing use: media, blogs, download stats, GitHub insights, community discussions) | Be honest that the project is new: "New project (October 2026), developed in the open with design records and test plans. First public alpha 2026-11-10, played by the maintainer's family and shared with friends and colleagues; a holiday release is planned for 2026-12-18." Links: the [release](https://github.com/dcuccia/go-go-harmoniyo/releases/tag/v0.1.0-alpha), [CHANGELOG](https://github.com/dcuccia/go-go-harmoniyo/blob/main/CHANGELOG.md), [design decisions](https://github.com/dcuccia/go-go-harmoniyo/tree/main/docs/decisions). Add download counts and any public mentions at submission time |
| Maintainer Type | Individual maintainer(s) |
| Build System\* | GitHub Actions |
| First Name\*, Last Name\*, Email\* | The owner's own, using a personal email (not the work organisation's) |
| Company Name ("your organization or employer, if applicable") | Leave blank: this is a personal project, not his employer's (see [§4](#4-account-and-ownership)) |
| Primary Discovery Channel\* (+ optional exact source) | The owner's answer, e.g. research with an AI assistant |
| Checkbox: Code of Conduct | Read first. It says certificates are issued in SignPath Foundation's name and can be revoked |
| Checkbox: data processing | Owner's consent |

Facts for SignPath's onboarding after acceptance:

- **Artifact to sign:** `go-go-harmoniyo.exe` inside `go-go-harmoniyo-<version>-windows-x64.zip`.
- **Build:** [`windows-package.yml`](../../.github/workflows/windows-package.yml) on GitHub-hosted
  `windows-latest` from `v*` tags; reproducible with `node tools/package/windows/build.mjs`.
- **Team:** @dcuccia is author, reviewer and approver, with MFA.
- **System changes:** none outside the unzipped folder and `%LOCALAPPDATA%\GoGoHarmoniYo`, except
  an inbound firewall rule if the user accepts Windows' prompt. Uninstall: delete both folders
  (and the rule).
- **Network use:**
  - a local web server for phones;
  - by default a Cloudflare quick tunnel (`trycloudflare.com`), plus DNS readiness checks against
    public resolvers;
  - `--lan-only` turns both off.

  No accounts, analytics or telemetry.

**Rejection risk:** "a certain verifiable reputation" is SignPath's judgement. With 0 stars and
one alpha, a "not yet" is possible. If so, ask what evidence would help, reapply after the
holiday release, and use Certum or stay unsigned meanwhile.

## 2. Which device is the host in a store world?

### Today's host and why it's hard to move

The TV page (`spikes/i2-web-phones`) is a browser client of the **Node host**
(`spikes/s1-phone-bell`). The host:

- serves HTTPS and WebSocket (HGP) to phones and the TV page;
- runs the clock sync;
- talks WebRTC through **werift** (a Node library);
- supervises **cloudflared** (ADR-0012).

All three pieces assume desktop Node.

### The DIRECTV Gemini

Sources: DIRECTV support and Insider pages
([000091357](https://www.directv.com/support/article/000091357),
[add apps to Gemini](https://www.directv.com/insider/add-apps-to-your-gemini-device)), FCC
filing news (June 2026), device spec sites. Medium confidence; not checked on a device.

| Model | OS | SoC | RAM / storage |
|---|---|---|---|
| Gemini (C71KW-200/400) | Android TV 8–11 (updates vary) | Broadcom BCM7271, 4× Cortex-A53 1.6 GHz, VideoCore V | 2–4 GB / 16 GB |
| Gemini Air | Android TV 11–14 | Broadcom BCM72181 | 4 GB / 16 GB |
| Gemini V2 (C81KW-650, FCC mid-2026, not widely shipped) | Android TV 14 | Amlogic S905X5, Mali-G310 | 4 GB / 64 GB, Wi-Fi 6 |

**The owner's box (2026-11-10):** he thinks it's the **V2 (Android TV 14)**. It has no browser.
He is checking sideloading. If it is the V2, its Amlogic S905X5 and 4 GB make the WebView host
much more plausible than on the original Gemini.

- **Google Play, Assistant and Cast** are on every model. That implies Google certification, so
  Play TV apps install normally.
- **Sideloading:** standard Android TV steps should work (Developer Options → USB/network
  debugging → `adb install`). **No source confirms or rules out a DIRECTV lock.** The owner
  must check on his box: Settings → Device Preferences → About (model, Android TV version), then
  tap Build 7 times.
- **Browser:** Android TV doesn't ship Chrome, and the owner's Gemini has none. **The game
  needs our own app there**, and that app has to be the host.
- **Unknown:** WebGL2, Web Audio and WebView WebRTC performance on the Broadcom chips and the V2's Amlogic S905X5 (S9 measures it). The original Gemini's
  quad A53 is weak; we found no benchmarks.

### Ways to run the host inside an app

| Approach | Status (sources) | Fit |
|---|---|---|
| **nodejs-mobile** (Android, iOS) | Official latest is **v18.20.4 (Node 18, end-of-life April 2025)**. A community fork claims Node 24 (unverified). On iOS it runs without a JIT; App Store fit is unverified | Reuses host code, but the runtime is end-of-life, and werift and cloudflared still don't come along easily. **High risk** |
| **Port the host to Kotlin/Swift** | Ktor/NanoHTTPD (Android) or `NWListener` (iOS) for HTTPS and WebSocket; Google's `libwebrtc` replaces werift. cloudflared has **no Android build**; the community workaround packages the Linux arm64 binary as `libcloudflared.so` in `jniLibs` to get around no-exec app storage, plus a DNS fix | A second host to maintain. Breaks ADR-0005's single TypeScript core unless kept minimal. 10–15 agent-days for Android TV |
| **WebView + embedded server** | WebView is Chromium, updated through Play on certified devices. A server plugin still needs a native HTTP/WS server | The same server work as above, plus WebView glue |
| **Host logic in the app's WebView + cloud signalling** (the owner's direction, 2026-11-10) | The app bundles the game and the TypeScript host logic and runs them in its WebView. Phones load the web controller from a trusted public page. A Cloudflare Worker/Durable Object (or similar, free tier) does WebRTC signalling; phones open data channels to the app. Android System WebView is Chromium; WKWebView has `RTCPeerConnection` and data channels from iOS 11 (camera/microphone only from 14.3; [WebKit, 2017](https://webkit.org/blog/7763/a-closer-look-into-webrtc/) and developer reports, secondary). Needs TURN on isolated networks | **No server in the app**, one TypeScript host. Needs internet to load the controller and to signal. The S9 prototype settles it |

Platform facts that constrain native hosts:

- **Android 14+ foreground services** must declare a type (e.g. `connectedDevice`) with the
  matching permission. Play asks for a declaration and a video
  ([Android 14 changes](https://developer.android.com/about/versions/14/changes/fgs-types-required)).
- Aggressive OEM task killers on budget boxes are a risk.
- **iOS/iPadOS:** a local server (`NWListener`) runs only while the app is in the foreground.
  Background audio used to keep a server alive gets rejected
  ([Guideline 2.5.4](https://developer.apple.com/app-store/review/guidelines/#2.5.4)). A host
  must stay in the foreground with `isIdleTimerDisabled`.
- **tvOS has no WKWebView.** An Apple TV host would mean rewriting the whole game natively.
  **Not viable.**
- **AirPlay mirroring** from an iPad adds roughly 150–500 ms of variable latency (secondary
  sources, unverified). A wired external display (USB-C/HDMI, `UIWindowScene` external role)
  is better.
  - Judging uses gesture source timestamps (ADR-0002), so latency moves only the picture.
  - The A/V calibration can absorb a stable offset, but not jitter.

### Options compared

| Host | What it takes | Effort (agent-days) | Main risks |
|---|---|---|---|
| **A. Android TV app (Gemini) running today's host** (nodejs-mobile or Kotlin port + WebView game) | TV app shell, host port, cloudflared trick, foreground service, leanback/D-pad | 6–10 (nodejs-mobile, high risk) / 10–15 (Kotlin) | Node 18 end-of-life; cloudflared not supported on Android; weak SoC; DIRECTV lock unknown |
| **B. Android TV app that is the host** (Gemini; the owner's direction): game + TypeScript host logic in the app's WebView; phones on the hosted web controller; free cloud signalling | ADR-0014; the S9 prototype; the app shell (Expo/React Native + `react-native-tvos`, Capacitor or a minimal Kotlin WebView); leanback and D-pad lobby | 3–5 (S9 prototype, separate session) + 2–4 (TV shell) + 1–2 (D-pad) | Internet needed; TURN on isolated networks; WebView WebRTC and WebGL performance on the box; DIRECTV sideload lock unknown |
| **C. Cast custom Web Receiver** (game page runs *on* the Gemini or Chromecast; a phone or PC sends only control messages) | $5 Cast registration ([support](https://support.google.com/cast-developer/answer/4512496)); receiver = our page; the host runs in the receiver page or in a phone/tablet app | 3–5 (receiver) / 6–9 (hybrid) | Receiver memory/perf limits; still needs a host somewhere |
| **D. iPad/Android tablet app that is the host**, showing on the TV over HDMI/USB-C or AirPlay | Same app as B (same WebView host); iPad via TestFlight | 2–4 per platform after B (native host instead: 15–25) | AirPlay latency jitter (wired is better); foreground only; iOS review for a WebView-heavy app (the bundled game is real app content, [2.5.2](https://developer.apple.com/app-store/review/guidelines/#2.5.2)) |
| **E. Phone as host** | Same as D on a phone; the phone is also a bell | ≈ D | Small screen unless cast; thermals and battery; foreground only |
| **F. Desktop stores** (Microsoft Store MSIX; notarized macOS zip; Mac App Store) | MSIX with full trust; Developer ID + notarization (`notarytool`, [Apple-Actions/notarize](https://github.com/Apple-Actions/notarize)); a Node SEA needs `allow-jit` / `allow-unsigned-executable-memory` | MSIX 3–5; notarized macOS zip 2–4; Mac App Store: not advised (sandbox + cloudflared child process) | macOS Sequoia removed right-click "Open" for unsigned apps, so notarization is needed for a usable macOS build |

### Recommendation

Revised 2026-11-10. The owner: "thin wrappers that require a host pc avoid the main benefit of
packaging/distributing as an app." His direction: "Online is fine for the app: TV/tablet app
hosts, phones scan a QR to a trusted web page, small free cloud service connects them; PC zip
stays the offline option."

**The TV or tablet app is the host. No PC is involved** (Proposed
[ADR-0014](../decisions/0014-store-era-host-architecture.md)).

1. **B first: an Android TV app for the Gemini.** It also runs on Android tablets with a
   touch layout.
2. **D next: an iPad app** with the same WebView host, through TestFlight.
3. Phones use the **hosted web controller**. A **small free signalling service** connects them
   to the app over WebRTC data channels.
4. The **PC zip / `npm start`** stays the offline LAN option, and the host for anyone without an
   app.
5. **The S9 working prototype** (a separate session) proves B end to end and picks the shell
   framework. Its results inform ADR-0014's acceptance.
6. A Cast receiver (C) and a phone host (E) can reuse the same page later.

**Rejected:**

- **A** (Node or native host inside the app), unless S9 fails;
- thin wrappers that need a PC;
- an Apple TV host.

**Shell framework candidates for S9:**

- **Expo/React Native + `react-native-webview`.** This is the owner's stripe-m2-pos stack (Expo
  ~52, React Native 0.76; APK via `expo prebuild` and Gradle; iOS via TestFlight). Expo builds
  Android TV and tvOS through the `react-native-tvos` fork and `@react-native-tvos/config-tv`
  ([Expo TV guide](https://docs.expo.dev/guides/building-for-tv/), modified 2026-11-02).
  Expo's TV guide warns that not every Expo library works on TV, and that the TV router example
  uses its own template. That doesn't matter for a WebView shell, but S9 should confirm that
  `react-native-webview` works on Android TV.
- **Capacitor** (the same web code, with native WebView projects).
- **A minimal Kotlin WebView app** for Android TV only.

## 3. Phone controllers

**Keep the web controller via QR.** It's E02's no-install promise and already works on iPhone,
iPad and Android (ADR-0012 owner checks).

What native controller apps would add:

- iOS haptics. Safari has no `navigator.vibrate`.
- Possibly higher sensor rates.
- Store presence.

What they would cost:

| Area | Apple App Store | Google Play |
|---|---|---|
| Wrapper risk | [4.2 / 4.2.2](https://developer.apple.com/app-store/review/guidelines/#4.2): "repackaged websites" are rejected. A motion-sensor controller with haptics is defensibly app-like; 4.2.3(i) allows companion apps if the store page says what's needed. Ship the web bundle inside the app ([2.5.2](https://developer.apple.com/app-store/review/guidelines/#2.5.2)); WebKit is required ([2.5.6](https://developer.apple.com/app-store/review/guidelines/#2.5.6)) | No equivalent rule, but a WebView-only app must still meet the minimum functionality policy |
| Local network | **Local network privacy prompt** for apps that connect to LAN devices, including through their own WKWebView (inferred) ([TN3179](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)). Safari pages don't get it | No prompt; `INTERNET` permission. Android 16+ local-network permission plans: not researched |
| Background | No background server or fake background audio ([2.5.4](https://developer.apple.com/app-store/review/guidelines/#2.5.4)) | Foreground service types and declarations (above) |
| Target API | Current Xcode/SDK requirement at submission | From **2026-08-31**, new apps and updates must target **API 36**; **TV apps API 34**; extensions until 2026-11-01 ([answer 11926878](https://support.google.com/googleplay/android-developer/answer/11926878)). 64-bit required for TV from 2026-08-01 |
| Privacy | Privacy "nutrition" label; aim for **Data Not Collected** (no analytics SDKs). Kids Category ([1.3](https://developer.apple.com/app-store/review/guidelines/#1.3)) is opt-in and strict | **Data safety form** for every app (assumed unchanged; not re-checked). Families policy applies if children are a target audience |
| Testing | TestFlight: internal testers need no review; external testers need Beta App Review; public links; builds expire after 90 days | Internal testing: up to 100 testers. **New personal accounts** (created after 2023-11-13) need a **closed test with 12 testers for 14 days** before *production* only ([answer 14151465](https://support.google.com/googleplay/android-developer/answer/14151465)) |

**Android TV requirements** for any TV app (option B), from the
[TV checklist](https://developer.android.com/training/tv/publishing/checklist) and
[TV app quality](https://developer.android.com/docs/quality-guidelines/tv-app-quality):

- a `LEANBACK_LAUNCHER` intent and `uses-feature android.software.leanback`;
- `android.hardware.touchscreen required="false"`;
- a 320×180 home-screen banner;
- **full D-pad navigation** (lobby, song picker, settings);
- no phone-only features required;
- a TV-layout review in Play Console.

The game's lobby and settings are mouse/keyboard today; D-pad focus handling is new work (~1–2
agent-days).

**Not researched:** App Clips (iOS) and Google Play Instant as zero-install store front doors.
They would need the same accounts.

## 4. Account and ownership

Revised 2026-11-10 with the owner's answers:

- **Both accounts are personal.** The Google Play Console developer account and the Apple
  Developer membership (the one used for stripe-m2-pos) are registered to the owner as an
  individual.
- The same Play Console also holds a **separate work organisation** (Modulated Imaging, Inc.,
  d.b.a. Modulim). A personal Go Go HarmoniYo setup, kept apart from that organisation, is fine.
- **Distribution is test-only for now:** sideloaded APKs and TestFlight builds, shared with
  colleagues through GitHub. There is no public listing yet.

What test distribution needs:

| Channel | Account | Review | Limits |
|---|---|---|---|
| **APK on GitHub Releases** (Gemini, Android tablets) | None. The APK is signed with our own app key, which stays out of the repo (a CI secret or the owner's machine) | None | The user enables sideloading. ADB installs stay allowed under Android developer verification (below) |
| **Play internal testing** (optional) | Personal Play Console | Usually fast | Up to 100 testers; no 12-tester rule ([answer 14151465](https://support.google.com/googleplay/android-developer/answer/14151465)) |
| **TestFlight** (iPad) | Personal Apple Developer | Internal testers (App Store Connect team members): none. External testers (email or public link): Beta App Review of the first build | Builds expire after 90 days. Needs an App Store Connect app record; a working name can be used and changed before a public release (secondary) |

Both stores show the **account holder as the seller** on public listings. Apple shows an
individual's legal name; Google shows the developer name plus verified identity data. Apple
guideline [5.1.1(ix)](https://developer.apple.com/app-store/review/guidelines/#5.1.1) allows
individual accounts for apps outside regulated fields. Converting a Play account from personal
to organisation is one-way; app transfers between accounts are possible on both stores.

**Open questions for the owner.** This report doesn't decide them; none is legal advice.

1. **Publisher name.** Which name should appear as the publisher?
   - Apple (individual): his legal name, fixed by the account.
   - Google Play: the developer name he chooses for the personal account.
   - Windows: "SignPath Foundation" if SignPath signs; "Open Source Developer, \<his name\>" if
     Certum signs; the publisher display name on the Microsoft Store.
   - A future entity (an LLC) would change all of these, and needs D-U-N-S for Apple.
2. **IP ownership.** Does his employment agreement with Modulim leave a personal, after-hours,
   MIT-licensed project with him? Keep Go Go HarmoniYo apps, keys and testers out of the
   Modulim organisation in the Play Console.
3. **Play's 12-tester rule.** A personal Play account created after 2023-11-13 needs a closed
   test with 12 testers for 14 days before **production** access. When was his personal
   developer account created? The rule doesn't affect sideloaded APKs, internal testing or
   TestFlight.

Still needed before any **public** listing:

- **Trademark clearance first.** [ADR-0009](../decisions/0009-product-name.md) and the
  [roadmap naming section](../roadmap.md) already say: before a public app-store launch,
  commission a full clearance search and consider a US filing (classes 9 and 41).
  - Store listings publish and effectively reserve the name.
  - Domains and handles are also still unreserved (ADR-0009 owner actions).
  - Test builds, TestFlight and signing GitHub Releases don't need it.
- **Public-facing basics** every store needs:
  - a privacy policy URL (the README's [Privacy](../../README.md#privacy) section, extended for
    the app and the signalling service);
  - a support contact email;
  - an age rating (IARC questionnaire);
  - a decision on targeting children (Kids Category / Families policy; avoid unless intended);
  - for the EU (DSA): Apple asks whether the account is a "trader". A free hobby app is
    probably not, but a trader must publish contact details
    ([Apple DSA](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)).
- **Android developer verification:** enforcement started 2026-09-30 in four countries
  (Brazil, Indonesia, Singapore, Thailand). It goes global in 2027 for sideloaded apps too, with
  a free limited-distribution tier for up to 20 devices; ADB installs are still allowed
  ([Android Developers Blog](https://android-developers.googleblog.com/2026/06/android-developer-verification.html)).
  A Gemini sideload test via ADB isn't affected.

## 5. Recommended sequence and effort

Revised 2026-11-10. Effort is in agent-days of repo work; owner time is listed separately.
Today is Tuesday 2026-11-10.

| When | Work | Effort | Owner |
|---|---|---|---|
| **By Thanksgiving (2026-11-26)** | Merge this PR (README code signing policy and privacy) | — | Review, merge |
| | Add the release-notes line to v0.1.0-alpha (§1 step 2); check GitHub MFA | — | ~10 min |
| | **Submit the SignPath application** (§1) | — | ~30 min, then wait (about a week in one report, secondary) |
| | Privacy paragraph in the zip's `README.txt` and the launcher output (a SignPath term) | ~0.5 | Review |
| | **Check the Gemini:** model and Android TV version, Developer Options, ADB/sideload of a test APK | — | ~30 min |
| | **S9 working prototype** under way (separate session): Android TV app hosting in its WebView, hosted web controller, free signalling Worker | 3–5 | Device tests |
| | Answer the §4 questions | — | Owner time |
| **By the holiday release (2026-12-18)** | If SignPath accepts: `build.mjs` signing hook (signtool lookup, fail closed, rcedit metadata) and the SignPath release workflow → signed release | ~1 + ~0.5 | Approve each signing request |
| | If SignPath hasn't answered or said no: release unsigned as today, or sign by hand with Certum (~€49/yr) | — | Certum validation, manual signing |
| | **Sideloaded Android TV / Android tablet APK** on GitHub Releases (after S9) | 2–4 | Sideload, test on the Gemini |
| | D-pad lobby, song picker and settings | 1–2 | Test with the remote |
| | **iPad TestFlight build** with the same WebView host | 2–4 | App Store Connect record, testers |
| **Later** (after name clearance) | Trademark clearance, domains and handles | — | Owner |
| | Public listings: Play (TV and tablet; closed test first if the rule applies), App Store (iPad), Microsoft Store MSIX | 3–5 each + review | Store pages, ratings, privacy |
| | Cast receiver; notarized macOS zip | 3–5; 2–4 | — |
| | Native controller apps, only if haptics or sensor rates justify them | 4–7 (Capacitor iOS) / 10–15 (native) | — |

Everything up to the holiday release depends on S9 passing. The owner shipped a TestFlight
build and a sideloaded APK for stripe-m2-pos in under a week, which matches these estimates.

Not realistic before Dec 18:

- any **public store listing** (clearance, review, and Play's closed test if it applies);
- a **native** TV or iPad host (option A), if S9 fails.

## Platform limits

- **Windows:**
  - Smart App Control blocks unsigned apps with no override. SmartScreen warns until reputation
    builds, even when signed.
  - Batch launchers can't be signed.
  - Windows on Arm wasn't tested (x64 emulation expected).
- **macOS:** Sequoia removed right-click "Open" for unsigned apps, so notarization is needed. A
  Node SEA needs the JIT entitlements under the hardened runtime.
- **Linux/ChromeOS:** no store question. ChromeOS uses the hosted page.
- **iOS/iPadOS:**
  - Foreground-only servers.
  - The local-network prompt in apps.
  - No WebView on tvOS.
  - AirPlay latency jitter.
  - Safari pages don't get the local-network prompt (why the web controller avoids it).
- **Android / Android TV:**
  - Foreground service types and declarations (Android 14+).
  - OEM task killers.
  - No official cloudflared build.
  - WebView updated through Play.
  - Gemini GPU performance unknown.
  - DIRECTV sideloading unverified.
- **Store-era app ([ADR-0014](../decisions/0014-store-era-host-architecture.md)):**
  - Needs internet: phones load the hosted controller, and the signalling service connects them.
  - Networks that block peer-to-peer need TURN.
  - WebView WebRTC and WebGL performance on the Gemini are unverified (S9).
  - Offline play stays on the PC zip / `npm start`.
- **Cast:** a custom receiver runs our page on the Cast device. Only control messages cross
  the network. Mirroring (tab cast) is a different, higher-latency path.

## Sources

Accessed 2026-11-09 unless marked 2026-11-10 (the revision). "Secondary" marks claims not confirmed from the vendor's own page.

- Microsoft:
  - [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) (2026-05-04, updated 2026-08-17)
  - [Code signing for Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control) (2026-09-25)
  - [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) (updated 2026-10-08)
  - [pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
  - [GA announcement](https://techcommunity.microsoft.com/blog/microsoft-security-blog/simplifying-code-signing-for-windows-apps-artifact-signing-ga/4482789)
  - [Free Store registration for individuals](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/) (2025-09-10)
  - [MSIX certification](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)
- SignPath:
  - [Foundation terms](https://signpath.org/terms.html) (fetched directly; re-read 2026-11-10)
  - [application form](https://signpath.org/apply.html) (fields read 2026-11-10; nothing submitted)
  - [docs](https://docs.signpath.io/), [origin verification](https://docs.signpath.io/origin-verification)
  - [GitHub Action](https://github.com/signpath/github-action-submit-signing-request)
  - approval timing anecdote [amd/gaia#732](https://github.com/amd/gaia/issues/732) (secondary)
- Certificates:
  - [DigiCert 459-day validity](https://knowledge.digicert.com/alerts/code-signing-certificates-459-day-validity)
  - Certum (2026-11-10): [Open Source Code Signing in the Cloud](https://shop.certum.eu/open-source-code-signing-on-simplysign.html), [required documents](https://support.certum.eu/en/code-signing-required-documents/); community CI tools [Le-Syl21/ssign](https://github.com/Le-Syl21/ssign) and [IvanHanloth/super-simply-sign](https://github.com/IvanHanloth/super-simply-sign) (secondary)
  - [Sectigo](https://www.sectigo.com/ssl-certificates-tls/code-signing)
  - SSL.com pricing (secondary)
- Node: [single executable applications](https://nodejs.org/api/single-executable-applications.html).
- Google:
  - [target API level](https://support.google.com/googleplay/android-developer/answer/11926878)
  - [testing requirements for new personal accounts](https://support.google.com/googleplay/android-developer/answer/14151465)
  - [TV checklist](https://developer.android.com/training/tv/publishing/checklist)
  - [TV quality](https://developer.android.com/docs/quality-guidelines/tv-app-quality)
  - [TV distribution](https://developer.android.com/training/tv/publishing/distribute)
  - [TV banner/icon](https://developer.android.com/design/ui/tv/guides/system/tv-app-icon-guidelines)
  - [foreground service types](https://developer.android.com/about/versions/14/changes/fgs-types-required)
  - [developer verification](https://android-developers.googleblog.com/2026/06/android-developer-verification.html)
  - [Cast registration](https://support.google.com/cast-developer/answer/4512496)
- DIRECTV:
  - [support 000091357](https://www.directv.com/support/article/000091357)
  - [adding apps to Gemini](https://www.directv.com/insider/add-apps-to-your-gemini-device)
  - spec sites and FCC news (secondary)
- nodejs-mobile: [GitHub releases](https://github.com/nodejs-mobile/nodejs-mobile/releases)
  (v18.20.4). Community fork claims are secondary.
- cloudflared on Android: community guides only (secondary).
- Apple:
  - [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) (1.3, 2.5.2, 2.5.4, 2.5.6, 4.2, 5.1.1)
  - [TN3179 local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
  - [NWListener](https://developer.apple.com/documentation/network/nwlistener)
  - [connected displays](https://developer.apple.com/documentation/uikit/presenting-content-on-a-connected-display)
  - [isIdleTimerDisabled](https://developer.apple.com/documentation/uikit/uiapplication/isidletimerdisabled)
  - [hardened runtime](https://developer.apple.com/documentation/xcode/configuring-the-hardened-runtime)
  - [DSA trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)
  - [Apple-Actions/notarize](https://github.com/Apple-Actions/notarize)
  - enrollment timing and seller-name details (secondary)
- Expo (2026-11-10): [Building for TV](https://docs.expo.dev/guides/building-for-tv/) (modified
  2026-11-02; `react-native-tvos`, `@react-native-tvos/config-tv`).
- WebKit: [A Closer Look Into WebRTC](https://webkit.org/blog/7763/a-closer-look-into-webrtc/)
  (2017); WKWebView data channels from iOS 11 and getUserMedia from 14.3 per developer reports
  (secondary).
- The owner's stripe-m2-pos app (`dcuccia/stripe-m2-pos`, `mobile/`): Expo ~52, React Native
  0.76, APK via `expo prebuild` + Gradle, iOS via TestFlight (read 2026-11-10).
- Repository facts: `gh repo view` / `gh release list` on 2026-11-09 (public, MIT, created
  2026-10-23, no releases) and 2026-11-10 (0 stars, 0 forks;
  [v0.1.0-alpha](https://github.com/dcuccia/go-go-harmoniyo/releases/tag/v0.1.0-alpha)
  pre-release, 2 zip downloads).

## Owner decisions and to-dos

### Decided 2026-11-10

- **Signing:** no paid subscription ("9.99 a month is too expensive for this hobby/oss
  project"). Apply to SignPath Foundation now; add a Microsoft Store (MSIX) listing later;
  Certum Open Source is the fallback; Azure Artifact Signing is rejected on cost
  ([ADR-0013](../decisions/0013-windows-code-signing.md), Proposed).
- **Host:** the TV or tablet app is the host, with no PC. "Online is fine for the app: TV/tablet
  app hosts, phones scan a QR to a trusted web page, small free cloud service connects them; PC
  zip stays the offline option"
  ([ADR-0014](../decisions/0014-store-era-host-architecture.md), Proposed; the S9 working
  prototype informs acceptance).
- **Timeline:** test builds (sideloaded APKs on GitHub Releases, TestFlight) go out as soon as
  they work. Only public store listings wait for name clearance.
- **Accounts:** the personal Play Console and Apple Developer accounts, kept separate from the
  Modulim organisation. Distribution is test-only for now.
- **Gemini:** probably the V2 (Android TV 14), with no browser, so the app is needed.

### Owner to-dos

1. Review and **merge this PR**. The README's code signing policy and privacy sections are
   SignPath prerequisites.
2. **Add the release-notes line** to v0.1.0-alpha ([§1 step 2](#recommendation)).
3. Check that **MFA is on** for GitHub.
4. **Submit the SignPath application**
   ([ready to submit](#signpath-foundation-application-ready-to-submit)).
5. **Gemini:** confirm the model and Android TV version, enable Developer Options, and try
   sideloading an APK (ADB or a sideload app).
6. Answer the [§4](#4-account-and-ownership) questions: publisher name, IP ownership, and when
   the personal Play account was created (12-tester rule, production only).
7. Accept ADR-0013 when ready, and ADR-0014 after the S9 results.
8. **Trademark clearance and name reservations** (ADR-0009) before any public store listing.

### Agent follow-ups

- Privacy paragraph in the zip's `README.txt` and the launcher output (a SignPath term).
- After SignPath accepts: `build.mjs` signing hook (`SIGNTOOL`, fail closed, rcedit metadata) and
  the SignPath release workflow (~1.5 agent-days).
- S9 working prototype (separate session).
- After S9: the Android TV / tablet APK shell and D-pad lobby, then the iPad TestFlight shell.
