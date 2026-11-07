# DOCMIND INDUSTRY: производство и закупки — API-контракт

Статус: **согласован** (Samir, issue #23). Ветка `backend/procurement-mvp`.
Реализовано: разделы 0–4 и 6 (детали, фото, подтверждения, прайсы, предложения, проверка цены на сайте, расчёт,
выгрузка, проверка утверждения). **Не реализовано: раздел 5 (HR)** — пока `features.hr = false`.
**Что добавлено 8 ноября** (всё только добавления, прежние поля и статусы не менялись) — в разделе «Ревизия 3» в конце.
Ревизия 2: учтены замечания из issue #23 (подтверждение после фото, наличие, происхождение цен, capabilities,
поведение при удалении прайса). Список изменений — в конце файла.
Всё под `/api/v1`, авторизация как сейчас: `Authorization: Bearer <token>` гостевой сессии.
Ошибки в общем формате: `{"error": {"code", "message", "retryable", "requestId"}}`.

Главная цепочка MVP (категория — **подшипники**):
технический документ → список деталей → фото маркировки → проверка соответствия → предложения поставщиков → расчёт закупки.

## Общие правила (важно для фронтенда)

- **Деньги — строки, не числа:** `"12500.00"`. Валюта отдельным полем (`"KZT"`, `"USD"`, `"RUB"`, `"EUR"`).
  Суммы считает код (Decimal), не ИИ. Разные валюты не складываются и не конвертируются: итог по каждой валюте отдельно.
- **Неизвестная цена — `null`,** никогда не 0 и не «примерно».
- **Каждая извлечённая деталь имеет источник** в том же формате, что и в чате (`Source`): страница, цитата, подсветка.
  Артикул показывается, только если он найден в тексте документа слово в слово (`verified: true`).
- Долгие операции (извлечение деталей, HR) — как Compare: `202` + опрос `GET` раз в 1–2 с, пока `status == "processing"`.
- Языки ответа: `kk`, `ru`, `en` (как в чате).

### Общий тип `Source` (уже есть в чате)
```json
{
  "index": 1,
  "documentId": "d1",
  "documentName": "Паспорт станка ТС-16.pdf",
  "page": 12,
  "location": null,
  "quote": "Подшипник 6205-2RS — 2 шт. (шпиндель, задняя опора)",
  "highlights": [{"x": 0.12, "y": 0.40, "w": 0.55, "h": 0.02}],
  "paragraph": null
}
```
`highlights` — для PDF (как сейчас), `paragraph` — для DOCX.

---

## 0. Возможности: `GET /capabilities` (расширение)
Только добавления: все текущие поля (`version`, `languages`, `ocr`, `docxPreview`, `comparison`, `highlights`, `limits`)
остаются с прежним смыслом. Новые: объект `features` и `limits.maxImageBytes`. `languages` теперь заполнен, когда есть OCR.
`ocr` по-прежнему означает **OCR сканированных PDF** (Tesseract). Распознавание фото детали — отдельная функция `features.photoIdentify` (Gemini).
```json
{
  "version": "0.4.0",
  "languages": ["kk", "ru", "en"],
  "ocr": true,
  "features": {
    "claimCheck": true,
    "parts": true,
    "photoIdentify": true,
    "priceLists": true,
    "procurement": true,
    "hr": false,
    "priceCheck": false
  },
  "limits": {"maxFileSizeBytes": 20971520, "maxPages": 300, "maxDocumentsPerConversation": 5, "maxImageBytes": 8388608}
}
```
`photoIdentify` = `false`, если не настроен Gemini (запасной Groq не читает картинки) — тогда кнопку фото скрыть.

---

## 1. Детали из технической документации

### `POST /documents/{documentId}/parts` → `202`
Запускает извлечение. Повторный вызов не запускает заново, а возвращает текущий результат.
Тело (необязательно): `{"category": "bearing", "language": "ru"}`. `category` — фильтр; без него — все категории.

