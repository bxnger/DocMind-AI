"""Store search: real offers from the shops in app.stores, by part number or by name.

How it works, and what it never does:
1. Once a day the shops' sitemaps are read (only the product links, with the pause each shop asks for) and the part
   number in each product address is kept in an index on disk. A search looks only at this index: no shop is asked to
   search, and their search pages (closed in robots.txt) are never opened.
2. The few best candidates of each shop are opened (at most MAX_PER_STORE, one request at a time per shop, with its
   pause) and read only through the schema.org product data (app.sitecheck). The page decides the match: the part number
   the page itself names, compared by app.codes. A page that names no such part number is "unconfirmed", without a price.
3. Prices, stock and times are what the page says, or None. A shop that does not answer is reported in `sources` and the
   rest of the search goes on.
"""

import json
import logging
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

from app.errors import AppError
from app.codes import clean_code, code_base, code_match, normalize_code
from app.sitecheck import CheckFailed, fetch, names_part, price_of, read_product
from app.stores import STORES, enabled_stores

logger = logging.getLogger("app.catalog")

USER_AGENT = "DocMindIndustry-StoreSearch/1.0 (reads product pages listed in the shop's sitemap)"
LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.IGNORECASE)
SITEMAP_BYTES = 20 * 1024 * 1024
SITEMAP_DEADLINE = 90.0
MAX_CHILD_SITEMAPS = 30
MAX_ITEMS_PER_STORE = 100_000
INDEX_MAX_AGE = 24 * 3600
PAGE_TTL = 30 * 60
FAILED_PAGE_TTL = 2 * 60
MAX_PER_STORE = 3
SEARCH_DEADLINE = 25.0
# A search that reads shops holds a server thread up to SEARCH_DEADLINE: at most this many at once, so many sessions
# searching together cannot take the threads every other request needs. The rest are told to retry (429 SEARCH_BUSY).
MAX_CONCURRENT_SEARCHES = 6
BUSY_WAIT = 3.0
NETWORK_REASONS = {"timeout", "connection_failed", "dns_failed", "unverified_connection"}
NOT_A_PREFIX = {"s", "v", "i", "k", "na", "po", "iz", "do", "ot", "so", "dlya", "bez", "pod", "dlja", "and", "for", "the", "with"}
TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
    "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
})


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def slug_of(url: str) -> str:
    return unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1]).lower()


def code_in_slug(slug: str) -> str | None:
    """The part number written in a product address: "radialnyy-...-6205-2rsh" -> "6205-2RSH",
    "w_6205_2rs1_podshipnik_skf" -> "W 6205-2RS1". Only picks candidates: the page itself decides the match."""
    tokens = [token for token in re.split(r"[-_.+]+", slug) if token]
    for index, token in enumerate(tokens):
        if not re.fullmatch(r"\d{3,7}[a-z0-9]*", token):
            continue
        parts = [token]
        for following in tokens[index + 1:]:
            if following not in NOT_A_PREFIX and re.fullmatch(r"[a-z]{0,4}\d[a-z0-9]{0,24}|[a-z]{1,3}", following):
                parts.append(following)
            else:
                break
        code = "-".join(parts).upper()
        before = tokens[index - 1] if index else ""
        if re.fullmatch(r"[a-z]{1,3}", before) and before not in NOT_A_PREFIX:
            code = f"{before.upper()} {code}"
        return code
    return None


def words_of(text: str) -> list[str]:
    """Words of a product name as they look in a transliterated address: "Подшипник шариковый" -> ["podshipnik", ...]."""
    return [word for word in re.findall(r"[a-z0-9]+", text.lower().translate(TRANSLIT)) if len(word) >= 3]


def default_fetcher(url: str, domain: str, kind: str) -> tuple[str, str]:
    if kind == "sitemap":
        return fetch(url, {domain}, accept="application/xml, text/xml", content_types=("xml",),
                     max_bytes=SITEMAP_BYTES, deadline=SITEMAP_DEADLINE, user_agent=USER_AGENT)
    return fetch(url, {domain}, user_agent=USER_AGENT)


