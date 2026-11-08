# Inkpoint iOS

The iOS app: Swift 6, SwiftUI and WKWebView, around the web page in [`core`](../core/README.md).

Mobile is no longer released. The last published IPA is 0.2.1, unsigned (not on the App Store), and is on the [download page](https://editor.jiaqi.im/#download). It has to be re-signed before it installs. Build newer versions yourself with the steps below.

## What it does

- **Loads the page from the app.** A `WKURLSchemeHandler` serves the bundled `editor/` files from a custom `inkpoint://` scheme, because ES modules do not load from `file://`.
- **Talks to the page through a bridge.** `InkpointBridgeController` receives messages from the page with `WKScriptMessageHandler` and sends actions back. The message types are checked by `InkpointContractTests`.
- **Opens documents in place.** `LSSupportsOpeningDocumentsInPlace` and `UIFileSharingEnabled` are set, and `UIDocumentPickerViewController` opens a file from iCloud Drive or local storage without copying it.
- **Share Extension.** Choosing "Open with Inkpoint" on a Markdown file in Files, Safari or another app imports it.
- **Keyboard toolbar and haptics.** `KeyboardAccessoryBar` sits above the keyboard, and the page's haptic requests are played with `UIImpactFeedbackGenerator` and `UISelectionFeedbackGenerator`.

## Layout

```
apps/mobile/ios/
├── Inkpoint/              # the app target: App, Info.plist, assets, Resources/editor (copied in by pnpm build:mobile)
├── Sources/InkpointCore/  # Bridge, Views (document, outline, keyboard bar, scheme handler), Models, Diagnostics
├── ShareExtension/        # the Share Extension
├── Tests/                 # InkpointContractTests
├── Inkpoint.xcodeproj
└── Package.swift
```

## Build and run

You need macOS and Xcode with Swift 6. The app needs iOS 17.0 or later.

```bash
pnpm dev:ios         # run in the simulator
pnpm build:ios       # dist-mobile/Inkpoint-<version>-unsigned.ipa
```

You can also open `Inkpoint.xcodeproj` in Xcode and run it on a simulator or a device.

To run the bridge contract tests:

```bash
cd apps/mobile/ios
swift run InkpointContractTests
```

`pnpm build:ios` builds a Release device build with code signing turned off and packages the `.app` as an IPA. The IPA carries no certificate or provisioning profile. Re-sign it with a tool such as Sideloadly or AltStore using your own Apple ID. A free Apple ID signature lasts 7 days.
