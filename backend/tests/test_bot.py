"""The Telegram bot against the real backend (with a scripted model) and a fake Telegram. No token, no network.

These prove what the bot does for given updates and answers. They do not prove that Telegram accepts the messages:
that is checked live with a real token (see docs/EVAL.md).
"""

import json

import httpx
import pytest

from app.llm import LlmRateLimited
from bot.backend_client import BackendClient
from bot.handlers import MAX_FILE_BYTES, Bot, short, split_message
from bot.render import render_page
from bot.telegram_api import TelegramAPI, TelegramError
from bot.texts import TEXTS, language_of, t
from tests.conftest import make_docx, make_pdf
from tests.test_chat import BIG_DOCUMENT, RULES_PAGE_1, RULES_PAGE_2

ANSWER = "Registration closes on 5 November 2026 [1]."
PNG = b"\x89PNG"


class FakeTelegram:
    def __init__(self):
        self.messages, self.photos, self.actions, self.callbacks, self.files = [], [], [], [], {}

    def send_message(self, chat_id, text, reply_markup=None, parse_mode="HTML"):
        self.messages.append((chat_id, text, reply_markup))
        return {}

    def send_photo(self, chat_id, png, caption=None):
        self.photos.append((chat_id, png, caption))
        return {}

    def send_chat_action(self, chat_id, action="typing"):
        self.actions.append(action)

    def answer_callback_query(self, callback_id, text=None):
        self.callbacks.append(callback_id)

    def get_file_path(self, file_id):
        return file_id

    def download_file(self, path):
        return self.files[path]

    @property
    def last(self) -> str:
        return self.messages[-1][1]

    @property
    def last_markup(self):
        return self.messages[-1][2]


@pytest.fixture
def telegram():
    return FakeTelegram()


@pytest.fixture
def bot(client, telegram):
    return Bot(telegram, BackendClient(client), per_minute=100)


def text_update(text, chat=1, code="ru", kind="private"):
    return {"message": {"chat": {"id": chat, "type": kind}, "from": {"language_code": code}, "text": text}}


def file_update(telegram, name, data, chat=1, code="ru", size=None):
    telegram.files[name] = data
    document = {"file_name": name, "file_id": name, "file_size": size if size is not None else len(data)}
    return {"message": {"chat": {"id": chat, "type": "private"}, "from": {"language_code": code}, "document": document}}


def button(chat, data, code="ru", callback_id="cb"):
    return {"callback_query": {"id": callback_id, "data": data, "message": {"chat": {"id": chat}}, "from": {"language_code": code}}}


def upload_rules(bot, telegram, name="rules.pdf", pages=(RULES_PAGE_1, RULES_PAGE_2), chat=1):
    bot.handle_update(file_update(telegram, name, make_pdf(list(pages)), chat=chat))


# --- commands and languages

def test_start_and_help_follow_the_telegram_language(bot, telegram):
    for code, expected in (("ru", "Привет"), ("kk", "Сәлем"), ("en", "Hi!")):
        bot.handle_update(text_update("/start", code=code))
        assert expected in telegram.last
    bot.handle_update(text_update("/help@docmind_bot", code="en"))
    assert "/compare" in telegram.last
    bot.handle_update(text_update("/whatever", code="en"))
    assert "/docs" in telegram.last  # an unknown command shows the help


def test_every_text_exists_in_all_three_languages():
    for key, entry in TEXTS.items():
        assert set(entry) == {"ru", "kk", "en"}, key
    assert language_of("en-US") == "en" and language_of("kk") == "kk" and language_of("de") == "ru" and language_of(None) == "ru"


# --- documents

def test_a_pdf_becomes_the_current_document_with_suggested_questions(bot, telegram):
    upload_rules(bot, telegram)
    assert "rules.pdf" in telegram.last and "2" in telegram.last  # the name and the page count
    assert telegram.last_markup and telegram.last_markup["inline_keyboard"][0][0]["callback_data"] == "q:0"
    bot.handle_update(text_update("/docs"))
    assert "● 1. rules.pdf (pdf)" in telegram.last


def test_unsupported_oversized_and_photo_are_refused_politely(bot, telegram):
    bot.handle_update(file_update(telegram, "notes.txt", b"hello"))
    assert telegram.last == t("ru", "unsupported")
    bot.handle_update(file_update(telegram, "big.pdf", b"%PDF-", size=MAX_FILE_BYTES + 1))
    assert telegram.last == t("ru", "too_big")
    bot.handle_update({"message": {"chat": {"id": 1, "type": "private"}, "from": {}, "photo": [{}]}})
    assert telegram.last == t("ru", "send_as_file")


def test_a_broken_pdf_gets_the_failure_message(bot, telegram):
    bot.handle_update(file_update(telegram, "empty.pdf", make_pdf([""])))
    assert telegram.last == t("ru", "failed_NO_TEXT_FOUND")


