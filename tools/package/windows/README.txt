Go Go HarmoniYo {{VERSION}} for Windows (build {{COMMIT}})
================================================================

A party rhythm game: this PC shows the game on the TV, and everyone rings
bells with their phones. Nothing to install: no Node.js, no npm, no admin.

You need
--------
- Windows 10 or 11, 64-bit, connected to the TV (HDMI) or just its own screen.
- An internet connection on this PC (best), or the phones on the same Wi-Fi.
- Phones with a web browser (iPhone/iPad Safari or Android Chrome), 1 to 4
  ringers.

Start
-----
1. Right-click the zip file > "Extract All..." (don't run it from inside the zip).
2. Open the extracted GoGoHarmoniYo folder and double-click
   "Play Go Go HarmoniYo.cmd".
3. The game opens in the browser. Drag that window to the TV and press F11.
4. Phones scan the QR code on the TV (or type the address it shows).
5. To stop: close the black window, or press Ctrl+C in it.

How the phones connect
----------------------
A plain double-click picks the best way by itself:
- With internet, the QR code is a secure https://....trycloudflare.com
  address, made by the included cloudflared.exe through Cloudflare. Phones
  get no certificate warning and can join from any network (home Wi-Fi,
  guest Wi-Fi, mobile data). Phones on the same Wi-Fi as this PC then switch
  to a direct link within a few seconds (the TV shows "direct"); the others
  stay "via tunnel", which plays just as well. While phones use the tunnel,
  the game's traffic passes through Cloudflare's servers.
  The address is new each time, so always scan the QR on the TV.
- Without internet, or if the tunnel isn't ready within 60 seconds, the QR
  shows this PC's Wi-Fi address instead (https://192.168...). Phones must
  then be on the same Wi-Fi, and each phone shows a certificate warning
  the first time (the PC makes its own certificate): Safari: "Show Details"
  > "visit this website". Chrome: "Advanced" > "Proceed". If the tunnel
  comes up later, the QR switches to it.

What Windows asks the first time
--------------------------------
- "Windows protected your PC" (SmartScreen): the program isn't code-signed
  yet. Click "More info", check the app is go-go-harmoniyo.exe or
  "Play Go Go HarmoniYo.cmd" (publisher: Unknown), then "Run anyway".
  If Windows says Smart App Control blocked it, it can't be allowed
  case by case: ask for a signed build, or use the developer setup at
  https://github.com/dcuccia/go-go-harmoniyo instead.
- "Windows Security Alert" / "Windows Defender Firewall has blocked some
  features of this app": it names "Node.js JavaScript Runtime" (the engine
  inside go-go-harmoniyo.exe; the path shown ends in this folder's
  go-go-harmoniyo.exe). Tick "Private networks" (home Wi-Fi) and click
  "Allow access". This lets phones on the Wi-Fi reach this PC directly.
  Windows asks for an administrator password here. Without one, click
  Cancel: phones still join through the tunnel (they just stay "via
  tunnel"), but the Wi-Fi address won't work.

Phones can't connect?
---------------------
- Check this PC is online, then scan the QR on the TV again (the address
  changes each time the game starts).
- Phones stay "via tunnel" on home Wi-Fi: check they are on the same Wi-Fi
  as this PC (not mobile data) and that the firewall allows the program on
  Private networks. It still plays fine.
- No internet, or you'd rather keep everything on your own network: open a
  Command Prompt in this folder and run
      "Play Go Go HarmoniYo.cmd" --lan-only
  The QR is then always the Wi-Fi address (phones on the same Wi-Fi, one
  certificate warning each). Guest Wi-Fi usually keeps phones apart from
  the PC: use your home Wi-Fi.
- To use only the tunnel (and stop with an error if it can't start):
      "Play Go Go HarmoniYo.cmd" --tunnel
- If the internet drops mid-game, everyone rescans the QR on the TV. If it
  stays down, restart with --lan-only.
Other options:  "Play Go Go HarmoniYo.cmd" --help
Check the setup without starting:  "Play Go Go HarmoniYo.cmd" --check

Files
-----
- This folder: the program and the game. It doesn't change them.
- %LOCALAPPDATA%\GoGoHarmoniYo: the PC's certificate (kept so phones only
  warn once) and session logs.
To remove Go Go HarmoniYo, delete this folder and that one. Nothing else is
installed. If you allowed it in the firewall, you can remove that rule in
Windows Security > Firewall & network protection > Allow an app.

Privacy
-------
Go Go HarmoniYo has no accounts, analytics, ads or telemetry, and it doesn't
upload logs.
- Local web server: the program runs a web server on this PC so that phones
  can join. Phones on the same network can connect to this PC directly.
- Cloudflare tunnel (on by default): the program also starts a Cloudflare
  quick tunnel (trycloudflare.com) with the included cloudflared.exe, so that
  phones on any network can join without a certificate warning. Game traffic
  between the phones and this PC then passes through Cloudflare, under
  Cloudflare's privacy policy (https://www.cloudflare.com/privacypolicy/).
  While the tunnel starts, the program asks public DNS resolvers (1.1.1.1,
  8.8.8.8, 9.9.9.9, 208.67.222.222) whether the tunnel's address is ready.
- To keep everything on your own network, start with --lan-only (see
  "Phones can't connect?" above).
- The certificate and session logs stay on this PC, in
  %LOCALAPPDATA%\GoGoHarmoniYo (see "Files" above).
Full policy: https://github.com/dcuccia/go-go-harmoniyo#privacy

Licenses
--------
Go Go HarmoniYo's code: MIT (LICENSE.txt). Art, songs and charts: see
ATTRIBUTION.md. Included third-party software (Node.js, cloudflared, npm
packages) with full license texts: THIRD_PARTY_NOTICES.md. License texts used
by Go Go HarmoniYo's own files: LICENSES\.

Source code, help and bug reports: https://github.com/dcuccia/go-go-harmoniyo