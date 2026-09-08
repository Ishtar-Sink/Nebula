#!/usr/bin/env bash
#
# Builds the desktop app (Tauri) and installs it as a real macOS application bundle, so it
# shows up in Launchpad and Spotlight instead of living as a loose binary.
#
#   tools/install-macos.sh [destino]      # padrão: ~/Applications
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$HOME/Applications}"
APP="$DEST/Nebula.app"
BIN="$ROOT/target/release/nebula-desktop"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Este instalador é para macOS. Em outros sistemas use: cargo run --release -p nebula-desktop" >&2
  exit 1
fi

command -v cargo >/dev/null 2>&1 || { echo "cargo não encontrado no PATH." >&2; exit 1; }

echo "==> Construindo o front"
pnpm --filter @nebula/web build

echo "==> Compilando (release)"
cargo build --release -p nebula-desktop --manifest-path "$ROOT/Cargo.toml"
[[ -x "$BIN" ]] || { echo "binário não encontrado em $BIN" >&2; exit 1; }

# Tauri picks dev-vs-production from the `custom-protocol` feature, not from the cargo
# profile. Without it the window loads the Vite dev server and shows a connection error.
BUNDLE="$(basename "$(ls "$ROOT/apps/web/dist/assets/"*.js | head -1)")"
if ! grep -q "$BUNDLE" "$BIN"; then
  echo "ERRO: o front não ficou embutido no binário (esperava encontrar $BUNDLE)." >&2
  echo "      Confirme que a feature 'custom-protocol' está ativa em apps/desktop/Cargo.toml." >&2
  exit 1
fi
echo "==> Front embutido conferido ($BUNDLE)"

echo "==> Gerando ícone"
ICONSET="$(mktemp -d)/Nebula.iconset"
mkdir -p "$ICONSET"
# Rendered at each size rather than downscaled, so small sizes stay crisp.
for spec in "16 icon_16x16" "32 icon_16x16@2x" "32 icon_32x32" "64 icon_32x32@2x" \
            "128 icon_128x128" "256 icon_128x128@2x" "256 icon_256x256" \
            "512 icon_256x256@2x" "512 icon_512x512" "1024 icon_512x512@2x"; do
  set -- $spec
  node "$ROOT/tools/make-icon.mjs" "$ICONSET/$2.png" "$1" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$(dirname "$ICONSET")/Nebula.icns"

echo "==> Montando Nebula.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/nebula-desktop"
cp "$(dirname "$ICONSET")/Nebula.icns" "$APP/Contents/Resources/Nebula.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Nebula</string>
  <key>CFBundleDisplayName</key><string>Nebula</string>
  <key>CFBundleIdentifier</key><string>com.nebula.player</string>
  <key>CFBundleExecutable</key><string>nebula-desktop</string>
  <key>CFBundleIconFile</key><string>Nebula</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc signature: without it, an unsigned arm64 binary inside a bundle is killed on launch.
codesign --force --deep --sign - "$APP" 2>/dev/null || \
  echo "    (aviso: codesign falhou; se o app não abrir, rode: codesign --force --deep --sign - '$APP')"

# Nudge Launch Services so the app is findable right away instead of on the next reindex.
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f "$APP" >/dev/null 2>&1 || true

echo
echo "Instalado: $APP"
echo
echo "  Abrir:      open -a Nebula"
echo "  Terminal:   $APP/Contents/MacOS/nebula-desktop"
echo
echo "Por padrão conecta em http://localhost:4000. O endereço se configura dentro do app"
echo "(engrenagem no topo) e fica em ~/.config/nebula/config.json."
