"""Check an offer's price on the supplier's own product page (the link in the price list).

Nothing is guessed and nothing is scraped around a site's rules:
- only domains listed in PRICE_CHECK_DOMAINS are opened (empty: the check is off);
- the page is read only through the product data a shop publishes for search engines (schema.org Product / Offer in
  JSON-LD or microdata, or the product:price meta tags). A page without it is "failed", not read some other way;
- the price counts only when the page names the same part number, has one price, and states its currency.

Safety (the server fetches a URL that came from a user's file): https on port 443 only, no user:password in the URL, the
host must be on the list, every address it resolves to must be public (no localhost, private, link-local / cloud
metadata, reserved or multicast addresses), the connection must land on one of those checked addresses (DNS rebinding),
every redirect is checked the same way (at most 3), no proxy from the environment, short timeouts, at most 2 MB read.
"""

import ipaddress
import json
import os
import socket
import time
from datetime import datetime, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

from app.codes import code_match
from app.stores import enabled_stores
from app.pricing import CURRENCIES, CURRENCY_WORDS, money, parse_price, row_match

MAX_PAGE_BYTES = 2 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(8.0, connect=4.0)
DEADLINE_SECONDS = 15.0
USER_AGENT = "DocMindIndustry-PriceCheck/1.0 (checks one product page from a price list)"
IN_STOCK = ("instock", "limitedavailability", "instoreonly", "onlineonly", "presale", "preorder")
OUT_OF_STOCK = ("outofstock", "discontinued", "soldout")


class CheckFailed(Exception):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def allowed_domains() -> set[str]:
    """PRICE_CHECK_DOMAINS plus the shops of the store search that are on (their offers are checked the same way)."""
    listed = {item.strip().lower().lstrip(".") for item in os.environ.get("PRICE_CHECK_DOMAINS", "").split(",") if item.strip()}
    return listed | set(enabled_stores())


def host_allowed(host: str, domains: set[str]) -> bool:
    host = host.lower().rstrip(".")
    return any(host == domain or host.endswith("." + domain) for domain in domains)


def public_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
                                 or ip.is_reserved or ip.is_unspecified)


def resolve(host: str) -> set[str]:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise CheckFailed("dns_failed") from exc
    return {info[4][0] for info in infos}


