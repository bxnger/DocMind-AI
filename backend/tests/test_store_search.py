"""Store search and barcodes (docs/STORE-SEARCH-API.md). No test opens the network: sitemaps and pages are given here."""

import io
import json

import pytest

from app.barcodes import classify, find_part_number, gtin_valid
from app.catalog import Catalog, code_in_slug
from app.sitecheck import CheckFailed
from tests.test_procurement import parts_of, price_list, ready, use

IM, BC, BK = "https://industrialmotion.kz", "https://bcindustry.kz", "https://bearing.kz"


def sitemap(*urls: str) -> str:
    return "<?xml version='1.0'?><urlset>" + "".join(f"<url><loc>{u}</loc></url>" for u in urls) + "</urlset>"


def sitemap_index(*urls: str) -> str:
    return "<?xml version='1.0'?><sitemapindex>" + "".join(f"<sitemap><loc>{u}</loc></sitemap>" for u in urls) + "</sitemapindex>"


def product_page(name: str, price: str | None, sku: str | None = None, mpn: str | None = None, stock="InStock") -> str:
    product = {"@context": "https://schema.org", "@type": "Product", "name": name}
    if sku:
        product["sku"] = sku
    if mpn:
        product["mpn"] = mpn
    if price is not None:
        product["offers"] = {"@type": "Offer", "price": price, "priceCurrency": "KZT", "availability": f"https://schema.org/{stock}"}
    return f'<html><head><script type="application/ld+json">{json.dumps(product, ensure_ascii=False)}</script></head></html>'


SITE = {
    f"{IM}/sitemap.xml": sitemap_index(f"{IM}/sitemaps/product-1.xml", f"{IM}/sitemaps/blog-1.xml"),
    f"{IM}/sitemaps/product-1.xml": sitemap(
        f"{IM}/product/radialnyy-sharikopodshipnik-6205",
        f"{IM}/product/radialnyy-sharikopodshipnik-s-uplotneniyami-6205-2rsh",
        f"{IM}/product/radialnyy-sharikopodshipnik-6203",
        f"{IM}/product/radialnyy-sharikopodshipnik-iz-nerzhaveyuschey-stali-w-6205-2rs1",
        f"{IM}/product/remen-klinovoy",
    ),
    f"{IM}/sitemaps/blog-1.xml": "must not be read",
    f"{BC}/sitemap-iblock-4.xml": sitemap(
        f"{BC}/catalog/bearings/6205_2rsh_podshipnik_skf/", f"{BC}/catalog/bearings/6205_2z_podshipnik_skf/",
        f"{BC}/catalog/bearings/6203_podshipnik_skf/", f"{BC}/catalog/bearings/",
    ),
    f"{BK}/sitemap-iblock-4.xml": sitemap(f"{BK}/produktsiya/skf/6205_2rsh_podshipnik_skf/"),
    f"{IM}/product/radialnyy-sharikopodshipnik-6205": product_page("Радиальный шарикоподшипник 6205", "3 650", sku="6205"),
    f"{IM}/product/radialnyy-sharikopodshipnik-s-uplotneniyami-6205-2rsh": product_page("Радиальный шарикоподшипник с уплотнениями 6205-2RSH", "4790", sku="6205-2RSH"),
    f"{IM}/product/radialnyy-sharikopodshipnik-6203": product_page("Радиальный шарикоподшипник 6203", "2620", sku="6203"),
    f"{BC}/catalog/bearings/6205_2rsh_podshipnik_skf/": product_page("6205-2RSH подшипник SKF", "4805.00", sku="20285", mpn="6205-2RSH"),
    f"{BC}/catalog/bearings/6205_2z_podshipnik_skf/": product_page("6205-2Z подшипник SKF", None, sku="20290", mpn="6205-2Z"),
    f"{BC}/catalog/bearings/6203_podshipnik_skf/": product_page("Шарикоподшипник SKF", "2630", sku="20100", mpn="6303"),
    f"{BK}/produktsiya/skf/6205_2rsh_podshipnik_skf/": product_page("6205-2RSH подшипник SKF", "4805.00", sku="20285", mpn="6205-2RSH"),
}


class FakeShops:
    def __init__(self, pages=None, down=()):
        self.pages = dict(SITE if pages is None else pages)
        self.down = set(down)
        self.opened: list[str] = []

    def __call__(self, url, domain, kind):
        self.opened.append(url)
        if domain in self.down:
            raise CheckFailed("timeout")
        if url not in self.pages:
            raise CheckFailed("http_404")
        return url, self.pages[url]