### `GET /documents/{documentId}/parts` → `200` `PartList`
`404 PARTS_NOT_STARTED`, если извлечение не запускали.
```json
{
  "documentId": "d1",
  "status": "ready",
  "progress": 1.0,
  "error": null,
  "equipment": {
    "name": "Станок токарный",
    "model": "ТС-16",
    "manufacturer": "Завод N",
    "sources": [ /* Source */ ]
  },
  "parts": [
    {
      "id": "p1",
      "category": "bearing",
      "name": "Подшипник шариковый радиальный",
      "partNumber": "6205-2RS",
      "manufacturer": "SKF",
      "quantity": 2,
      "unit": "шт",
      "specs": [
        {"name": "Внутренний диаметр", "value": "25", "unit": "мм", "origin": "document"},
        {"name": "Наружный диаметр", "value": "52", "unit": "мм", "origin": "standard"},
        {"name": "Ширина", "value": "15", "unit": "мм", "origin": "standard"}
      ],
      "location": "Шпиндель, задняя опора",
      "verified": true,
      "sources": [ /* Source */ ]
    }
  ],
  "summary": {"total": 14, "byCategory": {"bearing": 6, "seal": 4, "belt": 2, "other": 2}, "unverified": 1}
}
```
- `status`: `processing` | `ready` | `failed` (`error` = `{code, message}`).
- `category`: `bearing` | `seal` | `belt` | `filter` | `fastener` | `motor` | `electrical` | `hydraulic` | `other`.
- `quantity`: число или `null` (если в документе не указано — не выдумываем).
- `specs[].origin`: `document` — значение есть в документе (есть источник); `standard` — вычислено кодом по стандартному
  обозначению подшипника (например, 6205 → 25×52×15 мм), **не ИИ**. Фронтенд может пометить такие значения «по стандарту».
- `verified: false` — артикул не найден в тексте дословно (например, ИИ собрал его из частей). Такие позиции **приходят
  в том же списке `parts`** (бэкенд их не скрывает); фронтенд показывает их отдельной группой «Требует проверки» с
  предупреждением и источниками, чтобы пользователь мог открыть страницу и проверить. Количество — в `summary.unverified`.

---

## 2. Фото маркировки или шильдика

### `POST /documents/{documentId}/parts/identify` → `200` `PhotoMatch`
`multipart/form-data`: поле `image` (JPEG, PNG или WebP, до 8 МБ), необязательное `language`.
Фото **не сохраняется** на сервере. Требует, чтобы детали документа уже были извлечены:
- `404 PARTS_NOT_STARTED` — `POST /documents/{documentId}/parts` для этого документа ещё не вызывали;
- `409 PARTS_NOT_READY` — извлечение запущено, но список не `ready` (ещё `processing` или `failed`).

Обе ошибки возвращаются до вызова модели и не тратят дневной лимит ИИ. Те же два ответа дают
`POST /procurement/offers`, `/procurement/quote` и `/procurement/quote/export`.
```json
{
  "matchStatus": "needs_confirmation",
  "recognized": {
    "text": "SKF 6205-2RSH  C3  MADE IN ...",
    "partNumber": "6205-2RSH",
    "manufacturer": "SKF",
    "markings": ["C3"],
    "readability": "medium",
    "visibleMarkings": ["SKF", "6205-2RSH", "C3"],
    "partType": "bearing",
    "confidence": "high",
    "issues": []
  },
  "matches": [
    {"partId": "p1", "partNumber": "6205-2RS", "name": "Подшипник шариковый радиальный",
     "match": "close", "difference": "На фото 6205-2RSH, в документе 6205-2RS", "sources": [ /* Source */ ]}
  ],
  "message": "Похоже на позицию p1, но обозначение отличается. Подтвердите вручную.",
  "tips": []
}
```

**Анализ детали по фото (экспериментально, согласовано 8 ноября).** Основная и надёжная функция — чтение маркировки;
анализ внешнего вида — экспериментальный. Обратная совместимость: прежние поля и значения статусов не менялись,
новые поля **необязательные** для клиента (бэкенд их всегда присылает, но фронтенд может их не читать):
- `recognized.visibleMarkings` — все отдельные надписи, которые модель прочитала (обозначение, бренд, коды, клейма),
  как написано. Только прочитанное, ничего не додумано.
- `recognized.partType` — вид детали по её форме: `bearing` | `seal` | `belt` | `filter` | `fastener` | `motor` |
  `electrical` | `hydraulic` | `other` | `unknown`. Это оценка модели, а не факт.
- `recognized.confidence` — уверенность модели **в виде детали** (`partType`, не в артикуле): `high` | `medium` | `low`,
  словами, без выдуманных процентов. При `unknown` всегда `low`. Надёжность артикула — по-прежнему `readability`.
