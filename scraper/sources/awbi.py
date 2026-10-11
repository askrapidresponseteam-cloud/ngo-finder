"""Animal Welfare Board of India (AWBI) lists.

AWBI publishes two PDFs that matter here:
  1. The master list of recognised Animal Welfare Organisations (AWOs).
  2. The list of AWOs granted ABC (Animal Birth Control) project recognition.

The file names change with every update, so we try known links, then look
for newer ones with a web search, and always accept a local PDF path too.
Parsing tries three methods (ruled tables, column positions, flat text) and
keeps whichever finds the most rows.
"""

import io
import re
from datetime import date

import pdfplumber

from ..models import Org
from ..text import clean

BASE = "https://awbi.gov.in/uploads/documents/"

KNOWN_RECOGNITION_PDFS = [
    BASE + "177608352345Recognition%20List%2031_03_2026_3619.pdf",
    BASE + "175750190730List%20of%20Recognised%20Organisation%20as%20on%2031%20Aug%202025_compressed.pdf",
]
KNOWN_ABC_PDFS = [
    BASE + "178271834413List%20of%20AWOs%20Municipal%20Corporations%20Granted%20ABC%20PR29.pdf",
    "https://www.awbi.gov.in/uploads/documents/171585361206List%20of%20AWOs%20recognized%20for%20ABC_16052024.pdf",
]

STATES = [
    "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
    "Chattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
    "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
    "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Orissa", "Punjab",
    "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "Uttaranchal", "West Bengal", "Delhi",
    "New Delhi", "Chandigarh", "Puducherry", "Pondicherry", "Ladakh",
    "Jammu & Kashmir", "Jammu and Kashmir", "Andaman & Nicobar",
    "Andaman and Nicobar", "Lakshadweep", "Dadra & Nagar Haveli",
    "Daman & Diu", "Daman and Diu",
]
_STATE_SET = {s.lower() for s in STATES}
_STATE_RE = "|".join(re.escape(s) for s in sorted(STATES, key=len, reverse=True))

CODE_RE = re.compile(r"\b([A-Z]{2})\s?(\d{3})\s?/\s?(\d{4})\b")
DATE_RE = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b")
TITLE_RE = re.compile(r"^\s*List of (Animal|AWO)", re.I)

TARGET_STATE = "karnataka"


# ---------------------------------------------------------------- helpers

def _code(text):
    m = CODE_RE.search(text or "")
    return "{}{}/{}".format(*m.groups()) if m else ""


def _state_index(cells):
    # Rightmost match, so a district like "New Delhi" next to state "Delhi"
    # does not get mistaken for the state column.
    found = None
    for i, cell in enumerate(cells):
        if clean(cell).lower() in _STATE_SET:
            found = i
    return found


def _strip_code_bits(name):
    """'Sneh Animal Welfare (Offline) (HR337/2021)' -> 'Sneh Animal Welfare'."""
    name = re.sub(r"\((?:[^)]*\d{3}/\d{4}[^)]*|\s*(?:offline|online)\s*)\)", " ", name, flags=re.I)
    name = CODE_RE.sub(" ", name)
    name = re.sub(r"\(\s*\)", " ", name)
    return clean(name.rstrip(", "))


def _dates(cells):
    found = []
    for c in cells:
        m = DATE_RE.search(c or "")
        found.append("{:0>2}.{:0>2}.{}".format(*m.groups()) if m else "")
    return found


def _row(name, address, district, state, tail, code, method):
    dates = _dates(tail)
    return {
        "name": _strip_code_bits(clean(name)),
        "address": clean(address),
        "district": clean(district),
        "state": clean(state),
        "code": code or _code(name),
        "recognised": dates[0] if len(dates) > 0 else "",
        "renewed": dates[1] if len(dates) > 1 else "",
        "valid_upto": dates[-1] if len(dates) > 2 else (dates[1] if len(dates) == 2 else ""),
        "method": method,
    }


# ---------------------------------------------------- method 1: ruled tables