class Catalog:
    """The index and the page cache are shared by all sessions; nothing in them belongs to a user."""

    def __init__(self, directory: Path, fetcher=None, sleep=time.sleep, monotonic=time.monotonic) -> None:
        self.path = Path(directory) / "index.json"
        self.fetcher = fetcher or default_fetcher
        self.sleep, self.monotonic = sleep, monotonic
        self._lock = threading.Lock()
        self._refreshing = False
        self._index: dict | None = None
        self._pages: dict[str, tuple[float, object]] = {}
        self._last_request: dict[str, float] = {}
        self._store_locks = {domain: threading.Lock() for domain in STORES}
        self._searches = threading.BoundedSemaphore(MAX_CONCURRENT_SEARCHES)

    def slot(self):
        """One of the MAX_CONCURRENT_SEARCHES places for a search that may read shops, or 429 SEARCH_BUSY."""
        catalog = self

        class Slot:
            def __enter__(self):
                if not catalog._searches.acquire(timeout=BUSY_WAIT):
                    raise AppError(429, "SEARCH_BUSY", "Too many store searches right now, try again in a few seconds",
                                   retryable=True, retry_after=10)

            def __exit__(self, *exc):
                catalog._searches.release()

        return Slot()

    # The index ------------------------------------------------------------------------------------------------------

    def index(self) -> dict | None:
        if self._index is None and self.path.exists():
            try:
                self._index = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                self._index = None
        return self._index

    def stale(self) -> bool:
        index = self.index()
        if index is None:
            return True
        missing = [domain for domain in enabled_stores() if domain not in index.get("stores", {})]
        return bool(missing) or time.time() - index.get("builtAtEpoch", 0) > INDEX_MAX_AGE

    def refresh_in_background(self) -> bool:
        with self._lock:
            if self._refreshing or not enabled_stores():
                return False
            self._refreshing = True
        threading.Thread(target=self._refresh_guarded, name="store-catalog", daemon=True).start()
        return True

    def _refresh_guarded(self) -> None:
        try:
            self.refresh()
        except Exception:  # a broken sitemap must not take anything else down
            logger.exception("store catalog refresh failed")
        finally:
            with self._lock:
                self._refreshing = False

    def refresh(self) -> dict:
        """Reads the sitemaps of every shop that is on. A shop that fails keeps the items of its last good read."""
        old = self.index() or {"stores": {}, "items": {}}
        stores, items = dict(old.get("stores", {})), dict(old.get("items", {}))
        for domain in enabled_stores():
            started = now_iso()
            try:
                found = self._read_sitemaps(domain)
                items[domain] = found
                stores[domain] = {"status": "ok", "readAt": started, "products": len(found)}
            except CheckFailed as failure:
                previous = stores.get(domain, {})
                stores[domain] = {**previous, "status": "failed", "reason": failure.reason, "failedAt": started}
                logger.warning("sitemap of %s failed: %s", domain, failure.reason)
        index = {"builtAt": now_iso(), "builtAtEpoch": time.time(), "stores": stores, "items": items}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
        temporary.replace(self.path)
        self._index = index
        return index

    def _read_sitemaps(self, domain: str) -> list[list[str]]:
        store = STORES[domain]
        found, seen = [], set()
        queue = list(store["sitemaps"])
        opened = 0
        while queue and opened <= MAX_CHILD_SITEMAPS:
            url = queue.pop(0)
            opened += 1
            self._wait(domain, deadline_at=None)
            _final, text = self.fetcher(url, domain, "sitemap")
            locations = LOC.findall(text)
            if "<sitemapindex" in text[:2000].lower():
                child_filter = store.get("childSitemaps")
                queue.extend(loc for loc in locations if urlsplit(loc).hostname == domain
                             and (child_filter is None or child_filter in loc))
                continue
            for loc in locations:
                if loc in seen or urlsplit(loc).hostname != domain or store["productPath"] not in urlsplit(loc).path:
                    continue
                seen.add(loc)
                slug = slug_of(loc)
                code = code_in_slug(slug)
                if code:
                    found.append([loc, code, slug])
                elif re.search(r"[a-z]{3}", slug):
                    found.append([loc, "", slug])  # no part number in the address: only a name search can find it
                if len(found) >= MAX_ITEMS_PER_STORE:
                    return found
        if not found:
            raise CheckFailed("empty_sitemap")
        return found

    # Polite access to a shop ----------------------------------------------------------------------------------------

    def _wait(self, domain: str, deadline_at: float | None) -> bool:
        """One request at a time per shop, with its pause. False when the pause would pass the search deadline."""
        delay = STORES[domain]["delay"]
        with self._store_locks[domain]:
            pause = self._last_request.get(domain, -1e9) + delay - self.monotonic()
            if deadline_at is not None and self.monotonic() + max(pause, 0) > deadline_at:
                return False
            if pause > 0:
                self.sleep(pause)
            self._last_request[domain] = self.monotonic()
        return True

    def read_page(self, url: str, domain: str, deadline_at: float | None = None) -> tuple[str, list[dict], str]:
        """(final URL, products of the page, when it was really read), from the cache when fresh. Raises CheckFailed.
        A cached page keeps the time it was read: "checked at" is never the time of the answer."""
        cached = self._pages.get(url)
        if cached and self.monotonic() < cached[0]:
            if isinstance(cached[1], CheckFailed):
                raise cached[1]
            return cached[1]
        if not self._wait(domain, deadline_at):
            raise CheckFailed("shop_busy")
        try:
            final_url, html = self.fetcher(url, domain, "page")
        except CheckFailed as failure:
            self._pages[url] = (self.monotonic() + FAILED_PAGE_TTL, failure)
            raise
        result = (final_url, read_product(html), now_iso())
        self._pages[url] = (self.monotonic() + PAGE_TTL, result)
        if len(self._pages) > 2000:
            self._pages = dict(list(self._pages.items())[-1000:])
        return result

    # Searching ------------------------------------------------------------------------------------------------------

    def candidates(self, domain: str, query: str, mode: str) -> list[list[str]]:
        items = (self.index() or {}).get("items", {}).get(domain, [])
        if mode == "name":
            words = words_of(query)
            if not words:
                return []
            return [item for item in items if all(word in item[2] for word in words)][:MAX_PER_STORE]
        ranked, key = [], normalize_code(query)
        for item in items:
            if not item[1]:
                continue
            kind = code_match(query, item[1])
            if kind == "exact":
                ranked.append((0, 0, item))
            elif kind == "close":
                code = normalize_code(item[1])
                # 6205-2RS: 6205-2RSH (the query plus a letter) before 6205-RSH and 6205-Z/C3
                ranked.append((1 if code.startswith(key) else 2, abs(len(code) - len(key)), item))
        ranked.sort(key=lambda entry: (entry[0], entry[1], entry[2][1]))
        return [entry[2] for entry in ranked[:MAX_PER_STORE]]

    def search(self, query: str, mode: str = "partNumber") -> dict:
        """{"results": [...], "sources": [...]}. Each result: store, url, title, partNumber, match, check (the price
        result as stored on an offer). match: "exact" | "close" | "unconfirmed"."""
        enabled = enabled_stores()
        if self.stale():
            self.refresh_in_background()
        index = self.index()
        if index is None:
            return {"results": [], "sources": [{"store": d, "status": "unavailable", "reason": "index_building",
                                                "candidates": 0} for d in enabled]}
        with self.slot():
            return self._search(query, mode, enabled)

    def _search(self, query: str, mode: str, enabled: list[str]) -> dict:
        deadline_at = self.monotonic() + SEARCH_DEADLINE
        main = [d for d in enabled if STORES[d].get("mirrorOf") not in enabled]
        mirrors = [d for d in enabled if d not in main]
        with ThreadPoolExecutor(max_workers=max(len(main), 1)) as pool:
            done = dict(zip(main, pool.map(lambda d: self._search_store(d, query, mode, deadline_at), main)))
        for domain in mirrors:
            source = done[STORES[domain]["mirrorOf"]][0]
            if source["status"] == "unavailable":
                done[domain] = self._search_store(domain, query, mode, deadline_at)
            else:
                done[domain] = ({"store": domain, "status": "skipped", "reason": "same_seller",
                                 "sameSellerAs": STORES[domain]["mirrorOf"], "candidates": 0}, [])
        results = [result for domain in enabled for result in done[domain][1]]
        return {"results": results, "sources": [done[domain][0] for domain in enabled]}

    def _search_store(self, domain: str, query: str, mode: str, deadline_at: float) -> tuple[dict, list[dict]]:
        state = ((self.index() or {}).get("stores") or {}).get(domain)
        if not state or domain not in (self.index() or {}).get("items", {}):
            return {"store": domain, "status": "unavailable", "reason": "not_indexed", "candidates": 0}, []
        found = self.candidates(domain, query, mode)
        source = {"store": domain, "status": "ok", "candidates": len(found), "indexedAt": state.get("readAt")}
        results, failures = [], []
        for url, slug_code, slug in found:
            result = self.judge_page(url, domain, query, mode, slug_code, slug, deadline_at)
            results.append(result)
            if result["check"]["reason"] in NETWORK_REASONS or (result["check"]["reason"] or "").startswith("http_5"):
                failures.append(result["check"]["reason"])
            elif result["check"]["reason"] == "shop_busy":
                failures.append("shop_busy")
        if found and len(failures) == len(found):
            source.update(status="skipped" if set(failures) == {"shop_busy"} else "unavailable", reason=failures[0])
        elif failures:
            source["failedPages"] = len(failures)
        return source, results

    def judge_page(self, url: str, domain: str, query: str, mode: str, slug_code: str = "", slug: str = "",
                   deadline_at: float | None = None) -> dict:
        """One product page: what it is (its own part number) and its price. Nothing read means unconfirmed, price None."""
        check = {"status": "failed", "reason": None, "price": None, "currency": None, "stockStatus": "unknown",
                 "checkedAt": now_iso(), "url": url}
        result = {"store": domain, "url": url, "title": slug_code or slug, "partNumber": slug_code or None,
                  "match": "unconfirmed", "check": check, "sameSellerAs": list(STORES[domain].get("sameSellerAs", ()))}
        try:
            final_url, products, read_at = self.read_page(url, domain, deadline_at)
            check.update(url=final_url, checkedAt=read_at)
            result["url"] = final_url
            if products and products[0]["name"]:
                result["title"] = products[0]["name"][:200]
            code, match = page_code(products, query, slug_code, mode)
            if code is None:
                raise CheckFailed("part_number_not_on_page" if products else "no_product_data")
            result.update(partNumber=code, match=match)
            check.update(price_of(products, code))
        except CheckFailed as failure:
            check["reason"] = failure.reason
        return result


def page_code(products: list[dict], query: str, slug_code: str, mode: str) -> tuple[str | None, str]:
    """The part number the page names and how it matches the query. A name search confirms no part number."""
    if mode == "name":
        for product in products:
            for code in product["codes"]:
                if code_base(code):
                    return clean_code(code), "unconfirmed"
        return None, "unconfirmed"
    close = None
    for product in products:
        for code in product["codes"]:
            kind = code_match(query, code)
            if kind == "exact":
                return clean_code(code), "exact"
            if kind == "close" and close is None:
                close = clean_code(code)
    if close:
        return close, "close"
    if slug_code and any(names_part(product, slug_code) for product in products):
        kind = code_match(query, slug_code)
        if kind in ("exact", "close"):
            return slug_code, kind
    return None, "unconfirmed"


_catalog: Catalog | None = None


def get_catalog(directory: Path) -> Catalog:
    global _catalog
    if _catalog is None or _catalog.path.parent != Path(directory):
        _catalog = Catalog(directory)
    return _catalog
