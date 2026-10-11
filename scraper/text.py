"""Small text helpers shared by every module."""

import re
import unicodedata

# Long dashes and odd spaces that show up in government PDFs and web pages.
_DASHES = {chr(c): "-" for c in (0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212)}
_SPACES = {chr(0xA0): " ", chr(0x2009): " ", chr(0x200B): "", chr(0xFEFF): ""}

# Words that do not help tell two organisations apart.
_STOP = {
    "the", "of", "and", "for", "a", "an", "in", "trust", "society", "foundation",
    "charitable", "association", "organisation", "organization", "org", "ngo",
    "regd", "registered", "india", "indian", "karnataka", "bangalore", "bengaluru",
    "pvt", "ltd", "sangha", "sangh", "samiti", "seva", "sewa", "centre", "center",
    "welfare", "animal", "animals",
}


def clean(value):
    """Collapse whitespace, swap long dashes for hyphens, strip ends."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKC", str(value))
    for bad, good in _DASHES.items():
        text = text.replace(bad, good)
    for bad, good in _SPACES.items():
        text = text.replace(bad, good)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" ,;")


def name_tokens(name):
    """Significant lowercase tokens of an organisation name."""
    text = clean(name).lower().replace("'", "").replace(chr(0x2019), "")
    text = re.sub(r"\([^)]*\)", " ", text)  # drop (Online), (MH167/2016) etc
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return [t for t in text.split() if t and t not in _STOP and len(t) > 1]


def name_key(name):
    """Key used to spot the same organisation coming from two sources."""
    toks = name_tokens(name)
    if not toks:
        toks = re.sub(r"[^a-z0-9 ]+", " ", clean(name).lower()).split()
    return " ".join(toks)


def token_overlap(a, b):
    """Share of the shorter name's tokens found in the other name (0 to 1)."""
    ta, tb = set(name_tokens(a)), set(name_tokens(b))
    if not ta or not tb:
        return 0.0
    small, big = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return len(small & big) / len(small)
