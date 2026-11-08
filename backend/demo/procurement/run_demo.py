"""The demo path, end to end through the API, as the mobile app walks it. Repeatable: run it before every demo.

    python demo/procurement/run_demo.py https://<backend> tv320   # manual -> photo 6205 -> real prices -> site check -> XLSX
    python demo/procurement/run_demo.py https://<backend> kn80    # pump passport -> real prices -> XLSX (no photo for it)

Writes eval/results/demo_<name>.json (every step, what was expected, what came) and demo_<name>.xlsx, and exits 1 when
an expectation fails. Calls Gemini a few times (parts, photo); the site check reads two real supplier pages.
"""

import io
import json
import sys
import time
from pathlib import Path

import httpx
from openpyxl import load_workbook

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent.parent / "eval" / "results"
SCENARIOS = {
    "tv320": {
        "document": "tv320_manual.pdf",
        "parts": {"3182120": 1, "6210-2RS": 2, "6205-2RS": 4, "6203": 2, "NU 207 ECP": 1, "А-1250": 3,
                  "1.2-40x60-1": 2, "ФМ-12": 1, "АИР100L4": 1},
        "photo": ("marking_6205.png", "6205-2RS"),
        # The real list has plain 6203 and 6205. 6203 is the same part; 6205 is not 6205-2RS (no seals): only "similar".
        "exact": {"6203": "6203"},
        "similar": {"6205-2RS": "6205"},
    },
    "kn80": {
        "document": "kn80_pump_passport.pdf",
        "parts": {"6306-2Z": 2, "7208 BEP": 1, "ТУ-35": 1, "045-050-30": 4, "МУВП-2": 1, "АИР132M4": 1, "ФС-50": 2,
                  "РК-80": 1},
        "photo": None,
        "exact": {},
        "similar": {},
    },
}


def norm(code: str) -> str:
    return "".join(ch for ch in (code or "").upper().translate(str.maketrans("АВЕКМНОРСТХ", "ABEKMHOPCTX")) if ch.isalnum())


def wait(client: httpx.Client, url: str, seconds: int = 180) -> dict:
    for _ in range(seconds):
        body = client.get(url).json()
        if body.get("status") not in ("processing", "queued"):
            return body
        time.sleep(1)
    raise TimeoutError(url)


