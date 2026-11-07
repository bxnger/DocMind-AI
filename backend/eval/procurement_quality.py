"""Quality of the procurement chain on a running backend with a real model, item by item.

    python eval/procurement_quality.py http://127.0.0.1:8023 [--runs 2]

Uses the two fictional manuals in demo/procurement (their true contents are written below), the backend's public API
only, and writes eval/results/procurement_quality.json and .md: every expected part, every claim, every answer, so a
miss can be looked at, not only counted. Run the backend with raised limits (see docs/QUALITY-REPORT.md).
"""

import argparse
import json
import pathlib
import sys
import time
from collections import Counter

import httpx

BACKEND = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
from app.codes import normalize_code  # noqa: E402

DEMO = BACKEND / "demo" / "procurement"
RESULTS = BACKEND / "eval" / "results"

# What each manual really says: part number -> (quantity, page). Anything else the system lists is a false part.
TRUTH = {
    "tv320_manual.pdf": {
        "3182120": (1, 2), "6210-2RS": (2, 2), "6205-2RS": (4, 2), "6203": (2, 2), "NU 207 ECP": (1, 2),
        "А-1250": (3, 3), "1.2-40x60-1": (2, 3), "ФМ-12": (1, 3), "АИР100L4": (1, 3),
    },
    "kn80_pump_passport.pdf": {
        "6306-2Z": (2, 2), "7208 BEP": (1, 2), "ТУ-35": (1, 2), "045-050-30": (4, 2),
        "МУВП-2": (1, 3), "АИР132M4": (1, 3), "ФС-50": (2, 3), "РК-80": (1, 3),
    },
}
# Numbers in the manuals that are not parts: listing one of them is an error.
TRAPS = {"tv320_manual.pdf": ["1500", "2", "4"], "kn80_pump_passport.pdf": ["2025", "1250000", "2900", "6000", "1450", "11", "18"]}

# Statements -> the verdict a careful reader gives, and the page the proof is on (None for not_found).
CLAIMS = {
    "tv320_manual.pdf": [
        ("Подшипник 6205-2RS установлен в количестве 4 шт.", "supported", 2),
        ("На задней опоре шпинделя стоит подшипник 6210-2RS, 2 шт.", "supported", 2),
        ("В фартуке установлено 2 подшипника 6203.", "supported", 2),
        ("Ремень А-1250 нужен в количестве 3 шт.", "supported", 3),
        ("Мощность электродвигателя станка 4 кВт.", "supported", 3),
        ("Двигатель станка 7,5 кВт.", "contradicted", 3),
        ("В коробке скоростей стоят 2 подшипника 6205-2RS.", "contradicted", 2),
        ("Ремень А-1250 нужен в количестве 5 шт.", "contradicted", 3),
        ("Подшипники меняют не реже одного раза в 5 лет.", "contradicted", 3),
        ("Частота вращения двигателя 1500 об/мин.", "supported", 3),
        ("Станок весит 2 тонны.", "not_found", None),
        ("Гарантия на станок 12 месяцев.", "not_found", None),
        ("Цена подшипника 6205-2RS — 4 850 тенге.", "not_found", None),
        ("Станок изготовлен в Караганде.", "supported", 1),
        ("Двигатель 4 кВт, а ремень А-1250 нужен в количестве 10 шт.", "partly", 3),
    ],
    "kn80_pump_passport.pdf": [
        ("Агрегат выпущен в 2025 году.", "supported", 1),
        ("Подача насоса 80 м3/ч.", "supported", 1),
        ("Подача насоса 120 м3/ч.", "contradicted", 1),
        ("Подшипник 6306-2Z — 2 шт.", "supported", 2),
        ("Кольцо уплотнительное 045-050-30 — 2 шт.", "contradicted", 2),
        ("Электродвигатель АИР132M4 мощностью 11 кВт.", "supported", 3),
        ("Электродвигатель насоса 15 кВт.", "contradicted", 3),
        ("Гарантийный срок 18 месяцев.", "supported", 3),
        ("Гарантийный срок 24 месяца.", "contradicted", 3),
        ("Подшипники меняют каждые 6000 часов.", "supported", 2),
        ("Насос весит 320 кг.", "not_found", None),
        ("Рабочее давление насоса 16 бар.", "not_found", None),
        ("Агрегат произведён в Германии.", "not_found", None),
        ("Фильтр ФС-50 нужен в количестве 2 шт., а муфта МУВП-2 — 3 шт.", "partly", 3),
        ("Напор насоса 50 м.", "supported", 1),
    ],
}