def checked_url(url: str, domains: set[str]) -> tuple[str, set[str]]:
    """The URL if it may be opened, and the addresses its host resolves to (all of them public)."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        raise CheckFailed("not_https")
    if parts.username or parts.password or not parts.hostname:
        raise CheckFailed("bad_url")
    if parts.port not in (None, 443):
        raise CheckFailed("bad_port")
    host = parts.hostname
    try:
        ipaddress.ip_address(host)
        raise CheckFailed("ip_address_host")  # shops are reached by name; a bare address is never on the list
    except ValueError:
        pass
    if not host_allowed(host, domains):
        raise CheckFailed("domain_not_allowed")
    addresses = resolve(host)
    if not addresses or not all(public_address(address) for address in addresses):
        raise CheckFailed("private_address")
    return url, addresses


def fetch(url: str, domains: set[str], resolver=None, transport: httpx.BaseTransport | None = None, *,
          accept: str = "text/html", content_types: tuple[str, ...] = ("html",), max_bytes: int = MAX_PAGE_BYTES,
          deadline: float = DEADLINE_SECONDS, user_agent: str = USER_AGENT) -> tuple[str, str]:
    """(final URL, page text). Raises CheckFailed with a short reason. Tests pass a resolver and a transport.
    The store catalog (app.catalog) reads sitemaps through the same checks, with its own type, size and deadline."""
    started = time.monotonic()
    with httpx.Client(timeout=TIMEOUT, follow_redirects=False, trust_env=False, transport=transport,
                      headers={"User-Agent": user_agent, "Accept": accept}) as client:
        for _hop in range(MAX_REDIRECTS + 1):
            url, addresses = (resolver or checked_url)(url, domains)
            if time.monotonic() - started > deadline:
                raise CheckFailed("timeout")
            try:
                with client.stream("GET", url) as response:
                    peer = _peer(response)
                    if peer is None and transport is None:
                        raise CheckFailed("unverified_connection")  # a real connection whose address cannot be seen
                    if peer is not None and peer not in addresses:
                        raise CheckFailed("private_address")  # resolved again to another address while connecting
                    if response.is_redirect:
                        location = response.headers.get("location", "")
                        if not location:
                            raise CheckFailed("bad_redirect")
                        url = urljoin(url, location)
                        continue
                    if response.status_code != 200:
                        raise CheckFailed(f"http_{response.status_code}")
                    content_type = response.headers.get("content-type", "").lower()
                    if not any(kind in content_type for kind in content_types):
                        raise CheckFailed("not_html" if content_types == ("html",) else "wrong_content_type")
                    body = bytearray()
                    for chunk in response.iter_bytes():
                        body.extend(chunk)
                        if len(body) > max_bytes:
                            raise CheckFailed("page_too_large")
                        if time.monotonic() - started > deadline:
                            raise CheckFailed("timeout")
                    return url, body.decode(response.encoding or "utf-8", errors="replace")
            except httpx.TimeoutException as exc:
                raise CheckFailed("timeout") from exc
            except httpx.HTTPError as exc:
                raise CheckFailed("connection_failed") from exc
        raise CheckFailed("too_many_redirects")


def _peer(response: httpx.Response) -> str | None:
    stream = response.extensions.get("network_stream")
    try:
        address = stream.get_extra_info("server_addr") if stream is not None else None
    except Exception:
        address = None
    return address[0] if address else None


# Reading the product data of a page -----------------------------------------------------------------------------------

class _ProductData(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.json_ld: list[str] = []
        self.meta: dict[str, list[str]] = {}
        self.title = ""
        self._in_json = False
        self._in_title = False
        self._buffer: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = {key.lower(): (value or "") for key, value in attrs}
        if tag == "script" and attributes.get("type", "").lower() == "application/ld+json":
            self._in_json, self._buffer = True, []
        elif tag == "title":
            self._in_title = True
        key = attributes.get("itemprop") or attributes.get("property") or attributes.get("name")
        if key and ("content" in attributes or tag == "link"):
            value = attributes.get("content") or attributes.get("href", "")
            self.meta.setdefault(key.lower(), []).append(value.strip())

    def handle_endtag(self, tag):
        if tag == "script" and self._in_json:
            self.json_ld.append("".join(self._buffer))
            self._in_json = False
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_json:
            self._buffer.append(data)
        elif self._in_title:
            self.title += data


def _products(node) -> list[dict]:
    found = []
    if isinstance(node, list):
        for item in node:
            found.extend(_products(item))
    elif isinstance(node, dict):
        kind = node.get("@type")
        kinds = kind if isinstance(kind, list) else [kind]
        if any(str(k).lower() in ("product", "productmodel", "individualproduct") for k in kinds):
            found.append(node)
        for key in ("@graph", "mainEntity", "itemListElement", "item"):
            if key in node:
                found.extend(_products(node[key]))
    return found


def _offers(product: dict) -> list[dict]:
    offers = product.get("offers")
    offers = offers if isinstance(offers, list) else [offers] if isinstance(offers, dict) else []
    result = []
    for offer in offers:
        if str(offer.get("@type", "")).lower() == "aggregateoffer":
            low, high = offer.get("lowPrice"), offer.get("highPrice")
            if offer.get("price") is not None:
                result.append({**offer})
            elif low is not None and (high is None or str(low) == str(high)):
                result.append({**offer, "price": low})
            else:
                result.append({**offer, "price": None, "_several": True})
            result.extend(_offers(offer) if offer.get("offers") else [])
        else:
            result.append(offer)
    return result


def _stock(value: object) -> str:
    text = str(value or "").lower().rsplit("/", 1)[-1]
    if text in IN_STOCK:
        return "available"
    if text in OUT_OF_STOCK:
        return "unavailable"
    return "unknown"


def read_product(html: str) -> list[dict]:
    """Every product the page publishes: name, codes, price (Decimal or None), currency, stock."""
    parser = _ProductData()
    try:
        parser.feed(html)
    except Exception:
        pass
    products = []
    for text in parser.json_ld:
        try:
            data = json.loads(text.strip())
        except ValueError:
            continue
        for product in _products(data):
            codes = [str(product.get(key) or "") for key in ("sku", "mpn", "productID", "model") if isinstance(product.get(key), (str, int))]
            for offer in _offers(product) or [{}]:
                price, written = parse_price(offer.get("price")) if offer.get("price") is not None else (None, None)
                products.append({
                    "name": str(product.get("name") or ""), "codes": [c for c in codes if c],
                    "price": price, "several": bool(offer.get("_several")),
                    "currency": _currency(offer.get("priceCurrency")) or written,
                    "stock": _stock(offer.get("availability")),
                })
    if not products and (parser.meta.get("price") or parser.meta.get("product:price:amount")):
        meta = parser.meta
        prices = {value for value in meta.get("price", []) + meta.get("product:price:amount", []) if value}
        price, written = parse_price(next(iter(prices))) if len(prices) == 1 else (None, None)
        currency = (meta.get("pricecurrency") or meta.get("product:price:currency") or [""])[0]
        products.append({
            "name": (meta.get("name") or meta.get("og:title") or [parser.title])[0],
            "codes": [value for key in ("sku", "mpn", "productid") for value in meta.get(key, []) if value],
            "price": price, "several": len(prices) > 1, "currency": _currency(currency) or written,
            "stock": _stock((meta.get("availability") or [""])[0]),
        })
    return products


def _currency(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    code = CURRENCY_WORDS.get(text.lower(), text.upper())
    return code if code in CURRENCIES else None


def names_part(product: dict, part_number: str) -> bool:
    """The product on the page is this part number: by its own code, or by the code written in its name."""
    if any(code_match(part_number, code) == "exact" for code in product["codes"]):
        return True
    return row_match(part_number, {"partNumber": None, "title": product["name"]}) == "exact"


def price_of(products: list[dict], part_number: str) -> dict:
    """The price, currency and stock of `part_number` among the products of a page, or CheckFailed with the reason."""
    if not products:
        raise CheckFailed("no_product_data")
    same = [product for product in products if names_part(product, part_number)]
    if not same:
        raise CheckFailed("part_number_not_on_page")
    prices = {(product["price"], product["currency"]) for product in same if product["price"] is not None}
    if any(product["several"] for product in same) or len(prices) > 1:
        raise CheckFailed("several_prices")
    if not prices:
        raise CheckFailed("no_price")
    price, currency = prices.pop()
    if currency is None:
        raise CheckFailed("no_currency")
    if price <= 0:
        raise CheckFailed("no_price")
    stocks = {product["stock"] for product in same} - {"unknown"}
    return {"status": "checked", "price": money(price), "currency": currency,
            "stockStatus": stocks.pop() if len(stocks) == 1 else "unknown"}


def check_offer(url: str | None, part_number: str | None, domains: set[str] | None = None, fetcher=None) -> dict:
    """The result stored on the price list row: status "checked" (a real price was read) or "failed" with a reason."""
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    domains = allowed_domains() if domains is None else domains
    result = {"status": "failed", "reason": None, "price": None, "currency": None, "stockStatus": "unknown",
              "checkedAt": now, "url": url}
    try:
        if not domains:
            raise CheckFailed("check_disabled")
        if not url:
            raise CheckFailed("no_url")
        if not part_number:
            raise CheckFailed("no_part_number")
        final_url, html = (fetcher or fetch)(url, domains)
        result["url"] = final_url
        result.update(price_of(read_product(html), part_number))
    except CheckFailed as failure:
        result["reason"] = failure.reason
    return result
