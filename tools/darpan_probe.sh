#!/bin/bash
# Round 3: the NGO search endpoint and whether it needs a captcha.
set +e
curl -sS --max-time 30 https://ngodarpan.gov.in/ -o index.html
mkdir -p js
for src in $(grep -o '\(src\|href\)="[^"]*\.js"' index.html | sed 's/.*="//; s/"$//'); do
  curl -sS --max-time 60 "https://ngodarpan.gov.in/${src#/}" -o "js/${src##*/}"
done
h() { echo; echo "===== $1 ====="; }

h "all *apis/ strings"
grep -ho '[a-z]*apis/[a-zA-Z0-9/_.-]*' js/*.js | sort -u | head -80

h "context around search-ngo calls"
grep -ho '.\{0,160\}search-ngo.\{0,260\}' js/*.js | head -12

h "context around ngo-details calls"
grep -ho '.\{0,120\}"portal/ngo-details".\{0,200\}' js/*.js | head -6
grep -ho '.\{0,160\}ngoDetails.\{0,200\}' js/*.js | grep -i 'http\|apis\|post\|get' | head -8

h "post/get call paths (http client wrappers)"
grep -ho '\.\(post\|get\)([^)]\{0,120\}' js/*.js | grep -o '"[^"]*"' | sort -u | head -80

h "try master endpoints"
for u in "https://ngodarpan.gov.in/apis/capis/mstr-states" "https://ngodarpan.gov.in/apis/capis/web-counter" "https://ngodarpan.gov.in/apis/capis/sys-id"; do
  echo "--- GET $u"; curl -sS --max-time 20 -o out.txt -w "HTTP %{http_code}, %{size_download} bytes\n" "$u"; head -c 500 out.txt; echo
done

h "try search candidates"
for u in "https://ngodarpan.gov.in/apis/capis/search-ngo" "https://ngodarpan.gov.in/apis/capis/portal/search-ngo" "https://ngodarpan.gov.in/apis/papis/search-ngo"; do
  echo "--- GET $u"; curl -sS --max-time 20 -o out.txt -w "HTTP %{http_code}, %{size_download} bytes\n" "$u"; head -c 300 out.txt; echo
  echo "--- POST $u"; curl -sS --max-time 20 -o out.txt -w "HTTP %{http_code}, %{size_download} bytes\n" -H "Content-Type: application/json" -d '{"ngoName":"almighty"}' "$u"; head -c 300 out.txt; echo
done
echo; echo "probe done"; exit 0