- `recognized.issues` — что мешает на фото: `glare` | `blur` | `angle` | `partial` | `dark` | `far` | `no_marking` | `not_a_part`.
- `tips` — подсказки, как переснять, на языке ответа (по одной на каждую проблему; при `unreadable` хотя бы одна).
- Новое значение `matchStatus: "type_only"` и `matches[].match: "type"`: артикул **не прочитан**, но вид детали
  определён уверенно (`high` или `medium`), и в документе от 1 до 5 деталей этого вида. Это **кандидаты**, а не совпадение:
  `recognized.partNumber` остаётся `null`, у каждого кандидата есть `difference`. Пользователь выбирает и подтверждает.
  Если деталей этого вида больше 5 или нет вовсе — `unreadable`. `type_only` означает **только совпадение вида детали,
  никогда не совпадение артикула**: без подтверждения пользователя (`confirmations`) позицию в закупку не добавлять.
  Фронтенд, который ещё не знает `type_only`, должен показывать его как `needs_confirmation`.
- Если артикул совпал точно, но на фото уверенно (`high`) видна деталь другого вида (например, двигатель вместо
  подшипника) — `needs_confirmation` вместо `matched`, в `difference` об этом сказано.
- Артикул по форме детали **никогда не угадывается**.
- `matchStatus` — это **автоматическое сопоставление кодом, а не подтверждение человеком**:
  - `matched` — артикул с фото совпал ровно с одной деталью документа (после нормализации пробелов, дефисов и похожих букв),
    **и** фото чистое: `readability: high` и в `issues` нет `glare`, `blur`, `angle`, `partial`, `dark`, `far`
    (с 8 ноября: блик может скрыть последнюю букву, и 6205-2RSH читается как 6205-2RS). Иначе — `needs_confirmation`;
  - `needs_confirmation` — совпадение неточное или кандидатов несколько: **показать кандидатов и спросить пользователя**;
  - `no_match` — прочитано, но в документе такой детали нет;
  - `type_only` — артикул не прочитан, предложены детали документа того же вида (см. выше): выбрать и подтвердить;
  - `unreadable` — маркировку не удалось прочитать надёжно (размыто, блик): попросить переснять, показать `tips`.
- `matches[].match`: `exact` | `close` | `partial` | `type`. Решение о совпадении принимает **код**, ИИ только читает текст на фото.
- «Подтверждено» появляется **только** после явного действия пользователя (ниже), даже при `matched`.
- Фото не сохраняется: превью фронтенд показывает локально; при повторе пользователь загружает фото заново.

Ошибки: `413 IMAGE_TOO_LARGE`, `415 UNSUPPORTED_IMAGE`, `503 VISION_UNAVAILABLE`.

### `POST /documents/{documentId}/parts/{partId}/confirmations` → `201` `Confirmation`
Пользователь подтверждает (или отклоняет) соответствие фото и детали. Тело:
```json
{"recognizedText": "SKF 6205-2RSH  C3", "recognizedPartNumber": "6205-2RSH", "decision": "confirmed"}
```
`decision`: `confirmed` | `rejected`. Ответ:
```json
{"id": "c1", "partId": "p1", "decision": "confirmed", "recognizedPartNumber": "6205-2RSH",
 "documentPartNumber": "6205-2RS", "confirmedBy": "user", "createdAt": "2026-11-08T10:18:00Z"}
```
Хранится в сессии вместе с документом. `GET /documents/{documentId}/parts/{partId}/confirmations` → `{"items": [Confirmation]}`.
В закупке позиция получает `identification` (раздел 4).

---

## 3. Поставщики и цены

MVP: **импорт прайсов CSV/XLSX**. Поиска по сайтам магазинов нет (поле `source: "web"` зарезервировано). С 8 ноября
есть **проверка цены по ссылке из прайса** на сайтах из разрешённого списка (`POST /procurement/offers/check`, ниже).