@pytest.fixture
def shops(client, tmp_path, monkeypatch):
    monkeypatch.setenv("STORE_SEARCH", "all")
    fake = FakeShops()
    catalog = Catalog(tmp_path / "catalog", fetcher=fake, sleep=lambda seconds: None)
    catalog.refresh()
    client.app.state.catalog = catalog
    return fake


def search(client, query, kind="partNumber", **more):
    response = client.post("/api/v1/procurement/search", json={"query": query, "kind": kind, **more})
    assert response.status_code == 200, response.text
    return response.json()


# The index --------------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("slug, code", [
    ("radialnyy-sharikopodshipnik-s-uplotneniyami-6205-2rsh", "6205-2RSH"),
    ("6205_2rsh_c3_lht23_podshipnik_skf", "6205-2RSH-C3-LHT23"),
    ("w_6205_2rs1_podshipnik_skf", "W 6205-2RS1"),
    ("hybrid-ceramic-deep-groove-ball-bearing-with-low-friction-seals-on-both-sides-6205-2rsltn9hc5c3wt", "6205-2RSLTN9HC5C3WT"),
    ("podshipnik-nu-210-ecp", "NU 210-ECP"),
    ("remen-klinovoy", None),
])
def test_the_part_number_in_a_product_address(slug, code):
    assert code_in_slug(slug) == code


def test_the_index_reads_only_product_sitemaps(shops, client):
    index = client.app.state.catalog.index()
    assert set(index["stores"]) == {"industrialmotion.kz", "bcindustry.kz", "bearing.kz"}
    assert f"{IM}/sitemaps/blog-1.xml" not in shops.opened
    assert index["stores"]["industrialmotion.kz"]["products"] == 5
    category = next(item for item in index["items"]["bcindustry.kz"] if item[0] == f"{BC}/catalog/bearings/")
    assert category[1] == ""  # a section page has no part number: a part number search never opens it


def test_a_shop_whose_sitemap_fails_keeps_its_last_good_index(tmp_path, monkeypatch):
    monkeypatch.setenv("STORE_SEARCH", "all")
    fake = FakeShops()
    catalog = Catalog(tmp_path, fetcher=fake, sleep=lambda s: None)
    catalog.refresh()
    fake.down.add("industrialmotion.kz")
    index = catalog.refresh()
    assert index["stores"]["industrialmotion.kz"]["status"] == "failed"
    assert len(index["items"]["industrialmotion.kz"]) == 5


# Searching --------------------------------------------------------------------------------------------------------

def test_6205_2rs_finds_real_similar_offers_in_several_shops_and_no_exact_one(shops, client):
    body = search(client, "6205-2RS")
    assert body["offers"] == []  # nobody sells exactly 6205-2RS here: nothing is passed off as exact
    similar = [(o["store"], o["partNumber"], o["price"], o["match"], o["priceOrigin"]) for o in body["similar"]]
    assert ("industrialmotion.kz", "6205-2RSH", "4790.00", "close", "site_checked") in similar
    assert ("bcindustry.kz", "6205-2RSH", "4805.00", "close", "site_checked") in similar
    assert [o["price"] for o in body["similar"]][-1] is None  # 6205-2Z: page without a price, null and last
    no_price = body["similar"][-1]
    assert (no_price["partNumber"], no_price["stockStatus"], no_price["checkedAt"]) == ("6205-2Z", "unknown", None)
    assert body["similar"][0]["url"].startswith("https://") and body["similar"][0]["checkedAt"]
    assert {o["store"]: o["sameSellerAs"] for o in body["similar"]} == {"industrialmotion.kz": [], "bcindustry.kz": ["bearing.kz"]}
    sources = {s["store"]: s for s in body["sources"]}
    assert sources["bearing.kz"]["status"] == "skipped" and sources["bearing.kz"]["reason"] == "same_seller"
    assert f"{BK}/produktsiya/skf/6205_2rsh_podshipnik_skf/" not in shops.opened  # one seller is not shown twice


def test_6205_is_exact_and_6205_2rs_variants_stay_similar(shops, client):
    body = search(client, "6205")
    assert [(o["store"], o["partNumber"], o["price"]) for o in body["offers"]] == [("industrialmotion.kz", "6205", "3650.00")]
    assert {o["partNumber"] for o in body["similar"]} >= {"6205-2RSH"}
    assert all(o["match"] == "close" for o in body["similar"])


