"""Command line entry point: python -m scraper [options]"""

import argparse
import os
import sys
import time
from datetime import datetime

from . import __version__, dataset, districts, geo
from .enrich import enrich
from .export import write
from .lookup_page import build_site, write_html
from .models import merge
from .net import Http
from .sources import awbi, google_places, ola_places, osm, websearch
from .text import clean


PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DIR = os.path.join(PROJECT, "site")
OUT_NAME = "animal-ngos"


def build_args(argv=None):
    p = argparse.ArgumentParser(
        prog="ka-ngo-scraper",
        description="Find animal welfare and wildlife NGOs in Karnataka.")
    p.add_argument("--out", default=os.path.expanduser("~/Desktop"),
                   help="folder for the Excel and CSV output (default: Desktop)")
    p.add_argument("--site-dir", default=SITE_DIR,
                   help="website folder to rebuild (default: the site folder)")
    p.add_argument("--states", default="",
                   help="comma separated states to cover, e.g. Karnataka,Kerala (default: all of India)")
    p.add_argument("--lookup-max", type=int, default=800,
                   help="most groups to look up a website for in one run (results are cached)")
    p.add_argument("--people-max", type=int, default=600,
                   help="most groups to search for who runs them in one run")
    p.add_argument("--workers", type=int, default=12, help="websites read at the same time")
    p.add_argument("--quick", action="store_true",
                   help="skip web search and website visits (AWBI + OpenStreetMap only, ~1 min)")
    p.add_argument("--no-web", action="store_true", help="skip the district web searches")
    p.add_argument("--no-enrich", action="store_true", help="do not visit websites for contacts")
    p.add_argument("--no-find-websites", action="store_true",
                   help="do not search for websites of AWBI-listed groups")
    p.add_argument("--ola-key", default="",
                   help="Ola Maps API key (or save it in ~/.config/ka-ngo-scraper/ola_maps_key)")
    p.add_argument("--ola-max", type=int, default=90000,
                   help="most Ola Maps requests per calendar month (free tier is 100,000)")
    p.add_argument("--no-ola", action="store_true", help="skip the Ola Maps sweep")
    p.add_argument("--ola-check", action="store_true",
                   help="make one Ola Maps search, print the raw answer and stop")
    p.add_argument("--google-key", default="",
                   help="Google Maps Platform API key (or save it in ~/.config/ka-ngo-scraper/google_maps_key)")
    p.add_argument("--places-max", type=int, default=4500,
                   help="most Google Places Text Search calls per calendar month (free tier is 5,000)")
    p.add_argument("--no-places", action="store_true", help="skip the Google Maps sweep")
    p.add_argument("--no-cache", action="store_true", help="ignore saved search results")
    p.add_argument("--no-people", action="store_true",
                   help="do not search the web for who runs each group (websites are still read)")
    p.add_argument("--districts", default="",
                   help="comma separated districts to limit the web search, e.g. Udupi,Mysuru")
    p.add_argument("--awbi-pdf", action="append", default=[],
                   help="local AWBI recognised-list PDF to use instead of downloading")
    p.add_argument("--abc-pdf", action="append", default=[],
                   help="local AWBI ABC-list PDF to use instead of downloading")
    p.add_argument("--delay", type=float, default=2.0, help="seconds between requests")
    p.add_argument("--insecure", action="store_true",
                   help="skip TLS certificate checks (only if a government site's certificate is broken)")
    p.add_argument("--dump-awbi", action="store_true",
                   help="also save every parsed AWBI row (all states) for checking the parser")
    p.add_argument("--version", action="version", version=__version__)
    return p.parse_args(argv)