def rows_from_tables(pdf):
    rows = []
    for page in pdf.pages:
        try:
            tables = page.extract_tables()
        except Exception:
            continue
        for table in tables:
            for raw in table:
                cells = [clean(c) for c in raw]
                s = _state_index(cells)
                if s is None or s < 3:
                    continue
                rows.append(_row(cells[s - 3], cells[s - 2], cells[s - 1],
                                 cells[s], cells[s + 1:], _code(" ".join(cells[:s])),
                                 "table"))
    return rows


# ------------------------------------------- method 2: column x positions

_HEADER_KEYS = [
    ("name", re.compile(r"^name$", re.I)),
    ("address", re.compile(r"^(address|details)$", re.I)),
    ("district", re.compile(r"^district$", re.I)),
    ("state", re.compile(r"^state$", re.I)),
]


def _lines(words, tol=2.5):
    """Group words into text lines by their top coordinate."""
    lines = []
    for w in sorted(words, key=lambda w: (round(w["top"]), w["x0"])):
        for line in lines:
            if abs(line[0]["top"] - w["top"]) <= tol:
                line.append(w)
                break
        else:
            lines.append([w])
    return lines


_SERIAL = re.compile(r"^\d{1,4}\.?$")


def _keyword_count(line):
    keys = set()
    for w in line:
        for key, pat in _HEADER_KEYS:
            if pat.match(w["text"]):
                keys.add(key)
    return len(keys)


def _header_blocks(lines, name_x):
    """Find every header block on a page.

    A block is the keyword line plus neighbouring lines that sit within a
    small vertical gap, stopping at any line that holds a row serial number.
    Returns a list of (set of line indexes, keyword line index).
    """
    blocks = []

    def is_data(line):
        return any(_SERIAL.match(w["text"]) and w["x1"] <= name_x + 1 for w in line)

    for i, line in enumerate(lines):
        if _keyword_count(line) < 2 or any(i in b for b, _ in blocks):
            continue
        block = {i}
        j = i
        while j + 1 < len(lines) and not is_data(lines[j + 1]) and \
                lines[j + 1][0]["top"] - max(w["bottom"] for w in lines[j]) <= 3.5:
            j += 1
            block.add(j)
        j = i
        while j - 1 >= 0 and not is_data(lines[j - 1]) and \
                not TITLE_RE.match(" ".join(w["text"] for w in lines[j - 1])) and \
                lines[j][0]["top"] - max(w["bottom"] for w in lines[j - 1]) <= 3.5:
            j -= 1
            block.add(j)
        blocks.append((block, i))
    return blocks


def _columns(header_words, hits):
    """Rough column edges from the header, plus the range each edge may move in."""
    lefts, ranges = {}, {}
    for key in ("name", "address", "district", "state"):
        kw = hits[key]
        before = [w["x1"] for w in header_words if w["x1"] <= kw["x0"] + 0.5]
        lo = max(before) if before else kw["x0"] - 40
        lefts[key] = (lo + kw["x0"]) / 2
        ranges[key] = (lo, kw["x0"])
    after = [w for w in header_words
             if w["x0"] > hits["state"]["x1"] and re.match(r"^date|^valid", w["text"], re.I)]
    if after:
        first = min(after, key=lambda w: w["x0"])
        lefts["tail"] = (hits["state"]["x1"] + first["x0"]) / 2
        ranges["tail"] = (hits["state"]["x1"], first["x0"])
    lefts["_ranges"] = ranges
    return lefts


def _refine(lefts, data_words):
    """Move each edge to the x with the fewest words crossing it.

    Works whether headers are left aligned or centred, because data words
    never cross the real gap between two columns.
    """
    ranges = lefts.pop("_ranges", {})
    if len(data_words) < 20:
        return lefts
    for key, (lo, hi) in ranges.items():
        lo, hi = min(lo, hi), max(lo, hi)
        best_x, best_n = lefts[key], None
        x = lo
        while x <= hi + 0.01:
            n = sum(1 for w in data_words if w["x0"] < x < w["x1"])
            if best_n is None or n <= best_n:
                best_x, best_n = x, n
            x += 0.5
        lefts[key] = best_x
    return lefts