def key(code: str | None) -> str:
    return normalize_code(code or "")


def client_for(base: str) -> httpx.Client:
    client = httpx.Client(base_url=base + "/api/v1", timeout=180)
    client.headers["Authorization"] = "Bearer " + client.post("/sessions").json()["token"]
    return client


def upload(client: httpx.Client, name: str) -> str:
    with open(DEMO / name, "rb") as fh:
        doc = client.post("/documents", files={"file": (name, fh, "application/pdf")}).json()
    while doc["status"] == "processing":
        time.sleep(1)
        doc = client.get(f"/documents/{doc['id']}").json()
    assert doc["status"] == "ready", doc
    return doc["id"]


def parts_run(client: httpx.Client, name: str) -> dict:
    document_id = upload(client, name)
    started = time.monotonic()
    client.post(f"/documents/{document_id}/parts")
    while (result := client.get(f"/documents/{document_id}/parts").json())["status"] == "processing":
        time.sleep(1)
    seconds = round(time.monotonic() - started, 1)
    truth = {key(code): (code, quantity, page) for code, (quantity, page) in TRUTH[name].items()}
    found = {}
    for part in result.get("parts", []):
        found.setdefault(key(part["partNumber"]), part)
    rows = []
    for k, (code, quantity, page) in truth.items():
        part = found.get(k)
        source = (part or {}).get("sources", [{}])[0] if part and part.get("sources") else {}
        rows.append({
            "partNumber": code, "found": part is not None, "foundAs": part and part["partNumber"],
            "quantity": part and part.get("quantity"), "quantityOk": bool(part) and part.get("quantity") == quantity,
            "expectedQuantity": quantity, "page": source.get("page"), "pageOk": source.get("page") == page,
            "verified": bool(part) and part.get("verified"), "quoteHasCode": bool(source) and _code_in(code, source.get("quote", "")),
            "highlighted": bool(source.get("highlights")), "quote": source.get("quote"),
        })
    extra = [{"partNumber": part["partNumber"], "name": part["name"], "quantity": part.get("quantity"),
              "trap": str(part["partNumber"] or "").replace(" ", "") in TRAPS[name]}
             for k, part in found.items() if k not in truth]
    return {"document": name, "status": result["status"], "seconds": seconds, "expected": rows, "extra": extra,
            "equipment": result.get("equipment"), "documentId": document_id}


def _code_in(code: str, quote: str) -> bool:
    return key(code) in key(quote)


def claims_run(client: httpx.Client, name: str, document_id: str) -> list[dict]:
    conversation = client.post("/conversations", json={"documentIds": [document_id]}).json()
    rows = []
    for claim, expected, page in CLAIMS[name]:
        for attempt in range(4):
            response = client.post(f"/conversations/{conversation['id']}/verify", json={"claim": claim})
            if response.status_code != 429:
                break
            time.sleep(15 * (attempt + 1))
        body = response.json()
        sources = body.get("sources", [])
        pages = [source.get("page") for source in sources]
        rows.append({
            "claim": claim, "expected": expected, "verdict": body.get("verdict") or f"http_{response.status_code}",
            "ok": body.get("verdict") == expected, "expectedPage": page, "pages": pages,
            "pageOk": page is None or page in pages, "explanation": body.get("explanation"), "reason": body.get("reason"),
            "quotes": [source.get("quote") for source in sources],
            "highlighted": all(source.get("highlights") for source in sources) if sources else None,
        })
        time.sleep(1)
    return rows


