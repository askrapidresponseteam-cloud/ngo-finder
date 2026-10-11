"""Pre-deploy checks for the website folder. Standard library only.

Run: python3 check_site.py [site folder]
Fails (exit 1) if the data is broken, unsafe, or missing groups that must
always be there.
"""

import json
import os
import re
import sys

SITE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "karnataka-animal-ngos")
DISTRICTS = {
    "Bagalkote", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban",
    "Bengaluru South (Ramanagara)", "Bidar", "Chamarajanagar", "Chikkaballapura",
    "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad",
    "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal",
    "Mandya", "Mysuru", "Raichur", "Shivamogga", "Tumakuru", "Udupi",
    "Uttara Kannada", "Vijayanagara", "Vijayapura", "Yadgir", "Unknown",
}
LONG_DASH = re.compile("[" + "".join(chr(c) for c in (0x2012, 0x2013, 0x2014, 0x2015)) + "]")
MUST_HAVE = [
    # (name or alias, person who must be listed or None)
    ("Compassion Unlimited Plus Action", "Suparna Ganguly"),
    ("PFA Wildlife Hospital", None),
    ("Charlies Animal Rescue Centre (CARE)", None),
    ("People For Animals Mysuru", None),
    ("Ahimsa Animal Care Trust", "Veeranjay Hegde"),
    ("Asare Animal Trust", None),
]

errors = []
for f in ("index.html", "app.js", "styles.css", "vercel.json", "favicon.svg", "data/ngos.json"):
    if not os.path.exists(os.path.join(SITE, f)):
        errors.append("missing file: " + f)
if not errors:
    with open(os.path.join(SITE, "data", "ngos.json"), encoding="utf-8") as fh:
        raw = fh.read()
    data = json.loads(raw)
    orgs = data["orgs"]
    if LONG_DASH.search(raw):
        errors.append("long dash found in data")
    if len(orgs) < 160:
        errors.append("only {} groups; expected at least 160".format(len(orgs)))
    seen = set()
    for o in orgs:
        if o["d"] not in DISTRICTS:
            errors.append("bad district {!r} for {}".format(o["d"], o["n"]))
        key = (o["n"].lower(), o["d"], o["ac"])
        if key in seen:
            errors.append("duplicate: {} ({})".format(o["n"], o["d"]))
        seen.add(key)
        urls = [o["w"], o["m"]] + o["s"] + o["sr"] + [p["u"] for p in o["pp"]]
        for u in urls:
            if u and not re.match(r"^https?://", u):
                errors.append("unsafe link {!r} in {}".format(u, o["n"]))
        if not o["sr"] and not ("Ola Maps" in o["src"] and (o["m"] or o["ad"])):
            errors.append("no source link for " + o["n"])
    for name, person in MUST_HAVE:
        hits = [o for o in orgs if name == o["n"] or name in o["k"]]
        if not hits:
            errors.append("missing must-have group: " + name)
        elif person and not any(person == p["n"] for o in hits for p in o["pp"]):
            errors.append("{} should list {}".format(name, person))

    if any("Ola Maps" in o["src"] for o in orgs) and not data["meta"].get("ola"):
        errors.append("Ola Maps data present but the Ola Maps credit is missing")

if errors:
    print("Site check FAILED:")
    for e in errors[:40]:
        print("  - " + e)
    sys.exit(1)
print("Site check passed: {} groups, {} with named people, {} AWBI recognised.".format(
    len(orgs), sum(1 for o in orgs if o["pp"]), sum(1 for o in orgs if o["ac"])))
