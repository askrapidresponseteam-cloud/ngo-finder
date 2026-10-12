#!/bin/bash
# Round 2: find NPO Darpan's API base and its search endpoints inside the JS bundles.
set +e
h() { echo; echo "===== $1 ====="; }
curl -sS --max-time 30 https://ngodarpan.gov.in/ -o index.html
mkdir -p js
for src in $(grep -o '\(src\|href\)="[^"]*\.js"' index.html | sed 's/.*="//; s/"$//'); do
  curl -sS --max-time 60 "https://ngodarpan.gov.in/${src#/}" -o "js/${src##*/}"
done
ls -la js

h "APIUrl and environment URLs"
grep -ho 'APIUrl[^,};]*' js/*.js | sort -u | head
grep -ho '[A-Za-z]*Url:"[^"]*"' js/*.js | sort -u | head -30
grep -ho 'https://[a-zA-Z0-9.-]*gov\.in[a-zA-Z0-9/._-]*' js/*.js | sort -u | head -30

h "capis paths"
grep -ho '"capis/[^"]*"' js/*.js | sort -u | head -60
grep -ho "'capis/[^']*'" js/*.js | sort -u | head -60
grep -ho 'capis/[a-zA-Z0-9/_-]*' js/*.js | sort -u | head -80

h "search / sector / state strings near http calls"
grep -ho '"[a-zA-Z0-9/_-]*\(search\|Search\|sector\|Sector\|state\|State\|ngo\|Ngo\|NGO\)[a-zA-Z0-9/_-]*"' js/*.js | sort -u | head -80

h "try obvious capis endpoints"
for u in "https://ngodarpan.gov.in/capis/resources/circular" ; do
  echo "--- $u"; curl -sS --max-time 20 -o out.txt -w "HTTP %{http_code}, %{size_download} bytes\n" "$u"; head -c 400 out.txt; echo
done
echo; echo "probe done"; exit 0