def test_a_page_that_names_another_part_is_unconfirmed_without_a_price(shops, client):
    body = search(client, "6203")
    assert [(o["store"], o["price"]) for o in body["offers"]] == [("industrialmotion.kz", "2620.00")]
    unconfirmed = body["unconfirmed"]
    assert [(o["store"], o["match"], o["price"], o["reason"], o["id"]) for o in unconfirmed] == [
        ("bcindustry.kz", "unconfirmed", None, "part_number_not_on_page", None)]


def test_a_shop_that_does_not_answer_does_not_stop_the_search(shops, client):
    shops.down.add("bcindustry.kz")
    body = search(client, "6205-2RS")
    sources = {s["store"]: s for s in body["sources"]}
    assert sources["bcindustry.kz"]["status"] == "unavailable" and sources["bcindustry.kz"]["reason"] == "timeout"
    assert sources["industrialmotion.kz"]["status"] == "ok"
    # its mirror is asked instead, and says it is the same seller
    assert sources["bearing.kz"]["status"] == "ok"
    stores = {o["store"] for o in body["similar"]}
    assert stores == {"industrialmotion.kz", "bearing.kz"}


def test_unknown_part_number_is_an_honest_empty_answer(shops, client):
    body = search(client, "XYZ-99999")
    assert (body["offers"], body["similar"], body["unconfirmed"]) == ([], [], [])
    assert all(s["candidates"] == 0 for s in body["sources"])


def test_a_name_with_a_part_number_in_it_is_searched_by_that_number(shops, client):
    body = search(client, "Подшипник 6205-2RS SKF", kind="name")
    assert body["searchedAs"] == "6205-2RS" and body["similar"]


def test_a_plain_name_finds_pages_but_confirms_nothing(shops, client):
    body = search(client, "ремень клиновой", kind="name")
    assert body["offers"] == [] and body["similar"] == []
    assert [o["store"] for o in body["unconfirmed"]] == ["industrialmotion.kz"]


def test_store_search_off_keeps_price_lists_only(client):
    price_list(client, "Артикул;Наименование;Цена\n6205-2RS;Подшипник;4 850\n")
    body = search(client, "6205-2RS")
    assert [o["source"] for o in body["offers"]] == ["price_list"]
    assert [s["store"] for s in body["sources"]] == ["price_lists"]
    assert client.get("/api/v1/capabilities").json()["features"]["storeSearch"] is False


def test_search_validation_and_the_rate_limit(client):
    assert client.post("/api/v1/procurement/search", json={"query": " "}).json()["error"]["code"] == "VALIDATION_ERROR"
    assert client.post("/api/v1/procurement/search", json={"query": "6205", "kind": "other"}).status_code == 422
    assert client.post("/api/v1/procurement/search", json={"partId": "p1"}).status_code == 422
    assert client.post("/api/v1/procurement/search", json={"query": "6205"}, headers={"Authorization": ""}).status_code == 401


# Into the existing purchase flow ----------------------------------------------------------------------------------

def test_found_offers_reach_offers_quote_and_excel_and_stay_in_the_session(shops, client):
    use(client, None)
    document_id = ready(client)
    part = {p["partNumber"]: p for p in parts_of(client, document_id)["parts"]}["6205-2RS"]
    body = search(client, None, documentId=document_id, partId=part["id"])
    assert body["searchedAs"] == "6205-2RS"
    offers = client.post("/api/v1/procurement/offers", json={"documentId": document_id, "partIds": [part["id"]]}).json()["items"][0]
    assert offers["offers"] == []  # never a substitute
    store_offer = next(o for o in offers["similar"] if o["store"] == "bcindustry.kz" and o["partNumber"] == "6205-2RSH")
    assert store_offer["source"] == "store_catalog" and store_offer["price"] == "4805.00"

    quote = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": [
        {"partId": part["id"], "offerId": store_offer["id"], "quantity": 4}]}).json()
    line = quote["items"][0]
    assert (line["status"], line["unitPrice"], line["lineTotal"], line["matchWarning"]) == ("priced", "4805.00", "19220.00", True)
    assert any("похожий артикул 6205-2RSH" in w for w in quote["warnings"])

    no_price = next(o for o in offers["similar"] if o["partNumber"] == "6205-2Z")
    unpriced = client.post("/api/v1/procurement/quote", json={"documentId": document_id, "items": [
        {"partId": part["id"], "offerId": no_price["id"]}]}).json()
    assert unpriced["items"][0]["status"] == "no_price" and unpriced["items"][0]["unitPrice"] is None

    from openpyxl import load_workbook
    exported = client.post("/api/v1/procurement/quote/export", json={"documentId": document_id, "items": [
        {"partId": part["id"], "offerId": store_offer["id"], "quantity": 4}]})
    sheet = load_workbook(io.BytesIO(exported.content)).active
    header = [cell.value for cell in sheet[1]]
    row = dict(zip(header, [cell.value for cell in sheet[2]]))
    assert row["Поставщик"] == "bcindustry.kz" and row["Источник цены"] == "проверено на сайте"
    assert row["Совпадение артикула"].startswith("похожий") and row["DEMO"] == "нет"
    assert row["Ссылка"] == f"{BC}/catalog/bearings/6205_2rsh_podshipnik_skf/"

    other = client.__class__(client.app)
    other.headers["Authorization"] = "Bearer " + other.post("/api/v1/sessions").json()["token"]
    assert other.get("/api/v1/price-lists").json()["items"] == []
    check = other.post("/api/v1/procurement/offers/check", json={"offerIds": [store_offer["id"]]})
    assert check.status_code == 404


