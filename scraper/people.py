"""Find who runs an organisation: founders, trustees, office bearers.

Only names and roles that the organisation itself publishes (its website)
or that appear in search snippets about it. Every person keeps the link
where they were found so it can be checked.
"""

import re

from .text import clean, token_overlap

# Longest first so "Managing Trustee" wins over "Trustee".
ROLES = [
    ("founder and managing trustee", "Founder & Managing Trustee"),
    ("founder & managing trustee", "Founder & Managing Trustee"),
    ("founder trustee", "Founder Trustee"),
    ("managing trustee", "Managing Trustee"),
    ("co-founder", "Co-founder"), ("cofounder", "Co-founder"), ("co founder", "Co-founder"),
    ("founder director", "Founder Director"),
    ("founder president", "Founder President"),
    ("founder", "Founder"),
    ("vice president", "Vice President"), ("vice-president", "Vice President"),
    ("president", "President"),
    ("general secretary", "General Secretary"), ("joint secretary", "Joint Secretary"),
    ("honorary secretary", "Honorary Secretary"), ("secretary", "Secretary"),
    ("treasurer", "Treasurer"),
    ("chairperson", "Chairperson"), ("chairman", "Chairman"), ("chairwoman", "Chairwoman"),
    ("executive director", "Executive Director"), ("managing director", "Managing Director"),
    ("director", "Director"), ("ceo", "CEO"), ("trustee", "Trustee"),
]
_ROLE_MAP = dict(ROLES)
ROLE_RE = "(?i:" + "|".join(re.escape(r) for r, _ in ROLES) + ")"

HONORIFIC = r"(?:Dr|Mr|Mrs|Ms|Smt|Shri|Sri|Col|Capt|Prof|Lt|Maj|Gen)\.?"
TOKEN = r"[A-Z](?:[a-z]+|\.)?"
NAME_RE = r"(?:" + HONORIFIC + r"\s+)?" + TOKEN + r"(?:\s*" + TOKEN + r"){1,4}"

NOT_A_NAME = {
    "animal", "animals", "trust", "society", "foundation", "rescue", "welfare", "care",
    "centre", "center", "team", "our", "about", "contact", "home", "board", "members",
    "member", "volunteer", "volunteers", "india", "karnataka", "bangalore", "bengaluru",
    "read", "more", "meet", "founder", "president", "secretary", "trustee", "trustees",
    "director", "donate", "adopt", "privacy", "policy", "terms", "copyright", "shelter",
    "club", "mission", "vision", "story", "message", "desk", "office", "hospital",
    "clinic", "dear", "hello", "welcome", "governing", "council", "committee",
    "executive", "managing", "general", "joint", "vice", "chief", "officer", "honorary",
    "hon", "patron", "advisory", "the", "and", "for", "with", "from", "this", "that",
    "wildlife", "nature", "conservation", "dogs", "cats", "dog", "cat", "people",
    "news", "events", "gallery", "blog", "login", "sign", "follow", "facebook",
    "instagram", "twitter", "youtube", "whatsapp", "email", "phone", "call", "address",
    "road", "street", "nagar", "layout", "cross", "main", "floor", "post", "mysuru",
    "mysore", "udupi", "mangalore", "mangaluru", "hubli", "district", "state", "city",
    "registered", "reg", "regd", "ngo", "charitable", "association", "organisation",
    "organization", "sangha", "samiti", "seva", "gaushala", "goshala", "panjrapole",
    "chairman", "chairperson", "treasurer", "ceo", "co", "founders", "leadership",
    "all", "rights", "reserved", "powered", "designed", "by", "website", "page",
}

_PATTERNS = [
    # "Sudha Rao, Founder" / "Sudha Rao (Founder)" / "Sudha Rao - Managing Trustee"
    re.compile(r"(?P<name>" + NAME_RE + r")\s*(?:,|\(|-|:|\|)\s*(?i:our\s+|the\s+)?(?P<role>" + ROLE_RE + r")\b"),
    # "Founder: Sudha Rao" / "Managing Trustee - Dr. K. Rao"
    re.compile(r"(?P<role>" + ROLE_RE + r")\s*(?::|-|,)\s*(?P<name>" + NAME_RE + r")"),
    # "founded by Sudha Rao" / "started in 2004 by Sudha Rao"
    re.compile(r"(?i:founded|started|established|set up|begun)\s+(?:in\s+\d{4}\s+)?(?i:by)\s+(?P<name>" + NAME_RE + r")"),
]
# Snippets often say "founder Sudha Rao" with no punctuation.
_SNIPPET_EXTRA = re.compile(r"(?P<role>(?i:founder|managing trustee|president))\s+(?P<name>" + NAME_RE + r")")


