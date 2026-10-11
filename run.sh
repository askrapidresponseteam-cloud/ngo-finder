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

# Private Python environment for the scraper, in .venv. Some Python installs
# (for example a Homebrew Python 3.13) fail at "ensurepip" while creating it,
# so fall back to macOS's own Python, then to installing pip directly.
make_venv() {
  rm -rf .venv
  if python3 -m venv .venv >/dev/null 2>&1 && ./.venv/bin/python -m pip --version >/dev/null 2>&1; then
    return 0
  fi
  if [ -x /usr/bin/python3 ]; then
    echo "  default python3 could not set up; trying the macOS Python..."
    rm -rf .venv
    if /usr/bin/python3 -m venv .venv >/dev/null 2>&1 && ./.venv/bin/python -m pip --version >/dev/null 2>&1; then
      return 0
    fi
  fi
  echo "  installing pip directly..."
  rm -rf .venv
  python3 -m venv --without-pip .venv &&
    curl -fsSL https://bootstrap.pypa.io/get-pip.py -o .venv/get-pip.py &&
    ./.venv/bin/python .venv/get-pip.py -q &&
    ./.venv/bin/python -m pip --version >/dev/null 2>&1
}

if ! ./.venv/bin/python -m pip --version >/dev/null 2>&1; then
  echo "Setting up (first run takes a minute)..."
  if ! make_venv; then
    echo "Could not set up Python. Run: xcode-select --install   then try again."
    exit 1
  fi
fi
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
