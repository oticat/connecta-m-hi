#!/bin/bash
# Builds dom.oti.cat_<version>_all.ipk from control/ and data/ directories.
# Run from the repo root or any working directory.
# Override version: VERSION=1.8.0 bash build.sh
set -e

PKGNAME=dom.oti.cat
RELEASE=1
ARCH=all

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Version is read from control/control (single source of truth).
# Override only if VERSION is explicitly set in the environment.
if [ -z "$VERSION" ]; then
  VERSION=$(grep '^Version:' "$SCRIPT_DIR/control/control" | sed 's/^Version: //;s/-.*//')
fi

OUTDIR="$SCRIPT_DIR/out"
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$OUTDIR"

# Ensure scripts are executable before packaging
chmod +x "$SCRIPT_DIR/control/postinst"
chmod +x "$SCRIPT_DIR/control/prerm"
chmod +x "$SCRIPT_DIR/control/postrm"
chmod +x "$SCRIPT_DIR/data/etc/init.d/dom.oti.cat"

# Force root ownership inside the archives. Without this the builder's own uid/gid are baked in
# (on macOS that is 501:staff), and opkg installs the files owned by whatever that maps to on the
# hub. Flag spelling differs between bsdtar (macOS) and GNU tar (the release workflow's runner).
if tar --version 2>/dev/null | grep -qi bsdtar; then
    OWNER_FLAGS="--uid 0 --gid 0 --uname root --gname root"
else
    OWNER_FLAGS="--owner=0 --group=0 --numeric-owner"
fi

echo "[build] control.tar.gz"
COPYFILE_DISABLE=1 tar -czf "$TMPDIR/control.tar.gz" -C "$SCRIPT_DIR/control" \
    $OWNER_FLAGS --exclude='._*' --exclude='.DS_Store' .

# Archive the top-level entries by name rather than as '.'. A './' root entry lands in opkg's
# .list as an empty path, which it then tries to unlink on the next upgrade:
#   "Removing obsolete file ." / "remove_obsolesced_files: unlinking failed"
echo "[build] data.tar.gz"
DATA_ENTRIES=$(cd "$SCRIPT_DIR/data" && ls -A | grep -v -e '^\._' -e '^\.DS_Store$')
COPYFILE_DISABLE=1 tar -czf "$TMPDIR/data.tar.gz" -C "$SCRIPT_DIR/data" \
    $OWNER_FLAGS --exclude='._*' --exclude='.DS_Store' $DATA_ENTRIES

echo "[build] debian-binary"
printf '2.0\n' > "$TMPDIR/debian-binary"

echo "[build] assembling IPK"
IPK="$OUTDIR/${PKGNAME}_${VERSION}-${RELEASE}_${ARCH}.ipk"
( cd "$TMPDIR" && ar rc "$IPK" debian-binary control.tar.gz data.tar.gz )

echo "[build] done: $IPK"
ls -lh "$IPK"