def _h_rules(page):
    ys = []
    width = float(page.width)
    for ln in list(page.lines) + list(page.rects):
        if abs(ln["top"] - ln["bottom"]) < 2 and (ln["x1"] - ln["x0"]) > width * 0.4:
            ys.append(round(float(ln["top"]), 1))
    return sorted(set(ys))


def rows_from_layout(pdf):
    rows = []
    lefts = None
    for page in pdf.pages:
        words = page.extract_words(x_tolerance=1.5, y_tolerance=2)
        if not words:
            continue
        lines = _lines(words)
        # Column edges come from the first header seen; later pages reuse them.
        kw_lines = [ln for ln in lines if _keyword_count(ln) >= 2]
        if kw_lines and lefts is None:
            hits = {}
            first_top = kw_lines[0][0]["top"]
            near = [w for w in words if first_top - 20 <= w["top"] <= first_top + 30]
            for key, pat in _HEADER_KEYS:
                cand = [w for w in near if pat.match(w["text"])]
                if cand:
                    hits[key] = min(cand, key=lambda w: w["top"])
            if len(hits) == 4:
                probe = {"name": hits["name"]["x0"]}
                blocks = _header_blocks(lines, probe["name"])
                hdr_words = [w for b, _ in blocks[:1] for idx in b for w in lines[idx]]
                lefts = _columns(hdr_words or near, hits)
        if lefts is None:
            continue
        drop = set()
        for block, _ in _header_blocks(lines, lefts["name"]):
            drop |= block
        keep = []
        header_bottom = 0.0
        for idx, line in enumerate(lines):
            text = " ".join(w["text"] for w in line)
            if idx in drop:
                header_bottom = max(header_bottom, max(w["bottom"] for w in line))
                continue
            if TITLE_RE.match(text):
                continue
            keep.extend(line)
        if "_ranges" in lefts:
            lefts = _refine(lefts, keep)
        anchors = sorted((w for w in keep if w["x1"] <= lefts["name"] + 1 and _SERIAL.match(w["text"])),
                         key=lambda w: w["top"])
        if not anchors:
            continue
        # Words of a header or title never belong to a row; rows also never
        # straddle a header, so split anchors into groups at header blocks.
        barriers = sorted({max(w["bottom"] for w in lines[i]) for i in drop} |
                          {min(w["top"] for w in lines[i]) for i in drop})
        rules = _h_rules(page)
        bounds = []
        for i, a in enumerate(anchors):
            mid = (a["top"] + a["bottom"]) / 2
            above = [y for y in rules if y <= a["top"]]
            below = [y for y in rules if y >= a["bottom"]]
            if rules and above and below:
                bounds.append((above[-1], below[0]))
                continue
            prev = anchors[i - 1] if i else None
            nxt = anchors[i + 1] if i + 1 < len(anchors) else None
            top = (((prev["top"] + prev["bottom"]) / 2) + mid) / 2 if prev else 0.0
            bottom = (mid + ((nxt["top"] + nxt["bottom"]) / 2)) / 2 if nxt else float(page.height)
            for y in barriers:
                if top < y <= a["top"]:
                    top = y
                if a["bottom"] <= y < bottom:
                    bottom = y
            bounds.append((top, bottom))
        edges = [("name", lefts["name"]), ("address", lefts["address"]),
                 ("district", lefts["district"]), ("state", lefts["state"])]
        if "tail" in lefts:
            edges.append(("tail", lefts["tail"]))
        for top, bottom in bounds:
            cells = {k: [] for k in ("pre", "name", "address", "district", "state", "tail")}
            for w in keep:
                cy = (w["top"] + w["bottom"]) / 2
                if not (top <= cy < bottom):
                    continue
                col = "pre"
                for key, left in edges:
                    if w["x0"] >= left - 0.5:
                        col = key
                cells[col].append(w)
            text = {k: " ".join(x["text"] for x in sorted(v, key=lambda w: (round(w["top"]), w["x0"])))
                    for k, v in cells.items()}
            state = text["state"]
            if "tail" not in lefts:
                m = re.match(r"^(" + _STATE_RE + r")\b(.*)$", state, re.I)
                if m:
                    state, text["tail"] = m.group(1), m.group(2)
            if clean(state).lower() not in _STATE_SET:
                continue
            rows.append(_row(text["name"], text["address"], text["district"], state,
                             text["tail"].split(), _code(text["pre"] + " " + text["name"]),
                             "layout"))
    return rows


