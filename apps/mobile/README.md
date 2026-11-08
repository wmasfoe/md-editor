# Inkpoint Mobile

The Android and iOS apps. Each is a native shell around a web page (`core`) that renders and edits the document. Mobile is **no longer released**. The last published builds are 0.2.1 (an Android APK and an unsigned iOS IPA) and stay on the [download page](https://editor.jiaqi.im/#download). For anything newer, build it yourself (see [Build a package](#build-a-package)).

## Layout

```
apps/mobile/
├── core/      # @md-editor/mobile-core: the web page that runs inside the WebView
├── android/   # Kotlin, Jetpack Compose, Storage Access Framework
└── ios/       # Swift 6, SwiftUI, Share Extension
```

- **`core`** reuses `@md-editor/renderer-codemirror` and `@md-editor/syntax-plugins` from the desktop app, so documents render the same way. It talks to the native side through a message bridge (see [`core`](./core/README.md)).
- **`android`** adds a keyboard toolbar above the soft keyboard, haptics, and file access through the Storage Access Framework (see [`android`](./android/README.md)).
- **`ios`** adds a keyboard toolbar, haptics and a Share Extension, and loads the page through a custom URL scheme (see [`ios`](./ios/README.md)).

The native apps load the web page from files bundled in the app. They do not need a network.

## Sync the web bundle

After you change `core`, copy the build into both native projects:

```bash
pnpm build:mobile
```

This builds `core` and runs `scripts/mobile/sync-mobile-web.mjs`, which copies the output to:

- `apps/mobile/android/app/src/main/assets/editor/`
- `apps/mobile/ios/Inkpoint/Resources/editor/`

Both folders are git-ignored build output.

## Run on a device

```bash
pnpm --filter @md-editor/mobile-core dev   # the web page in a browser
pnpm dev:android                           # Android emulator or device
pnpm dev:ios                               # iOS simulator (macOS only)
```

## Build a package

```bash
pnpm build:android   # dist-mobile/Inkpoint_<version>.apk (debug-signed; needs JDK 17 and the Android SDK)
pnpm build:ios       # dist-mobile/Inkpoint-<version>-unsigned.ipa (needs macOS and Xcode)
```

The version is read from `versionName` in `android/app/build.gradle.kts` and `MARKETING_VERSION` in the Xcode project. Pass `--version <x.y.z>` to override it. Both scripts run `pnpm build:mobile` first; add `--no-sync` to skip that.

The IPA is unsigned, so it cannot be installed as is. Re-sign it with a tool such as Sideloadly or AltStore using your own Apple ID. A free Apple ID signature lasts 7 days.
