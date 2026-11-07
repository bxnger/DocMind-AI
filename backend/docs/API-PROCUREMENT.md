# DOCMIND: производство и закупки — API-контракт (черновик на согласование)

Статус: **предложение**, ничего из этого ещё не реализовано. Ветка `backend/procurement-mvp`.
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
Добавляется объект `features`, остальное без изменений. `languages` теперь заполнен, когда есть OCR.
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
- `verified: false` — артикул не найден в тексте дословно (например, ИИ собрал его из частей). Показывать с предупреждением.

---

## 2. Фото маркировки или шильдика

### `POST /documents/{documentId}/parts/identify` → `200` `PhotoMatch`
`multipart/form-data`: поле `image` (JPEG, PNG или WebP, до 8 МБ), необязательное `language`.
Фото **не сохраняется** на сервере. Требует, чтобы детали документа уже были извлечены (`409 PARTS_NOT_READY`).
```json
{
  "status": "needs_confirmation",
  "recognized": {
    "text": "SKF 6205-2RSH  C3  MADE IN ...",
    "partNumber": "6205-2RSH",
    "manufacturer": "SKF",
    "markings": ["C3"],
    "readability": "medium"
  },
  "matches": [
    {"partId": "p1", "partNumber": "6205-2RS", "name": "Подшипник шариковый радиальный",
     "match": "close", "difference": "На фото 6205-2RSH, в документе 6205-2RS", "sources": [ /* Source */ ]}
  ],
  "message": "Похоже на позицию p1, но обозначение отличается. Подтвердите вручную."
}
```
- `status`:
  - `confirmed` — артикул с фото совпал с одной деталью документа (после нормализации пробелов, дефисов и похожих букв);
  - `needs_confirmation` — совпадение неточное или кандидатов несколько: **показать кандидатов и спросить пользователя**;
  - `no_match` — прочитано, но в документе такой детали нет;
  - `unreadable` — маркировку не удалось прочитать надёжно (размыто, блик): попросить переснять.
- `matches[].match`: `exact` | `close` | `partial`. Решение о совпадении принимает **код**, ИИ только читает текст на фото.
- Отдельного эндпоинта подтверждения нет: выбранный пользователем `partId` просто идёт в закупку (раздел 4).

Ошибки: `413 IMAGE_TOO_LARGE`, `415 UNSUPPORTED_IMAGE`, `503 VISION_UNAVAILABLE`.

---

## 3. Поставщики и цены

MVP: **импорт прайсов CSV/XLSX**. Поиск по сайтам магазинов — только по источникам, которые разрешают это (открытый API
или разрешение владельца); в MVP не входит, поле `source: "web"` зарезервировано.

### `POST /price-lists` → `201` `PriceList`
`multipart/form-data`: `file` (CSV или XLSX, до 5 МБ), необязательно `supplier`, `currency` (по умолчанию `KZT`), `checkedAt` (дата цен, `YYYY-MM-DD`).
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
  "importedAt": "2026-11-08T10:15:00Z"
}
```
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
          "id": "o1",
          "supplier": "ТОО Подшипник-Центр",
          "title": "Подшипник 6205-2RS SKF",
          "partNumber": "6205-2RS",
          "match": "exact",
          "price": "4850.00",
          "currency": "KZT",
          "inStock": true,
          "url": "https://example.kz/item/6205",
          "source": "price_list",
          "priceListId": "pl1",
          "checkedAt": "2026-11-08"
        }
      ]
    },
    {"partId": "p2", "partNumber": "NU 210 ECP", "offers": []}
  ]
}
```
Предложения отсортированы: сначала точное совпадение артикула, потом по цене. Пустой `offers` — «предложений нет».

---

## 4. Закупочная ведомость и расчёт

### `POST /procurement/quote` → `200` `Quote` (без сохранения; считается кодом)
```json
{
  "documentId": "d1",
  "items": [
    {"partId": "p1", "quantity": 2, "offerId": "o1"},
    {"partId": "p2", "quantity": 1, "offerId": null}
  ]
}
```
Ответ:
```json
{
  "items": [
    {"partId": "p1", "name": "Подшипник шариковый радиальный", "partNumber": "6205-2RS", "quantity": 2, "unit": "шт",
     "offer": { /* Offer */ }, "unitPrice": "4850.00", "currency": "KZT", "lineTotal": "9700.00", "status": "priced"},
    {"partId": "p2", "name": "Подшипник роликовый", "partNumber": "NU 210 ECP", "quantity": 1, "unit": "шт",
     "offer": null, "unitPrice": null, "currency": null, "lineTotal": null, "status": "no_price"}
  ],
  "totals": [{"currency": "KZT", "amount": "9700.00", "items": 1}],
  "unpriced": 1,
  "warnings": ["1 позиция без цены не входит в итог"],
  "calculatedAt": "2026-11-08T10:20:00Z"
}
```
- `quantity` по умолчанию берётся из документа; пользователь может изменить. Целое > 0.
- `status`: `priced` | `no_price`. Итог — сумма только `priced`, по каждой валюте отдельно.

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

## Что не меняется
Существующие эндпоинты (документы, чат, цитаты, Compare, сессии) и Telegram-бот работают как раньше; новое — только
добавление. Все существующие тесты должны проходить.
