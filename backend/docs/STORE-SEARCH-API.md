# Поиск по магазинам и штрихкоды: источники, API-контракт, проверка

Ветка `backend/store-search` (от `backend/procurement-mvp` 1a4ebab). Этап 1 реализован 09.11.2026.
Всё новое — только добавления: существующие endpoints и поля не менялись.

## 1. Что было до этапа 1 (аудит 09.11)

| Функция | Статус | Чем подтверждено |
|---|---|---|
| Детали из документа по артикулу | работает | TV-320 9/9, KN-80 8/8 (`run_demo.py`) |
| Маркировка по фото (Gemini Vision) | работает, не менялась | `marking_6205.png` → 6205-2RS `matched` |
| Прайсы CSV/XLSX, поставщик, ссылка, наличие, дата | работает | `test_procurement.py` |
| Точные и похожие отдельно; 6205-2RS ≠ 6205 ≠ 6205-2RSH | работает | `test_offers_are_exact_matches_and_similar_ones_are_apart` |
| Проверка цены по ссылке | работает | `test_sitecheck.py` |
| Ручной выбор, количество, итог, Excel, DEMO | работает | `test_procurement.py` |
| Поиск в магазинах | **добавлен** | `test_store_search.py`, живой прогон ниже |
| EAN-13 / EAN-8 / UPC-A / QR | **добавлены** | `test_store_search.py`, живой прогон ниже |

## 2. Источники (проверено 09.11.2026)

Метод: **публичная карта сайта (sitemap) + страница товара**. Поиск самих сайтов (`/search/`) закрыт в их robots.txt и
не используется. Цена, наличие и артикул читаются только из разметки schema.org на странице товара.

| Магазин | В индексе | Пауза между запросами | Как используется |
|---|---|---|---|
| industrialmotion.kz | 23 243 товара (только `sitemaps/product-*.xml`) | 1 с | основной |
| bcindustry.kz | 18 733 | 5 с (Crawl-delay в robots.txt) | основной |
| bearing.kz | 19 596 | 1 с | **тот же продавец, что bcindustry.kz** (одинаковый внутренний код 20285 и цена): читается только если bcindustry.kz не ответил |
| kaspi.kz | — | — | не подключён: нет API поиска для покупателей; только выгрузка карты сайта (~350 МБ). Этап 2 при необходимости |

- Индекс собирается в фоне при старте и раз в сутки (~10 с), хранится в `DATA_DIR/catalog/index.json`. Если магазин не
  ответил при обновлении, остаются его товары из прошлого индекса.
- **Штрихкодов (EAN/GTIN) ни один магазин не публикует** (и Kaspi тоже). Штрихкод ищется только в загруженных прайсах
  (колонка «Штрихкод» / EAN / GTIN). Неизвестный штрихкод → честно пусто.
- Включение: `STORE_SEARCH=all` (или список доменов). Пусто/`off` → поиск только по прайсам пользователя.

## 3. API

Общее: токен сессии обязателен, ответы `camelCase`, ошибки `{"error": {"code", "message", ...}}`. Лимит на сессию:
`SEARCH_LIMIT_PER_MINUTE` = 20 в минуту (поиск + штрихкоды вместе), сверх — `429 RATE_LIMITED`. Магазины дополнительно
защищены паузой, одним запросом за раз и кэшем страниц на 30 минут (общий для всех).

### Что осталось как было

- `POST /procurement/offers` — предложения для деталей. После поиска в `offers` / `similar` появляются предложения
  магазинов (`source: "store_catalog"`), сортировка по цене, `null`-цены в конце.
- `POST /procurement/offers/check` — перепроверить цену (работает и для предложений магазинов).
- `POST /procurement/quote`, `POST /procurement/quote/export` — ведомость и Excel; выбор — `offerId`.
- `GET /price-lists` — результаты поиска видны как один список `kind: "store_catalog"` (его можно удалить).

### `GET /capabilities`

`features.storeSearch` (магазины включены), `features.barcodes` (сервер читает коды с фото; текст работает всегда).

### `POST /procurement/search`

```json
{"query": "6205-2RS", "kind": "partNumber"}
{"documentId": "…", "partId": "…"}              // query = артикул детали; результат сразу в /procurement/offers
{"query": "Подшипник 6205-2RS SKF", "kind": "name"}   // артикул в названии → ищется по артикулу
{"query": "4006381333931", "kind": "barcode"}         // то же, что /procurement/barcodes с text
```

