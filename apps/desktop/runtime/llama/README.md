# Bundled llama.cpp runtime

This directory contains the llama.cpp runtime used by the native desktop app's local inference feature.

The macOS Apple Silicon payload includes:

- `llama-server-aarch64-apple-darwin`
- `llama-runtime-macos-arm64/*.dylib`
- `llama-runtime-macos-arm64/LICENSE.llama.cpp`

The app's macOS packaging script copies the server and its runtime libraries into the app bundle. Keep the executable, required libraries, and license together when updating the vendored payload.
