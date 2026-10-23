# Connectivity ceilings, YARG-on-the-web, and deployment scenarios

Prepared 2026-10-22 for the M2 decision gate. Browser support changes quickly; items marked
**(verify)** should be re-checked before an ADR relies on them.

## 1. What a browser host can talk to

The game logic never cares about the transport. Every bell timestamps its own gestures on a
clock synced with the host (HGP), and the host judges by those timestamps
([ADR-0002](../decisions/0002-decouple-app-from-hardware.md)). The transport only has to
deliver events reliably within the host's lookbehind window (≈40–200 ms). It does **not** need
to be low-jitter, though lower latency makes hit feedback snappier.

### Browser APIs: ceilings

| API | What it reaches | Browsers | Ceilings / gotchas | Fit for us |
|---|---|---|---|---|
| **WebSocket (wss)** | Any TCP server: our Node host, an ESP32-S3 HTTP server | All | An HTTPS page needs `wss://` with a cert the browser trusts, so **self-signed LAN certs show a warning**. TCP head-of-line blocking on loss. Chrome's Local Network Access permission prompt applies when a *public* site calls a LAN IP **(verify)** | **Alpha default** (S1). Phones and ESP32 bells → host |
| **WebRTC data channel** | Peer-to-peer browser↔browser or browser↔device; unordered/unreliable mode ≈ UDP | All | Needs a signaling step (small cloud endpoint, or the host itself). ESP32-S3 can run WebRTC (Espressif `esp-webrtc-solution`), but it's heavy | Best path to a **GitHub Pages–hosted game with no cert warnings** |
| **WebTransport** (HTTP/3) | QUIC streams and datagrams to a server | Chromium, Firefox; Safari recent **(verify)** | `serverCertificateHashes` lets a page trust a short-lived (≤14-day) self-signed cert by hash, so LAN devices work without a public CA | Promising for a LAN host or relay; not for microcontrollers |
| **Web Bluetooth** (BLE GATT) | BLE peripherals: digital handbells | Chrome/Edge on Windows, macOS, ChromeOS, Android. **Not Safari/iOS, not Firefox** | Per-device chooser prompt. A practical ceiling of **≈7 simultaneous connections** per adapter (stack-dependent). Connection interval ≥7.5 ms. Notifications ≈ 10–30 ms typical | Good for 1–6 bells on a Chromebook or laptop; **not a classroom of 12**, not iPad hosts |
| **Web Serial** | USB-serial devices, e.g. an ESP32-S3 **gateway dongle** | Chrome/Edge desktop + ChromeOS; Android **(verify)** | One chooser prompt, then persistent. This is how browser IDEs and **ESP Web Tools** flash microcontrollers today | **Strong classroom pattern** (below) |
| **WebHID / Gamepad API** | USB HID devices; gamepads | WebHID: Chromium only. **Gamepad API: all browsers, no prompt** | Gamepad API is polled per frame, but `Gamepad.timestamp` helps; buttons/axes only | A gateway that presents as a **USB gamepad** works in every browser *and* in YARG/Unity natively |
| **Web MIDI** | USB/BLE MIDI devices | Chrome, Edge, Firefox. **Not Safari** | Events carry timestamps; a standard instrument protocol | Gateway as a **USB-MIDI instrument** also works with DAWs and notation apps |
| **WebUSB** | Raw USB | Chromium only | Lowest-level; a driverless custom protocol | Possible, but Serial/HID/MIDI cover it |
| **Direct Sockets** (raw TCP/UDP, mDNS) | Anything on the LAN | **Chrome Isolated Web Apps only** (ChromeOS kiosk/managed) **(verify)** | Not available to ordinary web pages | Future school-kiosk option |
| **Zigbee / Z-Wave / Thread** | — | **None** | No browser API. Needs a USB coordinator plus a gateway service. Built for home automation: Z-Wave ≈100 kbps sub-GHz, Zigbee/Thread multi-hop mesh, tens to hundreds of ms of latency, no clock-sync story | **Not recommended.** Wrong tool for real-time instruments |

