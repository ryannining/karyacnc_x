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
#
# SATU pengecualian: ai/ui-strings.js TIDAK pernah disinkron. Itu satu-satunya
# file ai/ yang sengaja berbeda — KaryaCNC memakai proxy Go bawaan (/api/chat),
# master memakai Node bridge (server/serve.js), dan chat.js membaca kata-kata
# panduannya dari window.MiniSketchAIStrings. chat.js sendiri tetap identik di
# kedua repo, jadi tetap aman disinkron (lihat guard di loop salin di bawah).

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

# Folder docs/ (halaman help + css/js/img): diakses via help → docs/index.html.
# Seluruh isinya ikut disalin; file sementara (PLANNING.md dkk) tetap ikut —
# ringan dan tidak mengganggu.
if [ -d "$SRC/docs" ]; then
    while IFS= read -r f; do
        rel="${f#"$SRC"/}"
        FILES+=("$rel")
    done < <(find "$SRC/docs" -type f | sort)
fi

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

# Aset RUNTIME ai/: prompt.js mem-fetch ai/system-prompt*.txt, tools.json dan
# skills.js lewat fetch() saat kirim — TIDAK dirujuk index.html, jadi discovery
# tag melewatkannya (system-prompt-svg.txt baru sempat terlewat dan hilang di
# salinan KaryaCNC). Salin SEMUA file ai/ KECUALI ui-strings.js/ui-flags.js
# (dilewati oleh guard di loop salin di bawah).
while IFS= read -r f; do
    rel="${f#"$SRC"/}"
    FILES+=("$rel")
done < <(find "$SRC/ai" -maxdepth 2 -type f \( -name '*.js' -o -name '*.txt' -o -name '*.json' \) | sort)

# Buang duplikat, jaga urutan
FILES=($(printf '%s\n' "${FILES[@]}" | awk '!seen[$0]++'))

echo "Sumber : $SRC"
echo "Target : $DST"
echo ""

for f in "${FILES[@]}"; do
    # KaryaCNC-specific: ai/ui-strings.js sengaja BERBEDA dari master (app ini
    # memakai proxy Go bawaan di /api/chat, bukan Node bridge server/serve.js).
    # chat.js membacanya lewat window.MiniSketchAIStrings dan fallback ke default
    # master, jadi file chat.js tetap identik & aman disinkron — hanya
    # ui-strings.js yang tidak boleh ditimpa. Lewati, pertahankan versi lokal.
    if [ "$f" = "ai/ui-strings.js" ] || [ "$f" = "ai/ui-flags.js" ]; then
        echo "  dilewati    : $f (spesifik KaryaCNC — proxy Go, bukan Node bridge)"
        continue
    fi
    if [ ! -s "$SRC/$f" ]; then
        echo "ERROR: $SRC/$f kosong — salinan lama dijadikan sebagai fallback."
        exit 1
    fi
    mkdir -p "$DST/$(dirname "$f")"
    # index.html di DST punya tab-shortcut bridge ter-inject di akhir file
    # (tidak ada di SRC) — strip sebelum compare agar sync idempoten.
    if [ -f "$DST/$f" ]; then
        if [ "$f" = "index.html" ] && grep -q "karyacnc-tab-shortcut" "$DST/$f"; then
            src_cmp=$(mktemp)
            dst_cmp=$(mktemp)
            cp "$SRC/$f" "$src_cmp"
            # buang DUA blok KaryaCNC-only dari DST agar compare idempoten:
            #   1) tab-shortcut bridge: 10 baris terakhir (di-inject heredoc)
            #   2) tag <script src="ai/ui-flags.js"> (di-inject sed, ber-marker)
            # Tanpa membuang ui-flags, compare selalu gagal dan index.html
            # di-copy+inject ulang tiap sync (tak pernah konvergen).
            head -n -10 "$DST/$f" \
                | grep -v 'karyacnc-ui-flags' > "$dst_cmp"
            if cmp -s "$src_cmp" "$dst_cmp"; then
                echo "  sama        : $f"
                rm -f "$src_cmp" "$dst_cmp"
                continue
            fi
            rm -f "$src_cmp" "$dst_cmp"
        elif cmp -s "$SRC/$f" "$DST/$f"; then
            echo "  sama        : $f"
            continue
        fi
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

# Inject <script src="ai/ui-flags.js"> ke index.html KaryaCNC. File ini
# KaryaCNC-specific (menyembunyikan baris "AI bridge URL" — app ini pakai proxy
# Go bawaan), jadi TIDAK ada di master dan akan hilang tiap kali sync menimpa
# index.html. Ber-marker komentar sehingga idempoten (tak menumpuk saat sync
# dijalankan berulang); disisipkan sebelum ai/chat.js agar flag terpasang dulu.
UIFLAGS_MARKER="karyacnc-ui-flags"
if grep -q "$UIFLAGS_MARKER" "$IDX"; then
    echo "  sudah ada   : ai/ui-flags.js script tag"
else
    sed -i "s#<script src=\"ai/chat.js\"></script>#<script src=\"ai/ui-flags.js\"></script> <!-- $UIFLAGS_MARKER -->\n<script src=\"ai/chat.js\"></script>#" "$IDX"
    echo "  di-inject   : ai/ui-flags.js script tag ke index.html"
fi

echo ""
echo "Selesai. ${#FILES[@]} file disinkronkan."
echo "  - Wails dev        : reload iframe/host — server baca dari disk dulu (folder dev float di atas embed)."
echo "  - Build produksi   : jalankan 'wails build' agar embed go:embed ter-update di binary."
