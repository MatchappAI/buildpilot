#!/bin/bash
# Builds the macOS menu-bar widget "BuildPilot Bar.app" (universal: Apple silicon + Intel, macOS 13+)
# and zips it into media/widget/ so it ships inside the VSIX. Requires Xcode Command Line Tools.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/build/widget"
APP="$OUT/BuildPilot Bar.app"
VERSION=$(node -p "require('$ROOT/package.json').version")
rm -rf "$OUT" && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ROOT/media/widget"

for arch in arm64 x86_64; do
  swiftc -O -parse-as-library -swift-version 5 -target "$arch-apple-macos13.0" \
    "$ROOT/widget/Sources/BuildPilotBar.swift" -o "$OUT/bar-$arch"
done
lipo -create "$OUT/bar-arm64" "$OUT/bar-x86_64" -output "$APP/Contents/MacOS/BuildPilot Bar"
rm "$OUT"/bar-*

# App icon from the extension icon
ICONSET="$OUT/icon.iconset" && mkdir -p "$ICONSET"
for s in 16 32 64 128 256; do sips -z $s $s "$ROOT/media/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null; done
cp "$ICONSET/icon_32x32.png" "$ICONSET/icon_16x16@2x.png"; cp "$ICONSET/icon_64x64.png" "$ICONSET/icon_32x32@2x.png"; cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"; rm "$ICONSET/icon_64x64.png"
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns" && rm -rf "$ICONSET"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>com.buildpilot.bar</string>
  <key>CFBundleName</key><string>BuildPilot Bar</string>
  <key>CFBundleDisplayName</key><string>BuildPilot Bar</string>
  <key>CFBundleExecutable</key><string>BuildPilot Bar</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>BuildPilot. Local only: reads ~/.buildpilot, sends nothing.</string>
</dict></plist>
PLIST

codesign --force --deep -s - "$APP"
rm -f "$ROOT/media/widget/BuildPilot-Bar.zip"
ditto -c -k --norsrc --noextattr --keepParent "$APP" "$ROOT/media/widget/BuildPilot-Bar.zip"
echo "Built $APP ($VERSION) → media/widget/BuildPilot-Bar.zip"
# The plugin ships its own copy; keep it in step (the plugin copy is otherwise refreshed only by npm run build,
# which runs before this script in npm run package).
mkdir -p "$ROOT/plugin/media/widget" && cp "$ROOT/media/widget/BuildPilot-Bar.zip" "$ROOT/plugin/media/widget/BuildPilot-Bar.zip"
