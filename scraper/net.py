"""Polite HTTP for many hosts at once.

* each host gets its own pause between requests, so different sites can be
  fetched in parallel without hammering any one of them
* one requests session per thread
* an optional disk cache, so a stopped run picks up where it left off
"""

import hashlib
import json
import os
import random
import threading
import time
from urllib.parse import urlparse

import requests

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

CACHE_DIR = os.path.expanduser("~/.cache/ka-ngo-scraper")


class Cache:
    """Tiny JSON-on-disk cache keyed by a string, with an age limit."""

    def __init__(self, folder=CACHE_DIR, max_age_days=14, enabled=True):
        self.folder = folder
        self.max_age = max_age_days * 86400
        self.enabled = enabled
        if enabled:
            os.makedirs(folder, exist_ok=True)

    def _path(self, key):
        return os.path.join(self.folder, hashlib.sha1(key.encode("utf-8")).hexdigest() + ".json")

    def get(self, key):
        if not self.enabled:
            return None
        p = self._path(key)
        try:
            if time.time() - os.path.getmtime(p) > self.max_age:
                return None
            with open(p, encoding="utf-8") as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return None

    def put(self, key, value):
        if not self.enabled:
            return
        tmp = self._path(key) + ".tmp"
        try:
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(value, fh)
            os.replace(tmp, self._path(key))
        except OSError:
            pass


class Http:
    def __init__(self, delay=1.5, timeout=30, verify=True, log=print):
        self.delay = delay
        self.timeout = timeout
        self.verify = verify
        self.log = log
        self._local = threading.local()
        self._lock = threading.Lock()
        self._next_ok = {}  # host -> earliest time for the next request

    def _session(self):
        s = getattr(self._local, "s", None)
        if s is None:
            s = requests.Session()
            s.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "en-IN,en;q=0.9"})
            self._local.s = s
        return s

    def _wait(self, host, delay):
        with self._lock:
            now = time.time()
            start = max(now, self._next_ok.get(host, 0.0))
            self._next_ok[host] = start + delay + random.uniform(0, delay / 2)
        if start > now:
            time.sleep(start - now)

    def request(self, method, url, retries=2, delay=None, **kw):
        kw.setdefault("timeout", self.timeout)
        kw.setdefault("verify", self.verify)
        host = urlparse(url).netloc
        last_err = None
        for attempt in range(retries + 1):
            self._wait(host, self.delay if delay is None else delay)
            try:
                resp = self._session().request(method, url, **kw)
                if resp.status_code in (429, 502, 503, 504) and attempt < retries:
                    time.sleep(5 * (attempt + 1))
                    continue
                return resp
            except requests.exceptions.SSLError as err:
                last_err = err
                break  # retrying will not fix a certificate problem
            except requests.RequestException as err:
                last_err = err
                time.sleep(2 * (attempt + 1))
        raise last_err if last_err else RuntimeError("request failed: " + url)

    def get(self, url, **kw):
        return self.request("GET", url, **kw)

    def post(self, url, **kw):
        return self.request("POST", url, **kw)
