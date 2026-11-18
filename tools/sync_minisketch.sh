#!/usr/bin/env bash
# Sync MiniSketch dari repo sumber ke salinan KaryaCNC.
# Sumber tidak pernah diedit di sini — jalankan script ini setiap ada update.
#   bash tools/sync_minisketch.sh [path-sumber]
#   atau: MINSKETCH_SRC=/path/to/minisketch bash tools/sync_minisketch.sh
#
# Daftar file TIDAK ditulis manual: semua <script src> dan <link href> lokal
# dibaca dari index.html sumber, jadi dependensi baru (help.js, tools/*.js, dst)
# otomatis ikut tersalin. Aset yang dimuat RUNTIME (fonts/<slug>.js disuntik
# fonts/fonts.js saat family dipilih) ikut disapu lewat glob fonts/*.js.

set -euo pipefail

SRC="${1:-${MINSKETCH_SRC:-$HOME/git/minisketch}}"
DST="$(cd "$(dirname "$0")/.." && pwd)/minisketch"

if [ ! -d "$SRC" ]; then
    echo "ERROR: sumber tidak ditemukan: $SRC"
    echo "Set MINSKETCH_SRC atau pass sebagai argumen: bash tools/sync_minisketch.sh /path/ke/minisketch"
    exit 1
fi

if [ ! -s "$SRC/index.html" ]; then
    echo "ERROR: $SRC/index.html tidak ada/kosong."
    exit 1
fi

# index.html selalu ikut (sumber daftar aset)
FILES=(index.html)

# Auto-discover aset lokal dari index.html: <script src="..."> dan <link href="...">
while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    case "$ref" in
        http://*|https://*|//*|about:*) continue ;;
    esac
    ref="${ref#./}"
    [ -f "$SRC/$ref" ] || { echo "ERROR: aset rujukan tidak ditemukan: $SRC/$ref"; exit 1; }
    FILES+=("$ref")
done < <(
    grep -oE '(src|href)="[^"]+"' "$SRC/index.html" \
        | sed -E 's/^(src|href)="//; s/"$//' \
        | grep -vE '^(https?:)?//' \
        | sort -u
)

# CSS/JS tambahan yang tidak selalu dirujuk lewat tag (mis. core.js dimuat app.js)
for extra in app.js core.js styles.css; do
    [ -f "$SRC/$extra" ] && FILES+=("$extra")
done

# Aset RUNTIME: fonts/fonts.js menyuntik fonts/<slug>.js lewat <script> saat
# sebuah family dipilih — file itu TIDAK dirujuk index.html, jadi discovery
# tag melewatkannya. Tanpa ikut tersalin, salinan embed (KaryaCNC/Windows)
# hanya punya fonts.js + hershey: semua font bundled 404, teks tidak render,
# preview font tidak berubah, dan -> Curve gagal ("nothing could be converted").
# build.js adalah generator node, bukan aset runtime — tidak perlu ikut.
for f in "$SRC"/fonts/*.js; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "build.js" ] && continue
    FILES+=("fonts/$(basename "$f")")
done

# Buang duplikat, jaga urutan
FILES=($(printf '%s\n' "${FILES[@]}" | awk '!seen[$0]++'))

echo "Sumber : $SRC"
echo "Target : $DST"
echo ""

for f in "${FILES[@]}"; do
    if [ ! -s "$SRC/$f" ]; then
        echo "ERROR: $SRC/$f kosong — salinan lama dijadikan sebagai fallback."
        exit 1
    fi
    mkdir -p "$DST/$(dirname "$f")"
    if [ -f "$DST/$f" ] && cmp -s "$SRC/$f" "$DST/$f"; then
        echo "  sama        : $f"
        continue
    fi
    old_size=$([ -f "$DST/$f" ] && wc -c < "$DST/$f" || echo 0)
    cp "$SRC/$f" "$DST/$f"
    new_size=$(wc -c < "$DST/$f")
    echo "  di-update   : $f ($old_size -> $new_size bytes)"
done

echo ""
echo "Inject KaryaCNC tab-shortcut bridge..."

# Ctrl+Tab / Ctrl+Shift+Tab di dalam iframe harus dikirim ke shell KaryaCNC via
# postMessage (iframe beda origin dengan parent). Snippet ini di-inject otomatis
# setelah sync, TIDAK ada di sumber — idempoten lewat marker.
MARKER="karyacnc-tab-shortcut"
IDX="$DST/index.html"
if grep -q "$MARKER" "$IDX"; then
    echo "  sudah ada   : tab-shortcut bridge"
else
    cat >> "$IDX" <<EOF
<script>
/* $MARKER: Ctrl+Tab / Ctrl+Shift+Tab -> kirim ke parent (KaryaCNC shell) */
window.addEventListener('keydown', function (e) {
    if (e.key === 'Tab' && e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        parent.postMessage({ type: e.shiftKey ? 'karyacnc-prev-tab' : 'karyacnc-next-tab' }, '*');
    }
}, true);
</script>
EOF
    echo "  di-inject   : tab-shortcut bridge ke index.html"
fi

echo ""
echo "Selesai. ${#FILES[@]} file disinkronkan."
echo "  - Wails dev        : reload iframe/host — server baca dari disk dulu (folder dev float di atas embed)."
echo "  - Build produksi   : jalankan 'wails build' agar embed go:embed ter-update di binary."
