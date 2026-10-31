#!/usr/bin/env sh
# Installs the Sniplex desktop entry for a locally built binary.
#
# The compositor authorizes direct screen capture by looking up the .desktop
# file whose Exec= resolves to the calling executable, so the entry must point at
# the exact binary path that is launched.
set -eu

binary="${1:-$HOME/.local/bin/sniplex}"
target_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
source_file="$(dirname "$0")/sniplex.desktop"

if [ ! -x "$binary" ]; then
    echo "error: $binary is missing or not executable" >&2
    exit 1
fi

resolved="$(readlink -f "$binary")"
mkdir -p "$target_dir"
sed "s|^Exec=.*|Exec=$resolved|" "$source_file" >"$target_dir/sniplex.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$target_dir" >/dev/null 2>&1 || true
fi

echo "installed $target_dir/sniplex.desktop -> Exec=$resolved"
