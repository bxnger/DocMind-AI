# DOCMIND INDUSTRY: Android app (and iOS later)

The app is the same React frontend inside Capacitor 8.6. Nothing in the website changes: the app-only code runs only
when `Capacitor.isNativePlatform()` is true, and its plugins load only there.

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

## 5. iOS (later)
- Full **Xcode** from the App Store, then `sudo xcode-select -s /Applications/Xcode.app`, and **CocoaPods**.
- `npm i @capacitor/ios@8.6.0 && npx cap add ios && npx cap sync ios && npx cap open ios`.
- An Apple ID for testing on your own iPhone. Paid Apple Developer membership for TestFlight or the App Store.
- In `ios/App/App/Info.plist`: `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
- Add `capacitor://localhost` to the backend's CORS.
