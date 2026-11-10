# S8 — Store delivery and code signing (brief)

- Feeds: E11 (distribution), E02 (phone controller), E03 (host), E10 (licensing/brand)
- Requested: 2026-11-09 by the owner, via the coordinator session
- Time box: research plus at most one small feasibility prototype (~1 session)
- Report: [S8-report.md](S8-report.md); prototype: [`spikes/s8-store-delivery/`](../../spikes/s8-store-delivery/README.md)

## Why

The owner, verbatim:

> i'm also interested in pushing the envelope and working on an iOS + Android app store
> delivery, including possibly apps for my directv box (gemini) if that's possible? stretch
> goal, but why not? I'm already working on Play Store for my work, so I have some familiarity
> with the process and have a developer account already. And already have an Apple store
> account for my work on the strip-m2-pos project. Re: "SignPath" or similar - this sounds
> interesting, and would like to evaluate/pursue/compare options.

Today Go Go HarmoniYo ships two ways:

- `npm start` from a clone.
- A portable Windows zip: an unsigned Node single executable app plus `cloudflared.exe`
  ([#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43),
  [tools/package/windows](../../tools/package/windows/README.md)).

Phones join by scanning a QR code (web controller; ADR-0012: auto tunnel plus a direct WebRTC
upgrade).

## Question

What would it take to (a) sign the Windows build and (b) deliver Go Go HarmoniYo through app
stores: iOS, Android, Android TV (the owner's DIRECTV Gemini box) and desktop stores? Which
device hosts in that world, and in what order should we do it?

## Do

- A desk study from primary sources (vendor docs, store policies), with access dates. Mark
  anything only secondary-sourced or unverified.
- One small prototype: can the SEA exe be signed (and given our own name and icon) and still
  pass the package smoke test? Use a throwaway self-signed certificate only.
- Don't create accounts, apply to programs, buy certificates, publish, register or contact
  anyone. Draft any applications in the report for the owner.

## Kill criteria

- If the SEA exe can't be signed without breaking it, stop the signing track and report.
- If no store host option can run the game without a ground-up rewrite, say so. A clear "no"
  for a platform (e.g. tvOS) is a valid result.

## Report must answer

1. **Code signing for the Windows zip.** Compare SignPath Foundation, Azure Artifact Signing
   (formerly Trusted Signing), OV/EV certificates and Microsoft Store distribution (MSIX) on
   cost, owner effort, SmartScreen and Smart App Control behaviour, CI fit and time to the first
   signed build. Recommend one path and what the owner must do.
2. **Which device is the host in a store world?**
   - Options:
     - an Android TV / Google TV app on a TV box (the DIRECTV Gemini: OS, Play, sideloading,
       chipset/RAM, local HTTPS/WebSocket server, cloudflared, WebRTC);
     - an iPad or Android tablet casting to a TV;
     - a phone;
     - desktop store apps.
   - How would the Node host run inside an app: nodejs-mobile, a Kotlin/Swift port, a WebView
     plus an embedded server, or a cloud relay?
3. **Phone controllers.**
   - Keep the web controller via QR, or build native apps?
   - App Store review risks: 4.2 minimal functionality and web wrappers, local-network
     permission, background audio.
   - Play policy: target API level, data safety form.
   - Android TV requirements: leanback, D-pad, TV app quality.
4. **Accounts and ownership.**
   - Is publishing under the owner's work-linked Play and Apple accounts appropriate, or should
     he use personal ones?
   - The naming/trademark clearance prerequisite (roadmap, ADR-0009).
   - List the questions; don't decide.
5. **Recommended sequence with effort.** What is realistic before Thanksgiving (2026-11-26), by
   the holiday release (2026-12-18), and later?
