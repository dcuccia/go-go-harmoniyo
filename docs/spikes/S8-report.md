# S8 — Store delivery and code signing: report

- Brief: [S8-store-delivery-and-signing.md](S8-store-delivery-and-signing.md)
- Date: 2026-11-09. Sources were accessed on that date unless noted.
- Prototype: [`spikes/s8-store-delivery/`](../../spikes/s8-store-delivery/README.md), run on
  Windows 11 x64 with Node 22.18 (build) and Node 22.23.4 (inside the exe), cloudflared
  2026.10.7.
- Proposed ADRs:
  - [ADR-0013](../decisions/0013-windows-code-signing.md): Windows code signing.
  - [ADR-0014](../decisions/0014-store-era-host-architecture.md): store-era host architecture.
  - Both are `Proposed`. The owner decides.
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
- **Recommended signing path: Azure Artifact Signing** (formerly Trusted Signing).
  - US/Canada individuals are eligible.
  - $9.99/month.
  - Identity validation takes days.
  - There is a first-party GitHub Action with OIDC.
  - A signed zip before Thanksgiving is realistic if the owner starts this week.
  - The certificate shows **the owner's legal name**.
  - SignPath Foundation is free and keeps the owner's name off the certificate (the publisher is
    "SignPath Foundation"). But it requires an existing public release, a code-signing-policy page,
    "verifiable reputation" and a manual approval for every release. Apply after the first public
    release. A draft application is below.
- **The DIRECTV Gemini is an Android TV box with Google Play** on every model found. Sideloading
  (Developer Options/ADB) is plausible but **unverified for DIRECTV's build**, and so is the
  owner's model.
  - Running today's Node + werift + cloudflared host *inside* an Android TV or iOS app is possible
    only through fragile or unmaintained pieces:
    - nodejs-mobile's official release is still on Node 18;
    - cloudflared has no Android build;
    - tvOS has no web view at all.
  - The cheaper store-era design is **"host in the page"** (Proposed ADR-0014):
    - the TV's browser page runs the host logic;
    - phones connect to it over WebRTC data channels;
    - a small cloud service does signalling.
  - Store apps then become thin shells: an Android TV WebView app, later a Cast receiver.
  - This needs a follow-up spike (S9, ~2–3 agent-days) before anyone commits to it.
- **Keep the web controller via QR.** "No install" is the E02 goal. Native controller apps add
  App Store 4.2 risk and a local-network prompt, and gain little (iOS haptics).