### `POST /price-lists` → `201` `PriceList`
`multipart/form-data`: `file` (CSV или XLSX, до 5 МБ), необязательно `supplier`, `currency` (по умолчанию `KZT`),
`checkedAt` (дата цен, `YYYY-MM-DD`), `demo` (`true` для тестовых прайсов).
Колонки распознаются по заголовкам (рус., каз., англ.): артикул / наименование / цена / валюта / наличие / ссылка / поставщик / дата /
производитель (с 8 ноября).
Минимум: артикул или наименование + цена.
```json
{
  "id": "pl1",
  "supplier": "ТОО Подшипник-Центр",
  "fileName": "price_november.xlsx",
  "rows": 1240,
  "skipped": [{"row": 17, "reason": "Нет цены"}],
  "checkedAt": "2026-11-08",
  "checkedAtOrigin": "upload_form",
  "demo": false,
  "importedAt": "2026-11-08T10:15:00Z"
}
```
- **Цены, даты и наличие — это данные файла поставщика, а не живая проверка сайта.** `checkedAtOrigin`:
  `file` (колонка даты в файле) | `upload_form` (поле при загрузке) | `import_date` (ничего не указано — дата импорта).
- Демо-прайсы (`demo: true`) помечаются во всех предложениях; в них нет ссылок на настоящие магазины.
  Демо-поставщики называются явно вымышленно, их нельзя выдавать за настоящих.
### `GET /price-lists` → `{"items": [PriceList]}`  ·  `DELETE /price-lists/{id}` → `204`
Прайсы принадлежат сессии, как документы.

### `POST /procurement/offers` → `200`
Тело: `{"documentId": "d1", "partIds": ["p1", "p2"]}`
```json
{
  "items": [
    {
      "partId": "p1",
      "partNumber": "6205-2RS",
      "offers": [
        {
          "id": "pl1:17",
          "supplier": "ТОО Подшипник-Центр",
          "title": "Подшипник 6205-2RS SKF",
          "partNumber": "6205-2RS",
          "match": "exact",
          "price": "4850.00",
          "currency": "KZT",
          "stockStatus": "available",
          "stockQuantity": 40,
          "url": null,
          "source": "price_list",
          "priceListId": "pl1",
          "sourceRow": 17,
          "checkedAt": "2026-11-08",
          "checkedAtOrigin": "file",
          "demo": false
        }
      ],
      "similar": [
        {"id": "pl1:18", "partNumber": "6205-2RSH", "match": "close", "price": "5100.00", "currency": "KZT",
         "stockStatus": "unknown", "stockQuantity": null, "...": "остальные поля как у offers"}
      ]
    },
    {"partId": "p2", "partNumber": "NU 210 ECP", "offers": [], "similar": []}
  ]
}
```
- `offers` — только **точное** совпадение артикула (после нормализации), сортировка по цене.
- `similar` — похожие артикулы (`close`): **не считаются совместимыми автоматически**, показываются отдельно с пометкой
  «проверьте совместимость»; бэкенд никогда не выбирает их сам.
- `stockStatus`: `available` | `unavailable` | `unknown`. Нет колонки или пустая ячейка → `unknown` (не `unavailable`).
  `stockQuantity` — число или `null`.
- `url` — только если ссылка есть в файле; иначе `null`. `sourceRow` — номер строки в файле (для проверки).
- `id` предложения = `<priceListId>:<строка>`: стабилен, пока прайс не удалён.
- Пустые `offers` и `similar` — «предложений нет».
- **Новые поля (8 ноября, необязательные для клиента):** `priceOrigin` (`file` | `site_checked`), `filePrice`
  (цена из файла, всегда), `siteCheck` (`null`, пока не проверяли, или `SiteCheck` ниже). При `site_checked` поля
  `price`, `currency`, `checkedAt` (дата-время проверки), `url` (итоговый адрес страницы) и `stockStatus` (если сайт его
  указал) — **с сайта**, `checkedAtOrigin: "site"`. Во всех остальных случаях — как раньше, из файла.
- `manufacturer` — производитель из колонки прайса «Производитель / Бренд / Марка / Manufacturer / Brand / Өндіруші»,
  иначе `null` (никогда не угадывается по названию). `priceListFile` — имя файла прайса.
- **Дата цены:** `checkedAtOrigin: "import_date"` значит, что в прайсе не было даты и в `checkedAt` стоит **дата загрузки
  файла, а не дата проверки цены** — показывать её как «загружено …», не как «цена от …».

