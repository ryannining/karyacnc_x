#!/usr/bin/env bash
# ============================================================
#  install_linux.sh
#  Installs pdf2svg (KaryaCNC PDF optimiser) on Ubuntu/Debian.
#
#  - Checks / installs Python 3 + pip
#  - Installs PyMuPDF
#  - Creates a launcher script
#  - Registers a .desktop entry so it appears in:
#      Files  ->  right-click PDF  ->  Open With  ->  Optimize to SVG
#
#  Run:  bash install_linux.sh
# ============================================================
set -e

APP_NAME="pdf2svg-karyacnc"
APP_FRIENDLY="Optimize to SVG (KaryaCNC)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/pdf2svg.py"

# --- helpers -------------------------------------------------
info()  { printf '\033[36m[*]\033[0m %s\n' "$1"; }
ok()    { printf '    \033[32m%s\033[0m\n' "$1"; }
err()   { printf '    \033[31mERROR: %s\033[0m\n' "$1"; }
warn()  { printf '    \033[33m%s\033[0m\n' "$1"; }

echo ""
echo "=== pdf2svg (KaryaCNC) installer for Linux ==="
echo ""

# ------------------------------------------------------------
# 1. Python 3
# ------------------------------------------------------------
info "Checking Python 3..."
if ! command -v python3 >/dev/null 2>&1; then
    warn "python3 not found. Installing via apt..."
    sudo apt-get update -qq
    sudo apt-get install -y python3 python3-pip
fi
PY_VER="$(python3 --version 2>&1)"
ok "Found $PY_VER"

# ------------------------------------------------------------
# 2. pip + PyMuPDF
# ------------------------------------------------------------
info "Ensuring pip is available..."
if ! python3 -m pip --version >/dev/null 2>&1; then
    warn "pip not available. Installing..."
    sudo apt-get install -y python3-pip
fi

info "Installing PyMuPDF (user-level)..."
# Prefer --break-system-packages on new Ubuntu (PEP 668), fall back gracefully
python3 -m pip install --user --quiet --disable-pip-version-check pymupdf 2>/dev/null \
    || python3 -m pip install --user --quiet --break-system-packages pymupdf \
    || python3 -m pip install --quiet pymupdf
ok "PyMuPDF installed."

# ------------------------------------------------------------
# 3. Verify the converter
# ------------------------------------------------------------
info "Verifying converter..."
if ! python3 "$PY_SCRIPT" --help >/dev/null 2>&1; then
    err "Cannot run $PY_SCRIPT"
    exit 1
fi
ok "Converter OK."

# ------------------------------------------------------------
# 4. Launcher script
# ------------------------------------------------------------
info "Creating launcher..."
LAUNCHER="$SCRIPT_DIR/pdf2svg_run.sh"
cat > "$LAUNCHER" << EOF
#!/usr/bin/env bash
# Auto-generated launcher for pdf2svg (KaryaCNC)
exec python3 "$PY_SCRIPT" "\$@" --stats
EOF
chmod +x "$LAUNCHER"
ok "Launcher: $LAUNCHER"

# ------------------------------------------------------------
# 5. .desktop entry (right-click / Open With)
# ------------------------------------------------------------
info "Registering 'Open With' entry..."
APPS_DIR="$HOME/.local/share/applications"
mkdir -p "$APPS_DIR"
DESKTOP_FILE="$APPS_DIR/$APP_NAME.desktop"

cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=$APP_FRIENDLY
GenericName=PDF to SVG optimiser
Comment=Optimise PDF vector drawings for CNC (KaryaCNC)
Exec=$LAUNCHER %f
Icon=application-pdf
Terminal=true
MimeType=application/pdf;
Categories=Graphics;Utility;Engineering;
Keywords=pdf;svg;cnc;laser;cam;inkscape;
EOF
chmod +x "$DESKTOP_FILE"

# Refresh desktop database so the new entry is picked up
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DIR" 2>/dev/null || true
fi
# Also refresh MIME cache
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database "$HOME/.local/share/mime" 2>/dev/null || true
fi

ok "Desktop entry: $DESKTOP_FILE"

# ------------------------------------------------------------
# 6. Done
# ------------------------------------------------------------
echo ""
echo "=== Installation complete ==="
echo ""
echo "How to use:"
echo "  1. In your file manager, right-click a PDF"
echo "     -> Open With -> $APP_FRIENDLY"
echo "  2. Or from terminal:  $LAUNCHER input.pdf"
echo ""
echo "Output: the SVG is written next to the source PDF"
echo "        as <filename>_optimized.svg"
echo ""
warn "If the new app does not appear in 'Open With' immediately,"
warn "log out and back in (or restart the file manager)."
echo ""
