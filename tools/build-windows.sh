#!/usr/bin/env bash
#
# Builds the Windows desktop app (Tauri) from Linux/WSL and lays out a ready-to-copy folder.
#
# Requires, once:
#   sudo apt install mingw-w64
#   rustup target add x86_64-pc-windows-gnu
#
#   tools/build-windows.sh [destino]     # padrão: dist/windows
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$ROOT/dist/windows}"
TARGET=x86_64-pc-windows-gnu
EXE="$ROOT/target/$TARGET/release/nebula-desktop.exe"

command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1 || {
  echo "mingw-w64 não encontrado. Instale com: sudo apt install mingw-w64" >&2; exit 1; }
rustup target list --installed | grep -qx "$TARGET" || {
  echo "Alvo Rust ausente. Instale com: rustup target add $TARGET" >&2; exit 1; }

echo "==> Construindo o front"
pnpm --filter @nebula/web build

echo "==> Compilando o app (Tauri, $TARGET)"
cargo build --release -p nebula-desktop --target "$TARGET"
[[ -f "$EXE" ]] || { echo "binário não encontrado em $EXE" >&2; exit 1; }

# Guard against shipping a development build: Tauri picks dev-vs-production from the
# `custom-protocol` feature, not from the cargo profile. Without it the window loads the
# Vite dev server and shows a connection error on any machine that isn't the dev box.
BUNDLE="$(basename "$(ls "$ROOT/apps/web/dist/assets/"*.js | head -1)")"
if ! grep -q "$BUNDLE" "$EXE"; then
  echo "ERRO: o front não ficou embutido no binário (esperava encontrar $BUNDLE)." >&2
  echo "      Confirme que a feature 'custom-protocol' está ativa em apps/desktop/Cargo.toml." >&2
  exit 1
fi
echo "==> Front embutido conferido ($BUNDLE)"

echo "==> Montando $DEST"
mkdir -p "$DEST"
cp "$EXE" "$DEST/Nebula.exe"

# The MSVC target links the WebView2 loader statically; the GNU target imports it, so the
# DLL has to travel with the executable or Windows refuses to start the process.
LOADER="$(find "$HOME/.cargo/registry/src" -path "*webview2-com-sys-*/x64/WebView2Loader.dll" 2>/dev/null | head -1)"
[[ -n "$LOADER" ]] || { echo "WebView2Loader.dll não encontrado no registry do cargo" >&2; exit 1; }
cp "$LOADER" "$DEST/WebView2Loader.dll"

echo
echo "Pronto: $DEST"
ls -la "$DEST"
echo
echo "Copie a pasta inteira para o Windows — os dois arquivos precisam ficar juntos."
echo "O endereço do servidor se configura dentro do app (engrenagem) e fica em"
echo "  %APPDATA%\\nebula\\config.json"
