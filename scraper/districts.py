"""Karnataka districts and the many spellings of their towns."""

import re

DISTRICTS = [
    "Bagalkote", "Ballari", "Belagavi", "Bengaluru Rural", "Bengaluru Urban",
    "Bengaluru South (Ramanagara)", "Bidar", "Chamarajanagar", "Chikkaballapura",
    "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad",
    "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal",
    "Mandya", "Mysuru", "Raichur", "Shivamogga", "Tumakuru", "Udupi",
    "Uttara Kannada", "Vijayanagara", "Vijayapura", "Yadgir",
]

# Search-friendly town name for each district (used for web queries).
SEARCH_TOWN = {
    "Bagalkote": "Bagalkot", "Ballari": "Ballari", "Belagavi": "Belagavi",
    "Bengaluru Rural": "Bengaluru Rural", "Bengaluru Urban": "Bengaluru",
    "Bengaluru South (Ramanagara)": "Ramanagara", "Bidar": "Bidar",
    "Chamarajanagar": "Chamarajanagar", "Chikkaballapura": "Chikkaballapur",
    "Chikkamagaluru": "Chikmagalur", "Chitradurga": "Chitradurga",
    "Dakshina Kannada": "Mangaluru", "Davanagere": "Davangere",
    "Dharwad": "Hubballi Dharwad", "Gadag": "Gadag", "Hassan": "Hassan",
    "Haveri": "Haveri", "Kalaburagi": "Kalaburagi", "Kodagu": "Kodagu Coorg",
    "Kolar": "Kolar", "Koppal": "Koppal", "Mandya": "Mandya", "Mysuru": "Mysuru",
    "Raichur": "Raichur", "Shivamogga": "Shivamogga", "Tumakuru": "Tumakuru",
    "Udupi": "Udupi", "Uttara Kannada": "Karwar", "Vijayanagara": "Hosapete",
    "Vijayapura": "Vijayapura", "Yadgir": "Yadgir",
}

_ALIASES = {
    "bagalkote": ["bagalkot", "ilkal", "badami", "mudhol", "jamkhandi"],
    "ballari": ["bellary", "siruguppa"],
    "vijayanagara": ["hospet", "hosapete", "huvinahadagali", "hagaribommanahalli"],
    "belagavi": ["belgaum", "hukkeri", "gokak", "chikkodi", "athani"],
    "bengaluru urban": ["bangalore", "bengaluru", "banglore", "banagalore",
                        "bangaluru", "bangalore urban", "bengaluru city", "bbmp",
                        "yelahanka", "kengeri", "whitefield", "anekal"],
    "bengaluru rural": ["devanahalli", "doddaballapur", "doddaballapura",
                        "hoskote", "nelamangala", "bangalore rural"],
    "bengaluru south (ramanagara)": ["ramanagara", "ramanagaram", "bengaluru south",
                                     "channapatna", "kanakapura", "magadi"],
    "bidar": ["aurad", "basavakalyan", "humnabad"],
    "chamarajanagar": ["chamrajnagar", "kollegal", "gundlupet"],
    "chikkaballapura": ["chickballapur", "chikkaballapur", "chikballapur",
                        "gauribidanur", "guddibande", "sidlaghatta", "agalagurki"],
    "chikkamagaluru": ["chikmagalur", "chikmangalur", "chickmagalur",
                       "chikkamagalur", "kadur", "tarikere", "sringeri", "mudigere"],
    "chitradurga": ["molakalmur", "hiriyur", "hosadurga"],
    "dakshina kannada": ["mangalore", "mangaluru", "puttur", "bantwal", "sullia",
                         "belthangady", "moodbidri", "ullal", "dakshina kannada district"],
    "davanagere": ["davangere", "harihar", "channagiri"],
    "dharwad": ["hubli", "hubballi", "hubli-dharwad", "hubballi dharwad", "kalghatgi"],
    "gadag": ["gadag-betageri", "ron", "naragund"],
    "hassan": ["arsikere", "sakleshpur", "channarayapatna", "belur"],
    "haveri": ["ranebennur", "savanur", "hangal"],
    "kalaburagi": ["gulbarga", "farhatabad", "sedam", "chincholi"],
    "kodagu": ["coorg", "madikeri", "virajpet", "kushalnagar", "somwarpet"],
    "kolar": ["kgf", "kolar gold fields", "bangarpet", "malur", "mulbagal"],
    "koppal": ["gangavathi", "gangavati", "anegundi", "kushtagi"],
    "mandya": ["nagamangala", "srirangapatna", "maddur", "malavalli", "pandavapura"],
    "mysuru": ["mysore", "t narasipur", "t.narasipur", "nanjangud", "hunsur",
               "hd kote", "h.d. kote", "periyapatna", "bogadi"],
    "raichur": ["sindhanur", "manvi", "lingsugur", "hatti"],
    "shivamogga": ["shimoga", "shivamoga", "sagar", "sagara", "hosanagara",
                   "hosa nagar", "shikaripura", "thirthahalli", "bhadravati"],
    "tumakuru": ["tumkur", "pavagada", "madhugiri", "tiptur", "sira", "kunigal"],
    "udupi": ["manipal", "karkala", "kundapura", "kundapur", "brahmavar", "kapu"],
    "uttara kannada": ["karwar", "sadashivgad", "sirsi", "honnavar", "honnavara",
                       "kumta", "bhatkal", "dandeli", "yellapur", "north kanara"],
    "vijayapura": ["bijapur", "indi", "sindagi"],
    "yadgir": ["yadagiri", "shahapur", "surpur"],
}

