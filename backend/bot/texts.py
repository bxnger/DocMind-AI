"""The bot's own messages in Russian, Kazakh and English. Answers and quotes come from the backend, not from here."""

LANGUAGES = ("ru", "kk", "en")

TEXTS: dict[str, dict[str, str]] = {
    "start": {
        "ru": "Привет! Я DOCMIND AI. Пришлите PDF или DOCX (до 20 МБ) и задавайте вопросы на русском, казахском или английском. Каждый ответ приходит с источником: файл, страница и точная цитата.\n\nКоманды: /docs, /facts, /export, /compare, /help.\n\nФайлы обрабатываются на сервере проекта. Не присылайте конфиденциальные документы.",
        "kk": "Сәлем! Мен DOCMIND AI. PDF немесе DOCX (20 МБ-қа дейін) жіберіңіз де, қазақша, орысша немесе ағылшынша сұрақ қойыңыз. Әр жауап дереккөзімен келеді: файл, бет және нақты дәйексөз.\n\nБұйрықтар: /docs, /facts, /export, /compare, /help.\n\nФайлдар жоба серверінде өңделеді. Құпия құжаттарды жібермеңіз.",
        "en": "Hi! I am DOCMIND AI. Send a PDF or DOCX (up to 20 MB) and ask questions in Russian, Kazakh or English. Every answer comes with its source: file, page and the exact quote.\n\nCommands: /docs, /facts, /export, /compare, /help.\n\nFiles are processed on the project's server. Do not send confidential documents.",
    },
    "help": {
        "ru": "/docs: мои документы\n/use N: выбрать документ\n/delete N: удалить документ\n/facts: даты, сроки и суммы документа\n/export: выгрузить вопросы и ответы файлом\n/compare 1 2: сравнить два документа\n\nПросто напишите вопрос, чтобы спросить о текущем документе.",
        "kk": "/docs: менің құжаттарым\n/use N: құжатты таңдау\n/delete N: құжатты жою\n/facts: құжаттағы күндер, мерзімдер, сомалар\n/export: сұрақтар мен жауаптарды файлға шығару\n/compare 1 2: екі құжатты салыстыру\n\nАғымдағы құжат туралы сұрау үшін сұрағыңызды жазыңыз.",
        "en": "/docs: my documents\n/use N: choose a document\n/delete N: delete a document\n/facts: dates, deadlines and amounts of the document\n/export: save the questions and answers as a file\n/compare 1 2: compare two documents\n\nJust write a question to ask about the current document.",
    },
    "export_none": {
        "ru": "По этому документу ещё нет ответов. Задайте вопрос, затем повторите /export.",
        "kk": "Бұл құжат бойынша жауап әлі жоқ. Алдымен сұрақ қойып, содан кейін /export қайталаңыз.",
        "en": "There are no answers for this document yet. Ask a question, then repeat /export.",
    },
    "export_caption": {
        "ru": "Вопросы и ответы по «{name}» с точными цитатами.",
        "kk": "«{name}» бойынша сұрақтар мен жауаптар, нақты дәйексөздермен.",
        "en": "Questions and answers about “{name}”, with exact quotes.",
    },
    "export_title": {"ru": "Вопросы и ответы", "kk": "Сұрақтар мен жауаптар", "en": "Questions and answers"},
    "export_question": {"ru": "Вопрос", "kk": "Сұрақ", "en": "Question"},
    "export_not_found": {"ru": "В документе ответа не найдено.", "kk": "Құжатта жауап табылмады.", "en": "No answer found in the document."},
    "need_doc": {
        "ru": "Сначала пришлите PDF или DOCX как файл.",
        "kk": "Алдымен PDF немесе DOCX файлын жіберіңіз.",
        "en": "Send a PDF or DOCX as a file first.",
    },
    "send_as_file": {
        "ru": "Пришлите документ именно как файл (PDF или DOCX), не как фото.",
        "kk": "Құжатты сурет емес, файл (PDF немесе DOCX) ретінде жіберіңіз.",
        "en": "Please send the document as a file (PDF or DOCX), not as a photo.",
    },
    "unsupported": {
        "ru": "Поддерживаются только PDF и DOCX.",
        "kk": "Тек PDF және DOCX қолдау көрсетіледі.",
        "en": "Only PDF and DOCX are supported.",
    },
    "too_big": {
        "ru": "Файл больше 20 МБ. Пришлите файл поменьше.",
        "kk": "Файл 20 МБ-тан үлкен. Кішірек файл жіберіңіз.",
        "en": "The file is larger than 20 MB. Send a smaller one.",
    },
    "uploading": {
        "ru": "Читаю документ «{name}»…",
        "kk": "«{name}» құжатын оқып жатырмын…",
        "en": "Reading “{name}”…",
    },
    "ready": {
        "ru": "Готово: «{name}»{pages}. Задавайте вопросы.",
        "kk": "Дайын: «{name}»{pages}. Сұрақ қойыңыз.",
        "en": "Ready: “{name}”{pages}. Ask your questions.",
    },
    "pages": {"ru": ", страниц: {n}", "kk": ", бет саны: {n}", "en": ", {n} pages"},
    "ocr_note": {
        "ru": "Это скан: текст распознан автоматически, возможны ошибки, подсветки на странице не будет.",
        "kk": "Бұл скан: мәтін автоматты түрде танылды, қателер болуы мүмкін, бетте ерекшелеу болмайды.",
        "en": "This is a scan: the text was recognized automatically and may contain errors; there will be no highlight on the page.",
    },
    "suggestions": {
        "ru": "Можно спросить:",
        "kk": "Мынаны сұрауға болады:",
        "en": "You could ask:",
    },
    "failed_NO_TEXT_FOUND": {
        "ru": "В документе нет текста. Если это скан, на сервере не настроено распознавание.",
        "kk": "Құжатта мәтін жоқ. Егер бұл скан болса, серверде тану бапталмаған.",
        "en": "No text found. If this is a scan, text recognition is not set up on the server.",
    },
    "failed_PASSWORD_PROTECTED": {
        "ru": "Документ защищён паролем. Снимите защиту и пришлите снова.",
        "kk": "Құжат парольмен қорғалған. Қорғауды алып, қайта жіберіңіз.",
        "en": "The document is password protected. Remove the protection and send it again.",
    },
    "failed": {
        "ru": "Не удалось обработать документ. Попробуйте другой файл.",
        "kk": "Құжатты өңдеу мүмкін болмады. Басқа файлды көріңіз.",
        "en": "The document could not be processed. Try another file.",
    },
    "slow": {
        "ru": "Документ ещё обрабатывается. Попробуйте задать вопрос через минуту.",
        "kk": "Құжат әлі өңделуде. Бір минуттан кейін сұрап көріңіз.",
        "en": "The document is still being processed. Try asking again in a minute.",
    },
    "thinking": {"ru": "Ищу ответ в документе…", "kk": "Құжаттан жауап іздеп жатырмын…", "en": "Looking for the answer…"},
    "no_docs": {
        "ru": "Документов пока нет. Пришлите PDF или DOCX.",
        "kk": "Құжаттар әлі жоқ. PDF немесе DOCX жіберіңіз.",
        "en": "No documents yet. Send a PDF or DOCX.",
    },
    "docs_header": {"ru": "Ваши документы (● выбранный):", "kk": "Құжаттарыңыз (● таңдалған):", "en": "Your documents (● selected):"},
    "used": {"ru": "Выбран: «{name}».", "kk": "Таңдалды: «{name}».", "en": "Selected: “{name}”."},
    "deleted": {"ru": "Удалён: «{name}».", "kk": "Жойылды: «{name}».", "en": "Deleted: “{name}”."},
    "bad_number": {
        "ru": "Нет документа с таким номером. Смотрите /docs.",
        "kk": "Мұндай нөмірлі құжат жоқ. /docs қараңыз.",
        "en": "No document with that number. See /docs.",
    },
    "answer_sources": {"ru": "Источники:", "kk": "Дереккөздер:", "en": "Sources:"},
    "section": {"ru": "раздел", "kk": "бөлім", "en": "section"},
    "page_short": {"ru": "с.", "kk": "б.", "en": "p."},
    "show_page": {"ru": "Страница {n}", "kk": "{n}-бет", "en": "Page {n}"},
    "page_caption_nohl": {
        "ru": "Точных координат нет, показана вся страница.",
        "kk": "Нақты координаттар жоқ, бүкіл бет көрсетілді.",
        "en": "No exact coordinates, the whole page is shown.",
    },
    "page_gone": {
        "ru": "Эти источники устарели. Задайте вопрос заново.",
        "kk": "Бұл дереккөздер ескірген. Сұрақты қайта қойыңыз.",
        "en": "Those sources are out of date. Ask the question again.",
    },
    "not_found_no_matching_excerpt": {
        "ru": "Поиск ничего не нашёл. Попробуйте переформулировать вопрос.",
        "kk": "Іздеу ештеңе таппады. Сұрақты басқаша қойып көріңіз.",
        "en": "The search found nothing. Try rephrasing the question.",
    },
    "not_found_model_refused": {
        "ru": "В документе нет ответа на этот вопрос.",
        "kk": "Құжатта бұл сұраққа жауап жоқ.",
        "en": "The document does not answer this question.",
    },
    "not_found": {
        "ru": "Не нашёл в документе подтверждённого ответа. Попробуйте переформулировать вопрос.",
        "kk": "Құжаттан расталған жауап таппадым. Сұрақты басқаша қойып көріңіз.",
        "en": "I found no verified answer in the document. Try rephrasing the question.",
    },
    "error_RATE_LIMITED": {
        "ru": "Сервис ИИ перегружен (лимит запросов). Повторите через минуту.",
        "kk": "ЖИ сервисі шамадан тыс жүктелген (сұрау лимиті). Бір минуттан кейін қайталаңыз.",
        "en": "The AI service is rate limited. Try again in a minute.",
    },
    "error_LLM_TIMEOUT": {
        "ru": "Сервис ИИ не ответил вовремя. Повторите вопрос.",
        "kk": "ЖИ сервисі уақытында жауап бермеді. Сұрақты қайталаңыз.",
        "en": "The AI service did not answer in time. Ask again.",
    },
    "error": {
        "ru": "Сервис ИИ сейчас недоступен. Повторите позже.",
        "kk": "ЖИ сервисі қазір қолжетімсіз. Кейінірек қайталаңыз.",
        "en": "The AI service is unavailable right now. Try again later.",
    },
    "backend_down": {
        "ru": "Сервер документов не отвечает. Попробуйте позже.",
        "kk": "Құжат сервері жауап бермейді. Кейінірек көріңіз.",
        "en": "The document server is not responding. Try again later.",
    },
    "rate": {
        "ru": "Слишком много сообщений. Подождите минуту.",
        "kk": "Хабарлама тым көп. Бір минут күтіңіз.",
        "en": "Too many messages. Wait a minute.",
    },
    "private_only": {
        "ru": "Напишите мне в личные сообщения.",
        "kk": "Маған жеке хабарлама жазыңыз.",
        "en": "Please write to me in a private chat.",
    },
    "session_expired": {
        "ru": "Сессия истекла, документы этого чата удалены. Пришлите документ заново.",
        "kk": "Сессия мерзімі өтті, бұл чаттың құжаттары жойылды. Құжатты қайта жіберіңіз.",
        "en": "The session expired and this chat's documents were deleted. Please send the document again.",
    },
    "denied": {
        "ru": "Этот бот сейчас закрыт для вас.",
        "kk": "Бұл бот қазір сізге жабық.",
        "en": "This bot is closed to you right now.",
    },
    "facts_header": {"ru": "Даты, сроки и суммы в «{name}»:", "kk": "«{name}» ішіндегі күндер, мерзімдер, сомалар:", "en": "Dates, deadlines and amounts in “{name}”:"},
    "facts_none": {
        "ru": "Ключевых фактов не найдено.",
        "kk": "Негізгі фактілер табылмады.",
        "en": "No key facts found.",
    },
    "compare_usage": {
        "ru": "Укажите номера двух документов из /docs, например: /compare 1 2",
        "kk": "/docs ішінен екі құжаттың нөмірін көрсетіңіз, мысалы: /compare 1 2",
        "en": "Give the numbers of two documents from /docs, for example: /compare 1 2",
    },
    "compare_wait": {"ru": "Сравниваю документы…", "kk": "Құжаттарды салыстырып жатырмын…", "en": "Comparing the documents…"},
    "compare_failed": {
        "ru": "Не удалось сравнить документы.",
        "kk": "Құжаттарды салыстыру мүмкін болмады.",
        "en": "The documents could not be compared.",
    },
    "compare_none": {"ru": "Различий не найдено.", "kk": "Айырмашылық табылмады.", "en": "No differences found."},
    "compare_note": {
        "ru": "Сравнение текстов по сходству предложений, не по смыслу.",
        "kk": "Мәтіндерді сөйлемдердің ұқсастығы бойынша салыстыру, мағынасы бойынша емес.",
        "en": "A comparison of sentence text, not of meaning.",
    },
    "diff_changed": {"ru": "Изменено", "kk": "Өзгерген", "en": "Changed"},
    "diff_added": {"ru": "Добавлено", "kk": "Қосылған", "en": "Added"},
    "diff_removed": {"ru": "Удалено", "kk": "Жойылған", "en": "Removed"},
}


def language_of(code: str | None) -> str:
    """The bot language for a Telegram language_code like "ru", "kk" or "en-US". Russian when unknown."""
    short = (code or "").split("-")[0].lower()
    return short if short in LANGUAGES else "ru"


def t(language: str, key: str, **values: object) -> str:
    entry = TEXTS[key]
    text = entry.get(language) or entry["ru"]
    return text.format(**values) if values else text
