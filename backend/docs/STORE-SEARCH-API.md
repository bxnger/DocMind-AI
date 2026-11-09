# Поиск по магазинам и штрихкоды: аудит, источники, план и API-контракт

Ветка `backend/store-search` (от `backend/procurement-mvp`, коммит 1a4ebab). Статус: **план, код не написан**.
Проверено 09.11.2026.

## 1. Аудит: что уже есть

| Функция | Статус | Чем подтверждено |
|---|---|---|
| Детали из документа по артикулу (кол-во, цитата, страница) | работает | `test_procurement.py`, TV-320 9/9, KN-80 8/8 (`run_demo.py`) |
| Маркировка по фото (Gemini Vision) → деталь документа | работает | `test_a_photo_is_read_by_the_model_and_matched_by_code`; на VPS `marking_6205.png` → 6205-2RS `matched` |
| Прайсы CSV/XLSX, поставщик, ссылка, наличие, дата | работает | `test_xlsx_price_list_and_export`, `test_the_sheet_says_where_each_price_and_date_came_from` |
| Точные и похожие отдельно, похожий сам не выбирается (6205-2RS ≠ 6205, ≠ 6205-2RSH) | работает | `test_offers_are_exact_matches_and_similar_ones_are_apart`; на VPS 09.11 |
| Проверка цены по ссылке (разрешённые домены, таймауты, без редиректов на чужие хосты) | работает | `test_sitecheck.py` (19 тестов); 6203 → 2 620 ₸ `site_checked` |
| Ручной выбор, количество, итог, Excel с источником и временем цены, DEMO | работает | `test_the_quote_is_computed_by_code_and_unknown_prices_stay_null`, `test_demo_price_lists_hide_links_and_bad_files_are_refused` |
| Изоляция, лимиты, CORS, секреты | работает | `test_security.py` (47), `test_an_offer_of_another_part_or_session_is_missing_not_priced` |
| **Поиск товара в магазинах по артикулу/названию** | **нет** | предложения только из загруженных прайсов |
| **Штрихкоды EAN-13/EAN-8/UPC-A, QR** | **нет** | ни в backend, ни во frontend |

Прогон 09.11: `pytest tests/test_procurement.py tests/test_sitecheck.py` → 104 passed.

## 2. Источники (проверено 09.11.2026)

Метод для всех: **публичная карта сайта (sitemap.xml) + страница товара**. Поиск на сайтах (`/search/`) закрыт в
robots.txt — им не пользуемся. Страницы товаров не закрыты; цена читается из разметки schema.org (как уже делает
проверка цены).

| Магазин | Карта сайта | Товаров | 6205* в карте | Цена со страницы 6205-2RSH | robots |
|---|---|---|---|---|---|
| industrialmotion.kz | `/sitemaps/product-1..N.xml` | ≥ 20 000 | 6205, 6205-2RSH, 6205-2RSHNR, 6205-TN9C3, W 6205-2RS1… | 4 790 ₸, в наличии | без Crawl-delay |
| bcindustry.kz | `/sitemap-iblock-4.xml` | 18 739 | 31 | 4 805 ₸, в наличии | `/search/` закрыт, Crawl-delay 5 |
| bearing.kz | `/sitemap-iblock-4.xml` | 19 602 | 31 | 4 805 ₸, в наличии | `/search/` закрыт |
| kaspi.kz | `/shop/sitemap.xml` → 351 файл по 10 000 товаров (~3,5 млн, ~350 МБ) | не искал | — | цена есть в schema.org на странице товара | `/search/` закрыт, Crawl-delay 10 |

Важно:
- **bcindustry.kz и bearing.kz, судя по всему, один дилер SKF**: одинаковый внутренний код товара (20285) и цена.
  Показывать их как два независимых предложения нечестно — объединять или помечать.
- **Точного 6205-2RS у SKF нет**: SKF продаёт 6205-2RSH (и 2RS1). По правилам backend это «похожий», не точный.
  Для «нескольких точных предложений 6205-2RS» нужен другой бренд (FAG/NSK/китайские) — в этих трёх каталогах не найден.
