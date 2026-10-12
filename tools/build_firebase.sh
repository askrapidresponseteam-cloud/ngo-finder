#!/bin/bash
# Rebuild scraper/web/vendor/firebase.js (the self-hosted Firebase SDK: app, auth, Firestore lite).
set -e
cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
cp tools/firebase-entry.js "$TMP/entry.js"
(cd "$TMP" && npm init -y >/dev/null && npm install --silent firebase@12.19.0 esbuild@0.25.10 &&
  npx esbuild entry.js --bundle --format=esm --minify --target=es2019 --legal-comments=eof --outfile=firebase.js)
cp "$TMP/firebase.js" scraper/web/vendor/firebase.js
rm -rf "$TMP"
echo "scraper/web/vendor/firebase.js rebuilt"