What a plain web page can **never** do: open raw UDP/TCP sockets, discover devices by
mDNS/broadcast, run in the background reliably, or trust a LAN device's self-signed cert
silently. Everything else above is reachable, with a permission prompt.

### Radio options for future digital handbells (ESP32-S3)

| Radio path | Latency | Bells per host | Network dependency | Host compatibility |
|---|---|---|---|---|
| Wi-Fi → host (WebSocket/WebRTC) | 2–10 ms typical, 100 ms+ power-save spikes (lookbehind absorbs them) | 12+ | Needs a router; **school Wi-Fi often isolates clients** | Every browser; YARG via sidecar |
| BLE → host directly (Web Bluetooth) | 10–30 ms | ≈6–7 | None | Chromium hosts only (no iPad) |
| **ESP-NOW → USB gateway dongle** → Web Serial / HID / MIDI | ≈1–5 ms over the air; USB ≤1 ms | ≈20 encrypted peers, more unencrypted **(verify)** | **None:** no router, no IT department | Serial: Chromium. HID gamepad: every browser + YARG. MIDI: Chromium/Firefox |

Recommendation for E09: bells speak **HGP over Wi-Fi** for home use, plus **ESP-NOW to a USB
gateway** for classrooms. The gateway enumerates as Web Serial, with HID-gamepad/MIDI fallback
modes. The gateway is just another HGP adapter; the game doesn't change.

### Phones (today)

A phone's web page reads `DeviceMotion` at ≈60 Hz (iOS) and up to ≈100–200 Hz via the
Generic Sensor API on Android Chrome. That gives ≈8 ms timing error per device (S1). A
native wrapper (Capacitor) would raise the sample rate on iOS too, and remove the cert warning.

## 2. Could YARG ever run on the web?

| Route | What it means | Blockers | Verdict |
|---|---|---|---|
| **Unity Web export of YARG** | Build YARG itself for WebGL/WebGPU | **BASS** and `yarg_audio`/VLC natives have no web builds, so the audio and video layers must be rewritten (Web Audio). Song scanning assumes a filesystem (OPFS/File System Access instead). Unity web is effectively single-threaded C#, with WASM memory limits and a 100s-of-MB download. Every upstream change re-breaks the port | **Possible, but a multi-month port** with permanent merge cost. Worth it only as an upstream-led effort. Don't plan on it |
| **Our web host + YARG.Core** | Keep our own renderer; use YARG's engine (WASM, S2) for scoring and YARG/Clone Hero chart parsing | Bridge TS↔C# (`[JSExport]`), ≈1.7 MB download, LGPL notes (S2), no team multiplier yet | **Feasible now** (S2 measured it). Gives a "YARG-compatible" web host: same charts, same judging, our visuals |
| **YARG as a desktop host, browser as controllers** | What I1 builds now | Desktop-only host | **The practical "YARG + web" combination** |
| Cloud/pixel streaming of YARG | Run YARG in the cloud, stream video to a browser | 50–150 ms video latency, server cost | Not for a rhythm game |

Bottom line: the web version of the YARG *experience* is our web host, optionally scoring with
YARG.Core and reading YARG/CH charts. YARG itself stays a desktop "deluxe" host.

## 3. Deployment scenarios

### Latency budget (what players feel)

| Segment | Typical | Notes |
|---|---|---|
| Gesture → detection (phone, 60 Hz) | 8–17 ms | Calibrated out (S1) |
| Detection → **bell sound on the phone/bell** | 20–40 ms Android, 10–25 ms iOS | Why S1 plays sound locally |
| Detection → host over Wi-Fi | 2–10 ms, spikes 100+ ms | Doesn't affect scoring (timestamps); only delays the hit flash |
| Host frame → **TV picture** | Game mode 10–30 ms; normal mode 50–150 ms; projector 30–80 ms; Chromecast/casting 100–300+ ms | A/V calibration screen compensates; tell users "Game mode on" |
| Host backing track → speakers | HDMI 20–60 ms; **Bluetooth speaker 150–250 ms** | Calibrate; avoid Bluetooth for backing |

