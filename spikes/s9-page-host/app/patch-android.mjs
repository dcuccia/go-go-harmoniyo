// Turns the stock `cap add android` project into an Android TV + tablet app. Idempotent, so
// re-running after `cap sync` is safe. Run after `npx cap add android` (npm run add:android).
//  - LEANBACK_LAUNCHER, so it shows on the Android TV home screen (Gemini), plus android:banner
//  - touchscreen and leanback both optional, so one APK installs on TVs, tablets and phones
//  - keep the screen on and allow audio without a tap (the TV starts songs from the remote)
//  - brand icons, banner and splash (make-art.mjs) instead of Capacitor's placeholders
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const main = join(here, 'android', 'app', 'src', 'main');
if (!existsSync(main)) throw new Error('no android project: run "npx cap add android" first');
const STAGE = '#0b0d17';

function edit(file, fn) {
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(file, after);
}

const manifest = join(main, 'AndroidManifest.xml');
edit(manifest, (s) => {
  if (!s.includes('android.software.leanback')) {
    s = s.replace(
      '<application',
      '<uses-feature android:name="android.software.leanback" android:required="false" />\n' +
        '    <uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n\n    <application',
    );
  }
  if (!s.includes('android:banner=')) s = s.replace('<application', '<application\n        android:banner="@drawable/banner"');
  if (!s.includes('LEANBACK_LAUNCHER')) {
    s = s.replace(
      '<category android:name="android.intent.category.LAUNCHER" />',
      '<category android:name="android.intent.category.LAUNCHER" />\n                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />',
    );
  }
  return s;
});

const pkgDir = join(main, 'java', 'io', 'github', 'dcuccia', 'gogoharmoniyo');
writeFileSync(
  join(pkgDir, 'MainActivity.java'),
  `package io.github.dcuccia.gogoharmoniyo;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // A song plays for minutes with no remote input: don't let the TV or tablet sleep.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        // Songs start from the D-pad or a phone, not a touch on the WebView.
        bridge.getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }
}
`,
);

edit(join(main, 'res', 'values', 'ic_launcher_background.xml'), (s) => s.replace(/#[0-9A-Fa-f]{6}/, STAGE.toUpperCase()));

// Splash: a layer-list (stage colour + centred lockup) instead of stretched per-density PNGs.
const res = join(main, 'res');
for (const d of readdirSync(res)) rmSync(join(res, d, 'splash.png'), { force: true });
writeFileSync(
  join(res, 'drawable', 'splash.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><color android:color="${STAGE}" /></item>
    <item><bitmap android:gravity="center" android:src="@drawable/splash_mark" /></item>
</layer-list>
`,
);
execFileSync(process.execPath, [join(here, 'make-art.mjs'), ...process.argv.slice(2)], { stdio: 'inherit' });
console.log('S9 android patch: leanback launcher, banner, optional touchscreen, keep-screen-on, autoplay, brand art');
