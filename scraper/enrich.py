"""Visit each organisation's website and pull out contact details."""

import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

from .sources.websearch import is_social

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
BAD_EMAIL = re.compile(r"\.(png|jpe?g|gif|svg|webp)$|@example\.(com|org|in)$|sentry|wixpress|"
                       r"@domain|yourname|email@|name@", re.I)
# Indian mobiles (with or without +91/0) and STD landlines like 080 2345 6789.
PHONE_RE = re.compile(
    r"(?<![\d])(?:\+?91[\s\-.]?|0)?[6-9]\d{4}[\s\-.]?\d{5}(?![\d])|"
    r"(?<![\d])0\d{2,4}[\s\-.]?\d{6,8}(?![\d])")
CONTACT_HINT = re.compile(r"contact|reach|get in touch|about", re.I)


def norm_phone(raw):
    """Format Indian numbers: mobiles as +91 98450 12345, landlines as 0820 2571234."""
    text = raw.strip()
    digits = re.sub(r"\D", "", text)
    if digits.startswith("91") and len(digits) == 12:
        return "+91 {} {}".format(digits[2:7], digits[7:]) if digits[2] in "6789" else ""
    if len(digits) == 10 and digits[0] in "6789":
        return "+91 {} {}".format(digits[:5], digits[5:])
    if len(digits) == 11 and digits.startswith("0"):
        # 0 + mobile written as 098450 12345, otherwise an STD landline.
        if digits[1] in "6789" and re.match(r"^0[6-9]\d{4}[\s\-.]?\d{5}$", text):
            return "+91 {} {}".format(digits[1:6], digits[6:])
        m = re.match(r"^(0\d{2,4})[\s\-.]+(\d{6,8})$", text)
        return "{} {}".format(*m.groups()) if m else digits
    return ""


BLOCKS = ["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th", "div", "section",
          "article", "figcaption", "dt", "dd", "address", "blockquote", "header", "footer"]
ABOUT_HINT = re.compile(r"about|team|founder|trustee|who[ -]?we[ -]?are|our[ -]?people|"
                        r"board|our[ -]?story|governing|leadership|committee", re.I)


def page_lines(soup):
    """Text of the page split at block elements, so a card's name and role
    stay on separate lines but "<b>Sudha</b> Rao" stays one line."""
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for tag in soup.find_all(BLOCKS):
        tag.insert_before("\n")
        tag.insert_after("\n")
    return [ln.strip() for ln in soup.get_text(" ").split("\n") if ln.strip()]


def extract(html, base_url):
    """Return a dict of emails, phones, social, contact page, about pages, text lines."""
    soup = BeautifulSoup(html, "html.parser")
    emails, phones, social = [], [], []
    contact_url, about_urls = "", []
    host = urlparse(base_url).netloc
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if href.lower().startswith("mailto:"):
            emails.append(href[7:].split("?")[0])
        elif href.lower().startswith("tel:"):
            phones.append(href[4:])
        elif href.startswith("http") and is_social(href):
            social.append(href.split("?")[0].rstrip("/"))
        else:
            label = (a.get_text(" ") or "") + " " + href
            target = urljoin(base_url, href).split("#")[0]
            if urlparse(target).netloc != host:
                continue
            if not contact_url and re.search(r"contact", label, re.I):
                contact_url = target
            elif ABOUT_HINT.search(label) and target not in about_urls:
                about_urls.append(target)
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    lines = page_lines(soup)
    text = " ".join(lines)
    emails.extend(EMAIL_RE.findall(text))
    phones.extend(PHONE_RE.findall(text))

    def uniq(items, fn=lambda x: x):
        out = []
        for i in items:
            v = fn(i)
            if v and v not in out:
                out.append(v)
        return out

    return {
        "emails": uniq(emails, lambda e: "" if BAD_EMAIL.search(e) else e.strip(".").lower()),
        "phones": uniq(phones, norm_phone),
        "social": uniq(social),
        "contact": contact_url,
        "about": about_urls[:2],
        "lines": lines,
    }


def enrich(http, org, log=print):
    """Fill emails, phones, social links and the people who run it,
    reading the home page, contact page and up to two about/team pages."""
    if not org.website or is_social(org.website):
        return False
    from .people import from_lines, merge_into

    pages = [org.website]
    seen = set()
    changed = False
    while pages and len(seen) < 4:
        url = pages.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            resp = http.get(url, timeout=20, retries=0)
        except Exception as err:
            if url == org.website:
                org.notes.append("Website did not load: {}".format(type(err).__name__))
                return changed
            continue
        if resp.status_code >= 400 or "html" not in resp.headers.get("Content-Type", "html"):
            if url == org.website:
                org.notes.append("Website returned HTTP {}".format(resp.status_code))
            continue
        info = extract(resp.text, resp.url or url)
        for attr in ("emails", "phones", "social"):
            mine = getattr(org, attr)
            for v in info[attr][:4]:
                if v not in mine:
                    mine.append(v)
                    changed = True
        found = from_lines(info["lines"], resp.url or url, org.name)
        if found:
            before = len(org.people)
            merge_into(org, found)
            changed = changed or len(org.people) != before
        for nxt in [info["contact"]] + info["about"]:
            if nxt and nxt not in seen and nxt not in pages:
                pages.append(nxt)
    return changed
