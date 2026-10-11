"""Free web search (DuckDuckGo HTML, Bing as fallback), no API key.

Used for three things:
  * district by district searches for animal welfare and wildlife groups
  * finding the website of organisations that came from the AWBI list
  * discovering newer AWBI PDF links
Search results are noisy, so anything found only this way is marked
low confidence and "needs review".
"""

import base64
import re
import time
from urllib.parse import parse_qs, unquote, urlparse

from bs4 import BeautifulSoup

from .. import districts
from ..classify import is_relevant, looks_governmental
from ..models import Org
from ..text import clean, token_overlap


class Blocked(Exception):
    pass


SOCIAL = ("facebook.com", "instagram.com", "x.com", "twitter.com")

SKIP_DOMAINS = (
    "justdial.com", "sulekha.com", "indiamart.com", "tradeindia.com",
    "wikipedia.org", "wikimapia.org", "youtube.com", "linkedin.com",
    "thehindu.com", "deccanherald.com", "timesofindia", "indiatimes.com",
    "indianexpress.com", "newindianexpress.com", "ndtv.com",
    "hindustantimes.com", "news18.com", "thebetterindia.com",
    "bangaloremirror", "starofmysore.com", "udayavani.com", "vijaykarnataka",
    "prajavani.net", "deccanchronicle.com", "thenewsminute.com", "scribd.com",
    "quora.com", "reddit.com", "tripadvisor", "zomato.com", "practo.com",
    "mapquest.com", "yelp.", "ngosindia", "guidestarindia", "ketto.org",
    "milaap.org", "give.do", "giveindia.org", "impactguru.com", "gov.in",
    "nic.in", "google.", "bing.com", "duckduckgo.com", "amazon.", "flipkart.",
    "pinterest.", "slideshare.net", "medium.com", "blogspot.", "wordpress.com/tag",
    "glassdoor", "naukri.com", "indeed.", "apps.apple.com", "play.google.com",
    "magicbricks", "housing.com", "99acres", "zaubacorp", "tofler",
    "instamojo", "razorpay", "ngodarpan", "indiafilings", "dialabank",
)

LISTICLE = re.compile(
    r"(\btop\s*\d+|\bbest\b|\blist of\b|\d+\s+(ngos|organi[sz]ations|shelters|"
    r"animal shelters)|\bngos in\b|\bhow to\b|\bwhy\b|\bwhat\b|\?|\bnear me\b|"
    r"\bjobs?\b|\bvacanc|\bnews\b|\bcase\b)",
    re.I)


def _domain(url):
    return (urlparse(url).netloc or "").lower().replace("www.", "")


def skip_url(url):
    d = _domain(url)
    return not d or any(s in d or s in url.lower() for s in SKIP_DOMAINS)


def is_social(url):
    d = _domain(url)
    return any(d == s or d.endswith("." + s) for s in SOCIAL)


def _unwrap(href):
    if not href:
        return ""
    if href.startswith("//"):
        href = "https:" + href
    q = parse_qs(urlparse(href).query)
    if "duckduckgo.com/l/" in href and q.get("uddg"):
        return unquote(q["uddg"][0])
    if "bing.com/ck/a" in href and q.get("u"):
        val = q["u"][0]
        if val.startswith("a1"):
            raw = val[2:] + "=" * (-len(val[2:]) % 4)
            try:
                return base64.urlsafe_b64decode(raw).decode("utf-8", "ignore")
            except Exception:
                return ""
    return href


def parse_ddg(html):
    soup = BeautifulSoup(html, "html.parser")
    if soup.find(string=re.compile(r"anomaly|unusual traffic|captcha", re.I)) and not soup.select("a.result__a"):
        raise Blocked("DuckDuckGo asked for a captcha")
    hits = []
    for res in soup.select("div.result, div.web-result"):
        a = res.select_one("a.result__a")
        if not a:
            continue
        snip = res.select_one(".result__snippet")
        hits.append({
            "title": clean(a.get_text(" ")),
            "url": _unwrap(a.get("href", "")),
            "snippet": clean(snip.get_text(" ")) if snip else "",
        })
    return hits