- **Accounts:** the owner's existing Play and Apple accounts are tied to work. Questions for the
  owner are in [§4](#4-account-and-ownership).
  - Trademark clearance (ADR-0009) must come before any public store listing.
- **Realistic now:** signing plus a first public GitHub Release before Dec 18. Android TV and
  stores come in 2027, after clearance and S9.

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

| | **Azure Artifact Signing** | **SignPath Foundation** (OSS) | **OV/EV certificate** | **Microsoft Store (MSIX)** |
|---|---|---|---|---|
| Cost | Basic $9.99/month (5,000 signatures); Premium $99.99/month ([pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)). Needs a paid Azure subscription | Free | OV from ~$129/year (SSL.com) up to several hundred (Sectigo, DigiCert). EV costs more. **Certum Open Source** from ~€49/year ([Certum](https://shop.certum.eu/open-source-code-signing.html)). Since June 2023 the key must live in a hardware or cloud HSM, which often costs extra | Individual registration has been **free since 2025-09-10** ([Windows blog](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/)) |
| Name on the certificate / publisher | **The owner's legal name**, from an Azure billing account of type *Individual*. It must match a government ID ([quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart), updated 2026-10-08) | **"SignPath Foundation"**. The product name comes from file metadata ([terms](https://signpath.org/terms.html)) | Owner's name (OV/EV individual or company); Certum OSS: "Open Source Developer, <name>" | Microsoft re-signs the package; the Store shows the developer's display name |
| Eligibility | "Individual developers must be located in the United States or Canada"; organisations need 3+ years of history in more countries | OSI licence, no proprietary parts, actively maintained, **already released** in the form to be signed, functionality documented, MFA for the team, **"a certain verifiable reputation"** for executables | Anyone who passes validation | Anyone who passes ID + selfie verification. Our app needs `runFullTrust`, a firewall rule and a child process (cloudflared): more review scrutiny (inference) |
| Owner effort | Create a personal Azure billing account (Individual), a subscription and an Artifact Signing account; identity validation in the portal; certificate profile; OIDC app registration + GitHub secrets. ~1–2 h, then wait | Prepare a release, a code-signing-policy section, a privacy statement and team roles; fill in the application; **approve every release by hand** in SignPath | Buy, validate, set up an HSM/cloud key, renew at least every ~459 days (from 2026-03-01, [DigiCert KB](https://knowledge.digicert.com/alerts/code-signing-certificates-459-day-validity)) | Register; reserve the name; write the listing, privacy policy and age rating; every release goes through certification |
| CI fit | [`azure/artifact-signing-action`](https://github.com/Azure/artifact-signing-action) + `azure/login` with OIDC, no stored secret. Short-lived certificates, timestamped (`timestamp.acs.microsoft.com`) | [`signpath/github-action-submit-signing-request`](https://github.com/signpath/github-action-submit-signing-request). Must build on GitHub-hosted runners ([origin verification](https://docs.signpath.io/origin-verification)). A human approves each request | No first-party Action. Vendor cloud-HSM tools (e.g. SSL.com eSigner, Certum SimplySign) or a self-hosted runner holding a token | Package as MSIX in CI; submit through Partner Center (manual or Store submission API) |
| SmartScreen | Named publisher; still "unrecognized" at first; reputation builds | Same, with publisher "SignPath Foundation" | Same (EV gets no bypass) | **No SmartScreen** (Store-signed) |
| Smart App Control | Allowed once signed (Microsoft's preferred method) | Allowed once signed | Allowed once signed | Allowed |
| Time to first signed build | Validation takes "a few business days" (Microsoft) plus ~0.5 agent-day of CI work: **about 3–7 days** | **Not possible now:** no public release exists yet. Once there is one, approval takes ~1 week anecdotally ([amd/gaia#732](https://github.com/amd/gaia/issues/732)), with a risk of rejection for reputation | Days to ~2 weeks (validation + hardware/HSM) | MSIX packaging and test (~3–5 agent-days) + certification (up to 3 business days, [Microsoft](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)) |
| Fits Go Go HarmoniYo now? | **Yes** | Later (after the first public release) | Only if the owner wants his own name and to avoid Azure; most cost and effort | Later, if store discoverability is wanted |

Notes:

- The repository is public and MIT-licensed. It was created 2026-10-23, has one contributor, 0
  stars and **no GitHub Releases** (checked 2026-11-09). SignPath's "released" and "reputation"
  conditions are the blockers today, not the licence.
- SignPath also asks signed programs to:
  - announce system changes (we add a firewall rule only when the user accepts Windows' prompt);
  - give uninstall instructions (the package README has them);
  - name third-party services. **The Cloudflare quick tunnel must be disclosed in the privacy
    statement.**
- SignPath enforces file metadata (product name and version). The rcedit step above is required
  for SignPath anyway.
- winget doesn't require signing ([winget-pkgs](https://github.com/microsoft/winget-pkgs)
  validation), but it gives no SmartScreen relief.

### Recommendation

**Azure Artifact Signing now** (Proposed [ADR-0013](../decisions/0013-windows-code-signing.md)).
It is the only option that can sign a public build before Thanksgiving with a known cost, no
reputation gate, and an unattended, tag-triggered CI step.

- Apply to **SignPath Foundation after the first public release** if the owner prefers a free
  option and keeping his name off the certificate. It could replace Azure later.
- Consider the **Microsoft Store (MSIX)** later. It is the only way to have no warning at all,
  and the Store also brings discoverability.

What the owner must do (Azure):

1. Decide whether the owner's legal name on the certificate is acceptable ([§4](#4-account-and-ownership)).
2. Use a **personal** Microsoft account and an Azure billing account of type *Individual*, not
   the work tenant. Name and address must match a government ID.
3. Create a subscription, a resource group and an **Artifact Signing account** (Basic, a US
   region), then submit **identity validation** (Public Trust) in the portal. This is
   portal-only, and Microsoft says it takes a few business days.
4. When validated, create a **Public Trust certificate profile**.
5. Create an Entra app registration with a GitHub OIDC federated credential (repo
   `dcuccia/go-go-harmoniyo`, release tags or a `release` environment). Grant it the
   *Artifact Signing Certificate Profile Signer* role.
6. Add the GitHub secrets/variables: tenant, client and subscription IDs, account name, profile
   name, endpoint. An agent then wires up the workflow (~0.5 agent-day).
7. After the first signed release, run the package README's clean-account checklist. Record the
   SmartScreen and Smart App Control dialogs it shows.

### Draft for later: SignPath Foundation application (not submitted)

The [apply page](https://signpath.org/apply.html) didn't render for us (cookie wall). Its exact
fields weren't checked. These are the facts it asks for, according to the
[terms](https://signpath.org/terms.html):

> **Project:** Go Go HarmoniYo — https://github.com/dcuccia/go-go-harmoniyo
> **License:** MIT (code); original assets CC BY 4.0, AI-generated assets CC0; REUSE-compliant.
> **Description:** A free handbell rhythm game for families and classrooms. A Windows PC shows the
> game on the TV; phones join by scanning a QR code and become handbells (motion sensors). Each
> release ships as a portable zip: `go-go-harmoniyo.exe` (Node.js single executable app with the
> game and host), `cloudflared.exe` (Cloudflare, already signed by Cloudflare, Inc.), licences
> and notices.
> **Artifacts to sign:** `go-go-harmoniyo.exe` inside `GoGoHarmoniYo-<version>-win-x64.zip`.
> **Build:** GitHub Actions on GitHub-hosted `windows-latest` runners from tagged commits;
> reproducible from source with `node tools/package/windows/build.mjs`.
> **Team:** @dcuccia — author, reviewer, approver (MFA enabled).
> **System changes:** none outside the folder and `%LOCALAPPDATA%\GoGoHarmoniYo`, except an
> inbound firewall rule if the user accepts Windows' prompt. Uninstall: delete both folders
> (and the rule).
> **Network use:** a local web server for phones on the same network; by default a Cloudflare
> quick tunnel (trycloudflare.com) so phones can join without certificate warnings. No accounts,
> analytics or telemetry.

Do this first:

- publish a GitHub Release;
- add the policy section below to the README and the release notes;
- enable MFA;
- add rcedit metadata.

### Draft: "Code signing policy" section (for the README, once SignPath signs our builds)

> ## Code signing policy
>
> Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by
> [SignPath Foundation](https://signpath.org/).
>
> - Committers and reviewers: [@dcuccia](https://github.com/dcuccia)
> - Approvers: [@dcuccia](https://github.com/dcuccia)
>
> **Privacy.** This program will not transfer any information to other networked systems unless
> specifically requested by the user or the person installing or operating it. To let phones
> join, it runs a local web server and, by default, opens a Cloudflare quick tunnel
> (trycloudflare.com); start it with `--lan-only` to keep everything on your network.

With Azure Artifact Signing, keep only the **Privacy** paragraph. It's good practice either way.

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

- **Google Play, Assistant and Cast** are on every model. That implies Google certification, so
  Play TV apps install normally.
- **Sideloading:** standard Android TV steps should work (Developer Options → USB/network
  debugging → `adb install`). **No source confirms or rules out a DIRECTV lock.** The owner
  must check on his box: Settings → Device Preferences → About (model, Android TV version), then
  tap Build 7 times.
- **Browser:** Android TV doesn't ship Chrome. Running the game in a browser would need a
  third-party TV browser or our own WebView shell.
- **Unknown:** WebGL2 and Web Audio performance on the Broadcom chips. The original Gemini's
  quad A53 is weak; we found no benchmarks.

### Ways to run the host inside an app

| Approach | Status (sources) | Fit |
|---|---|---|
| **nodejs-mobile** (Android, iOS) | Official latest is **v18.20.4 (Node 18, end-of-life April 2025)**. A community fork claims Node 24 (unverified). On iOS it runs without a JIT; App Store fit is unverified | Reuses host code, but the runtime is end-of-life, and werift and cloudflared still don't come along easily. **High risk** |
| **Port the host to Kotlin/Swift** | Ktor/NanoHTTPD (Android) or `NWListener` (iOS) for HTTPS and WebSocket; Google's `libwebrtc` replaces werift. cloudflared has **no Android build**; the community workaround packages the Linux arm64 binary as `libcloudflared.so` in `jniLibs` to get around no-exec app storage, plus a DNS fix | A second host to maintain. Breaks ADR-0005's single TypeScript core unless kept minimal. 10–15 agent-days for Android TV |
| **WebView + embedded server** | WebView is Chromium, updated through Play on certified devices. A server plugin still needs a native HTTP/WS server | The same server work as above, plus WebView glue |
| **Cloud relay / host in the page** | A Cloudflare Worker/Durable Object (or similar) does WebRTC signalling. The TV page itself is the host; phones open data channels to it. Needs TURN on isolated networks | **No server on the device.** Any modern browser or WebView can host. Needs internet to load and signal. The S9 spike would settle it |

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
| **B. Android TV WebView shell around a hosted "host in the page"** | ADR-0014 + S9; the shell loads the hosted game; D-pad lobby | 2–3 (S9) + 2–4 (shell) | Internet needed; TURN on isolated networks; WebGL perf on the box |
| **C. Cast custom Web Receiver** (game page runs *on* the Gemini or Chromecast; a phone or PC sends only control messages) | $5 Cast registration ([support](https://support.google.com/cast-developer/answer/4512496)); receiver = our page; host in the page or on a phone | 3–5 (receiver) / 6–9 (hybrid) | Receiver memory/perf limits; still needs a host somewhere |
| **D. iPad/Android tablet host app casting to the TV** | Native app + embedded server or host in the page; AirPlay/HDMI out | 15–25 (iPad native host) | AirPlay latency jitter; foreground only; local-network prompt; review |
| **E. Phone as host** | Same as D on a phone; the phone is also a bell | ≈ D | Small screen unless cast; thermals and battery; foreground only |
| **F. Desktop stores** (Microsoft Store MSIX; notarized macOS zip; Mac App Store) | MSIX with full trust; Developer ID + notarization (`notarytool`, [Apple-Actions/notarize](https://github.com/Apple-Actions/notarize)); a Node SEA needs `allow-jit` / `allow-unsigned-executable-memory` | MSIX 3–5; notarized macOS zip 2–4; Mac App Store: not advised (sandbox + cloudflared child process) | macOS Sequoia removed right-click "Open" for unsigned apps, so notarization is needed for a usable macOS build |

### Recommendation

Use the **desktop host now** (signed zip; notarized macOS zip if wanted). Before building any
TV or tablet host app, run **S9** to test Proposed **ADR-0014: host in the page**. If S9
passes:

- the **Android TV app becomes a thin WebView shell** (option B), small enough to sideload on
  the Gemini first;
- an iPad can host from Safari with no app at all;
- a Cast receiver (C) reuses the same page.

**Defer A and D** (native hosts) unless S9 fails. **Rule out an Apple TV host.**

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
| Testing | TestFlight: external testers need Beta App Review; public links; builds expire after 90 days | **New personal accounts** (created after 2023-11-13) need a **closed test with 12 testers for 14 days** before production ([answer 14151465](https://support.google.com/googleplay/android-developer/answer/14151465)) |

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

The owner has a Play Console account for his work and an Apple Developer account for his work
on strip-m2-pos. Both stores show the **account holder as the seller**:

- Apple: an individual's legal name, or the organisation's legal name with a D-U-N-S number.
- Google: the developer name, plus verified identity data.

Publishing a personal open-source game under a work account would show the employer, or mix
the two, as seller.

Transfers are possible but take effort:

- Apple supports app transfers between accounts.
- Play app transfers take about 2 days.
- Converting a Play account from personal to organisation is one-way.

Apple guideline [5.1.1(ix)](https://developer.apple.com/app-store/review/guidelines/#5.1.1)
allows individual accounts for apps outside regulated fields.

**Questions for the owner.** This report doesn't decide them; none is legal advice.

1. **Employer IP and moonlighting:** does the employment agreement let him publish a personal app,
   especially under an account the employer owns or pays for? Who owns the strip-m2-pos Apple
   account: the employer (organisation) or him (individual)?
2. **Seller of record:** whose name should appear on store pages and on the Windows certificate?
   Options: his legal name (Apple individual, Azure Artifact Signing), "SignPath Foundation"
   (Windows only), or a future entity (an LLC: D-U-N-S, Apple organisation, Play organisation,
   Azure organisation, which needs 3+ years of history).
3. **New personal accounts?**
   - Apple Developer individual: $99/year. One Apple ID can belong to several teams and also hold
     its own individual membership.
   - Play personal: $25 once. If new, the 12-tester × 14-day closed test applies.
   - Microsoft Store individual: free.
4. **The work Play account:** organisation or personal, and created before 2023-11-13? This
   decides whether the closed-test rule applies if he did use it. Our default assumption is that
   he won't.
5. **Azure:** does he have, or want, a **personal** Azure billing account of type Individual
   for Artifact Signing, separate from any work tenant?
6. **Trademark clearance first.** [ADR-0009](../decisions/0009-product-name.md) and the
   [roadmap naming section](../roadmap.md) already say: before a public app-store launch,
   commission a full clearance search and consider a US filing (classes 9 and 41).
   - Store listings publish and effectively reserve the name.
   - Domains and handles are also still unreserved (ADR-0009 owner actions).
   - Do these before any public store listing. Signing a GitHub Release doesn't need them.
7. **Public-facing basics** every store and SignPath need:
   - a privacy policy URL (draft paragraph above);
   - a support contact email;
   - an age rating (IARC questionnaire);
   - a decision on targeting children (Kids Category / Families policy; avoid unless intended);
   - for the EU (DSA): Apple asks whether the account is a "trader". A free hobby app is
     probably not, but a trader must publish contact details
     ([Apple DSA](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/)).
8. **Android developer verification:** enforcement started 2026-09-30 in four countries
   (Brazil, Indonesia, Singapore, Thailand). It goes global in 2027 for sideloaded apps too, with
   a free limited-distribution tier for up to 20 devices; ADB installs are still allowed
   ([Android Developers Blog](https://android-developers.googleblog.com/2026/06/android-developer-verification.html)).
   A Gemini sideload test via ADB isn't affected.

## 5. Recommended sequence and effort

Effort is in agent-days of repo work; owner hours are listed separately. Today is Monday
2026-11-09.

| When | Work | Effort | Owner |
|---|---|---|---|
| **By Thanksgiving (2026-11-26)** | `build.mjs` signing hook: signtool lookup, fail closed, rcedit name/version/icon, exe as the documented launcher | ~1 | Review |
| | Azure Artifact Signing setup (above) → release workflow signs tagged builds | ~0.5 after validation | ~1–2 h + 3–7 days of waiting. **Start this week**: a signed zip around Nov 16–20 is realistic; a slipped validation means Thanksgiving uses the unsigned zip, as planned today |
| | Check the Gemini: model, Android TV version, Developer Options/ADB, whether a TV browser from Play loads the hosted game | — | ~30 min |
| | Answer the account and IP questions (§4) | — | Owner time |
| **By the holiday release (2026-12-18)** | First **public GitHub Release** with release notes, the privacy paragraph, signed zip and checksums | ~0.5 | Approve |
| | **S9: host in the page** (ADR-0014): browser↔browser data channels via a hosted signalling Worker, on home Wi-Fi, guest Wi-Fi and mobile data; iOS and Android | 2–3 | Device tests |
| | Optional: sideloaded **Android TV WebView shell** for the Gemini (only if S9 passes and ADB works) | 2–4 | Sideload, test |
| | Optional: **notarized macOS zip** (needs the Apple account decision) | 2–4 | Apple account |
| | Optional: SignPath application (after the release; ~1 week review) | ~0.5 | Apply, approve each release |
| **2027** | Trademark clearance → Play **Android TV** app (leanback, D-pad, data safety, closed test if new account) | 3–5 + review | Clearance, account |
| | Microsoft Store **MSIX** (no SmartScreen) | 3–5 | Store registration |
| | Cast receiver; iPad host via Safari (free if S9 passes) or TestFlight | 3–9 | — |
| | Native controller apps, only if haptics or sensor rates justify them | 4–7 (Capacitor iOS) / 10–15 (native) | Accounts |

Not realistic before Dec 18:

- any **public store listing** (clearance, accounts, review, Play's closed test);
- a **native** TV or iPad host.

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
- **Cast:** a custom receiver runs our page on the Cast device. Only control messages cross
  the network. Mirroring (tab cast) is a different, higher-latency path.

## Sources

All accessed 2026-11-09. "Secondary" marks claims not confirmed from the vendor's own page.

- Microsoft:
  - [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) (2026-05-04, updated 2026-08-17)
  - [Code signing for Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control) (2026-09-25)
  - [Artifact Signing quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart) (updated 2026-10-08)
  - [pricing](https://azure.microsoft.com/en-us/pricing/details/artifact-signing/)
  - [GA announcement](https://techcommunity.microsoft.com/blog/microsoft-security-blog/simplifying-code-signing-for-windows-apps-artifact-signing-ga/4482789)
  - [Free Store registration for individuals](https://blogs.windows.com/windowsdeveloper/2025/09/10/free-developer-registration-for-individual-developers-on-microsoft-store/) (2025-09-10)
  - [MSIX certification](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-certification-process)
- SignPath:
  - [Foundation terms](https://signpath.org/terms.html) (fetched directly)
  - [docs](https://docs.signpath.io/), [origin verification](https://docs.signpath.io/origin-verification)
  - [GitHub Action](https://github.com/signpath/github-action-submit-signing-request)
  - approval timing anecdote [amd/gaia#732](https://github.com/amd/gaia/issues/732) (secondary)
- Certificates:
  - [DigiCert 459-day validity](https://knowledge.digicert.com/alerts/code-signing-certificates-459-day-validity)
  - [Certum open source](https://shop.certum.eu/open-source-code-signing.html)
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
- Repository facts: `gh repo view` / `gh release list` on 2026-11-09 (public, MIT, created
  2026-10-23, no releases).

## Owner decisions and to-dos

1. **Accept, amend or reject [ADR-0013](../decisions/0013-windows-code-signing.md)** (Azure
   Artifact Signing now; SignPath after the first release; Store later). Decide whether his legal
   name on the certificate is fine.
2. If yes: set up a **personal Azure Individual** billing account, an Artifact Signing account
   and **identity validation this week** (steps in §1).
3. **Check the Gemini in hand:** model, Android TV version, Developer Options/ADB, and whether a
   Play-store TV browser can load the hosted game.
4. **Answer the account/IP questions** in §4 (employer agreement; who owns the strip-m2-pos
   Apple account and the work Play account; personal accounts; seller name).
5. **Trademark clearance and name reservations** (ADR-0009) before any public store listing.
6. **Decide on [ADR-0014](../decisions/0014-store-era-host-architecture.md)** (host in the page)
   **and whether to run S9** before the holiday release.
7. Optional: a notarized macOS zip (needs an Apple account choice) and a SignPath application
   after the first public release.
