"""A small Telegram Bot API client over httpx (https://core.telegram.org/bots/api).

The token is part of every request URL, so errors are rebuilt from the status and the API's own description and never
carry the URL, the token or a response body into logs.
"""

import httpx

API = "https://api.telegram.org"
LONG_POLL_SECONDS = 30


class TelegramError(Exception):
    def __init__(self, description: str, code: int | None = None, retry_after: int | None = None) -> None:
        super().__init__(description)
        self.code = code
        self.retry_after = retry_after


class TelegramAPI:
    def __init__(self, token: str, client: httpx.Client | None = None) -> None:
        self._token = token
        self.client = client or httpx.Client(timeout=LONG_POLL_SECONDS + 15)

    def _url(self, method: str) -> str:
        return f"{API}/bot{self._token}/{method}"

    def call(self, method: str, files: dict | None = None, **params):
        """Calls a method and returns its `result`. Raises TelegramError without ever exposing the token."""
        params = {key: value for key, value in params.items() if value is not None}
        try:
            if files:
                response = self.client.post(self._url(method), data=_form(params), files=files)
            else:
                response = self.client.post(self._url(method), json=params)
        except httpx.HTTPError as exc:
            raise TelegramError(f"network error ({type(exc).__name__})") from None
        try:
            body = response.json()
        except ValueError:
            raise TelegramError(f"unreadable response, HTTP {response.status_code}", response.status_code) from None
        if not body.get("ok"):
            retry = (body.get("parameters") or {}).get("retry_after")
            raise TelegramError(str(body.get("description", "error")), body.get("error_code"), retry)
        return body.get("result")

    # --- the methods the bot uses

    def get_me(self) -> dict:
        return self.call("getMe")

    def get_updates(self, offset: int | None, timeout: int = LONG_POLL_SECONDS) -> list[dict]:
        return self.call("getUpdates", offset=offset, timeout=timeout, allowed_updates=["message", "callback_query"])

    def send_message(self, chat_id: int, text: str, reply_markup: dict | None = None, parse_mode: str | None = "HTML") -> dict:
        return self.call(
            "sendMessage", chat_id=chat_id, text=text, parse_mode=parse_mode, reply_markup=reply_markup,
            disable_web_page_preview=True,
        )

    def send_photo(self, chat_id: int, png: bytes, caption: str | None = None) -> dict:
        return self.call(
            "sendPhoto", files={"photo": ("page.png", png, "image/png")}, chat_id=chat_id, caption=caption, parse_mode="HTML"
        )

    def send_chat_action(self, chat_id: int, action: str = "typing") -> None:
        try:
            self.call("sendChatAction", chat_id=chat_id, action=action)
        except TelegramError:
            pass  # a missed "typing" indicator is not worth failing an answer

    def answer_callback_query(self, callback_id: str, text: str | None = None) -> None:
        try:
            self.call("answerCallbackQuery", callback_query_id=callback_id, text=text)
        except TelegramError:
            pass

    def get_file_path(self, file_id: str) -> str:
        return self.call("getFile", file_id=file_id)["file_path"]

    def download_file(self, file_path: str) -> bytes:
        try:
            response = self.client.get(f"{API}/file/bot{self._token}/{file_path}")
        except httpx.HTTPError as exc:
            raise TelegramError(f"download failed ({type(exc).__name__})") from None
        if response.status_code != 200:
            raise TelegramError(f"download failed, HTTP {response.status_code}", response.status_code)
        return response.content

    def set_my_commands(self, commands: list[tuple[str, str]], language_code: str | None = None) -> None:
        self.call(
            "setMyCommands",
            commands=[{"command": name, "description": text} for name, text in commands],
            language_code=language_code,
        )


def _form(params: dict) -> dict:
    """Multipart fields must be strings: lists and dicts go as JSON."""
    import json

    return {key: value if isinstance(value, (str, int, float)) else json.dumps(value) for key, value in params.items()}