def parse_bing(html):
    soup = BeautifulSoup(html, "html.parser")
    hits = []
    for li in soup.select("li.b_algo"):
        a = li.select_one("h2 a")
        if not a:
            continue
        snip = li.select_one(".b_caption p, p")
        hits.append({
            "title": clean(a.get_text(" ")),
            "url": _unwrap(a.get("href", "")),
            "snippet": clean(snip.get_text(" ")) if snip else "",
        })
    if not hits and re.search(r"captcha|unusual traffic", html, re.I):
        raise Blocked("Bing asked for a captcha")
    return hits


def parse_ddg_lite(html):
    soup = BeautifulSoup(html, "html.parser")
    links = soup.select("a.result-link")
    if not links and re.search(r"anomaly|unusual traffic|captcha", html, re.I):
        raise Blocked("DuckDuckGo Lite asked for a captcha")
    snips = soup.select("td.result-snippet")
    hits = []
    for i, a in enumerate(links):
        hits.append({"title": clean(a.get_text(" ")), "url": _unwrap(a.get("href", "")),
                     "snippet": clean(snips[i].get_text(" ")) if i < len(snips) else ""})
    return hits


def parse_mojeek(html):
    soup = BeautifulSoup(html, "html.parser")
    hits = []
    for li in soup.select("ul.results-standard li"):
        a = li.select_one("a.title") or li.select_one("h2 a")
        if not a:
            continue
        snip = li.select_one("p.s")
        hits.append({"title": clean(a.get_text(" ")), "url": a.get("href", ""),
                     "snippet": clean(snip.get_text(" ")) if snip else ""})
    if not hits and re.search(r"captcha|automated|blocked", html, re.I):
        raise Blocked("Mojeek blocked the request")
    return hits or parse_generic(html, "mojeek.com")


ENGINE_HOSTS = ("duckduckgo.com", "bing.com", "mojeek.com", "brave.com", "google.", "microsoft.com")


def parse_generic(html, own_host):
    """Fallback for result pages whose layout we do not know: external links
    with a real title, plus the text around them as the snippet."""
    soup = BeautifulSoup(html, "html.parser")
    hits, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = _unwrap(a["href"])
        host = _domain(href)
        title = clean(a.get_text(" "))
        if not href.startswith("http") or not host or own_host in host:
            continue
        if any(e in host for e in ENGINE_HOSTS) or len(title) < 12 or href in seen:
            continue
        seen.add(href)
        box = a.find_parent(["article", "li", "div"])
        snippet = clean(box.get_text(" "))[:300] if box else ""
        hits.append({"title": title, "url": href, "snippet": snippet})
        if len(hits) >= 10:
            break
    return hits


def parse_brave(html):
    soup = BeautifulSoup(html, "html.parser")
    hits = []
    for box in soup.select('div.snippet[data-type="web"], div[data-type="web"]'):
        a = box.select_one("a[href^=http]")
        if not a or "brave.com" in _domain(a["href"]):
            continue
        t = box.select_one(".title, .snippet-title") or a
        d = box.select_one(".snippet-description, .description")
        hits.append({"title": clean(t.get_text(" ")), "url": a["href"],
                     "snippet": clean(d.get_text(" ")) if d else ""})
    if not hits and re.search(r"captcha|are you a robot|rate limit", html, re.I):
        raise Blocked("Brave asked for a captcha")
    return hits or parse_generic(html, "brave.com")


ENGINE_ORDER = ["ddg", "ddg_lite", "mojeek", "brave", "bing"]


