# DOCMIND: производство и закупки — API-контракт (черновик на согласование)

Статус: **согласован** (Samir, issue #23). Ветка `backend/procurement-mvp`.
Реализовано: разделы 0–4 и 6 (детали, фото, подтверждения, прайсы, предложения, расчёт, выгрузка, проверка утверждения).
**Не реализовано: раздел 5 (HR)** — пока `features.hr = false`.
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
    "hr": true
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
  - `matched` — артикул с фото совпал ровно с одной деталью документа (после нормализации пробелов, дефисов и похожих букв);
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

MVP: **импорт прайсов CSV/XLSX**. Поиск по сайтам магазинов — только по источникам, которые разрешают это (открытый API
или разрешение владельца); в MVP не входит, поле `source: "web"` зарезервировано.

### `POST /price-lists` → `201` `PriceList`
`multipart/form-data`: `file` (CSV или XLSX, до 5 МБ), необязательно `supplier`, `currency` (по умолчанию `KZT`),
`checkedAt` (дата цен, `YYYY-MM-DD`), `demo` (`true` для тестовых прайсов).
Колонки распознаются по заголовкам (рус., каз., англ.): артикул / наименование / цена / валюта / наличие / ссылка / поставщик / дата.
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

## 6. Проверка утверждения (уже готово, ветка `backend/verify-claim`)
`POST /conversations/{conversationId}/verify`, тело `{"claim": "...", "language": "ru"}` (до 1000 символов) →
```json
{"verdict": "contradicted", "explanation": "В документе указано 12 450 000 ₸ [1].", "sources": [ /* Source */ ]}
```
`verdict`: `supported` | `partly` | `contradicted` | `not_found` (+ `reason` для `not_found`).

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

## Что не меняется
Существующие эндпоинты (документы, чат, цитаты, Compare, сессии) и Telegram-бот работают как раньше; новое — только
добавление. Все существующие тесты должны проходить.