def test_searching_again_updates_the_same_rows(shops, client):
    search(client, "6205-2RS")
    first = client.get("/api/v1/price-lists").json()["items"]
    search(client, "6205-2RS")
    again = client.get("/api/v1/price-lists").json()["items"]
    assert len(first) == len(again) == 1 and first[0]["rows"] == again[0]["rows"] and again[0]["kind"] == "store_catalog"


def test_a_store_offer_is_checked_again_through_the_existing_check(shops, client, monkeypatch):
    search(client, "6203")
    offer = search(client, "6203")["offers"][0]
    from app import sitecheck
    monkeypatch.setattr(sitecheck, "fetch", lambda url, domains, **kw: (url, product_page("6203", "2700", sku="6203")))
    checked = client.post("/api/v1/procurement/offers/check", json={"offerIds": [offer["id"]]}).json()["items"][0]
    assert (checked["siteCheck"]["status"], checked["price"], checked["priceOrigin"]) == ("checked", "2700.00", "site_checked")


def test_demo_price_lists_stay_demo_next_to_store_offers(shops, client):
    price_list(client, "Артикул;Наименование;Цена\n6203;Подшипник;100\n", demo="true")
    body = search(client, "6203")
    by_source = {(o["source"], o["demo"]) for o in body["offers"]}
    assert by_source == {("price_list", True), ("store_catalog", False)}


# Barcodes and QR --------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("value, valid", [("4006381333931", True), ("4006381333932", False), ("96385074", True),
                                          ("036000291452", True), ("036000291453", False), ("12345", False)])
def test_check_digits(value, valid):
    assert gtin_valid(value) is valid


def test_what_a_code_holds():
    assert classify("https://industrialmotion.kz/product/x", "QR")["kind"] == "url"
    assert classify("6205-2RS", "QR")["kind"] == "partNumber"
    assert classify("Склад 3, полка 12", "QR")["kind"] == "text"
    assert classify("4006381333931", "QR")["kind"] == "gtin"
    assert find_part_number("подшипник 6205-2RS SKF") == "6205-2RS"
    assert find_part_number("Подшипник NU 210 ECP") == "NU 210 ECP"
    assert find_part_number("ремень приводной") is None


def barcode(client, **form):
    files = form.pop("files", None)
    return client.post("/api/v1/procurement/barcodes", data=form, files=files)


def test_an_unknown_barcode_is_an_honest_empty_answer(shops, client):
    body = barcode(client, text="4006381333931").json()
    assert body["codes"] == [{"format": "text", "value": "4006381333931", "valid": True, "kind": "gtin"}]
    lookup = body["lookup"]
    assert (lookup["offers"], lookup["reason"]) == ([], "gtin_not_in_sources")
    assert {s["store"]: s["reason"] for s in lookup["sources"] if s["store"] != "price_lists"} == {
        "industrialmotion.kz": "no_barcodes_published", "bcindustry.kz": "no_barcodes_published", "bearing.kz": "no_barcodes_published"}
    assert not [url for url in shops.opened if "/product/" in url]  # no shop page is opened for a bare number


def test_a_wrong_check_digit_is_said_and_not_searched(client):
    body = barcode(client, text="4006381333932").json()
    assert body["codes"][0]["valid"] is False and body["lookup"]["reason"] == "checksum_failed"


