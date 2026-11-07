# Sniplex

**Snip, annotate, and copy your screen — a modern desktop screen capture & markup utility for Linux.**

[Install](#install) · [Using Sniplex](#using-sniplex) · [Recording](#recording) · [The player](#the-player) · [Tools and shortcuts](#tools-and-shortcuts) · [Development](#development) · [Troubleshooting](#troubleshooting)

Snip an area, an app, or the whole screen. Draw on it, pull text out of it, and copy or save it. Sniplex uses a Fluent design system, a capture toolbar, and a full-screen overlay selector. The workflow is built for Linux first, treating each compositor's screenshot path as the design center rather than an afterthought.

> Still in development. Sniplex is under active development and is not yet stable. Expect unfinished surfaces, changed interfaces, and updates that alter behavior between builds.

## Features

- **Snip anything** — a region, an app, the whole screen, or a freeform lasso. Live `width x height` badge while dragging.
- **Annotate in place** — pen, highlighter, arrows, boxes, numbered steps, text, crop, and emoji stamps drawn straight onto the frozen frame. No separate editor to open.
- **Pull text out of a capture** — on-device OCR (Tesseract.js, WASM) with auto-dimming rows, selectable words, and one-click copy. Core and language assets are fetched once and cached by the browser; later offline use depends on that cache, so it is not guaranteed.
- **Copy and hand off fast** — when `Automatically copy changes` is on and a clipboard helper is present (`wl-copy` on Wayland, `xclip` on X11), captures copy shortly after they land and edits keep the clipboard fresh so `Ctrl + V` pastes the latest composite. Share prefers the native share sheet, then the clipboard, then a downloaded PNG via the app.
- **Keep the display frozen** — the whole display freezes into one still frame for selection and markup, which is why the flow behaves the same in third-party sessions.
- **Record video** — pick a region or an app and film it to MP4. Flip `Snip | Record` and the viewport fades into a recorder view. *(Not in this build — see Recording below.)*
- **Replayed captures** — by default, each capture lands as a new tab in the same editor. Turn `Multiple frames` on and each capture opens in its own editor frame instead.

MIT licensed. Build it with Bun + Tauri — see [Install](#install) and [Development](#development).

## Platform support

| Platform | State | How it captures |
| --- | --- | --- |
| **Linux** (KDE Plasma, Wayland or X11) | Best supported | Direct compositor capture via `org.kde.KWin.ScreenShot2` on KDE; otherwise external helpers. Per-app geometry via `kdotool` / KWin D-Bus, with a `wmctrl` fallback. |
| **Linux** (GNOME, wlroots, other desktops) | Partial | Same capture-helper fallback chain applies. Recording has no Linux-native backend attached yet — see [Recording](#recording). |
| **Other platforms** | Not yet | The app boots as a browser bundle, but the desktop shell settings revolve around Linux output. |

KDE Plasma is the intended path: Sniplex requests the compositor's screenshot interface when the desktop reports KDE, so the frame arrives with no external screen-grab process on that desktop. App geometry may still use helpers (`kdotool` / `wmctrl`). Other desktops use the same helper fallback chain; recording still needs a backend before a clip can be captured.

## Why

Linux has capable screenshot tools, but a capture running on Wayland has to go through a compositor-provided screenshot path every time, and tools that predate that constraint fight it. Sniplex treats that seam as a central design problem: freeze the screen once, then run everything else against pixels already in memory.

## How it works

Capture the whole display in a single shot, then run selection against that frozen frame inside Sniplex's own overlay. The compositor is involved for exactly one instant, which lets the same code path behave the same on Wayland and X11. Everything downstream — region select, annotation, OCR, export — is ordinary drawing on an image already held in memory.

Recording rides a similar rule — **the frozen frame is still how you choose, and recording starts once you have chosen** — though no recorder exists to start today. A future capture box would sit fixed on screen: where a region is is where it stays, even if an app is nudged out of it.

## Install

### Linux

Sniplex is built on Tauri, so it ships as a desktop app rather than a pip package. Two parts: the web bundle and the Rust shell.

```sh
bun install            # web dependencies
bun run build          # production bundle -> dist/
bun run tauri build    # release binary + .deb bundle (.deb target in tauri.conf.json)
```

Release artifacts land under `src-tauri/target/release/` and `src-tauri/target/release/bundle/deb/`. To put a local binary on the desktop:

```sh
cp src-tauri/target/release/sniplex ~/.local/bin/sniplex
packaging/install-local-desktop.sh ~/.local/bin/sniplex
```

That script wires the desktop entry (`packaging/sniplex.desktop`), the KGlobalAccel-style service (`packaging/org.sniplex.Sniplex.service`), and the `Ctrl + Shift + S` shortcut. It is safe to re-run. Keep the binary somewhere it will stay: the shortcut points at the file itself, so if you move it, run it once from its new home to re-point the shortcut.

**Updating is rebuilding or re-downloading**, not an in-app updater. A `.deb` installs over the old one. The AppImage/standalone path does not apply here; the binary from `tauri build` replaces the old one.

**Uninstalling wants the removal step first.** `apt remove` alone won't reach the desktop entry, autostart entry, icons, and `Ctrl + Shift + S` shortcut that live in `~/.local`. A plain file search for `sniplex` under `~/.local/share/applications`, `~/.config/autostart`, and `~/.local/bin` finds them.

Two prerequisites the first launch cannot invent: a capture helper (any of `spectacle`, `gnome-screenshot`, `grim`, `maim`, `scrot`, or `import`) and, for folder picking, `zenity` or `kdialog`. Without at least one helper binary the capture fails with `Unable to capture screen using available desktop capture backends`.

## Using Sniplex

Sniplex runs resident once it is running, so the shortcut reaches a warm process instead of paying startup cost on every snip.

1. **Press `Ctrl + Shift + S`.** The whole display freezes into a full-screen overlay. This single frozen frame is what both selection and annotation work against, which is why the flow is identical on Wayland and X11.

2. **Choose what to capture.** A bar docked at the top of the screen carries the capture mode.

3. **Drag.** Or, in App mode, hover — the app under the pointer is outlined and named — and click to accept it.

4. **Annotate in place**, directly on the frozen display; there is no separate editor step. Resize any edge of the selection and the ink stays exactly where it was drawn, over the same pixels, instead of moving with the selection or getting clipped away.

5. **Copy or save** from the bar that appears under the selection.

### Capture modes

| Mode | What it captures |
| --- | --- |
| **Region** | Any rectangle you drag |
| **App** | One application's app |
| **Full screen** | The whole workspace (all monitors) |
| **Freeform** | A hand-drawn lasso; pixels outside the loop are transparent |

### What happens after a snip

What you get next is driven by global toggles in Settings, not a per-capture destination chooser:

| Destination | What it does |
| --- | --- |
| **Copy to clipboard** | When `Automatically copy changes` is on and a clipboard helper is present, the composite (capture plus markup) is copied shortly after landing, with no overlay left behind |
| **Annotate, then export** | The frozen frame and its tools stay up: Copy or Save when you are done |
| **Save to folder** | The original PNG writes to `~/Pictures/Screenshots` (configurable) |
| **Open in editor** | The capture opens in the main Sniplex editor with tabs, zoom, undo, and print |

### The editor

Selecting `Edit` after a capture reveals the overlay's own floating bar over the image — the same widget, the same tools, the same markup model, so there is no second tool set to drift. The only differences are that there is no capture-mode chip (there is nothing left to capture) and the bar's trailing action is `Done`, since the chrome already owns Copy and Save As.

Marks live in image coordinates rather than screen coordinates, so they survive zooming and export exactly where they looked. Several captures in a row leave several editor tabs open.

**`Open file` (or `Ctrl + O`, or dropping a file on the window)** loads another image into the same tab. On its own the editor starts empty, with an Open button and a place to drop a file.

## Recording

*Planned behavior — nothing here records today.* Flip `Snip | Record` and the same selection would become the thing that gets filmed. Region, App, and Full screen would all record.

Committing a selection *would* **arm** a recording rather than starting one, so you could still reframe it with the handles. One pill *would* carry the whole thing and its button *would* name what a click does — **Record**, then `Starting in 3` during a delay, then the running clock and **Stop** — but no such pill, countdown, or clock UI exists today; the toggle only switches mode.

In App mode, filming would cover where an app is right now. It does not follow an app that moves mid-recording; there is no app-following API to build it on.

**This build ships without it.** Flip `Snip | Record`, press the shortcut, or hit `Ctrl + Shift + R` and nothing records — the toggle and settings exist as interface, but there is no recorder backend, no `.mp4` writer, and no player.

| The recorder would want | Here |
| --- | --- |
| Region / App / Full screen recording | No recorder attached |
| Pause / Resume, Stop, Discard | No recorder attached |
| MP4 container, audio toggles, 3s countdown | No recorder attached |
| MP4 via `canvas.toBlob` | Produces no blob on typical Linux browsers — Save As to MP4 reports it could not be encoded |

There are no recording backends to list or pick from. `snipux --list-backends` is a reference-app command and does not exist here.

### Where a recording would go

| Destination | What it does |
| --- | --- |
| **Copy to the clipboard** | The video would go to the clipboard as a file reference and the file would be deleted. |
| **Save to a folder** | Moved into `~/Videos/Screen Recordings` (configurable). |
| **Open in the player** | Saved as above, then opened in the trim editor. |

## The player

The `Open` destination's other half: playback, a rail with a decoded filmstrip and a real waveform, in/out handles with a plain-language readout, and export.

There is no player in this build, for the same reason there is no recorder. The trimming timeline (`Trim`), the `Export GIF` flow (`Ctrl + G`), and the bottom overlay bar (Play / Pause, scrubber, elapsed readout, volume) are not implemented — no file exists to play.

## Tools and shortcuts

| Key | Tool | What it does |
| --- | --- | --- |
| `Alt + B` | Pen | Drag to draw freehand (color + thickness flyout on second click) |
| `Alt + H` | Highlighter | Sweep over text; multiply blend keeps dark rows readable. `Shift` constrains to a straight row |
| `Alt + E` | Eraser | Click a stroke or merged shape to remove it whole |
| `Alt + I` | Crop | Non-destructive 8-handle crop, `Enter` to apply, `Esc` to cancel |
| `T` | Text | Drag a box, type directly (font, size, B / I / U, color, highlight, align) |
| `Alt + T` | Touch Writing | One finger draws when on, pans when off |
| `Ctrl + Z` / `Ctrl + Y` | — | Undo / redo (per-tab stack; crop is a history boundary) |
| `Ctrl + Plus` / `Ctrl + Minus` / `Ctrl + 0` / `Ctrl + 1` | — | Zoom in, zoom out, actual size, fit to window |
| `Ctrl + R` | — | Show / hide ruler when Scan Text is off; suppressed when Scan Text is on (redact is disabled) |
| `Ctrl + S` / `Ctrl + O` / `Ctrl + C` / `Ctrl + P` | — | Save As (PNG / JPG / single-frame GIF) / Open / Copy / Print |
| `Ctrl + N` | — | New capture |

The capture bar (top-center pill) flips `Snip | Record`, commits Region / App / Full screen / Freeform, offers 0 / 3 / 5 / 10s delay, and carries the eyedropper color picker and Text Extractor. The eyedropper loupe zooms 2x–16x with `Ctrl` + wheel and copies HEX / RGB / HSL to the clipboard; `Alt` alone flashes keytip badges across the editor.

## Where files go

| | Folder | Default filename |
| --- | --- | --- |
| Snips | `~/Pictures/Screenshots` | `Sniplex_YYYY-MM-DD_HH-MM-SS.png` |
| Recordings | `~/Videos/Screen Recordings` | Recording names only — no recorder to name |

The screenshots directory is created if it doesn't exist yet. The folder and pattern are configurable in Settings; `Change` opens a picker, `Open folder` opens the directory in the file manager. Picker support needs `zenity` or `kdialog` installed.

## Command reference

| Command | What it does |
| --- | --- |
| `bun install` | Install web dependencies |
| `bun run dev` | Vite dev server |
| `bun run build` | Production web bundle → `dist/` |
| `bun run check` | `svelte-check` + `tsc` |
| `bun test` | Unit tests |
| `bun run tauri dev` | Desktop shell during development |
| `bun run tauri build` | Release binary + `.deb` bundle |
| `sniplex --capture=overlay\|fullscreen\|record\|new` | Desktop-entry launch actions (see `packaging/sniplex.desktop`) |
| `packaging/install-local-desktop.sh` | Install/clean the local desktop entry + shortcut service |

## Uninstall

Run the local removal step first so the desktop entry, autostart entry, icons, and bound shortcut all go with it. The install script in `packaging/` only installs — remove its outputs manually. Then remove the package the way it was installed.

Local binary:

```sh
rm -f ~/.local/bin/sniplex
rm -f ~/.local/share/applications/sniplex.desktop
rm -f ~/.local/share/kglobalaccel/sniplex.desktop
rm -f ~/.local/share/dbus-1/services/org.sniplex.Sniplex.service
```

If you built the `.deb`:

```sh
sudo apt remove sniplex
```

Uninstalling only removes the installed package — it has no idea the first launch also wrote files under `~/.local`, so skipping the removal step leaves an autostart entry pointing at a binary that no longer exists, a dead keyboard shortcut, and a ghost entry in your application list. The removal script only splices its own shortcut block out of GNOME's list, so any other shortcuts you set by hand are left alone.

## Troubleshooting

**No tray icon.** Stock Ubuntu / GNOME ships no legacy tray support unless the AppIndicator/KStatusNotifierItem extension is installed and enabled. Without it, Sniplex still runs and still answers the shortcut — it just prints a notice on startup and has no tray icon or Quit item. Use Settings from the app itself, and kill the process to quit.

**Capture fails, or a prompt appears every time.** On Wayland, capture uses the compositor screenshot path when the desktop reports KDE, otherwise an external helper. If the helper reports failure, check that at least one capture helper (`spectacle`, `gnome-screenshot`, `grim`, `maim`, `scrot`, or `import`) is installed — Sniplex cannot get pixels if no backend is available.

**Recording is unavailable.** By design today. The `Snip | Record` toggle exists so the surface is ready, but no recorder is attached on any desktop. Nothing captures video.

**Nothing happens when I press the shortcut.** Check the binary runs from a terminal and that `Ctrl + Shift + S` isn't already taken by another app. The hotkey is a registration the running process holds; a dead process means a dead key. The shortcut is safe to re-bind from Settings and the change sticks.

**`capture-desktop` says no backend is available.** Install one of `spectacle`, `gnome-screenshot`, `grim`, `maim`, `scrot`, or `import`, plus a detection helper (`kdotool` or `wmctrl`). KDE Plasma with KWin keeps the direct compositor path, so it is the least fragile desktop for this build.

## What hasn't been tested yet

Development has happened on a single KDE/Plasma Linux desktop. These are known gaps, and they read as a list of things that don't work now rather than unknowns:

- **Screen video recording** — Surface E plus Phase 24 are stubs. No `MediaRecorder` / `getDisplayMedia` pipeline, no native recorder, no pause/stop/discard wiring. `recordMicrophone` / `recordSystemAudio` settings persist but drive nothing.
- **MP4 export from the canvas** — `canvas.toBlob(..., 'video/mp4')` yields no blob on typical Linux browsers, so Save As to MP4 fails with `Could not encode the image for saving`.
- **`HDR screenshot color corrector`** — the toggle persists in Settings, but no tone mapping is applied to captures.
- **Privacy redaction** — `Quick redact` and manual `Redact text` are disabled and show `Available in a later phase`. Undoing redactions is on the same roadmap.
- **QR / barcode detection** — no decoder is bundled, so Scan Text extracts no QR codes.
- **Perfect Screenshot auto-snap** — content-aware region tightening (button or `Ctrl`-drag) doesn't exist.
- **Quick Markup inline overlay (`Ctrl + E`)** — no bar under the selection with Share / Capture split-button semantics.
- **Text Extractor quick-copy bar** — in-place drag-to-OCR in the overlay works (`Copy all text` on the frozen frame), but the full Text Extractor flow with `Automatically copy text` and `Remove line breaks` options is not there.
- **Screen-recording folders and prompts** — `recordingFolder`, `askToSaveRecordings`, and audio defaults are persisted from the Settings surface but no code reads them yet.
- **Native dialogs behind web APIs** — the native folder dialog and share sheet are thin wrappers: picking a folder wants `zenity` / `kdialog`, and Share falls back to clipboard or download where the native sheet isn't present.

If one of these is where something goes wrong, that is a known gap, not a mystery.

Fractional display scaling, termination under a deep-Wayland session with no portal backend, and pasting into every file manager and chat app have not been verified on real hardware.

## Requirements

- **Linux** (KDE Plasma 5/6 preferred; Wayland or X11)
- **Bun** (runs the JS side and the unit tests)
- **Rust toolchain** (edition 2024, per `src-tauri/Cargo.toml`)
- **WebKitGTK dev libraries** (`webkit2gtk`, `gtk`, `gobject-sys`) for the Tauri shell
- Optional but recommended helpers: `kdotool`, one of `spectacle` / `gnome-screenshot` / `grim` / `maim` / `scrot` / `import`, `zenity` / `kdialog`

## Development

```sh
bun install            # install web dependencies
bun run dev            # Vite dev server
bun run build          # production bundle -> dist/
bun run check          # svelte-check + tsc
bun test               # unit tests
bun run tauri dev      # desktop shell during development
bun run tauri build    # release binary + .deb bundle
```

`src-tauri/Cargo.toml` pins `tauri 2.12.5` and `rust-version 1.90`. `src-tauri/tauri.conf.json` builds a `deb` only — an AppImage or USB install is out of scope for this build. `misc/tech-stack.md` lists the rendering and shell facts, `misc/behavioral-plan.md` holds the full interaction contract, and `AGENTS.md` holds the project rules that constrain branding and naming.

## Contributing

Issues and pull requests are welcome. Keep changes strictly in-scope for the phase you are working on: no unrequested UI changes, and no new terminology beyond the generic descriptors in `AGENTS.md`. Exact phase plans live in `misc/behavioral-plan.md`.

## Licence

MIT — see `LICENSE`.

## About

Snip, annotate, and copy your screen — a modern desktop screen capture & markup utility for Linux. Fluent design system, capture toolbar, overlay selector.
