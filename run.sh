#!/bin/bash
# Karnataka animal welfare and wildlife NGO scraper.
# Usage: bash run.sh               (full run)
#        bash run.sh --ola-check   (test your Ola Maps key with one search)
#        bash run.sh --quick    (official lists + map data only, about 1 minute)
set -e
cd "$(dirname "$0")"
OUT="$HOME/Desktop"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found. Install it with: xcode-select --install"
  exit 1
fi

echo "Setting up (first run takes a minute)..."
python3 -m venv .venv
./.venv/bin/python -m pip install -q --upgrade pip >/dev/null 2>&1 || true
./.venv/bin/python -m pip install -q -r requirements.txt

echo "Running regression tests..."
if ! ./.venv/bin/python -m unittest discover -s tests -q; then
  echo "Tests failed, stopping before scraping."
  exit 1
fi

# A key check only makes one request; keep existing outputs.
if [[ " $* " == *" --ola-check "* ]]; then
  ./.venv/bin/python -m scraper --ola-check
  exit $?
fi

# Remove the previous run's output so old files do not pile up.
rm -f "$OUT/karnataka-animal-ngos.xlsx" "$OUT/karnataka-animal-ngos.csv" "$OUT/karnataka-animal-ngos.html" "$OUT/awbi-parsed-rows.csv"

./.venv/bin/python -m scraper --out "$OUT" "$@"
open "$OUT/karnataka-animal-ngos.html" 2>/dev/null || true
