#!/bin/bash
# Renders the menu-bar widget's panel to PNGs WITHOUT showing anything on screen: the SwiftUI views are compiled into a
# plain command-line tool (no app, no menu-bar item, no Dock icon, no window) and drawn with ImageRenderer.
# Usage: scripts/render-widget.sh <out-dir>   (data comes from BUILDPILOT_HOME / HOME, e.g. a seeded test home)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:?out dir}"; mkdir -p "$OUT"
B="$ROOT/build/widget-render"; mkdir -p "$B"
# Same source as the app, minus the @main app entry (so nothing registers in the menu bar).
sed 's/^@main$//' "$ROOT/widget/Sources/BuildPilotBar.swift" > "$B/Bar.swift"
cat > "$B/main.swift" <<'SWIFT'
import AppKit
let a = CommandLine.arguments
MainActor.assumeIsolated { renderSnapshot(to: a[1], dark: a.contains("dark"), float: a.contains("float"), expanded: a.contains("expanded")) }
SWIFT
if [ ! -x "$B/render" ] || [ "$ROOT/widget/Sources/BuildPilotBar.swift" -nt "$B/render" ]; then
  swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" "$B/Bar.swift" "$B/main.swift" -o "$B/render"
fi
"$B/render" "$OUT/widget-light.png"
"$B/render" "$OUT/widget-dark.png" dark
"$B/render" "$OUT/widget-float.png" float expanded
