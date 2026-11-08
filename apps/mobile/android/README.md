# Inkpoint Android

The Android app: Kotlin, [Jetpack Compose](https://developer.android.com/compose) and Material 3, around the web page in [`core`](../core/README.md).

Mobile is no longer released. The last published APK is 0.2.1 and is on the [download page](https://editor.jiaqi.im/#download). Build newer versions yourself with the steps below.

## What it does

- **Loads the page from the app.** `WebViewAssetLoader` serves the bundled `assets/editor/` files from a virtual HTTPS origin, so the page does not use `file://` and has no network access of its own.
- **Opens and saves files with the Storage Access Framework.** It opens a document with `OpenDocument`, keeps access across restarts with `takePersistableUriPermission`, and writes back through `openOutputStream`. No broad storage permission is needed.
- **Keyboard toolbar.** `KeyboardAccessoryBar` sits above the soft keyboard (it follows the IME insets) with bold, italic, strikethrough, code, lists, headings and undo.
- **Haptics.** The page can ask for haptic feedback through the bridge, and `MainActivity` plays it with the system vibrator.

## Layout

```
apps/mobile/android/
├── app/
│   ├── build.gradle.kts
│   └── src/
│       ├── main/
│       │   ├── assets/editor/            # the web bundle, copied in by pnpm build:mobile
│       │   └── java/com/inkpoint/editor/
│       │       ├── MainActivity.kt
│       │       ├── bridge/               # BridgeContracts.kt, AndroidBridgeInterface.kt
│       │       ├── model/DocumentViewModel.kt
│       │       └── ui/                   # DocumentScreen, EditorWebView, KeyboardAccessoryBar, OutlineDrawer
│       └── test/                         # BridgeContractTest.kt
├── build.gradle.kts
└── gradlew
```

## Build and run

You need JDK 17 and the Android SDK (API 34). The app supports Android 8.0 (API 26) and later. Set `ANDROID_HOME`, or put `sdk.dir=<path>` in `apps/mobile/android/local.properties`.

```bash
pnpm dev:android          # run on an emulator or a connected device
pnpm build:android        # dist-mobile/Inkpoint_<version>.apk
```

To use Gradle directly, run `pnpm build:mobile` once, then in this folder:

```bash
./gradlew installDebug          # install on a device
./gradlew assembleDebug         # app/build/outputs/apk/debug/
./gradlew testDebugUnitTest     # unit tests
```

The project defines no release signing config, so `assembleRelease` produces an unsigned APK.