### `POST /procurement/offers/check` → `200` (новое, 8 ноября)
Проверка цены предложения на странице поставщика (ссылка из прайса). Тело: `{"offerIds": ["pl1:17", "pl1:18"]}`, до 10.
```json
{
  "items": [
    {"offerId": "pl1:17", "priceOrigin": "site_checked", "price": "4650.00", "currency": "KZT", "filePrice": "4850.00",
     "siteCheck": {"status": "checked", "reason": null, "price": "4650.00", "currency": "KZT", "stockStatus": "available",
                   "checkedAt": "2026-11-08T10:30:00+00:00", "url": "https://shop.kz/p/6205-2rs"}},
    {"offerId": "pl1:18", "priceOrigin": "file", "price": "5100.00", "currency": "KZT", "filePrice": "5100.00",
     "siteCheck": {"status": "failed", "reason": "no_product_data", "price": null, "currency": null,
                   "stockStatus": "unknown", "checkedAt": "2026-11-08T10:30:01+00:00", "url": "https://shop.kz/p/6205-2rsh"}}
  ]
}
```
- **`site_checked` ставится только после успешной реальной проверки**: страница открыта, на ней опубликованы данные товара
  (schema.org `Product`/`Offer` в JSON-LD или микроразметке, либо `product:price:*`), товар назван **тем же артикулом**
  (точное совпадение после нормализации), цена одна, больше нуля и с валютой. Ссылка сама по себе ничего не меняет.
- При любой неудаче цена остаётся из файла (`priceOrigin: "file"`), в `siteCheck.reason` причина:
  `check_disabled` (не настроен список сайтов) · `no_url` · `no_part_number` · `demo_price_list` · `not_https` · `bad_url` ·
  `bad_port` · `ip_address_host` · `domain_not_allowed` · `dns_failed` · `private_address` · `unverified_connection` ·
  `bad_redirect` · `too_many_redirects` · `timeout` · `connection_failed` · `http_<код>` · `not_html` · `page_too_large` ·
  `no_product_data` · `part_number_not_on_page` · `several_prices` · `no_price` · `no_currency`.
- Результат хранится в строке прайса: дальше `/procurement/offers`, `quote` и `export` берут его сами.
  Новая неудачная проверка возвращает цену из файла.
- Текст страницы не передаётся модели и не выполняется: читаются только поля данных о товаре.
- **Безопасность адреса** (адрес пришёл из файла пользователя): только `https` и порт 443; без `user:password@`; хост —
  только из списка `PRICE_CHECK_DOMAINS` (или его поддомен), не IP-адрес; **все** IP, в которые резолвится имя, должны быть
  публичными — запрещены localhost, частные сети, `169.254.0.0/16` (metadata облаков), `100.64.0.0/10`, IPv6 loopback,
  link-local и ULA, multicast, зарезервированные; соединение должно прийти на один из проверенных адресов (защита от DNS
  rebinding); каждый редирект проверяется заново, не больше 3; прокси из окружения не используется; таймауты 4 с на
  соединение, 8 с на чтение, 15 с на всю проверку; читается не больше 2 МБ; принимается только HTML.
- Ошибки: `404 OFFER_NOT_FOUND` (нет такого предложения в этой сессии), `422` (больше 10 или пусто).
  Лимит частоты — как у сравнения документов.
- **Наличие с сайта** (`stockStatus: "available"`) значит только то, что сайт отметил товар `schema.org/InStock`.
  Где склад и какой срок поставки — сайт в данных о товаре **не публикует** (проверено 8 ноября на industrialmotion.kz
  и bcindustry.kz: в общем тексте страницы есть фраза про склад в Европе, но не для конкретного товара). Поэтому
  полей `stockLocation` / `leadTime` нет: показывать «есть у поставщика, склад и срок уточняйте». Если сайт начнёт
  публиковать эти данные в разметке товара, их можно будет добавить как необязательные поля.
- `GET /capabilities` → `features.priceCheck: true`, только если задан `PRICE_CHECK_DOMAINS`.
  Список сайтов задаёт администратор сервера, пользователь его не меняет.

---

## 4. Закупочная ведомость и расчёт