Ответ 200 — **реальный ответ 09.11 для 6205-2RS** (сокращён): точных нет, похожие из двух магазинов.
```json
{
  "query": "6205-2RS", "searchedAs": "6205-2RS", "normalized": "62052RS", "kind": "partNumber", "reason": null,
  "offers": [],
  "similar": [
    {"id": "pls8c1f…:1", "source": "store_catalog", "store": "industrialmotion.kz", "supplier": "industrialmotion.kz",
     "title": "Радиальный шарикоподшипник с уплотнениями 6205-2RSH", "partNumber": "6205-2RSH", "match": "close",
     "price": "4790.00", "currency": "KZT", "stockStatus": "available", "priceOrigin": "site_checked",
     "checkedAt": "2026-11-09T12:50:46+00:00", "checkedAtOrigin": "site", "demo": false, "sameSellerAs": [],
     "url": "https://industrialmotion.kz/product/radialnyy-sharikopodshipnik-s-uplotneniyami-6205-2rsh"},
    {"id": "pls8c1f…:3", "source": "store_catalog", "store": "bcindustry.kz", "partNumber": "6205-2RSH", "match": "close",
     "price": "4805.00", "currency": "KZT", "stockStatus": "available", "priceOrigin": "site_checked",
     "checkedAt": "2026-11-09T12:50:46+00:00", "sameSellerAs": ["bearing.kz"],
     "url": "https://bcindustry.kz/catalog/bearings_ball_deep_groove/6205_2rsh_podshipnik_skf/"}
  ],
  "unconfirmed": [],
  "sources": [
    {"store": "price_lists", "status": "ok", "candidates": 0},
    {"store": "industrialmotion.kz", "status": "ok", "candidates": 3, "indexedAt": "…"},
    {"store": "bcindustry.kz", "status": "ok", "candidates": 3, "indexedAt": "…"},
    {"store": "bearing.kz", "status": "skipped", "reason": "same_seller", "sameSellerAs": "bcindustry.kz", "candidates": 0}
  ],
  "searchedAt": "2026-11-09T12:50:57+00:00"
}
```

Поля предложения — как у существующих (`id`, `supplier`, `title`, `partNumber`, `match`, `price`, `currency`,
`stockStatus`, `url`, `checkedAt`, `priceOrigin`, `demo`…), плюс у магазинных: `source: "store_catalog"`, `store`,
`sameSellerAs`.

- `match`: `exact` — артикул подтверждён на странице; `close` — та же основа, другой суффикс (сам не выбирается, в
  ведомости предупреждение «выбран похожий артикул»); `unconfirmed` — страница открыта, но артикул не подтверждён
  (`id: null`, выбрать нельзя, есть `reason`).
- `price`, `currency`, `checkedAt` — только прочитанное со страницы, иначе `null`; `stockStatus` — `available` /
  `unavailable` / `unknown`. Выбор предложения без цены даёт в ведомости `status: "no_price"`.
- Для 6205-2RS точных предложений нет: SKF продаёт 6205-2RSH / 2RS1. Это не ошибка — так и показывать.

Пустая выдача (200):
```json
{"query": "XYZ-99999", "offers": [], "similar": [], "unconfirmed": [],
 "sources": [{"store": "price_lists", "status": "ok", "candidates": 0},
             {"store": "industrialmotion.kz", "status": "ok", "candidates": 0}, …], "reason": null}
```

Неподтверждённая страница (страница названа 6203 в адресе, а в разметке другой артикул):
```json
{"unconfirmed": [{"id": null, "store": "bcindustry.kz", "match": "unconfirmed", "price": null,
                  "reason": "part_number_not_on_page", "url": "https://bcindustry.kz/…"}]}
```

Магазин недоступен — остальное работает (200):
```json
{"sources": [{"store": "bcindustry.kz", "status": "unavailable", "reason": "timeout", "candidates": 3},
             {"store": "bearing.kz", "status": "ok", "candidates": 1}, …]}
```
`status`: `ok` | `unavailable` (`timeout`, `connection_failed`, `http_5xx`, `not_indexed`, `index_building` — индекс ещё
собирается после старта, повторить через 10–20 с) | `skipped` (`same_seller`, `shop_busy` — не успели за 25 с,
`no_barcodes_published`). Поиск занимает 5–15 с при первом запросе (паузы магазинов), повторный — из кэша.

Ошибки: `422 VALIDATION_ERROR` (меньше 2 символов, нет `documentId` при `partId`), `404 PART_NOT_FOUND`,
`404` (чужой или несуществующий документ), `409 PARTS_NOT_READY`, `401`, `429 RATE_LIMITED`.

### `POST /procurement/barcodes` (multipart)

Поля: `image` (JPEG/PNG/WebP ≤ 8 МБ) **или** `text` (≤ 500 символов: значение, которое прочитала камера на телефоне,
или введённое вручную). Ответ: `{"codes": [...], "lookup": <ответ как у search>}`.

`codes[]`: `{"format": "EAN13|EAN8|UPCA|QR|text", "value", "valid": true|false|null, "kind": "gtin|url|partNumber|text"}`.
Контрольная цифра EAN/UPC проверяется кодом; Gemini не участвует.