def test_docs_use_and_delete_by_number(bot, telegram):
    upload_rules(bot, telegram, "a.pdf")
    upload_rules(bot, telegram, "b.pdf")
    bot.handle_update(text_update("/use 1"))
    assert "a.pdf" in telegram.last
    bot.handle_update(text_update("/use 9"))
    assert telegram.last == t("ru", "bad_number")
    bot.handle_update(text_update("/delete 1"))
    assert "a.pdf" in telegram.last
    bot.handle_update(text_update("/docs"))
    assert "b.pdf" in telegram.last and "a.pdf" not in telegram.last


# --- questions

def test_a_question_gets_a_verified_answer_with_its_source_and_a_page_button(bot, telegram, answerer):
    upload_rules(bot, telegram)
    answerer.reply = ANSWER
    bot.handle_update(text_update("When does registration close?", code="en"))
    answer = telegram.last
    assert "Registration closes on 5 November 2026" in answer and "Sources:" in answer
    assert "rules.pdf, p. 1" in answer and "«Registration closes on 5 November 2026.»" in answer
    assert telegram.last_markup["inline_keyboard"][0][0]["callback_data"] == "s:0"
    assert "typing" in telegram.actions


def test_the_page_button_sends_the_page_with_the_passage_highlighted(bot, telegram, answerer):
    upload_rules(bot, telegram)
    answerer.reply = ANSWER
    bot.handle_update(text_update("When does registration close?"))
    bot.handle_update(button(1, "s:0"))
    chat, png, caption = telegram.photos[-1]
    assert png.startswith(PNG) and "Registration closes" in caption
    assert t("ru", "page_caption_nohl") not in caption  # the backend gave coordinates, so a highlight was drawn


def test_a_suggested_question_button_asks_that_question(bot, telegram, answerer):
    upload_rules(bot, telegram)
    answerer.reply = ANSWER
    bot.handle_update(button(1, "q:0"))
    assert answerer.calls and telegram.callbacks == ["cb"]


def test_the_answer_language_is_left_to_the_backend(bot, telegram, answerer):
    upload_rules(bot, telegram)
    answerer.reply = ANSWER
    bot.handle_update(text_update("When does registration close?", code="ru"))  # an English question, Russian Telegram
    assert answerer.calls[0][2] == "en"  # the backend followed the question, not the interface language


def test_a_question_without_a_document_asks_for_one(bot, telegram):
    bot.handle_update(text_update("What is this?"))
    assert telegram.last == t("ru", "need_doc")


def test_the_refusal_reasons_have_their_own_messages(bot, telegram, answerer):
    upload_rules(bot, telegram)
    answerer.reply = "NOT_FOUND"
    bot.handle_update(text_update("quantum chromodynamics"))
    assert telegram.last == t("ru", "not_found_model_refused")
    upload_rules(bot, telegram, "big.pdf", pages=BIG_DOCUMENT)
    bot.handle_update(text_update("quantum chromodynamics"))
    assert telegram.last == t("ru", "not_found_no_matching_excerpt")


def test_a_provider_failure_is_an_error_message_not_a_refusal(bot, telegram, answerer):
    upload_rules(bot, telegram)

    async def limited(question, excerpts, language, history):
        raise LlmRateLimited()
        yield  # pragma: no cover

    answerer.stream = limited
    bot.handle_update(text_update("When does registration close?"))
    assert telegram.last == t("ru", "error_RATE_LIMITED") and telegram.last != t("ru", "not_found")


def test_docx_sources_show_a_section_and_no_page_button(bot, telegram, answerer):
    bot.handle_update(file_update(telegram, "lease.docx", make_docx([("Terms", ["The rent is 450 USD per month."])])))
    answerer.reply = "The rent is 450 USD per month [1]."
    bot.handle_update(text_update("What is the rent?", code="en"))
    assert "section Terms" in telegram.last or "раздел Terms" in telegram.last or "Terms" in telegram.last
    assert telegram.last_markup is None


# --- facts and comparison

def test_facts_lists_dates_and_amounts_with_pages(bot, telegram):
    upload_rules(bot, telegram, pages=("Registration closes on 5 November 2026. The fee is 500 USD.", "Teams have three members."))
    bot.handle_update(text_update("/facts", code="en"))
    assert "5 November 2026" in telegram.last and "500 USD" in telegram.last and "p. 1" in telegram.last


def test_compare_reports_the_differences_and_says_it_is_text_not_meaning(bot, telegram):
    upload_rules(bot, telegram, "v1.pdf", pages=("The fee is 500 USD.",))
    upload_rules(bot, telegram, "v2.pdf", pages=("The fee is 700 USD.",))
    bot.handle_update(text_update("/compare 1 2", code="en"))
    assert "500" in telegram.last and "700" in telegram.last and "not of meaning" in telegram.last
    bot.handle_update(text_update("/compare 1", code="en"))
    assert telegram.last == t("en", "compare_usage")


# --- protection

def test_rate_limit_per_chat(client, telegram):
    now = [0.0]
    bot = Bot(telegram, BackendClient(client), per_minute=3, clock=lambda: now[0])
    for _ in range(3):
        bot.handle_update(text_update("/help"))
    bot.handle_update(text_update("/help"))
    assert telegram.last == t("ru", "rate")
    now[0] = 61.0
    bot.handle_update(text_update("/help"))
    assert telegram.last == t("ru", "help")


