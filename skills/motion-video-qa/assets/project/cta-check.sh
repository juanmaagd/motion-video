#!/bin/sh
# Verify every call-to-action before it goes on screen: an npm package's dist-tag can lag a
# renumbering (`latest` still pointing at an old build, so `npm install -g` gets the wrong thing),
# a URL can 404, a repo can have moved. Reports every check; exits 1 if any FAILs. Prefer the repo
# URL over a stale registry when they disagree -- this tool tells you which one is stale, the
# choice of which to show on screen is yours.
#
#   ./cta-check.sh npm:PKG[@EXPECTED] url:URL git:OWNER/REPO ...
#
# npm:PKG            reports dist-tags.latest (informational)
# npm:PKG@EXPECTED   FAILs if dist-tags.latest != EXPECTED (the on-screen claim)
# url:URL            FAILs unless the (redirect-following) HTTP status is 2xx/3xx
# git:OWNER/REPO     FAILs unless the repo exists (gh if authenticated, else an HTTPS HEAD)
#
# -h/--help or no arguments: usage, exit 2. An unrecognized spec FAILs (never a silent skip that
# reads as PASS) -- a verifier that checked nothing must never report success.
set -eu
FAIL=0

check() {
  ok="$1"; shift
  if [ "$ok" = "0" ]; then printf "  PASS  %s\n" "$*"; else printf "  FAIL  %s\n" "$*"; FAIL=1; fi
}

usage() { echo "usage: cta-check.sh npm:PKG[@EXPECTED] url:URL git:OWNER/REPO ..." >&2; }

[ "$#" -gt 0 ] || { usage; exit 2; }
for a in "$@"; do
  case "$a" in -h|--help) usage; exit 2 ;; esac
done

for spec in "$@"; do
  case "$spec" in
    npm:*)
      rest="${spec#npm:}"
      pkg="${rest%%@*}"
      if [ "$rest" != "$pkg" ]; then expected="${rest#*@}"; else expected=""; fi
      if ! latest=$(npm view "$pkg" dist-tags.latest 2>/dev/null); then
        check 1 "npm $pkg: package not found"
        continue
      fi
      if [ -n "$expected" ]; then
        if [ "$latest" = "$expected" ]; then
          check 0 "npm $pkg: dist-tags.latest=$latest (matches the on-screen $expected)"
        else
          check 1 "npm $pkg: dist-tags.latest=$latest -- on-screen claim is $expected (npm install would get $latest)"
        fi
      else
        check 0 "npm $pkg: dist-tags.latest=$latest"
      fi
      ;;
    url:*)
      url="${spec#url:}"
      code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "$url" 2>/dev/null || echo "000")
      case "$code" in
        2??|3??) check 0 "url $url: HTTP $code" ;;
        *) check 1 "url $url: HTTP $code" ;;
      esac
      ;;
    git:*|gh:*)
      repo="${spec#*:}"
      if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        if gh repo view "$repo" >/dev/null 2>&1; then check 0 "git $repo: exists (gh)"; else check 1 "git $repo: not found (gh)"; fi
      else
        code=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "https://github.com/$repo" 2>/dev/null || echo "000")
        case "$code" in
          2??) check 0 "git $repo: exists (HTTP $code)" ;;
          *) check 1 "git $repo: HTTP $code" ;;
        esac
      fi
      ;;
    *)
      # An unrecognized spec checked NOTHING -- that must never look like a PASS. If this is a
      # `--flag` the caller mistyped as an argument, --help above already caught -h/--help; anything
      # else here is a real usage mistake that would otherwise silently verify zero CTAs.
      check 1 "unrecognized spec: $spec (use npm:PKG[@EXPECTED], url:URL, or git:OWNER/REPO)"
      ;;
  esac
done

if [ "$FAIL" = "0" ]; then echo "cta-check: PASS"; else echo "cta-check: FAIL"; fi
exit "$FAIL"