### `POST /procurement/quote` → `200` `Quote` (без сохранения; считается кодом)
```json
{
  "documentId": "d1",
  "items": [
    {"partId": "p1", "quantity": 2, "offerId": "pl1:17", "confirmationId": "c1"},
    {"partId": "p2", "quantity": 1, "offerId": null}
  ]
}
```
Ответ:
```json
{
  "items": [
    {"partId": "p1", "name": "Подшипник шариковый радиальный", "partNumber": "6205-2RS", "quantity": 2, "unit": "шт",
     "offer": { /* Offer */ }, "unitPrice": "4850.00", "currency": "KZT", "lineTotal": "9700.00", "status": "priced",
     "identification": {"status": "user_confirmed", "confirmationId": "c1"}},
    {"partId": "p2", "name": "Подшипник роликовый", "partNumber": "NU 210 ECP", "quantity": 1, "unit": "шт",
     "offer": null, "unitPrice": null, "currency": null, "lineTotal": null, "status": "no_price",
     "identification": {"status": "document_only", "confirmationId": null}}
  ],
  "totals": [{"currency": "KZT", "amount": "9700.00", "items": 1}],
  "unpriced": 1,
  "warnings": ["1 позиция без цены не входит в итог"],
  "calculatedAt": "2026-11-08T10:20:00Z"
}
```
- `quantity` по умолчанию берётся из документа; пользователь может изменить. Целое > 0.
- `status`: `priced` | `no_price` | `offer_missing` (предложение с таким `offerId` больше не существует: прайс удалён,
  или это предложение другой сессии, или оно для другого артикула). `offer_missing` — не ошибка запроса: позиция без цены,
  в `warnings` объяснение. Итог — сумма только `priced`, по каждой валюте отдельно.
- Выбранное пользователем похожее предложение (`match: close`) считается, но в позиции `matchWarning: true`.
- `identification.status`: `user_confirmed` (есть подтверждение `decision: confirmed`) | `user_rejected` |
  `document_only` (деталь из документа, фото не подтверждали). Опционально в теле: `"confirmationId"` на позицию.
- После удаления прайса его предложения исчезают из `/procurement/offers`; уже сделанный расчёт не меняется (он не хранится).

### `POST /procurement/quote/export?format=xlsx|csv` → файл
То же тело, что у `quote`. Возвращает ведомость: позиция, артикул, кол-во, цена, валюта, сумма, поставщик, ссылка, дата цены, страница документа.
С 8 ноября после прежних колонок (они не сдвигались) добавлены: «Источник цены» (прайс-лист / проверено на сайте),
«Откуда дата» (дата из прайса / указана при загрузке / **дата загрузки прайса, не дата цены** / проверено на сайте
поставщика), «Производитель», «Совпадение артикула» (точный / похожий, проверьте совместимость), «Файл прайса»,
«Строка прайса», «DEMO» (да / нет), «Наличие» (есть у поставщика / нет в наличии / не указано, + количество, если
есть), «Проверено (время Казахстана, UTC+5)» — для проверки на сайте, например «08.11.2026 00:41»; исходное значение
`checkedAt` (ISO, UTC) остаётся в «Дата цены». Если в прайсе не было даты, колонка «Дата цены» **пустая**: дата загрузки прайса
стоит только в «Откуда дата». Позиция без цены — пустые «Цена» и «Сумма» (в JSON — `null`).

---

## 5. HR: резюме и вакансия

### `POST /hr/matches` → `202` · `GET /hr/matches/{id}` → `200`
Тело: `{"resumeDocumentId": "r1", "vacancyDocumentId": "v1", "language": "ru"}` (оба документа загружаются как обычно).
```json
{
  "id": "m1",
  "status": "ready",
  "requirements": [
    {
      "requirement": "Опыт работы с Python от 3 лет",
      "kind": "must",
      "status": "confirmed",
      "explanation": "Python в 2021–2025 в компании X [1]",
      "evidence": [ /* Source из резюме */ ],
      "vacancySource": { /* Source из вакансии */ }
    },
    {"requirement": "Английский B2", "kind": "nice", "status": "not_found", "explanation": "", "evidence": [], "vacancySource": { }}
  ],
  "skills": [{"name": "FastAPI", "evidence": [ /* Source */ ]}],
  "coverage": {"must": {"confirmed": 4, "partial": 1, "notFound": 1}, "nice": {"confirmed": 1, "partial": 0, "notFound": 2}},
  "notice": "Это сопоставление навыков с требованиями. Решение о найме принимает человек."
}
```
- `status` требования: `confirmed` | `partial` | `not_found`. Навык «подтверждён», только если есть цитата из резюме.
- **Нет** общего балла и рекомендации «нанять/не нанять». Не извлекаются и не учитываются: возраст, пол, семейное
  положение, национальность, здоровье, фото.