def camera_summary(runs: dict) -> dict:
    """From the camera stability run: {"<model> | <image>": {"truth", "runs", "falseMatched", "outcomes"}}."""
    lines = ["| Модель | Картинка | На ней написано | Повторов | Ложных matched | Ответы (статус / прочитано / читаемость / лучший кандидат: число) |",
             "|---|---|---|---|---|---|"]
    for name, row in runs.items():
        model, image = name.split(" | ")
        outcomes = "<br>".join(f"{k}: {n}" for k, n in row["outcomes"].items())
        lines.append(f"| {model} | {image} | {row['truth'] or '— (нечитаемо / без маркировки)'} | {row['runs']} | {row['falseMatched']} | {outcomes} |")
    return {"calls": sum(row["runs"] for row in runs.values()), "falseMatched": sum(row["falseMatched"] for row in runs.values()),
            "unstableImages": sum(len(row["outcomes"]) > 1 for row in runs.values()), "markdown": "\n".join(lines)}


def summarize(parts: list[dict], claims: list[dict], camera: dict | None) -> dict:
    expected = [row for run in parts for row in run["expected"]]
    extra = [row for run in parts for row in run["extra"]]
    found = [row for row in expected if row["found"]]
    summary = {
        "parts": {
            "expected": len(expected), "found": len(found), "recall": round(len(found) / len(expected), 3),
            "falseParts": len(extra), "trapsListed": sum(row["trap"] for row in extra),
            "precision": round(len(found) / (len(found) + len(extra)), 3) if found or extra else None,
            "quantityCorrect": sum(row["quantityOk"] for row in found), "pageCorrect": sum(row["pageOk"] for row in found),
            "verifiedQuotes": sum(bool(row["verified"]) for row in found), "quoteHasCode": sum(row["quoteHasCode"] for row in found),
            "highlighted": sum(row["highlighted"] for row in found),
        },
        "claims": {
            "total": len(claims), "correct": sum(row["ok"] for row in claims),
            "byExpected": {verdict: f"{sum(r['ok'] for r in claims if r['expected'] == verdict)}/{sum(r['expected'] == verdict for r in claims)}"
                           for verdict in ("supported", "contradicted", "partly", "not_found")},
            "confusion": dict(Counter(f"{row['expected']} -> {row['verdict']}" for row in claims if not row["ok"])),
            "pageCorrect": sum(row["pageOk"] for row in claims if row["ok"] and row["expectedPage"]),
            "withPage": sum(1 for row in claims if row["ok"] and row["expectedPage"]),
            "dangerous": [row["claim"] for row in claims if row["expected"] == "not_found" and row["verdict"] in ("supported", "contradicted")
                          or row["expected"] == "contradicted" and row["verdict"] == "supported"
                          or row["expected"] == "supported" and row["verdict"] == "contradicted"],
        },
    }
    if camera:
        summary["camera"] = camera
    return summary


