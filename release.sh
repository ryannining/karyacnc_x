#!/usr/bin/env bash
#
# release.sh — Commit + push + trigger release + download binary ke share.
#
# Alur:
#   1. git add -A, commit (pesan dari argumen, atau prompt), push
#   2. CI "Build Web" jalan otomatis setelah push (web update untuk customer)
#   3. Trigger workflow "Build Binary" dengan version tag
#   4. Tunggu CI selesai, download binary Linux + Windows ke build/bin/ di share
#
# Cara pakai:
#   ./release.sh                       # prompt commit message + version
#   ./release.sh -m "pesan commit"     # commit message dari argumen
#   ./release.sh -m "pesan" -v v1.0.7  # lengkap
#   ./release.sh --no-commit           # skip commit (sudah di-commit manual), langsung release
#   ./release.sh --skip-binary         # push saja, tanpa build binary (web update saja)
#
set -euo pipefail

SHARE="/mnt/smbshare/wails/karyacnc"
BIN_OUT="$SHARE/build/bin"
REPO="ryannining/karyacnc_x"
BIN_VER=""

COMMIT_MSG=""
VERSION=""
DO_COMMIT=true
DO_BINARY=true

while [ $# -gt 0 ]; do
    case "$1" in
        -m) COMMIT_MSG="$2"; shift 2 ;;
        -v) VERSION="$2"; shift 2 ;;
        --no-commit) DO_COMMIT=false; shift ;;
        --skip-binary) DO_BINARY=false; shift ;;
        *) echo "Arg tidak dikenal: $1" >&2; exit 1 ;;
    esac
done

cd "$SHARE"

# Deteksi apakah ada perubahan sama sekali (working tree kotor, staged, atau
# commit lokal belum ter-push). Kalau tidak ada, lewati push + CI Build Web.
CHANGES_DETECTED=false
if ! git diff --quiet || ! git diff --cached --quiet || [ -n "$(git status -s)" ]; then
    CHANGES_DETECTED=true
fi
if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" -gt 0 ]; then
    CHANGES_DETECTED=true
fi

# ===== 1) Commit (hanya kalau ada perubahan) =====
if $DO_COMMIT && $CHANGES_DETECTED; then
    if [ -z "$COMMIT_MSG" ]; then
        echo "=== File berubah: ==="
        git status -s | head -20
        echo ""
        read -rp "Commit message: " COMMIT_MSG
        [ -z "$COMMIT_MSG" ] && { echo "Commit message kosong. Batal." >&2; exit 1; }
    fi
    git add -A
    git commit -m "$COMMIT_MSG"
    echo ">>> Commit: $COMMIT_MSG"
fi

if ! $CHANGES_DETECTED; then
    echo ">>> Tidak ada perubahan. Skip push dan CI Build Web."
    exit 0
fi

echo ">>> Push ke GitHub..."
git push
echo ">>> Push selesai. CI Build Web jalan otomatis (web update untuk customer)."
echo ""

# ===== 2) Tunggu Build Web selesai =====
echo ">>> Tunggu CI Build Web (~30s)..."
sleep 30
for i in $(seq 1 10); do
    status=$(gh run list --workflow="Build Web" --limit 1 --json status,conclusion --jq '.[0].status + ":" + (.[0].conclusion // "")')
    if [ "$status" = "completed:success" ]; then
        echo ">>> Build Web OK."
        break
    elif [ "$status" = "completed:failure" ]; then
        echo "ERROR: Build Web gagal. Cek: gh run list --workflow='Build Web'" >&2
        exit 1
    fi
    sleep 10
done
echo ""

# ===== 3) Build binary =====
if $DO_BINARY; then
    if [ -z "$VERSION" ]; then
        read -rp "Version tag (kosong = skip binary release, Enter saja): " VERSION
    fi
    if [ -n "$VERSION" ]; then
        BIN_VER="$VERSION"

        # Versi yang sama boleh dipakai ulang: release/tag lama dihapus dulu,
        # karena CI Build Binary tidak bisa membuat release dengan tag yang sudah
        # ada. Hapus release + tag sekaligus (atau tag sisa kalau tidak ada release).
        if gh release view "$VERSION" -R "$REPO" >/dev/null 2>&1; then
            echo ">>> Release $VERSION sudah ada — hapus dulu (release + tag)."
            gh release delete "$VERSION" -R "$REPO" --yes --cleanup-tag
        elif git ls-remote --tags origin "refs/tags/$VERSION" | grep -q .; then
            echo ">>> Tag $VERSION sudah ada tanpa release — hapus tag dulu."
            git push origin ":refs/tags/$VERSION"
        fi

        echo ">>> Trigger Build Binary $VERSION..."
        gh workflow run "Build Binary" -f version="$VERSION"

        echo ">>> Tunggu CI Build Binary (~5 menit)..."
        sleep 30
        run_id=""
        for i in $(seq 1 60); do
            run_id=$(gh run list --workflow="Build Binary" --limit 1 --json databaseId,status --jq '.[0].databaseId')
            status=$(gh run list --workflow="Build Binary" --limit 1 --json status,conclusion --jq '.[0].status + ":" + (.[0].conclusion // "")')
            if [ "$status" = "completed:success" ]; then
                echo ">>> Build Binary OK."
                break
            elif [ "$status" = "completed:failure" ]; then
                echo "ERROR: Build Binary gagal. Cek: gh run view $run_id --log-failed" >&2
                exit 1
            fi
            sleep 10
        done

        # ===== 4) Download binary ke share =====
        echo ">>> Download binary ke $BIN_OUT ..."
        mkdir -p "$BIN_OUT"
        gh release download "$VERSION" -R "$REPO" -p "karyacnc-linux-*" -O "$BIN_OUT/karyacnc" --clobber
        gh release download "$VERSION" -R "$REPO" -p "karyacnc-windows-*" -O "$BIN_OUT/karyacnc.exe" --clobber
        chmod +x "$BIN_OUT/karyacnc" 2>/dev/null || true
        echo ">>> Binary tersimpan:"
        ls -lh "$BIN_OUT/karyacnc" "$BIN_OUT/karyacnc.exe"
    else
        echo ">>> Skip binary release (web update saja)."
    fi
fi

echo ""
echo "=== SELESAI ==="
echo "Customer update web: otomatis (startup) / tombol 'Check Web Update'"
[ -n "$BIN_VER" ] && echo "Binary $BIN_VER: download manual dari https://github.com/$REPO/releases/tag/$BIN_VER atau sudah di $BIN_OUT"
