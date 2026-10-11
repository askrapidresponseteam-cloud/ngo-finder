"""Tag organisations as animal welfare, wildlife or cattle shelter."""

import re

WILDLIFE = [
    "wildlife", "wild life", "conservation", "nature", "forest", "tiger",
    "elephant", "snake", "reptile", "bird", "avian", "turtle", "marine",
    "biodiversity", "wild", "herpet", "raptor", "bat ", "leopard",
]
CATTLE = [
    "gau", "gow", "go ", "goshala", "gaushala", "goushala", "gosamrakshana",
    "gorakshana", "go rakshana", "gauraksha", "goraksha", "panjrapole",
    "panjarapole", "pinjarapole", "panjarpol", "cow", "govardhan", "gokula",
    "kamadhenu", "nandi", "punyakoti", "punnyakoti", "govamsha", "govansha",
]
ANIMAL = [
    "animal", "spca", "s.p.c.a", "blue cross", "pet", "dog", "canine", "cat ",
    "stray", "rescue", "prani", "jeev", "jeeva", "karuna", "compassion",
    "cruelty", "veterinary", "vety", "voiceless", "paws", "furry", "shelter",
    "humane", "pfa", "people for animals", "horse", "donkey", "thoroughbred",
]

CATEGORY_LABELS = {
    "animal": "Animal welfare",
    "wildlife": "Wildlife / conservation",
    "cattle": "Gaushala / cattle shelter",
}


def _has(text, words):
    for w in words:
        # A trailing space in the word list means "whole word only".
        pattern = r"(?<![a-z])" + re.escape(w.strip())
        if w.endswith(" "):
            pattern += r"(?![a-z])"
        if re.search(pattern, text):
            return True
    return False


def categories(*texts):
    """Return a list of category keys that match the given texts."""
    text = " ".join(t for t in texts if t).lower()
    text = re.sub(r"[^a-z.& ]+", " ", text)
    found = []
    if _has(text, ANIMAL):
        found.append("animal")
    if _has(text, WILDLIFE):
        found.append("wildlife")
    if _has(text, CATTLE):
        found.append("cattle")
    return found


def label(keys):
    return ", ".join(CATEGORY_LABELS[k] for k in keys) if keys else "Unclear"


def is_relevant(*texts):
    return bool(categories(*texts))


GOVT_WORDS = [
    "municipal", "corporation", "palike", "panchayat", "panchayath",
    "department", "polyclinic", "veterinary hospital", "govt", "government",
    "nagara sabhe", "city municipal", "town municipal", "mahanagara",
    "bbmp", "abc centre", "abc center",
]


def looks_governmental(name):
    low = (name or "").lower()
    return any(w in low for w in GOVT_WORDS)
