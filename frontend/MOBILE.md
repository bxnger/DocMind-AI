# DOCMIND INDUSTRY: Android and iOS app

The app is the same React frontend inside Capacitor 8.6, with its own phone interface (`src/mobile/`): a welcome,
five tabs (Home, Documents, Scanner, Purchases, Profile) and phone-sized screens. The website keeps its own interface.
The phone interface runs inside the app, or in a browser with `?mobile=1` for checking it (`?mobile=0` turns it off).

| Tab | What it holds |
| --- | --- |
| Home | Analyze a document, scan a part, recent documents with the chat one tap away, the demonstration |
| Documents | Upload PDF/DOCX, the list, each document's workspace: parts, chat, Evidence Jump, claim check, map, facts |
| Scanner | Choose the machine's document, then its photo step |
| Purchases | Price lists and each document's purchase sheet |
| Profile | Who uses the app, organization (optional, kept on the device), mode, language, theme, Compare, Knowledge map, HR, all settings |

| What | How in the app |
| --- | --- |
| PDF/DOCX | The usual file picker (`<input type="file">`), opened by Android's document picker |
| Photo of a part | "Take a photo of the part" opens the system camera (`capture="environment"`); "Upload a photo" opens the gallery |
| Backend | The https origin from `VITE_API_BASE_URL`, built into the code. A production build refuses localhost or plain http |
| XLSX/CSV export | Written to the app's cache and handed to the share sheet: save to Files or Drive, or open in Excel |
| Back button | Closes an open dialog, menu or evidence panel first, then goes back a screen, then leaves the app |
| System bars | The page runs edge to edge; `html.native-app #root` pads it by the status and navigation bar insets |

`appId` is **provisional**: `kz.docmind.industry`. It becomes permanent with the first store release, so confirm it first.
There are no API keys in the app, and there must never be: the backend holds them.

## Backend CORS (for the backend team)
The app's pages come from these origins, which must be in `CORS_ORIGINS`:
- Android: `https://localhost`
- iOS (later): `capacitor://localhost`

## 1. Install the tools (macOS, Apple silicon)
1. Install **Android Studio** from developer.android.com/studio. It brings the JDK 21 that Gradle 8.14 needs.
2. In Android Studio: **More Actions → SDK Manager**, then install **Android SDK Platform 36** and **Android SDK Build-Tools**.
   On **SDK Tools**, also install **Platform-Tools**.
3. Add to `~/.zshrc`, then open a new terminal:
   ```bash
   export ANDROID_HOME="$HOME/Library/Android/sdk"
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   ```
4. Check: `java -version` shows 21, and `adb version` answers.

## 2. Build a debug APK
```bash
export PATH=~/.local/share/docmind-node/bin:$PATH
cd ~/DocMind-AI/frontend
VITE_API_BASE_URL=https://win-347ek05mdnv.tailf14622.ts.net npm run build:mobile
cd android && ./gradlew assembleDebug
```
The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Or open the project with `npm run cap:open:android`
and press **Run**. Rebuild with `build:mobile` after every change to the web code or the backend address.

## 3. Install on a phone
1. On the phone: **Settings → About phone**, tap **Build number** seven times, then turn on **USB debugging**
   under **Developer options**.
2. Connect it by USB and accept the prompt on the phone. `adb devices` must list it.
3. `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`. Or send the APK to the phone and open it,
   allowing installs from that app.

## 4. What to check on the phone
1. The app opens, the home page sits below the status bar, and the bottom bar doesn't cover the chat box.
2. **See the demonstration**: 9 parts appear. Open a quote, and the page opens with the passage highlighted.
3. **Check by photo → Take a photo of the part**: the camera opens. Photograph a marking and decide on the match.
4. **Upload a photo** from the gallery works too.
5. **Offers → Real prices… → Check price on the site**, then **Purchase sheet → Export XLSX**: the share sheet
   opens. Save to Files, then open the file in Excel or Sheets.
6. Upload your own PDF and DOCX from the phone's files.
7. **Back** closes the evidence panel, then the menu, then returns to the previous screen.
8. Languages and the light or dark theme.
9. Watch the session: after closing and reopening the app, documents of the same session should still be listed.

## 5. iOS
The project is in `ios/` (Swift Package Manager, no CocoaPods). `Info.plist` already explains camera and photo use.
1. Install **Xcode** from the App Store and open it once to install its components and an iOS Simulator.
   Then run `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
2. Build and open it:
   ```bash
   VITE_API_BASE_URL=https://win-347ek05mdnv.tailf14622.ts.net npm run build:ios
   npm run cap:open:ios
   ```
3. In Xcode, choose an iPhone simulator and press **Run**.
4. On your own iPhone: connect it, under **Signing & Capabilities** choose your Apple ID as the team, and Run. Then on the
   phone, open **Settings → General → VPN & Device Management** and trust the developer. Use a paid Apple Developer
   account for TestFlight.
5. The backend must allow `capacitor://localhost` in `CORS_ORIGINS`.

## 6. Requests to the backend
**False part numbers from unrelated documents.** A train ticket gave the part "154A" from "154А Терминал". The cause is in
`backend/app/codes.py`, `find_bearings`: after Cyrillic letters become Latin, "154А" reads as 154 with the suffix "A",
and a number with any suffix is accepted without a bearing word nearby. Proposed general guards, not a fix for one ticket:
1. Suffixes that are single letters (A, B, E, J, K, M, Z) and 3-digit numbers need a bearing word in the window, as
   bare numbers already do. Only full designations (6205-2RS, NU 210 ECP, 6305ZZ) count on their own.
2. The text around a hit must not be an address, a seat, a terminal, a route or a time (a context check, not a word list
   for one document): skip hits in lines that have no part noun and that do have a date with a time, "рейс", "вагон",
   "место" or "терминал".
3. Document relevance: add `documentKind` (`technical` | `other`) and `relevance` (`high` | `low`) to the part list, from
   a cheap check (part nouns, specifications, units) or one model question. With `other`, return no parts and a
   `notice`. The frontend will show "this doesn't look like technical documentation" and keep the chat available.
4. A regression test with non-technical documents (a ticket, an invoice, a letter) that must give zero parts.

**Photos and privacy.** The interface now says the photo is sent to the DOCMIND server and an external AI model and that the
server doesn't keep it. Please confirm: does the model provider keep or train on the images, and in which region? The
wording will follow the answer.

**CORS.** `https://localhost` (Android) works. Add `capacitor://localhost` for iOS.
