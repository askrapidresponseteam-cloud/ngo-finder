#!/bin/bash
# Finds how to read NGO Darpan's public data: the SPA's API, and data.gov.in.
# Runs in GitHub Actions (open internet); prints everything it learns.
set -u
h() { echo; echo "===== $1 ====="; }

h "ngodarpan.gov.in index.html"
curl -sS --max-time 30 https://ngodarpan.gov.in/ -o index.html
grep -o '<script[^>]*src="[^"]*"' index.html || true
grep -o '<link[^>]*href="[^"]*\.js[^"]*"' index.html || true
echo "(size: $(wc -c < index.html))"

h "JS bundles: API strings"
for src in $(grep -o 'src="[^"]*\.js[^"]*"' index.html | sed 's/src="//; s/"$//'); do
  case "$src" in http*) url="$src";; /*) url="https://ngodarpan.gov.in$src";; *) url="https://ngodarpan.gov.in/$src";; esac
  echo "--- $url"
  curl -sS --max-time 60 "$url" -o bundle.js || continue
  grep -o 'https\?://[a-zA-Z0-9./_-]*api[a-zA-Z0-9./_-]*' bundle.js | sort -u | head -30
  grep -o '"/[a-zA-Z0-9/_-]*\(ngo\|sector\|state\|search\|list\)[a-zA-Z0-9/_-]*"' bundle.js | sort -u | head -60
  grep -o 'apiUrl[^,;]*\|baseUrl[^,;]*\|API_URL[^,;]*' bundle.js | head -20
done

h "likely endpoints"
for u in "https://ngodarpan.gov.in/api/sector/list" "https://ngodarpan.gov.in/api/home/sectorwise" \
         "https://api.ngodarpan.gov.in/" "https://ngodarpan.gov.in/openapi/"; do
  echo "--- $u"; curl -sS --max-time 20 -o out.txt -w "HTTP %{http_code}, %{size_download} bytes\n" "$u" || true
  head -c 300 out.txt; echo
done

h "data.gov.in catalog: darpan"
K="579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"
curl -sS --max-time 40 "https://api.data.gov.in/lists?format=json&filters%5Btitle%5D=darpan&api-key=$K&limit=50" -o dg.json || true
head -c 2500 dg.json; echo
h "data.gov.in catalog: NGO"
curl -sS --max-time 40 "https://api.data.gov.in/lists?format=json&filters%5Btitle%5D=NGO&api-key=$K&limit=100" -o dg2.json || true
python3 - <<'P' || head -c 2000 dg2.json
import json
d=json.load(open("dg2.json"))
print("total:", d.get("total"))
for r in d.get("records", [])[:100]:
    print(r.get("index_name") or r.get("id"), "|", (r.get("title") or "")[:110])
P
