"""The shops the store search may read (app.catalog), checked by hand on 09.11.2026.

Every shop here publishes a sitemap of its product pages and does not close those pages in robots.txt; its own search
pages are closed (/search/), so they are never used. A product page is read only through the schema.org data the shop
publishes for search engines (app.sitecheck). Nothing here logs in, solves a CAPTCHA or goes around a block.

STORE_SEARCH lists the shops that are on (comma-separated domains, or "all"); empty or "off": the store search is off.
"""

import os

STORES: dict[str, dict] = {
    "industrialmotion.kz": {
        "sitemaps": ("https://industrialmotion.kz/sitemap.xml",),
        "childSitemaps": "/sitemaps/product-",  # the index also lists articles, blogs and pages
        "productPath": "/product/",
        "delay": 1.0,
    },
    "bcindustry.kz": {
        "sitemaps": ("https://bcindustry.kz/sitemap-iblock-4.xml",),
        "productPath": "/catalog/",
        "delay": 5.0,  # Crawl-delay: 5 in its robots.txt
        "sameSellerAs": ("bearing.kz",),
    },
    "bearing.kz": {
        "sitemaps": ("https://bearing.kz/sitemap-iblock-4.xml",),
        "productPath": "/produktsiya/",
        "delay": 1.0,
        # Same internal product code (20285 for 6205-2RSH) and the same price as bcindustry.kz: by all signs one SKF
        # dealer with two sites. It is read only when bcindustry.kz does not answer, so one seller is not shown twice.
        "mirrorOf": "bcindustry.kz",
        "sameSellerAs": ("bcindustry.kz",),
    },
}


def enabled_stores() -> list[str]:
    value = os.environ.get("STORE_SEARCH", "").strip().lower()
    if value in ("", "off", "0", "false", "no"):
        return []
    if value in ("all", "on", "1", "true", "yes"):
        return list(STORES)
    return [domain for domain in (item.strip().lstrip(".") for item in value.split(",")) if domain in STORES]