# --------------------------------------------------- method 3: flat text

_ADDR_START = re.compile(
    r"^(\d|#|no\b|no\.|c/o|h\.?\s?no|sy\b|sy\.|survey|plot|door|vill|village|"
    r"post|po\b|p\.o|at\b|opp|near|nr\.|door|flat|room|shop|unit of|ward|"
    r"\"|r/o|ho\b|vpo|apo|main|cross|ring|nh)",
    re.I)


def rows_from_text(pdf):
    raw_lines = []
    for page in pdf.pages:
        for line in (page.extract_text() or "").splitlines():
            if TITLE_RE.match(line):
                continue
            raw_lines.append(line)
    # A record starts with the next serial number.
    records, current, expect = [], None, 1
    for line in raw_lines:
        m = re.match(r"^\s*(\d{1,4})\.?\s+(.*)$", line)
        if m and int(m.group(1)) == expect:
            if current:
                records.append(current)
            current, expect = [m.group(2)], expect + 1
        elif current is not None:
            current.append(line)
    if current:
        records.append(current)

    state_line = re.compile(
        r"^(?P<pre>.*?)\s*(?P<state>" + _STATE_RE + r")\s*(?P<tail>(N/?A|N\.A|\d{1,2}[./-]).*)?$",
        re.I)
    rows = []
    for rec in records:
        code = _code(rec[0])
        first = CODE_RE.sub(" ", rec[0]).replace("(Online)", " ").replace("(Offline)", " ")
        lines = [clean(first)] + [clean(x) for x in rec[1:]]
        lines = [x for x in lines if x]
        st_idx, m = None, None
        for i in range(len(lines) - 1, -1, -1):
            m = state_line.match(lines[i])
            if m:
                st_idx = i
                break
        if st_idx is None:
            continue
        pre = m.group("pre")
        # District is the trailing words after the last digit or comma.
        parts = re.split(r"[,\d]", pre)
        district = clean(parts[-1]) if parts else ""
        lead = clean(pre[: len(pre) - len(parts[-1])]) if parts and parts[-1] else clean(pre)
        body = lines[:st_idx] + ([lead] if lead else [])
        joined = " ".join(body)
        name, address = joined, ""
        tokens = joined.split(" ")
        for i, tok in enumerate(tokens):
            if i and _ADDR_START.match(tok):
                name, address = " ".join(tokens[:i]), " ".join(tokens[i:])
                break
        else:
            if len(body) > 1:
                name, address = body[0], " ".join(body[1:])
        rows.append(_row(name, address, district, m.group("state"),
                         (m.group("tail") or "").split(), code, "text"))
    return rows


# ---------------------------------------------------------------- parsing

def parse_pdf(data):
    """Parse an AWBI PDF (bytes or path). Returns (rows, method, counts)."""
    src = io.BytesIO(data) if isinstance(data, (bytes, bytearray)) else data
    with pdfplumber.open(src) as pdf:
        results = {}
        for label, fn in (("table", rows_from_tables), ("layout", rows_from_layout),
                          ("text", rows_from_text)):
            try:
                results[label] = fn(pdf)
            except Exception as err:  # keep going with the other methods
                results[label] = []
                results[label + "_error"] = str(err)

    def score(rows):
        good = [r for r in rows if r["name"] and r["state"].lower() in _STATE_SET]
        return len(good)

    counts = {k: score(v) for k, v in results.items() if not k.endswith("_error")}
    best = max(("table", "layout", "text"), key=lambda k: counts[k])
    return results[best], best, counts


def karnataka_rows(rows):
    return [r for r in rows if r["state"].lower() == TARGET_STATE]


