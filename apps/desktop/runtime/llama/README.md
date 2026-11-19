This directory vendors the bundled local inference runtime for the desktop app.

Current payload:
- `llama-server-aarch64-apple-darwin`
- `llama-runtime-macos-arm64/*.dylib`
- `LICENSE.llama.cpp`

The Tauri bundle config copies the macOS arm64 runtime into app resources and
loads it as a bundled sidecar from the app's resource directory.

To refresh this payload, update it from the matching llama.cpp release artifact
and keep the executable plus its sibling dylibs together.