- **Kaspi**: публичного API поиска для покупателей нет (Merchant API — только для своих товаров продавца). Законный путь —
  только карта сайта: разовая выгрузка ~350 МБ с паузой 10 с ≈ 1 час, затем отбор подшипников. Цена на странице —
  минимальная по Kaspi без учёта города. Предлагаю как этап 2, если останется время.
- **EAN/GTIN ни на одной странице нет** (ни у трёх магазинов, ни у Kaspi в schema.org). Открытой базы «штрихкод →
  промышленная деталь» для Казахстана не нашёл. Значит, по EAN честно найти товар можно только в загруженных прайсах
  (новая необязательная колонка «Штрихкод»). Неизвестный EAN → пустая выдача с причиной.
- Библиотека декодирования: `zxing-cpp` 3.1.1 (Apache-2.0), колесо abi3 — ставится на Python 3.14, без системных DLL.

## 3. План (этап 1 — один рабочий сценарий)

1. **Каталог магазинов** (`app/catalog.py`): раз в сутки читает карты сайтов 3 магазинов (только URL, с паузами по
   robots), извлекает артикул из адреса товара, хранит индекс на диске. Поиск по индексу — без запросов к магазинам.
2. **Поиск** `POST /procurement/search`: индекс → до 8 кандидатов → страницы товаров читаются существующей проверкой цены
   (таймаут 8 с, домены из списка, ≤ 1 запрос в 5 с на магазин, кэш 30 мин). Артикул подтверждается по странице
   (`mpn`/`sku`/название), иначе `unconfirmed`. Магазин не ответил — он в `sources` со статусом, остальное работает.
3. Результаты поиска сохраняются в сессии как прайс-лист типа «каталоги магазинов» → **существующие** offers, check,
   quote и export работают с ними без изменений (offerId того же вида).
4. **Штрихкоды** `POST /procurement/barcodes`: фото или текст → формат, проверка контрольной цифры, тип QR (ссылка /
   текст / артикул). Дальше — тот же поиск. Gemini здесь не участвует.
5. Тесты (без сети, на сохранённых страницах) + живой прогон по списку из задания.

Без новых платных сервисов. VPS не меняется до согласования.

## 4. API-контракт (новое — только добавление; старое не меняется)

Все ответы — как сейчас: `camelCase`, ошибки `{"error": {"code", "message"}}`, токен сессии обязателен.

### Существующие (используются как есть)

- `POST /procurement/offers` — предложения для деталей документа. **Новое:** в `offers`/`similar` появятся предложения из
  каталогов (`source: "store_catalog"`) после поиска по этой детали. Поля старых предложений не меняются.
- `POST /procurement/offers/check` — проверка цены на сайте (и для предложений из каталога).
- `POST /procurement/quote`, `POST /procurement/quote/export` — ведомость и Excel; выбор — `offerId` в `items`.

### `POST /procurement/search` — новый

Запрос:
```json
{"query": "6205-2RS", "kind": "partNumber", "documentId": "doc_…", "partId": "part_…"}
```
`kind`: `partNumber` | `name` | `barcode`. `documentId`/`partId` необязательны: с ними результат сразу появится в
`/procurement/offers` этой детали.

Ответ 200 (есть похожие, точных нет — реальная ситуация 6205-2RS):
```json
{
  "query": "6205-2RS", "normalized": "62052RS", "kind": "partNumber",
  "offers": [],
  "similar": [
    {"id": "pl_store_…:1", "source": "store_catalog", "store": "industrialmotion.kz",
     "title": "Радиальный шарикоподшипник с уплотнениями 6205-2RSH", "partNumber": "6205-2RSH",
     "match": "close", "price": "4790.00", "currency": "KZT", "stockStatus": "available",
     "url": "https://industrialmotion.kz/product/radialnyy-sharikopodshipnik-s-uplotneniyami-6205-2rsh",
     "checkedAt": "2026-11-09T12:40:00+00:00", "priceOrigin": "site_checked", "demo": false},
    {"id": "pl_store_…:2", "source": "store_catalog", "store": "bcindustry.kz", "sameSellerAs": ["bearing.kz"],
     "title": "6205-2RSH подшипник SKF", "partNumber": "6205-2RSH", "match": "close",
     "price": "4805.00", "currency": "KZT", "stockStatus": "available",
     "url": "https://bcindustry.kz/catalog/bearings_ball_deep_groove/6205_2rsh_podshipnik_skf/",
     "checkedAt": "2026-11-09T12:40:03+00:00", "priceOrigin": "site_checked", "demo": false}
  ],
  "unconfirmed": [],
  "sources": [
    {"store": "industrialmotion.kz", "status": "ok", "candidates": 1},
    {"store": "bcindustry.kz", "status": "ok", "candidates": 1},
    {"store": "bearing.kz", "status": "ok", "candidates": 1}
  ],
  "searchedAt": "2026-11-09T12:40:05+00:00"
}
```

