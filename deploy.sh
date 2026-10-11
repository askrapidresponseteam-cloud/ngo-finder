#!/bin/bash
# Publish the website folder (site) to Vercel.
# First run asks you to log in to Vercel in the browser.
set -e
cd "$(dirname "$0")"

echo "Checking the site before publishing..."
python3 check_site.py
if [ -x .venv/bin/python ]; then
  ./.venv/bin/python -m unittest discover -s tests -q
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js is needed for the Vercel CLI. Install it from https://nodejs.org or run: brew install node"
  exit 1
fi

cd site
npx --yes vercel@latest link --yes --project ngo-finder
npx --yes vercel@latest deploy --prod --yes