def valid_name(name, org_name=""):
    words = clean(name).strip(" ,-").split()
    # Trim words that trail into the next phrase, e.g. "Sudha Rao Read More".
    while words and words[-1].strip(".").lower() in NOT_A_NAME:
        words.pop()
    while words and words[0].strip(".").lower() in NOT_A_NAME:
        words.pop(0)
    name = " ".join(words)
    tokens = [t.strip(".").lower() for t in words if t.strip(".")]
    if len(tokens) < 2:
        return ""
    # Every word must start with a capital letter.
    if any(not w[0].isupper() for w in words):
        return ""
    if any(t in NOT_A_NAME for t in tokens):
        return ""
    # At least one real word, not only initials.
    if not any(len(t) >= 3 for t in tokens):
        return ""
    if org_name and token_overlap(name, org_name) >= 0.6:
        return ""
    if len(name) > 40:
        return ""
    return name


def combine_roles(a, b):
    """'Founder' + 'Founder & Managing Trustee' -> 'Founder & Managing Trustee'.
    A plain 'Trustee' is dropped when 'Managing Trustee' is already there."""
    parts = []
    for r in (a + " & " + b).split(" & "):
        r = r.strip()
        if r and r not in parts:
            parts.append(r)
    keep = [r for r in parts if not any(o != r and o.endswith(" " + r) for o in parts)]
    return " & ".join(keep)


def _role(raw):
    key = re.sub(r"\s+", " ", raw.lower().strip())
    return _ROLE_MAP.get(key, raw.title())


def _add(found, name, role, source, org_name):
    name = valid_name(name, org_name)
    if not name:
        return
    role = _role(role)
    key = re.sub(r"[^a-z]", "", name.lower().replace("dr.", "").replace("dr ", ""))
    for p in found:
        if p["key"] == key:
            p["role"] = combine_roles(p["role"], role)
            return
    found.append({"key": key, "name": name, "role": role, "source": source})


def from_lines(lines, source, org_name=""):
    """People in a list of text blocks (one per HTML block element)."""
    found = []
    lines = [clean(x) for x in lines if clean(x)]
    for i, line in enumerate(lines):
        if len(line) <= 300:
            for pat in _PATTERNS:
                for m in pat.finditer(line):
                    role = m.groupdict().get("role") or "Founder"
                    _add(found, m.group("name"), role, source, org_name)
        # Card layout: a name on one line and only a role on the next.
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if re.fullmatch(NAME_RE, line) and nxt and len(nxt) <= 45:
            m = re.fullmatch(r"(?P<role>" + ROLE_RE + r")(?:\s*(?:&|and|,)\s*" + ROLE_RE + r")?\.?", nxt)
            if m:
                _add(found, line, m.group("role"), source, org_name)
        prev = lines[i - 1] if i else ""
        # "Founder" above "Sudha Rao", unless that role is already the
        # caption of the name card just before it.
        if re.fullmatch(ROLE_RE, line) and nxt and re.fullmatch(NAME_RE, nxt) and \
                not (prev and re.fullmatch(NAME_RE, prev) and valid_name(prev, org_name)):
            _add(found, nxt, line, source, org_name)
    return found


def from_snippet(text, source, org_name=""):
    found = from_lines([text], source, org_name)
    for m in _SNIPPET_EXTRA.finditer(text):
        _add(found, m.group("name"), m.group("role"), source, org_name)
    return found


def _same_person(a, b):
    """Same key, or a one-letter spelling difference (Navaz / Nawaz)."""
    import difflib
    if a == b:
        return True
    return min(len(a), len(b)) >= 8 and difflib.SequenceMatcher(None, a, b).ratio() >= 0.9


def merge_into(org, found, limit=6):
    """Add people to org.people, skipping ones already there."""
    for p in found:
        p.setdefault("key", re.sub(r"[^a-z]", "", p.get("name", "").lower()))
        twin = next((q for q in org.people if _same_person(q.get("key", ""), p["key"])), None)
        if twin:
            twin["role"] = combine_roles(twin["role"], p["role"])
            continue
        if len(org.people) >= limit:
            break
        org.people.append(dict(p))


def label(org):
    return "; ".join("{} ({})".format(p["name"], p["role"]) for p in org.people)