def markdown(report: dict) -> str:
    s = report["summary"]
    p, c = s["parts"], s["claims"]
    lines = [
        f"# Качество закупочной цепочки — реальные ответы модели", "",
        f"Дата: {report['date']}. Бэкенд: `{report['commit']}`. Модель: {report['model']}. Прогонов извлечения на документ: {report['runs']}.",
        "Документы — вымышленные паспорта из `demo/procurement` (известно точное содержание). Ниже — каждый случай, не только итог.", "",
        "## Итог", "",
        "| Что | Результат |", "|---|---|",
        f"| Найдено артикулов (recall) | {p['found']}/{p['expected']} ({p['recall']:.0%}) |",
        f"| Лишние «детали» | {p['falseParts']} (из них числа-ловушки: {p['trapsListed']}) |",
        f"| Количество верное | {p['quantityCorrect']}/{p['found']} |",
        f"| Страница верная | {p['pageCorrect']}/{p['found']} |",
        f"| Цитата дословная (verified) | {p['verifiedQuotes']}/{p['found']} |",
        f"| Артикул есть в цитате | {p['quoteHasCode']}/{p['found']} |",
        f"| Подсветка на странице | {p['highlighted']}/{p['found']} |",
        f"| Проверка утверждений: верный вердикт | {c['correct']}/{c['total']} |",
        f"| … по ожидаемому вердикту | {', '.join(f'{k}: {v}' for k, v in c['byExpected'].items())} |",
        f"| Верная страница у верных вердиктов | {c['pageCorrect']}/{c['withPage']} |",
        f"| Опасные ошибки (подтвердил ложное, опроверг верное, «нашёл» то, чего нет) | {len(c['dangerous'])} |",
        "",
    ]
    if "camera" in s:
        lines += ["## Камера: повторные запросы", "", s["camera"]["markdown"], ""]
    lines += ["## Ошибки извлечения", ""]
    for run in report["parts"]:
        misses = [r for r in run["expected"] if not (r["found"] and r["quantityOk"] and r["pageOk"] and r["verified"])]
        lines.append(f"**{run['document']}** (прогон {run['run']}, {run['seconds']} с): "
                     + ("всё верно" if not misses and not run["extra"] else ""))
        for r in misses:
            what = "не найден" if not r["found"] else ", ".join(
                x for x, bad in (("количество " + str(r["quantity"]) + " вместо " + str(r["expectedQuantity"]), not r["quantityOk"]),
                                 ("страница " + str(r["page"]), not r["pageOk"]), ("цитата не дословная", not r["verified"])) if bad)
            lines.append(f"- `{r['partNumber']}`: {what}")
        for r in run["extra"]:
            lines.append(f"- лишняя деталь `{r['partNumber']}` ({r['name']}){' — число-ловушка' if r['trap'] else ''}")
        lines.append("")
    lines += ["## Проверка утверждений — каждый ответ", "", "| Утверждение | Ожидалось | Ответ | Стр. | Объяснение / причина |", "|---|---|---|---|---|"]
    for row in report["claims"]:
        mark = "✅" if row["ok"] else "❌"
        detail = (row["explanation"] or row["reason"] or "").replace("|", "/")
        lines.append(f"| {row['claim']} | {row['expected']} | {mark} {row['verdict']} | {row['pages'] or '—'} | {detail} |")
    if c["dangerous"]:
        lines += ["", "**Опасные ошибки:**"] + [f"- {claim}" for claim in c["dangerous"]]
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("--runs", type=int, default=2)
    parser.add_argument("--camera", help="report.json of the camera stability run, added to the report")
    parser.add_argument("--commit", default="?")
    parser.add_argument("--model", default="?")
    args = parser.parse_args()
    parts, claims = [], []
    for name in TRUTH:
        for run in range(1, args.runs + 1):
            client = client_for(args.base)
            result = parts_run(client, name)
            result["run"] = run
            parts.append(result)
            print(f"parts {name} run {run}: {sum(r['found'] for r in result['expected'])}/{len(result['expected'])} found, "
                  f"{len(result['extra'])} extra, {result['seconds']} s", flush=True)
            if run == 1:
                rows = claims_run(client, name, result["documentId"])
                claims += rows
                print(f"claims {name}: {sum(r['ok'] for r in rows)}/{len(rows)}", flush=True)
    camera = camera_summary(json.loads(pathlib.Path(args.camera).read_text(encoding="utf-8"))) if args.camera else None
    report = {"date": time.strftime("%Y-%m-%d %H:%M"), "commit": args.commit, "model": args.model, "runs": args.runs,
              "parts": parts, "claims": claims, "summary": summarize(parts, claims, camera)}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "procurement_quality.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    (RESULTS / "procurement_quality.md").write_text(markdown(report), encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