---

## 6. Проверка утверждения (готово, входит в эту ветку `backend/procurement-mvp`)
`POST /conversations/{conversationId}/verify`, тело `{"claim": "...", "language": "ru"}` (до 1000 символов) →
```json
{"verdict": "contradicted", "explanation": "В документе указано 12 450 000 ₸ [1].", "sources": [ /* Source */ ]}
```
- `verdict`: `supported` | `partly` | `contradicted` | `not_found`.
- `reason` есть только при `not_found`: `no_matching_excerpt` (в документах нет подходящего фрагмента) |
  `model_refused` (модель ответила, что данных нет) | `citations_failed_verification` (модель дала вердикт, но её
  цитаты не прошли дословную проверку — вердикт не показывается как доказанный).
- `explanation` пустая строка при `not_found`; иначе — предложения с маркерами `[n]`, `sources[].index` = n.
- Лимит частоты — как у чата; тратит дневной лимит ИИ (один запрос к модели). В историю чата не пишется.
- Ошибки: `409 DOCUMENT_NOT_READY`, `422 EMPTY_MESSAGE`, `429 RATE_LIMITED` / `AI_BUDGET_EXCEEDED`, `503 LLM_UNAVAILABLE`,
  `504 LLM_TIMEOUT`.

---

## Новые коды ошибок
`PARTS_NOT_STARTED` (404), `PARTS_NOT_READY` (409), `IMAGE_TOO_LARGE` (413), `UNSUPPORTED_IMAGE` (415),
`VISION_UNAVAILABLE` (503), `PRICE_LIST_INVALID` (422, `message` объясняет, каких колонок нет), `PRICE_LIST_TOO_LARGE` (413).
Лимиты и дневной бюджет ИИ — как у чата (`429 RATE_LIMITED`, `429 AI_BUDGET_EXCEEDED`).

## Изменения в ревизии 2 (по issue #23)
1. Фото: `status` → `matchStatus`, `confirmed` → `matched` (автоматическое сопоставление ≠ подтверждение человеком);
   добавлен `POST /documents/{id}/parts/{partId}/confirmations`; в закупке `identification`.
2. Наличие: `inStock` → `stockStatus` (`available|unavailable|unknown`) + `stockQuantity`; нет данных → `unknown`.
3. Происхождение цен: `sourceRow`, `checkedAtOrigin`, `demo`; цены и наличие — данные файла, не живая проверка;
   похожие артикулы вынесены в `similar` и не подбираются автоматически; ссылка только из файла.
4. Capabilities: явно только добавления, `ocr` = OCR сканов PDF, фото — `features.photoIdentify`.
5. Удаление прайса и чужой `offerId`: статус позиции `offer_missing`, не ошибка.
6. Фото не хранится: превью на фронтенде, при повторе — повторная загрузка.

## Ревизия 3 (8 ноября): что добавлено для фронтенда
Только добавления. Прежние поля, значения и статусы не менялись; новые поля бэкенд присылает всегда, но клиент может их
не читать.
1. Фото (раздел 2): `recognized.visibleMarkings`, `partType`, `confidence` (уверенность в виде детали), `issues`;
   ответ `tips`; новый `matchStatus: "type_only"` и `matches[].match: "type"` — только вид детали, всегда с ручным
   подтверждением; клиенту, не знающему `type_only`, показывать его как `needs_confirmation`.
2. Предложения (раздел 3): `priceOrigin` (`file` | `site_checked`), `filePrice`, `siteCheck`, `manufacturer`,
   `priceListFile`; `checkedAtOrigin` может быть `"site"`.
3. Новый `POST /procurement/offers/check` — проверка цены на странице поставщика (только разрешённые сайты, защита адресов).
4. Выгрузка (раздел 4): новые колонки в конце; дата загрузки прайса не пишется в «Дата цены».
5. `GET /capabilities` → `features.priceCheck`.
6. Ошибки фото уточнены: `404 PARTS_NOT_STARTED` до запуска извлечения, `409 PARTS_NOT_READY` пока не `ready`.
7. Текст PDF: мягкий перенос U+00AD отдаётся как обычный дефис в `quote` и текстах.

## Что не меняется
Существующие эндпоинты (документы, чат, цитаты, Compare, сессии) и Telegram-бот работают как раньше; новое — только
добавление. Все существующие тесты должны проходить.