Rule of thumb: judging accuracy is independent of all this. Feel is best when the bell sound
comes from the bell itself and the TV is in game mode.

### Scenarios and minimum requirements

| Scenario | Host | Bells | Network | Packaging | Min requirements | Expected UX |
|---|---|---|---|---|---|---|
| **Family at the TV** (holiday v1) | Laptop/PC via HDMI. Web host (any OS) or YARG (Win/macOS/Linux x64) | 3–5 phones via QR | Home Wi-Fi (not guest) | Web: local `npm start` now, then hosted page + WebRTC. YARG: zip/installer | Any 2018+ laptop with HDMI; phones from the last ~6 years with Chrome/Safari | Excellent once TV game mode and calibration are set; one cert tap per phone (alpha) |
| **Classroom with projector**, 8–12 ringers | Teacher laptop or **Chromebook** (web host only) | Digital handbells (later) or student devices | **Avoid school Wi-Fi:** ESP-NOW gateway dongle via USB | Hosted web app/PWA; gateway flashed from the browser (ESP Web Tools) | Chromebook + projector + gateway dongle; no installs, no IT tickets | Very good with bell speakers. Phones are a poor fit here (policy and isolation) |
| **Handbell choir rehearsal** (real bells) | Laptop + mic | Acoustic bells/chimes | None | Web app (mic permission) | Laptop + decent mic | "Coach" mode now. Mic scoring later: wider timing windows (pitch detection on low bells ≈50–100 ms) |
| **Solo / small-group practice** | Desktop, tablet, or phone | Keyboard, MIDI keyboard, phone | None/home | Web/PWA | Any modern browser | Good; MIDI keyboards make a great practice controller |
| **Demo / kiosk** (museum, fair, church event) | ChromeOS kiosk or Windows PC | Digital bells + gateway | Isolated | Kiosk web app or YARG build | Dedicated device | Excellent; can lock down |
| **Remote ensemble** over the internet | — | — | Internet RTT 50–150 ms | — | — | **Out of scope** for real-time play; possible later as asynchronous layered play |

### Packaging options

| Option | Unlocks | Costs |
|---|---|---|
| **Hosted website / PWA** (GitHub Pages) | Zero install; installable on Android/ChromeOS/Windows/macOS; easy updates | LAN rendezvous needs WebRTC signaling or a local host; Web Bluetooth/Serial are Chromium-only |
| **Desktop wrapper for the web host** (Tauri, Electron, or Avalonia + WebView) | Raw UDP/TCP, mDNS discovery, local trusted HTTPS, serial without prompts; one install | Per-OS builds and signing. Avalonia + WebView fits the existing [Avalonia.Controls.WebView](https://github.com/dcuccia/Avalonia.Controls.WebView) work |
| **Mobile apps** (Capacitor wraps the same web code; cf. stripe-m2-pos uses React Native) | Higher-rate motion sensors, BLE on iOS, no cert warnings, store discoverability | Apple $99/yr, review, Kids-category privacy rules; maintenance |
| **YARG fork release** (zip/installer) | Commercial-grade polish on desktop | Desktop only; non-commercial (BASS); can't ship via YARC's launcher |

Suggested sequence: local web host + phones (alpha), then a hosted PWA with WebRTC (holiday or
just after), then an ESP-NOW gateway + Chromebook classroom kit (with the digital-handbell
ESP32-S3), then optional app-store controller and desktop wrapper if demand appears.

Privacy note for kids and schools: no accounts or PII, ephemeral room codes, nothing stored
server-side, which keeps COPPA/FERPA questions simple.