- `match`: `exact` (артикул подтверждён на странице) | `close` (та же основа, другой суффикс — сам не выбирается,
  в ведомости предупреждение) | `unconfirmed` (страница не прочитана или артикула на ней нет; `price` = `null`).
- `price`, `stockStatus`, `checkedAt` — только прочитанное; иначе `null` / `"unknown"`. Сортировка — по цене, `null` в конце.

Пустая выдача (200):
```json
{"query": "XYZ-999", "normalized": "XYZ999", "kind": "partNumber", "offers": [], "similar": [], "unconfirmed": [],
 "sources": [{"store": "industrialmotion.kz", "status": "ok", "candidates": 0}, …], "searchedAt": "…"}
```

Магазин недоступен (200, частичный результат):
```json
{"sources": [{"store": "bcindustry.kz", "status": "unavailable", "reason": "timeout", "candidates": 1}, …]}
```
`status`: `ok` | `unavailable` (`timeout`, `http_error`, `blocked`) | `skipped` (лимит частоты — повторить позже).

Ошибки: `422 VALIDATION_ERROR` (пустой или длинный запрос), `429 RATE_LIMITED`, `404 PART_NOT_FOUND`.

### `POST /procurement/barcodes` — новый

Запрос: `multipart` с `image` (JPEG/PNG/WebP ≤ 8 МБ) **или** JSON `{"text": "4012345678901"}` (с камеры, если frontend
сам декодирует).

Ответ 200 (EAN-13, найден в загруженном прайсе):
```json
{"codes": [{"format": "EAN13", "value": "4012345678901", "valid": true, "kind": "gtin"}],
 "lookup": {"query": "4012345678901", "kind": "barcode", "offers": [ … как в search … ], "similar": [], "unconfirmed": [],
            "sources": [{"store": "price_lists", "status": "ok", "candidates": 1}]}}
```

Неизвестный штрихкод (200, честно пусто):
```json
{"codes": [{"format": "EAN13", "value": "4600000000017", "valid": true, "kind": "gtin"}],
 "lookup": {"offers": [], "similar": [], "unconfirmed": [], "reason": "gtin_not_in_sources"}}
```

QR со ссылкой на товар разрешённого магазина → `kind: "url"`, предложение по этой странице; QR с текстом артикула →
`kind: "partNumber"`, обычный поиск; прочее → `kind: "text"`, без поиска. Ссылки на другие сайты не открываются
(`reason: "domain_not_allowed"`).

Ошибки: `422 BARCODE_NOT_FOUND` (на фото нет кода), `422 BARCODE_INVALID` (контрольная цифра не сошлась — значение
возвращается, поиск не выполняется), `415 UNSUPPORTED_IMAGE`, `413`, `429`.

### `GET /capabilities`

Добавятся `features.storeSearch` и `features.barcodes` (true, когда включено на сервере).

## 5. Открытые вопросы

1. Kaspi в этап 1 не входит (нет API поиска; только выгрузка карты сайта ~1 ч). Делать как этап 2?
2. bcindustry.kz и bearing.kz — показывать одним предложением с пометкой «тот же продавец» (предлагаю) или двумя?
3. Для демонстрации EAN нужен прайс с колонкой «Штрихкод» (у магазинов EAN нет) — подготовить учебный файл с пометкой?