def main(argv=None):
    args = build_args(argv)
    if args.ola_check:
        key = ola_places.load_key(args.ola_key)
        if not key:
            print("No Ola Maps key found. Save it first (see README, 'Ola Maps key').")
            return 1
        ok = ola_places.check(Http(delay=0.5), key, log=print)
        print("")
        print("Ola Maps is working: the sweep's search style returns places." if ok else
              "The sweep's search style returned nothing. Send me the lines above.")
        return 0 if ok else 1
    if args.quick:
        args.no_web = args.no_enrich = args.no_find_websites = args.no_people = True
        args.no_places = True
        args.no_ola = True
    states = [geo.normalize_state(x) for x in args.states.split(",") if x.strip()]
    bad = [x for x in args.states.split(",") if x.strip() and not geo.normalize_state(x)]
    if bad:
        print("Unknown state(s): " + ", ".join(bad))
        return 1
    states = states or None
    only = []
    for d in [x.strip() for x in args.districts.split(",") if x.strip()]:
        hit = districts.normalise(d) or next((geo.normalize_district(st, d) for st in (states or geo.states())
                                                if geo.normalize_district(st, d)), "")
        if hit:
            only.append(hit)
    do_karnataka = not states or "Karnataka" in states

    started = time.time()
    log_rows = [("Run at", datetime.now().strftime("%Y-%m-%d %H:%M")), ("Version", __version__)]

    def say(msg):
        print(clean(msg), flush=True)

    http = Http(delay=args.delay, verify=not args.insecure, log=say)
    if args.insecure:
        import urllib3
        urllib3.disable_warnings()
    from .net import Cache
    searcher = websearch.Searcher(http, log=say, cache=Cache(enabled=not args.no_cache))
    search_fn = None if args.quick else searcher.search

    records = []

    say("1/5 AWBI recognised organisations")
    orgs, info, all_rows = awbi.fetch(http, "recognised", args.awbi_pdf, search_fn, say, states=states)
    records += orgs
    log_rows.append(("AWBI recognised list", "{} rows; used {}; method {}".format(
        len(orgs), info["used"] or "none", info["method"] or "-")))
    if info.get("used", "").startswith("http") and all_rows:
        kept = awbi.save_snapshot(all_rows, dataset.NATIONAL_SNAPSHOT)
        if kept:
            say("  saved the national AWBI list ({} groups) into the project".format(kept))
    log_rows.append(("AWBI recognised attempts", " | ".join(info["tried"])))
    if args.dump_awbi and all_rows:
        _dump(all_rows, os.path.join(args.out, "awbi-parsed-rows.csv"))

    say("2/5 AWBI ABC project list")
    orgs, info, _ = awbi.fetch(http, "abc", args.abc_pdf, search_fn, say, states=states)
    records += orgs
    log_rows.append(("AWBI ABC list", "{} NGO rows; used {}".format(len(orgs), info["used"] or "none")))

    say("3/5 OpenStreetMap")
    orgs, info = osm.fetch(http, say)
    if states:
        orgs = [o for o in orgs if o.state in states]
    records += orgs
    log_rows.append(("OpenStreetMap", "{} kept from {} places; {}".format(
        len(orgs), info["elements"], "; ".join(info["errors"]) or "ok")))

    if not args.no_web and do_karnataka:
        say("4/5 Web search by district in Karnataka (this is the slow part)")
        orgs = websearch.district_sweep(searcher, only, say)
        records += orgs
        log_rows.append(("Web search", "{} candidates from {} queries".format(len(orgs), searcher.count)))
    else:
        say("4/5 Web search skipped")

    base = dataset.base()
    if states:
        base = [o for o in base if o.state in states]
    say("  verified base dataset: {} groups".format(len(base)))
    merged = merge(base + records)

    ola_key = "" if args.no_ola else ola_places.load_key(args.ola_key)
    if ola_key:
        say("Ola Maps sweep ({})".format(", ".join(states) if states else "every district in India"))
        try:
            ola_orgs, oinfo = ola_places.sweep(http, ola_key, cap=args.ola_max, only=only or None, log=say,
                                               states=states)
            before = len(merged)
            merged = merge(merged + ola_orgs)
            log_rows.append(("Ola Maps", "{} shelters and groups from {} searches; {} new after merging; "
                             "{} requests used this month; {} failed searches {}".format(
                                 len(ola_orgs), oinfo["queries"], len(merged) - before,
                                 oinfo["requests_this_month"], oinfo["errors"], oinfo["stopped"])))
        except PermissionError as err:
            say("  Ola Maps sweep skipped: " + str(err))
            log_rows.append(("Ola Maps", "skipped: " + str(err)))
    elif not args.no_ola:
        say("Ola Maps sweep skipped: no API key (see README, 'Ola Maps key')")
        log_rows.append(("Ola Maps", "skipped: no API key. This is the source that finds most small shelters."))

    pending = []
    key = "" if (args.no_places or not do_karnataka) else google_places.load_key(args.google_key)
    if key:
        say("Google Maps sweep (every district, taluk town and Bengaluru locality)")
        try:
            leads, ginfo = google_places.sweep(http, key, cap=args.places_max,
                                               only=[d for d in only if d in districts.DISTRICTS] or None, log=say)
            confirmed, pending = google_places.confirm(leads, merged, searcher, log=say)
            log_rows.append(("Google Maps", "{} leads from {} queries; {} new groups confirmed on the web; "
                             "{} leads to confirm by phone; {} calls used this month {}".format(
                                 len(leads), ginfo["queries"], len(confirmed), len(pending),
                                 ginfo["calls_this_month"], ginfo["stopped"])))
        except PermissionError as err:
            say("  Google Maps sweep skipped: " + str(err))
            log_rows.append(("Google Maps", "skipped: " + str(err)))
    elif not args.no_places:
        say("Google Maps sweep skipped: no API key (see README, 'Google Maps key')")
        log_rows.append(("Google Maps", "skipped: no API key. This is the source that finds most small shelters."))
    say("  merged {} raw records into {} organisations".format(len(records), len(merged)))

    if not args.no_find_websites:
        missing = [o for o in merged if not o.website and not o.social and o.confidence == "high"]
        if len(missing) > args.lookup_max:
            say("  {} AWBI groups have no website; looking up {} this run (the rest next run)".format(
                len(missing), args.lookup_max))
            # Groups never looked up before go first; cached lookups cost nothing.
            missing = missing[:args.lookup_max]
        say("  looking up websites for {} AWBI groups".format(len(missing)))
        found = 0
        for i, o in enumerate(missing, 1):
            try:
                if websearch.find_website(searcher, o):
                    found += 1
            except websearch.Blocked:
                say("  search engines blocked; stopping website lookup")
                break
            if i % 15 == 0:
                say("  {}/{} looked up, {} websites found".format(i, len(missing), found))
        log_rows.append(("Website lookup", "{} of {} AWBI groups matched".format(found, len(missing))))
        merged = merge(merged)

    if not args.no_enrich:
        targets = [o for o in merged if o.website]
        say("5/5 Reading {} websites for email, phone and who runs them".format(len(targets)))
        from concurrent.futures import ThreadPoolExecutor
        done = 0
        with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
            for _ in pool.map(lambda o: enrich(http, o, say), targets):
                done += 1
                if done % 50 == 0:
                    say("  {}/{} websites read".format(done, len(targets)))
    else:
        say("5/5 Website visits skipped")

    if not args.no_people:
        targets = [o for o in merged if not o.people and o.confidence in ("high", "medium")]
        targets = sorted(targets, key=lambda o: (o.confidence != "high", not o.website))[:args.people_max]
        say("  searching for who runs {} groups not named on their websites".format(len(targets)))
        added = 0
        for i, o in enumerate(targets, 1):
            try:
                added += websearch.find_people(searcher, o)
            except websearch.Blocked:
                say("  search engines blocked; stopping the people search")
                break
            if i % 15 == 0:
                say("  {}/{} searched, {} people found".format(i, len(targets), added))
        log_rows.append(("People search", "{} names found for {} groups searched".format(added, len(targets))))

    with_people = sum(1 for o in merged if o.people)
    log_rows.append(("Groups with a named person", "{} of {}".format(with_people, len(merged))))

    if searcher.errors:
        log_rows.append(("Search issues", " | ".join(searcher.errors[:20])))

    os.makedirs(args.out, exist_ok=True)
    xlsx = os.path.join(args.out, OUT_NAME + ".xlsx")
    csv_path = os.path.join(args.out, OUT_NAME + ".csv")
    html_path = os.path.join(args.out, OUT_NAME + ".html")
    log_rows.append(("Total organisations", str(len(merged))))
    log_rows.append(("Run time (min)", "{:.1f}".format((time.time() - started) / 60)))
    n = write(merged, xlsx, csv_path, log_rows, leads=pending)
    write_html(merged, html_path)
    site_dir = args.site_dir
    build_site(merged, site_dir)
    say("")
    say("Done: {} organisations".format(n))
    say("  {}".format(xlsx))
    say("  {}".format(csv_path))
    say("  {}  (open this to look groups up)".format(html_path))
    say("  website folder updated: {}  (run deploy.sh to publish)".format(site_dir))
    return 0 if n else 1


def _dump(rows, path):
    import csv
    os.makedirs(os.path.dirname(path), exist_ok=True)
    keys = ["code", "name", "address", "district", "state", "recognised", "renewed", "valid_upto", "method"]
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in keys})


if __name__ == "__main__":
    sys.exit(main())