_LOOKUP = {}
for _d in DISTRICTS:
    _LOOKUP[_d.lower()] = _d
for _canon, _names in _ALIASES.items():
    _d = next(d for d in DISTRICTS if d.lower() == _canon)
    for _n in _names:
        _LOOKUP[_n] = _d


def _norm(value):
    text = (value or "").lower()
    text = re.sub(r"\b(dist|district|tq|taluk|taluka|tehsil)\b[.\-:]*", " ", text)
    text = re.sub(r"[^a-z. ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip(" .")


def normalise(value):
    """Map a town or district spelling to its official district, or ''."""
    key = _norm(value)
    if not key:
        return ""
    if key in _LOOKUP:
        return _LOOKUP[key]
    # Try every known name as a whole word inside the text, longest first.
    for name in sorted(_LOOKUP, key=len, reverse=True):
        if re.search(r"(^|\s)" + re.escape(name) + r"($|\s)", key):
            return _LOOKUP[name]
    return ""


def guess_from_text(*parts):
    """Best district guess from any mix of address, city, pin text."""
    for part in parts:
        hit = normalise(part)
        if hit:
            return hit
    return ""


# Taluk headquarters and other main towns, used for town-by-town searches.
TALUK_TOWNS = {
    "Bagalkote": ["Bagalkot", "Jamkhandi", "Mudhol", "Badami", "Ilkal", "Hungund", "Bilagi"],
    "Ballari": ["Ballari", "Siruguppa", "Sandur", "Kurugodu"],
    "Belagavi": ["Belagavi", "Gokak", "Chikkodi", "Athani", "Nippani", "Bailhongal", "Ramdurg",
                 "Saundatti", "Khanapur"],
    "Bengaluru Rural": ["Devanahalli", "Doddaballapura", "Hoskote", "Nelamangala"],
    "Bengaluru Urban": ["Anekal", "Yelahanka"],
    "Bengaluru South (Ramanagara)": ["Ramanagara", "Channapatna", "Kanakapura", "Magadi"],
    "Bidar": ["Bidar", "Basavakalyan", "Humnabad", "Bhalki", "Aurad"],
    "Chamarajanagar": ["Chamarajanagar", "Kollegal", "Gundlupet", "Yelandur", "Hanur"],
    "Chikkaballapura": ["Chikkaballapur", "Chintamani", "Gauribidanur", "Sidlaghatta", "Bagepalli"],
    "Chikkamagaluru": ["Chikkamagaluru", "Kadur", "Tarikere", "Mudigere", "Koppa", "Sringeri", "Birur"],
    "Chitradurga": ["Chitradurga", "Hiriyur", "Hosadurga", "Challakere", "Holalkere", "Molakalmuru"],
    "Dakshina Kannada": ["Mangaluru", "Puttur", "Bantwal", "Sullia", "Belthangady", "Moodbidri",
                         "Ullal", "Surathkal", "Kadaba", "Mulki"],
    "Davanagere": ["Davanagere", "Harihar", "Channagiri", "Honnali", "Jagalur"],
    "Dharwad": ["Hubballi", "Dharwad", "Kalghatgi", "Navalgund", "Kundgol"],
    "Gadag": ["Gadag", "Ron", "Nargund", "Mundargi", "Shirahatti", "Lakshmeshwar"],
    "Hassan": ["Hassan", "Arsikere", "Channarayapatna", "Sakleshpur", "Belur", "Holenarasipur", "Arkalgud"],
    "Haveri": ["Haveri", "Ranebennur", "Byadgi", "Hangal", "Savanur", "Shiggaon", "Hirekerur"],
    "Kalaburagi": ["Kalaburagi", "Sedam", "Chincholi", "Aland", "Afzalpur", "Jewargi", "Chittapur", "Wadi"],
    "Kodagu": ["Madikeri", "Virajpet", "Kushalnagar", "Somwarpet", "Gonikoppal"],
    "Kolar": ["Kolar", "Kolar Gold Fields", "Bangarpet", "Malur", "Mulbagal", "Srinivaspur"],
    "Koppal": ["Koppal", "Gangavathi", "Kushtagi", "Yelburga", "Karatagi"],
    "Mandya": ["Mandya", "Maddur", "Malavalli", "Srirangapatna", "Pandavapura", "Nagamangala", "Krishnarajpet"],
    "Mysuru": ["Mysuru", "Nanjangud", "Hunsur", "T Narasipura", "Periyapatna", "Krishnarajanagara",
               "Heggadadevanakote"],
    "Raichur": ["Raichur", "Sindhanur", "Manvi", "Lingsugur", "Devadurga"],
    "Shivamogga": ["Shivamogga", "Bhadravathi", "Sagara", "Shikaripura", "Thirthahalli", "Soraba", "Hosanagara"],
    "Tumakuru": ["Tumakuru", "Tiptur", "Sira", "Madhugiri", "Kunigal", "Gubbi", "Pavagada",
                 "Chikkanayakanahalli"],
    "Udupi": ["Udupi", "Manipal", "Kundapura", "Karkala", "Byndoor", "Brahmavar", "Kapu", "Hebri"],
    "Uttara Kannada": ["Karwar", "Sirsi", "Dandeli", "Haliyal", "Kumta", "Bhatkal", "Honnavar",
                       "Ankola", "Yellapur", "Joida", "Mundgod", "Siddapur"],
    "Vijayanagara": ["Hosapete", "Kudligi", "Hagaribommanahalli", "Harapanahalli", "Hoovina Hadagali"],
    "Vijayapura": ["Vijayapura", "Indi", "Sindagi", "Muddebihal", "Basavana Bagewadi", "Talikota"],
    "Yadgir": ["Yadgir", "Shahapur", "Surapura", "Gurmitkal"],
}

BENGALURU_LOCALITIES = [
    "Whitefield", "Marathahalli", "Sarjapur Road", "HSR Layout", "Koramangala", "Indiranagar",
    "Jayanagar", "JP Nagar", "Banashankari", "Kanakapura Road", "Bannerghatta Road",
    "Electronic City", "Rajarajeshwari Nagar", "Kengeri", "Yeshwanthpur", "Malleshwaram",
    "Hebbal", "Hennur", "KR Puram", "Vijayanagar Bengaluru", "Basavanagudi", "Horamavu",
]

# Make every town resolve to its district as well.
for _d, _towns in TALUK_TOWNS.items():
    for _t in _towns:
        _LOOKUP.setdefault(_t.lower(), _d)
