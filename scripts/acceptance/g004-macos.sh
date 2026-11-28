#!/usr/bin/env bash
# G004 A 类验收：可由代理自动化的部分。
#
# 只读系统状态与隔离目录，不触碰真实的 ~/Library/Application Support/md-editor。
# 用法：G004_ROOT=<隔离根> bash scripts/acceptance/g004-macos.sh
set -uo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${G004_ROOT:?set G004_ROOT to the isolated rehearsal root}"
APP="$repository_root/target/gpui-preview/Inkpoint GPUI Preview.app"
DATA="$ROOT/data"
LOGS="$ROOT/logs"
DOCS="$ROOT/docs"
INGRESS="$LOGS/ingress.log"
REAL="$HOME/Library/Application Support/md-editor"

pass=0
fail=0
note() { printf '%s\n' "$*"; }
ok()   { note "PASS  $*"; pass=$((pass + 1)); }
bad()  { note "FAIL  $*"; fail=$((fail + 1)); }

launch() {
  # `open -a` is required: executing the binary directly does not register with
  # LaunchServices, so a later Finder open has nothing to deliver to.
  open -a "$APP" --env "INKPOINT_DATA_ROOT=$DATA" --env "INKPOINT_OPEN_INGRESS_LOG=$INGRESS" "$@"
}

# The app appends to the ingress log asynchronously, so deleting the file
# between steps races with a write still in flight: the next step then reads a
# stale line and reports a phantom failure. Instead, remember how many lines
# existed before the step and only ever look at lines appended after that.
INGRESS_OFFSET=0

# Number of non-empty lines in a file, or 0 when it does not exist.
#
# `grep -c` prints 0 *and* exits 1 on an empty file, so `grep -c . || echo 0`
# yields two lines and every later `$((...))` fails with a syntax error. Count
# with a command that cannot fail instead.
line_count() {
  [ -f "$1" ] || { printf '0\n'; return 0; }
  awk 'NF { n++ } END { printf "%d\n", n + 0 }' "$1"
}

mark_ingress() {
  INGRESS_OFFSET="$(line_count "$INGRESS")"
}

# Lines appended since the last mark.
new_ingress() {
  [ -f "$INGRESS" ] || return 0
  tail -n "+$((INGRESS_OFFSET + 1))" "$INGRESS" 2>/dev/null
}

# Waits until at least `want` lines have been appended since the mark.
wait_for_ingress() {
  local want="$1" tries=0
  while [ "$tries" -lt 60 ]; do
    if [ "$(new_ingress | awk 'NF { n++ } END { printf "%d\n", n + 0 }')" -ge "$want" ]; then
      return 0
    fi
    sleep 0.5
    tries=$((tries + 1))
  done
  return 1
}

real_before="$(stat -f %m "$REAL" 2>/dev/null || echo missing)"

# --- A1: bundle identity -----------------------------------------------------
plist="$APP/Contents/Info.plist"
bin="$APP/Contents/MacOS/inkpoint-gpui"
[ -f "$bin" ] && ok "A1 binary present" || bad "A1 binary missing"
id="$(plutil -extract CFBundleIdentifier raw "$plist" 2>/dev/null)"
[ "$id" = "com.inkpoint.gpui-preview" ] && ok "A1 bundle id $id" || bad "A1 bundle id '$id'"
arch="$(file -b "$bin" | grep -o 'arm64' | head -1)"
[ "$arch" = "arm64" ] && ok "A1 binary is arm64" || bad "A1 binary arch '$arch'"

# --- A2: cold start delivers a file -----------------------------------------
mark_ingress
launch "$DOCS/plain.md" >/dev/null 2>&1
if wait_for_ingress 1; then
  ok "A2 cold start recorded ingress"
  new_ingress | sed -n '1,3p' | sed 's/^/      /'
else
  bad "A2 no ingress recorded on cold start"
fi

# --- A3: second delivery while running --------------------------------------
mark_ingress
launch "$DOCS/plain.md" >/dev/null 2>&1
if wait_for_ingress 1; then
  ok "A3 delivery while running recorded"
else
  bad "A3 no ingress while running"
fi

# --- A4: one delivery carrying two files ------------------------------------
mark_ingress
launch "$DOCS/plain.md" "$DOCS/含 空格#井号 中文.md" >/dev/null 2>&1
if wait_for_ingress 1; then
  first="$(new_ingress | head -1)"
  case "$first" in
    *'"urlCount":2'*) ok "A4 single delivery carried two urls" ;;
    *) bad "A4 expected \"urlCount\":2, got: $first" ;;
  esac
  new_ingress | sed -n '1,6p' | sed 's/^/      /'
else
  bad "A4 no ingress for multi-file delivery"
fi

# --- A5: awkward path ------------------------------------------------------
mark_ingress
launch "$DOCS/含 空格#井号 中文.md" >/dev/null 2>&1
if wait_for_ingress 1; then
  if new_ingress | grep -q '中文'; then
    ok "A5 path with space, # and CJK delivered intact"
  else
    bad "A5 path mangled in ingress: $(new_ingress | head -1)"
  fi
else
  bad "A5 no ingress for CJK path"
fi

# --- A6: unreadable file ---------------------------------------------------
unreadable="$ROOT/docs/unreadable.md"
printf '# secret\n' > "$unreadable"
chmod 000 "$unreadable"
mark_ingress
launch "$unreadable" >/dev/null 2>&1
sleep 2
if [ -n "$(new_ingress)" ]; then
  ok "A6 unreadable file still produced an ingress record (app decides the message)"
else
  bad "A6 no ingress for unreadable file"
fi
chmod 644 "$unreadable"

# --- A7: the running process actually received the isolated root -----------
# Opening a file read-only writes no state, so an empty root is the correct
# outcome here. What must hold is that the process was launched with the
# override, which is what makes every later write land in the throwaway root.
pid="$(pgrep -f "Inkpoint GPUI Preview" | head -1)"
if [ -n "$pid" ] && ps eww -p "$pid" 2>/dev/null | tr ' ' '\n' | grep -qx "INKPOINT_DATA_ROOT=$DATA"; then
  ok "A7 process $pid launched with INKPOINT_DATA_ROOT=$DATA"
elif [ -z "$pid" ]; then
  bad "A7 no running app process to inspect"
else
  bad "A7 process $pid does not carry INKPOINT_DATA_ROOT=$DATA"
fi

# --- A8: the real data directory was not touched ---------------------------
real_after="$(stat -f %m "$REAL" 2>/dev/null || echo missing)"
if [ "$real_before" = "$real_after" ]; then
  ok "A8 real data dir untouched (mtime $real_after)"
else
  bad "A8 real data dir changed: $real_before -> $real_after"
fi

note ""
note "----"
note "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
