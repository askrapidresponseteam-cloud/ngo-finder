#!/bin/bash
# Animal welfare and wildlife NGO scraper for India.
# Usage: bash run.sh               (full run)
#        bash run.sh --ola-check   (enter or keep your Ola Maps key, then 6 test calls)
#        bash run.sh --quick       (official lists + map data only, a few minutes)
#        bash run.sh --states Karnataka,Kerala   (only these states)
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

# Ola Maps key: asked here (typing is hidden) and saved privately on this Mac.
# Asked on --ola-check, or whenever no key is saved yet. Press Enter to keep the saved one.
KEY_FILE="$HOME/.config/ka-ngo-scraper/ola_maps_key"
if [[ " $* " == *" --ola-check "* ]] || { [ ! -s "$KEY_FILE" ] && [ -z "$OLA_MAPS_API_KEY" ]; }; then
  if [ -s "$KEY_FILE" ]; then
    printf "Ola Maps key (press Enter to keep the saved one): "
  else
    printf "Paste your Ola Maps key and press Enter (or just Enter to skip Ola): "
  fi
  read -rs NEW_KEY || NEW_KEY=""
  echo ""
  NEW_KEY="$(printf '%s' "$NEW_KEY" | tr -d '[:space:]')"
  if [ -n "$NEW_KEY" ]; then
    mkdir -p "$(dirname "$KEY_FILE")"
    ( umask 077 && printf '%s\n' "$NEW_KEY" > "$KEY_FILE" )
    chmod 600 "$KEY_FILE"
    echo "Key saved."
  fi
  unset NEW_KEY
fi

# A key check only makes a few requests; keep existing outputs.
if [[ " $* " == *" --ola-check "* ]]; then
  ./.venv/bin/python -m scraper --ola-check
  exit $?
fi

# Remove the previous run's output so old files do not pile up.
find "$OUT" -maxdepth 1 \( -name 'animal-ngos.*' -o -name 'karnataka-animal-ngos.*' -o -name 'awbi-parsed-rows.csv' \) -type f -delete 2>/dev/null || true

./.venv/bin/python -m scraper --out "$OUT" "$@"
open "$OUT/animal-ngos.html" 2>/dev/null || true