def run(base: str, name: str) -> dict:
    scenario = SCENARIOS[name]
    api = base.rstrip("/") + "/api/v1"
    log: dict = {"scenario": name, "backend": base, "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": [], "failures": []}

    def step(title: str, ok: bool, detail: object) -> None:
        log["steps"].append({"step": title, "ok": ok, "detail": detail})
        if not ok:
            log["failures"].append(title)
        print(("OK  " if ok else "FAIL"), title, json.dumps(detail, ensure_ascii=False)[:300])

    # The Android app's origin: the same CORS path the phone takes.
    c = httpx.Client(timeout=120, headers={"Origin": "https://localhost"})
    health = c.get(api + "/health")
    step("health", health.status_code == 200 and health.headers.get("access-control-allow-origin") == "https://localhost",
         {"status": health.status_code, "cors": health.headers.get("access-control-allow-origin")})
    features = c.get(api + "/capabilities").json()["features"]
    step("capabilities", all(features.get(k) for k in ("parts", "photoIdentify", "priceLists", "priceCheck")), features)
    c.headers["Authorization"] = "Bearer " + c.post(api + "/sessions").json()["token"]

    # 1. Document -> parts
    with open(HERE / scenario["document"], "rb") as fh:
        doc = c.post(api + "/documents", files={"file": (scenario["document"], fh, "application/pdf")}).json()
    doc = wait(c, f"{api}/documents/{doc['id']}")
    step("document ready", doc["status"] == "ready", {"pages": doc.get("pageCount"), "status": doc["status"]})
    c.post(f"{api}/documents/{doc['id']}/parts")
    parts = wait(c, f"{api}/documents/{doc['id']}/parts")
    found = {norm(p["partNumber"]): p for p in parts["parts"] if p["partNumber"]}
    rows = []
    for code, quantity in scenario["parts"].items():
        part = found.get(norm(code))
        rows.append({"partNumber": code, "found": bool(part), "quantity": part and part["quantity"], "expected": quantity,
                     "verified": bool(part) and part["verified"], "page": part and part["sources"][0]["page"]})
    extra = sorted(p["partNumber"] for p in parts["parts"] if norm(p["partNumber"]) not in {norm(k) for k in scenario["parts"]})
    all_ok = all(r["found"] and r["quantity"] == r["expected"] and r["verified"] for r in rows)
    step(f"parts {sum(r['found'] for r in rows)}/{len(rows)}, quantities and quotes", all_ok, {"parts": rows, "extra": extra})
    by_code = {norm(p["partNumber"]): p for p in parts["parts"] if p["partNumber"]}

    # 2. Photo -> part (only a clear exact match is "matched"; the user still confirms)
    confirmation_id = None
    if scenario["photo"]:
        photo, expected = scenario["photo"]
        with open(HERE / photo, "rb") as fh:
            result = c.post(f"{api}/documents/{doc['id']}/parts/identify", files={"image": (photo, fh, "image/png")}).json()
        matches = [(m.get("partNumber"), m.get("match")) for m in result.get("matches", [])]
        ok = result.get("matchStatus") == "matched" and matches[:1] and norm(matches[0][0]) == norm(expected)
        step(f"photo {photo} -> {expected}", bool(ok), {"matchStatus": result.get("matchStatus"), "matches": matches,
                                                         "read": result.get("recognized", {}).get("partNumber")})
        if ok:
            part = by_code[norm(expected)]
            confirmed = c.post(f"{api}/documents/{doc['id']}/parts/{part['id']}/confirmations", json={
                "recognizedText": result["recognized"].get("text") or "", "recognizedPartNumber": result["recognized"].get("partNumber"),
                "decision": "confirmed"}).json()
            confirmation_id = confirmed.get("id")
            step("user confirms the photo match", bool(confirmation_id), {"confirmationId": confirmation_id})

    # 3. Real price list -> offers (exact and similar kept apart)
    with open(HERE / "real_prices_kz.csv", "rb") as fh:
        price_list = c.post(api + "/price-lists", files={"file": ("real_prices_kz.csv", fh, "text/csv")}).json()
    step("real price list", price_list.get("rows") == 5 and not price_list.get("isDemo"),
         {"rows": price_list.get("rows"), "skipped": price_list.get("skipped"), "isDemo": price_list.get("isDemo")})
    part_ids = [p["id"] for p in parts["parts"]]
    offers = {norm(i["partNumber"]): i for i in c.post(api + "/procurement/offers",
                                                         json={"documentId": doc["id"], "partIds": part_ids}).json()["items"]}
    for code, row in scenario["exact"].items():
        item = offers.get(norm(code), {})
        step(f"{code}: exact offer {row}", [norm(o["partNumber"]) for o in item.get("offers", [])] == [norm(row)],
             {"offers": [(o["partNumber"], o["price"], o["match"]) for o in item.get("offers", [])]})
    for code, row in scenario["similar"].items():
        item = offers.get(norm(code), {})
        ok = not item.get("offers") and [norm(o["partNumber"]) for o in item.get("similar", [])] == [norm(row)]
        step(f"{code}: {row} only as similar, never exact", ok,
             {"offers": [(o["partNumber"], o["match"]) for o in item.get("offers", [])],
              "similar": [(o["partNumber"], o["match"]) for o in item.get("similar", [])]})
    unpriced = sorted(i["partNumber"] for i in offers.values() if not i.get("offers"))
    log["noExactOffer"] = unpriced

    # 4. Site check of the offers the quote will use
    chosen = {code: offers[norm(code)]["offers"][0] for code in scenario["exact"] if offers.get(norm(code), {}).get("offers")}
    if chosen:
        checked = c.post(api + "/procurement/offers/check", json={"offerIds": [o["id"] for o in chosen.values()]}).json()["items"]
        for item in checked:
            site = item["siteCheck"]
            step(f"site check {item['offerId']}", site["status"] == "checked" and item["priceOrigin"] == "site_checked",
                 {"priceOrigin": item["priceOrigin"], "price": item["price"], "filePrice": item["filePrice"],
                  "reason": site["reason"], "checkedAt": site["checkedAt"], "url": site["url"]})
        chosen = {code: o for code, o in ((code, offers_after) for code, offers_after in (
            (code, c.post(api + "/procurement/offers", json={"documentId": doc["id"], "partIds": [by_code[norm(code)]["id"]]}).json()["items"][0]["offers"][0])
            for code in chosen))}

    # 5. Quote and XLSX: every part, priced only where an exact offer exists
    items = []
    for part in parts["parts"]:
        item = {"partId": part["id"]}
        offer = chosen.get(next((code for code in chosen if norm(code) == norm(part["partNumber"])), ""), None)
        if offer:
            item["offerId"] = offer["id"]
        if confirmation_id and scenario["photo"] and norm(part["partNumber"]) == norm(scenario["photo"][1]):
            item["confirmationId"] = confirmation_id
        items.append(item)
    body = {"documentId": doc["id"], "items": items}
    quote = c.post(api + "/procurement/quote", json=body).json()
    priced = [(i["partNumber"], i["quantity"], i["unitPrice"], i["lineTotal"], i["offer"]["priceOrigin"] if i["offer"] else None)
              for i in quote["items"] if i["status"] == "priced"]
    step("quote", bool(quote.get("items")) and all(i["status"] in ("priced", "no_price") for i in quote["items"]),
         {"priced": priced, "totals": quote.get("totals"), "warnings": quote.get("warnings")})
    export = c.post(api + "/procurement/quote/export", json=body)
    out = RESULTS / f"demo_{name}.xlsx"
    out.write_bytes(export.content)
    sheet = load_workbook(io.BytesIO(export.content)).active
    header = [cell.value for cell in sheet[1]]
    sheet_rows = [dict(zip(header, [cell.value for cell in row])) for row in sheet.iter_rows(min_row=2)]
    step("xlsx", export.status_code == 200 and len(sheet_rows) >= len(parts["parts"]),
         {"file": out.name, "columns": len(header),
          "priced": [{k: r.get(k) for k in ("Артикул", "Кол-во", "Цена", "Источник цены", "Проверено (время Казахстана, UTC+5)",
                                            "Совпадение артикула", "Наличие")} for r in sheet_rows if r.get("Источник цены")]})
    log["finishedAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
    return log


if __name__ == "__main__":
    base, name = sys.argv[1], sys.argv[2]
    RESULTS.mkdir(parents=True, exist_ok=True)
    result = run(base, name)
    (RESULTS / f"demo_{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("failures:", result["failures"] or "none")
    sys.exit(1 if result["failures"] else 0)
