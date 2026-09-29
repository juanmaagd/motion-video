#!/bin/sh
# Snapshot outputs + source into vN/ before a revision: the archive must re-render on its own,
# so it copies everything except node_modules and out/'s scratch, and prints the command to prove it.
#
#   ./archive.sh                archives this project's own directory
#   ./archive.sh /path/to/proj  archives another project directory (e.g. from a worker's checkout)
set -eu
ROOT="$(cd "$(dirname "$0")" && pwd)"
DIR="$(cd "${1:-$ROOT}" && pwd)"

n=1
while [ -d "$DIR/v$n" ]; do n=$((n + 1)); done
DEST="$DIR/v$n"
mkdir -p "$DEST/src"

for item in "$DIR"/*; do
  [ -e "$item" ] || continue
  base=$(basename "$item")
  case "$base" in
    node_modules|out) continue ;;
    v[0-9]*) continue ;;
    __pycache__|.DS_Store) continue ;;  # qa.py's `import lagproof` creates __pycache__ on the first real build
  esac
  cp -R "$item" "$DEST/src/"
done

if [ -d "$DIR/out" ]; then
  mkdir -p "$DEST/out"
  for f in "$DIR"/out/*.mp4 "$DIR"/out/*.png "$DIR"/out/*.txt; do
    [ -e "$f" ] && cp "$f" "$DEST/out/"
  done
fi

echo "archive: $DIR -> $DEST"
echo "verify it stands alone: (cd \"$DEST/src\" && npm install && npm run build)"
