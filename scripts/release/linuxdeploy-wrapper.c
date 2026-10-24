/*
 * ELF stand-in for Tauri's cached linuxdeploy AppImage.
 *
 * tauri-bundler 2.9.4 (shipped by @tauri-apps/cli 2.11.4) executes
 * ~/.cache/tauri/linuxdeploy-<arch>.AppImage and then runs `dd` to zero ELF
 * bytes 8-10 so desktop integration does not treat the tool as an AppImage.
 * A shell script would be corrupted by that write; this ELF survives it.
 * The marker below must stay out of the first 16 bytes (it lives in .rodata).
 *
 * The real AppImage is the sibling file with a `.real` suffix. Arguments are
 * forwarded unchanged, including `--appimage-extract-and-run`, and
 * `--exclude-library libwayland-client.so.0` is appended for the outer deploy.
 * LD_PRELOAD is set so the GTK plugin's later re-exec of `linuxdeploy` gets
 * the same flag even if the plugin script was not patched.
 */
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Referenced so the linker keeps the marker for cache detection. */
__attribute__((used)) static const char inkpoint_marker[] = "INKPOINT_LINUXDEPLOY_WRAPPER";

static const char exclude_flag[] = "--exclude-library";
static const char exclude_library[] = "libwayland-client.so.0";
static const char hook_name[] = "inkpoint-linuxdeploy-hook.so";

static int argv_has_exclude(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], exclude_flag) == 0 && i + 1 < argc &&
        strcmp(argv[i + 1], exclude_library) == 0) {
      return 1;
    }
    if (strncmp(argv[i], "--exclude-library=", 18) == 0 &&
        strcmp(argv[i] + 18, exclude_library) == 0) {
      return 1;
    }
  }
  return 0;
}

static void prepend_preload(const char *hook_path) {
  const char *existing = getenv("LD_PRELOAD");
  if (existing && strstr(existing, hook_path)) return;
  if (!existing || !existing[0]) {
    setenv("LD_PRELOAD", hook_path, 1);
    return;
  }
  size_t length = strlen(hook_path) + 1 + strlen(existing) + 1;
  char *combined = malloc(length);
  if (!combined) return;
  snprintf(combined, length, "%s:%s", hook_path, existing);
  setenv("LD_PRELOAD", combined, 1);
  free(combined);
}

int main(int argc, char **argv) {
  (void)inkpoint_marker;
  char self[PATH_MAX];
  ssize_t self_length = readlink("/proc/self/exe", self, sizeof(self) - 1);
  if (self_length < 0) {
    perror("inkpoint-linuxdeploy-wrapper: readlink");
    return 127;
  }
  self[self_length] = '\0';

  char real_path[PATH_MAX];
  if (snprintf(real_path, sizeof(real_path), "%s.real", self) >= (int)sizeof(real_path)) {
    fprintf(stderr, "inkpoint-linuxdeploy-wrapper: path too long\n");
    return 127;
  }

  char hook_path[PATH_MAX];
  char *slash = strrchr(self, '/');
  if (!slash) {
    fprintf(stderr, "inkpoint-linuxdeploy-wrapper: cannot locate hook directory\n");
    return 127;
  }
  size_t dir_length = (size_t)(slash - self);
  if (snprintf(hook_path, sizeof(hook_path), "%.*s/%s", (int)dir_length, self, hook_name) >=
      (int)sizeof(hook_path)) {
    fprintf(stderr, "inkpoint-linuxdeploy-wrapper: hook path too long\n");
    return 127;
  }
  if (access(hook_path, R_OK) == 0) {
    prepend_preload(hook_path);
  } else {
    fprintf(stderr, "inkpoint-linuxdeploy-wrapper: hook missing at %s\n", hook_path);
  }

  setenv("LINUXDEPLOY_EXCLUDED_LIBRARIES", exclude_library, 1);

  int extra = argv_has_exclude(argc, argv) ? 0 : 2;
  char **next_argv = calloc((size_t)argc + (size_t)extra + 1, sizeof(char *));
  if (!next_argv) return 127;
  next_argv[0] = real_path;
  for (int i = 1; i < argc; i++) next_argv[i] = argv[i];
  if (extra) {
    next_argv[argc] = (char *)exclude_flag;
    next_argv[argc + 1] = (char *)exclude_library;
    fprintf(stderr, "inkpoint-linuxdeploy-wrapper: appending --exclude-library %s\n",
            exclude_library);
  }

  execv(real_path, next_argv);
  perror("inkpoint-linuxdeploy-wrapper: execv");
  return 127;
}
