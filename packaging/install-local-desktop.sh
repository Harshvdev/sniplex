#!/usr/bin/env sh
# Installs the Sniplex desktop entry and D-Bus activation file for a locally
# built binary.
#
# The compositor authorizes direct screen capture by looking up the .desktop
# file whose Exec= resolves to the calling executable, so the entry must point at
# the exact binary path that is launched.
#
# The entry also declares one action per capture mode. Those actions carry the
# shortcut defaults, which is how a KDE-derived desktop learns them: the
# compositor owns the keys and starts this programme when one is pressed.
set -eu

binary="${1:-$HOME/.local/bin/sniplex}"
data_dir="${XDG_DATA_HOME:-$HOME/.local/share}"
target_dir="$data_dir/applications"
service_dir="$data_dir/dbus-1/services"
shortcut_dir="$data_dir/kglobalaccel"
source_dir="$(dirname "$0")"

if [ ! -x "$binary" ]; then
    echo "error: $binary is missing or not executable" >&2
    exit 1
fi

resolved="$(readlink -f "$binary")"
mkdir -p "$target_dir" "$service_dir" "$shortcut_dir"

# Only the command itself is replaced, so each action keeps its arguments.
sed "s|^Exec=[^ ]*|Exec=$resolved|" "$source_dir/sniplex.desktop" >"$target_dir/sniplex.desktop"
sed "s|^Exec=[^ ]*|Exec=$resolved|" "$source_dir/org.sniplex.Sniplex.service" >"$service_dir/org.sniplex.Sniplex.service"

# The shortcut service reads its desktop entries from this directory, not from
# the applications menu, so the entry is linked in the same way packaged
# applications do it. Without this link no shortcut is discovered.
ln -sf "../applications/sniplex.desktop" "$shortcut_dir/sniplex.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$target_dir" >/dev/null 2>&1 || true
fi

# Makes the new actions visible to the shortcut service without a restart.
if command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 --noincremental >/dev/null 2>&1 || true
elif command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
fi

echo "installed $target_dir/sniplex.desktop -> Exec=$resolved"
echo "installed $service_dir/org.sniplex.Sniplex.service -> Exec=$resolved"
echo "linked $shortcut_dir/sniplex.desktop -> ../applications/sniplex.desktop"