def test_a_barcode_in_a_price_list_is_found(client):
    price_list(client, "Артикул;Наименование;Цена;Штрихкод\n6205-2RS;Подшипник 6205-2RS;4 850;4006381333931\n"
                       "6203;Подшипник 6203;2 600;4006381333932\n")
    body = barcode(client, text="4006381333931").json()
    assert [(o["partNumber"], o["price"], o["barcode"]) for o in body["lookup"]["offers"]] == [("6205-2RS", "4850.00", "4006381333931")]
    # a wrong check digit in the file is not kept as a barcode
    assert barcode(client, text="4006381333932").json()["lookup"]["reason"] == "checksum_failed"


def code_image(value: str, kind: str) -> bytes:
    import numpy
    import zxingcpp
    from PIL import Image

    made = zxingcpp.create_barcode(value, getattr(zxingcpp.BarcodeFormat, kind))
    buffer = io.BytesIO()
    Image.fromarray(numpy.array(zxingcpp.write_barcode_to_image(made, scale=4))).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.mark.parametrize("kind, value, format", [("EAN13", "4006381333931", "EAN13"), ("EAN8", "96385074", "EAN8"),
                                                 ("UPCA", "036000291452", "UPCA")])
def test_linear_codes_are_read_from_a_photo(client, kind, value, format):
    body = barcode(client, files={"image": ("code.png", code_image(value, kind), "image/png")}).json()
    assert body["codes"][0] == {"format": format, "value": value, "valid": True, "kind": "gtin"}


def test_a_qr_link_to_a_listed_shop_gives_that_product(shops, client):
    url = f"{IM}/product/radialnyy-sharikopodshipnik-6203"
    body = barcode(client, files={"image": ("qr.png", code_image(url, "QRCode"), "image/png")}).json()
    assert body["codes"][0]["kind"] == "url"
    offer = body["lookup"]["offers"][0]
    assert (offer["store"], offer["partNumber"], offer["price"], offer["match"]) == ("industrialmotion.kz", "6203", "2620.00", "exact")


def test_a_qr_link_to_another_site_is_not_opened(shops, client):
    opened = len(shops.opened)
    body = barcode(client, text="https://evil.example/6205").json()
    assert body["lookup"]["reason"] == "domain_not_allowed" and len(shops.opened) == opened


def test_a_qr_with_a_part_number_searches_it(shops, client):
    body = barcode(client, text="6205-2RS").json()
    assert body["codes"][0]["kind"] == "partNumber" and body["lookup"]["similar"]


def test_barcode_errors(client):
    from PIL import Image

    blank = io.BytesIO()
    Image.new("RGB", (200, 100), "white").save(blank, "PNG")
    assert barcode(client, files={"image": ("w.png", blank.getvalue(), "image/png")}).json()["error"]["code"] == "BARCODE_NOT_FOUND"
    assert barcode(client, files={"image": ("x.png", b"not an image at all", "image/png")}).status_code == 415
    assert barcode(client).json()["error"]["code"] == "VALIDATION_ERROR"
    big = b"\xff\xd8\xff" + b"0" * (8 * 1024 * 1024)
    assert barcode(client, files={"image": ("big.jpg", big, "image/jpeg")}).status_code == 413


def test_a_slow_shop_is_skipped_when_the_search_would_run_out_of_time(tmp_path, monkeypatch):
    monkeypatch.setenv("STORE_SEARCH", "bcindustry.kz")
    clock = [0.0]
    catalog = Catalog(tmp_path, fetcher=FakeShops(), sleep=lambda s: clock.__setitem__(0, clock[0] + s),
                      monotonic=lambda: clock[0])
    catalog.refresh()
    assert catalog._wait("bcindustry.kz", deadline_at=clock[0] + 1.0) is False  # its 5 s pause would pass the deadline


def test_search_and_barcodes_have_their_own_rate_limit(store, monkeypatch):
    from fastapi.testclient import TestClient

    from app.deps import get_store
    from app.main import create_app
    from tests.conftest import relaxed_settings

    app = create_app(relaxed_settings(store, search_limit_per_minute=2))
    app.dependency_overrides[get_store] = lambda: store
    limited_client = TestClient(app)
    limited_client.headers["Authorization"] = "Bearer " + limited_client.post("/api/v1/sessions").json()["token"]
    assert limited_client.post("/api/v1/procurement/search", json={"query": "6205"}).status_code == 200
    assert limited_client.post("/api/v1/procurement/barcodes", data={"text": "6205"}).status_code == 200
    third = limited_client.post("/api/v1/procurement/search", json={"query": "6205"})
    assert third.status_code == 429 and third.json()["error"]["code"] == "RATE_LIMITED"
