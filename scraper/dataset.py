"""The verified base dataset shipped with the project.

Two parts, both checked by hand against their sources:
  * data/awbi_karnataka_snapshot.csv: every Karnataka row of the AWBI list
    of recognised organisations (as on 31 Mar 2026)
  * data/researched.json: groups researched from their own websites, news
    coverage and directories, each with source links, plus who runs them

The scraper adds to this; it never needs the network to produce it.
"""

import csv
import json
import os

from .models import Org, merge
from .text import clean

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
SNAPSHOT = os.path.join(HERE, "awbi_karnataka_snapshot.csv")
RESEARCHED = os.path.join(HERE, "researched.json")
ADDITIONS = os.path.join(HERE, "my_additions.csv")
SNAPSHOT_DATE = "31 Mar 2026"
SNAPSHOT_URL = "https://awbi.gov.in/uploads/documents/177608352345Recognition%20List%2031_03_2026_3619.pdf"

# Names people actually use for some AWBI-listed groups.
KNOWN_AKA = {
    "KA001/1965": ["Mysore Pinjrapole Society", "Mysuru Pinjrapole"],
    "KA003/1987": ["Hubli Panjrapole", "Hubballi Panjrapole"],
    "KA004/1993": ["CUPA"],
    "KA014/1999": ["Animal Rights Fund"],
    "KA016/1999": ["PFA Mysore", "People For Animals Mysuru", "People for Animals Mysore"],
    "KA017/1999": ["WRRC", "Bannerghatta Rescue Centre"],
    "KA020/2000": ["CRA"],
    "KA025/2001": ["PFA Bangalore", "PFA Wildlife Hospital", "People for Animals Wildlife Hospital",
                   "People for Animals Bangalore"],
    "KA026/2002": ["PFA Hubli", "People For Animals Hubli", "People For Animals Hubballi"],
    "KA066/2015": ["Sarvodaya Sevabhavi Samstha", "Sarvodaya Vets"],
    "KA067/2018": ["CARE", "Charlie's Animal Rescue Centre"],
    "KA072/2019": ["ROTA", "Reach Out To Animals"],
    "KA085/2023": ["Let's Live Together Charitable Trust", "LLT"],
}


def load_snapshot(path=SNAPSHOT):
    orgs = []
    with open(path, encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            notes = ["AWBI recognised AWO"]
            orgs.append(Org(
                name=r["name"],
                source="AWBI recognised list",
                confidence="high",
                city=r["district"],
                reg_address=r["address"],
                awbi_code=r["code"],
                awbi_valid_upto=r["valid_upto"],
                aka=list(KNOWN_AKA.get(r["code"], [])),
                source_urls=[SNAPSHOT_URL],
                notes=notes,
            ))
    return orgs


def load_researched(path=RESEARCHED):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)
    orgs = []
    for r in rows:
        notes = [clean(r["notes"])] if r.get("notes") else []
        orgs.append(Org(
            name=r["name"],
            source="Researched",
            confidence="medium",
            district=r.get("district", ""),
            city=r.get("area", ""),
            address=r.get("address", ""),
            phones=[clean(p) for p in r.get("phones", []) if clean(p)],
            emails=[clean(e).lower() for e in r.get("emails", []) if clean(e)],
            website=clean(r.get("website", "")),
            social=[clean(s) for s in r.get("social", []) if clean(s)],
            source_urls=[clean(s) for s in r.get("sources", []) if clean(s)],
            notes=notes,
            people=[{"name": clean(p["name"]), "role": clean(p.get("role", "")),
                     "source": clean(p.get("source", ""))} for p in r.get("people", []) if p.get("name")],
            aka=r.get("aka", []),
            categories=r.get("category", []),
        ))
    return orgs


def _split(value):
    return [clean(x) for x in (value or "").split(";") if clean(x)]


def load_additions(path=ADDITIONS):
    """Groups you add yourself (one row each). List fields use ';' between
    items; people are written as Name|Role|Source URL."""
    if not path or not os.path.exists(path):
        return []
    orgs = []
    with open(path, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if not clean(r.get("name")):
                continue
            people = []
            for item in _split(r.get("people")):
                bits = [clean(b) for b in item.split("|")]
                if bits and bits[0]:
                    people.append({"name": bits[0], "role": bits[1] if len(bits) > 1 else "",
                                   "source": bits[2] if len(bits) > 2 else ""})
            orgs.append(Org(
                name=r["name"],
                source="Added by you",
                confidence="medium",
                district=r.get("district", ""),
                city=r.get("area", ""),
                address=r.get("address", ""),
                phones=_split(r.get("phones")),
                emails=[e.lower() for e in _split(r.get("emails"))],
                website=clean(r.get("website")),
                social=_split(r.get("social")),
                source_urls=_split(r.get("sources")),
                notes=[clean(r["notes"])] if clean(r.get("notes")) else [],
                people=people,
                aka=_split(r.get("aka")),
                categories=[c for c in _split(r.get("category")) if c in ("animal", "wildlife", "cattle")],
            ))
    return orgs


def base(additions=ADDITIONS):
    """The merged, verified base dataset."""
    return merge(load_snapshot() + load_researched() + load_additions(additions))
