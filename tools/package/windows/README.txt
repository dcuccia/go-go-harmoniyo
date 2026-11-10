Go Go HarmoniYo {{VERSION}} for Windows (build {{COMMIT}})
================================================================

A party rhythm game: this PC shows the game on the TV, and everyone rings
bells with their phones. Nothing to install: no Node.js, no npm, no admin.

You need
--------
- Windows 10 or 11, 64-bit, connected to the TV (HDMI) or just its own screen.
- Phones with a web browser (iPhone Safari or Android Chrome), on the same
  Wi-Fi as this PC. Guest Wi-Fi or mobile data: see "Phones can't connect".

Start
-----
1. Right-click the zip file > "Extract All..." (don't run it from inside the zip).
2. Open the extracted GoGoHarmoniYo folder and double-click
   "Play Go Go HarmoniYo.cmd".
3. The game opens in the browser. Drag that window to the TV and press F11.
4. Phones scan the QR code on the TV (or type the address it shows).
5. To stop: close the black window, or press Ctrl+C in it.

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
  "Allow access". This lets phones reach this PC.
  Windows asks for an administrator password here; on an account without one,
  click Cancel and use the tunnel (below).
- On each phone, the first visit shows a certificate warning (the PC makes its
  own certificate). Safari: "Show Details" > "visit this website". Chrome:
  "Advanced" > "Proceed". The tunnel address doesn't need this.

Phones can't connect?
---------------------
Start with the tunnel instead: open a Command Prompt in this folder and run
    "Play Go Go HarmoniYo.cmd" --tunnel
It uses the included cloudflared.exe to make a public https address through
Cloudflare, so it works on guest Wi-Fi and mobile data. The game's traffic
then passes through Cloudflare's servers.
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

Licenses
--------
Go Go HarmoniYo's code: MIT (LICENSE.txt). Art, songs and charts: see
ATTRIBUTION.md. Included third-party software (Node.js, cloudflared, npm
packages) with full license texts: THIRD_PARTY_NOTICES.md. License texts used
by Go Go HarmoniYo's own files: LICENSES\.

Source code, help and bug reports: https://github.com/dcuccia/go-go-harmoniyo