def test_allowed_chats_and_private_only(client, telegram):
    bot = Bot(telegram, BackendClient(client), allowed_chats={7})
    bot.handle_update(text_update("/start", chat=1))
    assert telegram.last == t("ru", "denied")
    bot.handle_update(text_update("/start", chat=7))
    assert telegram.last == t("ru", "start")
    bot.handle_update(text_update("/start", chat=7, kind="group"))
    assert telegram.last == t("ru", "private_only")


def test_the_state_survives_a_restart(client, telegram, tmp_path):
    path = tmp_path / "bot_state.json"
    first = Bot(telegram, BackendClient(client), state_path=path, per_minute=100)
    upload_rules(first, telegram)
    second = Bot(telegram, BackendClient(client), state_path=path, per_minute=100)
    second.handle_update(text_update("/docs"))
    assert "rules.pdf" in telegram.last


def test_an_unreachable_backend_is_a_polite_message(telegram):
    def down(request):
        raise httpx.ConnectError("down", request=request)

    bot = Bot(telegram, BackendClient(httpx.Client(transport=httpx.MockTransport(down), base_url="http://x")), per_minute=100)
    bot.state["1"] = {"docs": [{"id": "d", "name": "x.pdf", "kind": "pdf", "ocr": False}], "current": "d", "conversations": {"d": "c"}, "sources": [], "suggestions": []}
    bot.handle_update(text_update("a question"))
    assert telegram.last == t("ru", "backend_down")


def test_one_broken_update_does_not_stop_the_bot(bot, telegram):
    bot.handle_update({"message": {"chat": {"id": 1, "type": "private"}, "text": None, "weird": object()}})
    bot.handle_update({"callback_query": {"id": "x"}})  # malformed: no message
    bot.handle_update(text_update("/help"))
    assert telegram.last == t("ru", "help")


# --- helpers

def test_long_messages_are_split_under_the_telegram_limit():
    text = "\n".join(f"line {i} " + "x" * 80 for i in range(200))
    parts = split_message(text)
    assert len(parts) > 1 and all(len(part) <= 4000 for part in parts) and "\n".join(parts) == text
    assert split_message("y" * 9000)[0] == "y" * 4000
    assert short("a  b\nc" * 100, 20).endswith("…") and len(short("a  b\nc" * 100, 20)) <= 20
    assert short("short text", 20) == "short text"


def test_render_page_draws_a_translucent_highlight():
    pdf = make_pdf(["Registration closes on 5 November 2026."])
    plain, plain_flag = render_page(pdf, 1, None)
    marked, marked_flag = render_page(pdf, 1, [{"x": 0.1, "y": 0.1, "w": 0.5, "h": 0.05}])
    assert plain.startswith(PNG) and marked.startswith(PNG) and not plain_flag and marked_flag and plain != marked


# --- the Telegram API client

def api(handler) -> TelegramAPI:
    return TelegramAPI("123:SECRET", client=httpx.Client(transport=httpx.MockTransport(handler)))


def test_api_returns_the_result_and_sends_json():
    seen = {}

    def handler(request):
        seen["url"], seen["body"] = str(request.url), json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "result": [{"update_id": 5}]})

    assert api(handler).get_updates(offset=5) == [{"update_id": 5}]
    assert seen["url"].endswith("/bot123:SECRET/getUpdates") and seen["body"]["offset"] == 5


def test_api_errors_use_the_description_and_never_the_token():
    def refused(request):
        return httpx.Response(401, json={"ok": False, "error_code": 401, "description": "Unauthorized"})

    def throttled(request):
        return httpx.Response(429, json={"ok": False, "error_code": 429, "description": "Too Many Requests", "parameters": {"retry_after": 7}})

    def down(request):
        raise httpx.ConnectError("boom 123:SECRET", request=request)

    with pytest.raises(TelegramError) as unauthorized:
        api(refused).get_me()
    assert unauthorized.value.code == 401 and "SECRET" not in str(unauthorized.value)
    with pytest.raises(TelegramError) as slow:
        api(throttled).send_message(1, "x")
    assert slow.value.retry_after == 7
    with pytest.raises(TelegramError) as network:
        api(down).get_me()
    assert "SECRET" not in str(network.value) and "ConnectError" in str(network.value)


def test_api_photo_is_sent_as_multipart_and_files_are_downloaded():
    seen = {}

    def handler(request):
        seen[request.url.path] = request
        if request.url.path.startswith("/file/"):
            return httpx.Response(200, content=b"FILEDATA")
        return httpx.Response(200, json={"ok": True, "result": {"file_path": "docs/a.pdf"}})

    telegram = api(handler)
    telegram.send_photo(1, b"\x89PNGdata", "caption")
    assert "multipart/form-data" in seen["/bot123:SECRET/sendPhoto"].headers["content-type"]
    assert telegram.download_file("docs/a.pdf") == b"FILEDATA" and telegram.get_file_path("fid") == "docs/a.pdf"