def _lapsed(valid_upto):
    m = DATE_RE.search(valid_upto or "")
    if not m:
        return False
    d, mo, y = (int(x) for x in m.groups())
    try:
        return date(y, mo, d) < date.today()
    except ValueError:
        return False


def to_orgs(rows, list_kind, source_url):
    from ..classify import looks_governmental

    orgs = []
    for r in rows:
        if not r["name"]:
            continue
        if list_kind == "abc" and looks_governmental(r["name"]):
            continue  # municipal ABC centres are not NGOs
        notes = []
        if list_kind == "recognised":
            notes.append("AWBI recognised AWO")
            if _lapsed(r["valid_upto"]):
                notes.append("AWBI recognition 'valid upto' date has passed")
        else:
            notes.append("AWBI ABC (animal birth control) project holder")
            if r["address"]:
                notes.append("ABC centre: " + r["address"])
        if r["method"] == "text":
            notes.append("Parsed from flat PDF text; check the name/address split")
        orgs.append(Org(
            name=r["name"],
            source="AWBI recognised list" if list_kind == "recognised" else "AWBI ABC list",
            confidence="high",
            city=r["district"],
            address=r["address"] if list_kind == "recognised" else "",
            awbi_code=r["code"],
            awbi_valid_upto=r["valid_upto"] if list_kind == "recognised" else "",
            source_urls=[source_url] if source_url else [],
            notes=notes,
        ))
    return orgs


# ----------------------------------------------------------- downloading

def _stamp(url):
    m = re.search(r"/documents/(\d{10,})", url)
    return int(m.group(1)[:10]) if m else 0


def discover(search, kind):
    """Find newer AWBI PDF links through the web search source."""
    query = {
        "recognised": 'site:awbi.gov.in "Recognition List" OR "List of Recognised Organisation" pdf',
        "abc": 'site:awbi.gov.in "Granted ABC" Project Recognition pdf',
    }[kind]
    try:
        hits = search(query)
    except Exception:
        return []
    urls = []
    for h in hits:
        u = h.get("url", "")
        if "awbi.gov.in" in u and u.lower().endswith(".pdf") and "/documents/" in u:
            urls.append(u.replace(" ", "%20"))
    return urls


def fetch(http, kind, local_paths=(), search=None, log=print):
    """Return Karnataka Org records for one list kind, plus a log dict."""
    known = KNOWN_RECOGNITION_PDFS if kind == "recognised" else KNOWN_ABC_PDFS
    candidates = []
    if search:
        candidates.extend(discover(search, kind))
    candidates.extend(known)
    seen, ordered = set(), []
    for u in sorted(candidates, key=_stamp, reverse=True):
        if u not in seen:
            seen.add(u)
            ordered.append(u)

    attempts = [("local", p) for p in local_paths] + [("url", u) for u in ordered]
    info = {"kind": kind, "tried": [], "used": "", "method": "", "rows": 0, "karnataka": 0}
    for how, where in attempts:
        try:
            if how == "local":
                with open(where, "rb") as fh:
                    data = fh.read()
            else:
                resp = http.get(where, timeout=90)
                if resp.status_code != 200 or not resp.content.startswith(b"%PDF"):
                    info["tried"].append("{} (HTTP {})".format(where, resp.status_code))
                    continue
                data = resp.content
            rows, method, counts = parse_pdf(data)
            ka = karnataka_rows(rows)
            info["tried"].append("{} (parsed {} rows via {}, scores {})".format(where, len(rows), method, counts))
            if len(ka) >= 3:
                info.update(used=where, method=method, rows=len(rows), karnataka=len(ka))
                log("  AWBI {}: {} Karnataka rows from {} ({} method)".format(kind, len(ka), where, method))
                return to_orgs(ka, kind, where if how == "url" else ""), info, rows
        except Exception as err:
            info["tried"].append("{} (error: {})".format(where, err))
    log("  AWBI {}: could not get a usable PDF. Tried: {}".format(kind, "; ".join(info["tried"]) or "nothing"))
    return [], info, []