class Searcher:
    """Rotates queries across free engines. An engine that blocks us cools
    down for 15 minutes instead of being dropped; when every engine is
    cooling, the searcher waits (up to 30 minutes in total) and carries on."""

    def __init__(self, http, log=print, cache=None, engines=None, max_wait=1800):
        self.http = http
        self.log = log
        self.cache = cache
        self.engines = list(engines or ENGINE_ORDER)
        self.cool = {}
        self.empty = {}
        self.rr = 0
        self.count = 0
        self.errors = []
        self.max_wait = max_wait
        self.waited = 0

    def _fetch(self, engine, query):
        h = self.http
        if engine == "ddg":
            r = h.post("https://html.duckduckgo.com/html/", data={"q": query, "kl": "in-en"}, timeout=30)
            if r.status_code in (202, 403, 429):
                raise Blocked("DuckDuckGo HTTP {}".format(r.status_code))
            return parse_ddg(r.text)
        if engine == "ddg_lite":
            r = h.post("https://lite.duckduckgo.com/lite/", data={"q": query, "kl": "in-en"}, timeout=30)
            if r.status_code in (202, 403, 429):
                raise Blocked("DuckDuckGo Lite HTTP {}".format(r.status_code))
            return parse_ddg_lite(r.text)
        if engine == "mojeek":
            r = h.get("https://www.mojeek.com/search", params={"q": query}, timeout=30)
            if r.status_code in (403, 429):
                raise Blocked("Mojeek HTTP {}".format(r.status_code))
            return parse_mojeek(r.text)
        if engine == "brave":
            r = h.get("https://search.brave.com/search", params={"q": query, "source": "web"}, timeout=30)
            if r.status_code in (403, 429):
                raise Blocked("Brave HTTP {}".format(r.status_code))
            return parse_brave(r.text)
        r = h.get("https://www.bing.com/search", params={"q": query, "cc": "IN", "setlang": "en"}, timeout=30)
        if r.status_code in (403, 429):
            raise Blocked("Bing HTTP {}".format(r.status_code))
        return parse_bing(r.text)

    def _cool(self, engine, seconds, why):
        self.cool[engine] = time.time() + seconds
        self.errors.append("{}: {}".format(engine, why))
        self.log("  search: {} ({}), resting it for {} min".format(engine, why, seconds // 60))

    def search(self, query):
        key = "search:" + query
        if self.cache:
            cached = self.cache.get(key)
            if cached is not None:
                return cached
        while True:
            n = len(self.engines)
            for step in range(n):
                engine = self.engines[(self.rr + step) % n]
                if self.cool.get(engine, 0) > time.time():
                    continue
                try:
                    hits = self._fetch(engine, query)
                except Blocked as err:
                    self._cool(engine, 900, str(err))
                    continue
                except Exception as err:
                    self.errors.append("{} {}: {}".format(engine, query, err))
                    continue
                self.rr = (self.rr + step + 1) % n
                self.count += 1
                if hits:
                    self.empty[engine] = 0
                else:
                    self.empty[engine] = self.empty.get(engine, 0) + 1
                    if self.empty[engine] >= 4:
                        self.empty[engine] = 0
                        self._cool(engine, 3600, "no results 4 times in a row")
                if self.cache:
                    self.cache.put(key, hits)
                return hits
            # Every engine is resting or failed for this query.
            ready = [t for e, t in self.cool.items() if e in self.engines]
            if len(ready) < len(self.engines):
                return []  # some engine answered with an error, not a block
            wait = max(1, min(ready) - time.time())
            if self.waited + wait > self.max_wait:
                raise Blocked("all search engines blocked")
            self.log("  search: all engines resting, waiting {} min".format(int(wait // 60) + 1))
            time.sleep(wait)
            self.waited += wait


HOSTED = ("sites.google.com", "wixsite.com", "weebly.com", "godaddysites.com", "linktr.ee")


def site_root(url):
    """Home page of a result, keeping the path for site builders."""
    p = urlparse(url)
    if any(h in p.netloc for h in HOSTED):
        return url.split("?")[0].split("#")[0]
    return "{0.scheme}://{0.netloc}".format(p)


# Title separators: " | ", " - ", " : ", middle dot, bullet, or "Name: tagline".
SPLIT_RE = re.compile(r"\s+[|\-:" + chr(0xB7) + chr(0x2022) + r"]\s+|\s*\|\s*|:\s+")


def name_from_title(title):
    t = clean(title)
    t = re.sub(r"\s*\(@[^)]*\).*$", "", t)  # Instagram "Name (@handle) ..."
    parts = re.split(SPLIT_RE, t)
    name = parts[0] if parts else t
    name = re.sub(r"\b(home|homepage|official website|welcome to|welcome)\b", " ", name, flags=re.I)
    return clean(name)


def candidates(hits, queried_district):
    """Turn search hits into Org records, discarding obvious noise."""
    out = []
    for h in hits:
        url, title, snippet = h["url"], h["title"], h["snippet"]
        if not url.startswith("http") or skip_url(url):
            continue
        if LISTICLE.search(title):
            continue
        blob = " ".join([title, snippet])
        if not is_relevant(blob):
            continue
        name = name_from_title(title)
        if len(name) < 4 or len(name) > 80 or looks_governmental(name):
            continue
        if is_social(url) and re.match(r"^(facebook|instagram|log in|sign up)\b", name, re.I):
            continue
        found = districts.guess_from_text(title, snippet, url)
        if not found and "karnataka" not in blob.lower():
            continue
        district = found or queried_district
        social = [url] if is_social(url) else []
        out.append(Org(
            name=name,
            source="Web search",
            confidence="low",
            district=district,
            website="" if social else site_root(url),
            social=social,
            source_urls=[url],
            snippet=snippet[:300],
            notes=["Found by web search; confirm it is an NGO and still active"],
        ))
    return out


QUERY_TEMPLATES = [
    "animal welfare rescue NGO {town} Karnataka",
    "wildlife conservation NGO {town} Karnataka",
]
STATEWIDE = [
    "wildlife conservation organisation Karnataka",
    "snake rescue volunteers Karnataka",
    "bird rescue rehabilitation Karnataka",
    "animal shelter trust Karnataka",
    "stray dog rescue trust Karnataka",
]


def district_sweep(searcher, only=None, log=print):
    orgs = []
    targets = [d for d in districts.DISTRICTS if not only or d in only]
    total = len(targets) * len(QUERY_TEMPLATES) + (0 if only else len(STATEWIDE))
    done = 0
    try:
        for d in targets:
            town = districts.SEARCH_TOWN[d]
            for tpl in QUERY_TEMPLATES:
                hits = searcher.search(tpl.format(town=town))
                orgs.extend(candidates(hits, d))
                done += 1
                if done % 10 == 0:
                    log("  web search: {}/{} queries, {} candidates".format(done, total, len(orgs)))
        if not only:
            for q in STATEWIDE:
                orgs.extend(candidates(searcher.search(q), ""))
    except Blocked as err:
        log("  web search stopped early: {}".format(err))
    return orgs


def find_website(searcher, org):
    """Look up an organisation by name and fill website or social links."""
    place = districts.SEARCH_TOWN.get(org.district, org.district or "Karnataka")
    hits = searcher.search('"{}" {}'.format(org.name, place))
    found = False
    for h in hits[:6]:
        url = h["url"]
        if not url.startswith("http") or skip_url(url):
            continue
        if token_overlap(org.name, h["title"]) < 0.6:
            continue
        if is_social(url):
            if url not in org.social:
                org.social.append(url)
            continue
        if not org.website:
            org.website = site_root(url)
            org.notes.append("Website matched by name search; double check")
            found = True
    return found


def find_people(searcher, org):
    """Search for who founded or runs an organisation, from result snippets.

    Only snippets whose title or text clearly refer to this organisation
    are used, and each person keeps the result link as its source.
    """
    from ..people import from_snippet, merge_into

    place = districts.SEARCH_TOWN.get(org.district, org.district or "Karnataka")
    hits = searcher.search('"{}" {} founder OR "managing trustee" OR president'.format(org.name, place))
    added = 0
    for h in hits[:8]:
        about_this = max(token_overlap(org.name, h["title"]), token_overlap(org.name, h["snippet"]))
        if about_this < 0.6:
            continue
        found = from_snippet(h["title"] + ". " + h["snippet"], h["url"], org.name)
        before = len(org.people)
        merge_into(org, found)
        added += len(org.people) - before
    return added
