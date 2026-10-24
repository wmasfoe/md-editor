/*
 * LD_PRELOAD hook for the linuxdeploy process tree.
 *
 * Tauri 2.11.4 cannot pass --exclude-library. The GTK plugin re-executes the
 * extracted `linuxdeploy` binary (basename exactly "linuxdeploy") to copy GTK
 * libraries, and that second pass is what bundles libwayland-client.so.0.
 * Inject the exclude flag only for that binary. AppImage runtimes and
 * linuxdeploy-plugin-* tools are left untouched.
 *
 * The outer AppImage invocation is handled by linuxdeploy-wrapper.c, which
 * also installs this hook into the child environment.
 */
#define _GNU_SOURCE

#include <dlfcn.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static const char exclude_library[] = "libwayland-client.so.0";

static int is_linuxdeploy_tool(const char *path) {
  const char *base = strrchr(path, '/');
  base = base ? base + 1 : path;
  return strcmp(base, "linuxdeploy") == 0;
}

static int argv_has_exclude(char *const argv[]) {
  if (!argv) return 0;
  for (int i = 0; argv[i]; i++) {
    if (strcmp(argv[i], "--exclude-library") == 0 && argv[i + 1] &&
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

static char **append_exclude(char *const argv[]) {
  int count = 0;
  while (argv[count]) count++;
  char **rewritten = calloc((size_t)count + 3, sizeof(char *));
  if (!rewritten) return NULL;
  for (int i = 0; i < count; i++) rewritten[i] = argv[i];
  rewritten[count] = "--exclude-library";
  rewritten[count + 1] = (char *)exclude_library;
  rewritten[count + 2] = NULL;
  fprintf(stderr, "inkpoint-linuxdeploy-hook: excluding %s\n", exclude_library);
  return rewritten;
}

static char **maybe_rewrite(const char *path, char *const argv[]) {
  if (!path || !argv || !is_linuxdeploy_tool(path) || argv_has_exclude(argv)) return NULL;
  return append_exclude(argv);
}

static void *real_symbol(const char *name) {
  void *symbol = dlsym(RTLD_NEXT, name);
  if (!symbol) {
    fprintf(stderr, "inkpoint-linuxdeploy-hook: dlsym(%s) failed: %s\n", name, dlerror());
    _exit(127);
  }
  return symbol;
}

int execve(const char *pathname, char *const argv[], char *const envp[]) {
  static int (*real_execve)(const char *, char *const[], char *const[]) = NULL;
  if (!real_execve) real_execve = real_symbol("execve");
  char **rewritten = maybe_rewrite(pathname, argv);
  if (!rewritten) return real_execve(pathname, argv, envp);
  int rc = real_execve(pathname, rewritten, envp);
  free(rewritten);
  return rc;
}

int execv(const char *path, char *const argv[]) {
  static int (*real_execv)(const char *, char *const[]) = NULL;
  if (!real_execv) real_execv = real_symbol("execv");
  char **rewritten = maybe_rewrite(path, argv);
  if (!rewritten) return real_execv(path, argv);
  int rc = real_execv(path, rewritten);
  free(rewritten);
  return rc;
}

int execvp(const char *file, char *const argv[]) {
  static int (*real_execvp)(const char *, char *const[]) = NULL;
  if (!real_execvp) real_execvp = real_symbol("execvp");
  char **rewritten = maybe_rewrite(file, argv);
  if (!rewritten) return real_execvp(file, argv);
  int rc = real_execvp(file, rewritten);
  free(rewritten);
  return rc;
}

int execvpe(const char *file, char *const argv[], char *const envp[]) {
  static int (*real_execvpe)(const char *, char *const[], char *const[]) = NULL;
  if (!real_execvpe) real_execvpe = real_symbol("execvpe");
  char **rewritten = maybe_rewrite(file, argv);
  if (!rewritten) return real_execvpe(file, argv, envp);
  int rc = real_execvpe(file, rewritten, envp);
  free(rewritten);
  return rc;
}

int posix_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *file_actions,
                const posix_spawnattr_t *attrp, char *const argv[], char *const envp[]) {
  static int (*real_posix_spawn)(pid_t *, const char *, const posix_spawn_file_actions_t *,
                                 const posix_spawnattr_t *, char *const[], char *const[]) = NULL;
  if (!real_posix_spawn) real_posix_spawn = real_symbol("posix_spawn");
  char **rewritten = maybe_rewrite(path, argv);
  if (!rewritten) return real_posix_spawn(pid, path, file_actions, attrp, argv, envp);
  int rc = real_posix_spawn(pid, path, file_actions, attrp, rewritten, envp);
  free(rewritten);
  return rc;
}

int posix_spawnp(pid_t *pid, const char *file, const posix_spawn_file_actions_t *file_actions,
                 const posix_spawnattr_t *attrp, char *const argv[], char *const envp[]) {
  static int (*real_posix_spawnp)(pid_t *, const char *, const posix_spawn_file_actions_t *,
                                  const posix_spawnattr_t *, char *const[], char *const[]) = NULL;
  if (!real_posix_spawnp) real_posix_spawnp = real_symbol("posix_spawnp");
  char **rewritten = maybe_rewrite(file, argv);
  if (!rewritten) return real_posix_spawnp(pid, file, file_actions, attrp, argv, envp);
  int rc = real_posix_spawnp(pid, file, file_actions, attrp, rewritten, envp);
  free(rewritten);
  return rc;
}
