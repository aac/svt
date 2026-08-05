#!/usr/bin/env bash
# Bundle the unrestrained "Triage Orbit" demo (main.tsx) — which imports the
# REAL headless @surface/cockpit engine plus React — into one IIFE, then inline
# it into template.html to produce the self-contained companion page.
#
# Run from anywhere:  bash packages/cockpit-ui/demo-unrestrained/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
ESB="$REPO/node_modules/.pnpm/esbuild@0.25.12/node_modules/esbuild/node_modules/.bin/esbuild"
OUT="$HERE/dist/unrestrained-headless-demo.html"

# Resolve react / @surface/cockpit from cockpit-ui's node_modules by bundling
# with that package dir as the working directory.
cd "$REPO/packages/cockpit-ui"

mkdir -p "$HERE/dist"
BUNDLE="$(mktemp)"
"$ESB" "$HERE/main.tsx" \
  --bundle --format=iife --platform=browser \
  --jsx=automatic \
  --loader:.tsx=tsx \
  --define:process.env.NODE_ENV='"production"' \
  --minify \
  --outfile="$BUNDLE" 2>&1

# Inline the bundle into the template at the @BUNDLE@ marker.
python3 - "$HERE/template.html" "$BUNDLE" "$OUT" <<'PY'
import sys, pathlib
template, bundle, out = sys.argv[1], sys.argv[2], sys.argv[3]
html = pathlib.Path(template).read_text()
js = pathlib.Path(bundle).read_text()
# Guard against an accidental </script> inside the bundle breaking the tag.
js = js.replace("</script>", "<\\/script>")
html = html.replace("<!-- @BUNDLE@ -->", "<script>\n" + js + "\n</script>")
pathlib.Path(out).write_text(html)
print(f"wrote {out} ({len(html)//1024} KB)")
PY

rm -f "$BUNDLE"
