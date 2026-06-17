fn main() {
    // Keep the binary entrypoint tiny; all Tauri commands and app wiring live in
    // the library crate so the native boundary is easy to scan.
    md_editor_lib::run()
}