EAN-13 найден в прайсе пользователя:
```json
{"codes": [{"format": "EAN13", "value": "4006381333931", "valid": true, "kind": "gtin"}],
 "lookup": {"kind": "barcode", "offers": [{"partNumber": "6205-2RS", "price": "4850.00", "barcode": "4006381333931", "source": "price_list", …}],
            "reason": null}}
```

Неизвестный штрихкод (реальный ответ 09.11):
```json
{"codes": [{"format": "text", "value": "4006381333931", "valid": true, "kind": "gtin"}],
 "lookup": {"offers": [], "similar": [], "unconfirmed": [], "reason": "gtin_not_in_sources",
            "sources": [{"store": "price_lists", "status": "ok", "candidates": 0},
                        {"store": "industrialmotion.kz", "status": "skipped", "reason": "no_barcodes_published", "candidates": 0}, …]}}
```

Неверная контрольная цифра: `valid: false`, `lookup.reason: "checksum_failed"`, поиск не выполняется.

QR:
- ссылка на товар магазина из списка → `lookup.offers[0]` — этот товар (`match: "exact"`, цена со страницы);
- ссылка на другой сайт → `reason: "domain_not_allowed"`, сайт **не открывается**;
- артикул (`6205-2RS`) → обычный поиск; текст с артикулом внутри → поиск по нему; прочий текст → `reason: "not_a_product_code"`.

Ошибки: `422 BARCODE_NOT_FOUND` (на фото нет кода), `415 UNSUPPORTED_IMAGE`, `413 IMAGE_TOO_LARGE`,
`422 VALIDATION_ERROR` (нет ни фото, ни текста), `429 RATE_LIMITED`, `503 BARCODES_UNAVAILABLE` (на сервере не
установлен zxing-cpp; см. `features.barcodes`).

### Прайсы: новая необязательная колонка

«Штрихкод» / «EAN» / «GTIN» / «UPC». Значение с неверной контрольной цифрой не сохраняется как штрихкод.

## 4. Проверка (09.11.2026)

Тесты без сети: `tests/test_store_search.py` — 40 тестов (индекс, 6205-2RS / 6205 / 6203, недоступный магазин,
пустая выдача, неподтверждённая страница, поиск по названию, offers → quote → Excel, изоляция сессий, перепроверка,
DEMO рядом с магазинами, контрольные цифры, EAN-13/EAN-8/UPC-A/QR с картинки, чужие ссылки, ошибки, лимиты).

Живой прогон на локальном сервере ветки (реальные магазины, Gemini): `eval/results/store_search_live.json`,
Excel `eval/results/store_search_tv320.xlsx`. Все 13 шагов OK:

| Проверка | Результат |
|---|---|
| TV-320: детали | 9/9 |
| Фото маркировки (Gemini) | 6205-2RS `matched` |
| 6205-2RS | точных 0; похожие: industrialmotion.kz 6205-2RSH 4 790 ₸, bcindustry.kz 6205-2RSH 4 805 ₸ (+ /C3, 2RSL), 11 с |
| 6205 | точные: industrialmotion.kz 3 650 ₸, bcindustry.kz 3 675 ₸; 6205-2Z/Z/N — только похожие |
| 6203 | точные: 2 620 ₸ и 2 630 ₸, перепроверка через `/offers/check` — `checked` |
| Неизвестный EAN-13 | пусто, `gtin_not_in_sources` |
| EAN-13 с картинки | прочитан, контрольная цифра верна |
| QR со ссылкой на industrialmotion.kz | товар 6203, 2 620 ₸ |
| QR со ссылкой на чужой сайт | не открыт, `domain_not_allowed` |
| Ведомость: магазин + DEMO | итог 38 740 ₸; предупреждения «похожий артикул» и «DEMO» |
| Excel | поставщик-магазин, «проверено на сайте», время по Казахстану; DEMO-строка помечена |
| Регрессия `run_demo.py` | TV-320 9/9, KN-80 8/8, все шаги кроме CORS `https://localhost` (у локального сервера его нет в списке) |

## 5. Что не сделано и ограничения

- Kaspi — не подключён (см. раздел 2).
- Штрихкод → товар только через прайсы пользователя: открытой базы для промышленных деталей нет.
- Поиск по названию без артикула ищет слова в адресах товаров (транслит) и ничего не подтверждает (`unconfirmed`).
- Первый поиск — 5–15 с из-за пауз магазинов (bcindustry.kz просит 5 с между запросами).
- На VPS не выкладывалось. Для выкладки: `pip install -r requirements.txt` (добавлены `zxing-cpp`, `pillow`),
  `STORE_SEARCH=all` в `/etc/docmind/backend.env`.
