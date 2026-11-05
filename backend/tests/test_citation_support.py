"""Citation verification: a cited source must exist, be verbatim, and contain the figures the claim states."""

from app.citations import numbers_in, unsupported_numbers
from tests.test_chat import ask, conversation_for, ready_document

PAGES = (
    "Registration closes on 5 November 2026. The fee is 15 000 KZT.",
    "Teams may have at most 3 members. The prize is 1,500,000 KZT.",
)


def outcome(client, answerer, reply, question="Tell me about registration, fee, teams and prize"):
    """{reg} and {team} in `reply` become the excerpt numbers of the registration and team pages."""
    document = ready_document(client, pages=PAGES)

    async def stream(question, excerpts, language, history):
        number = {key: next((e.number for e in excerpts if word in e.text), 9) for key, word in (("reg", "Registration"), ("team", "Teams"))}
        yield reply.format(**number)

    answerer.stream = stream
    events = ask(client, conversation_for(client, document), question)
    done = dict(events)["done"]["answerStatus"]
    sources = dict(events).get("sources", {}).get("sources", [])
    return done, sources


# --- number matching

def test_same_value_in_different_notations_matches():
    assert numbers_in("15 000") == numbers_in("15000") == numbers_in("15,000") == {"15000"}
    assert numbers_in("1,500,000 KZT") == {"1500000"}
    assert numbers_in("3,5 %") == numbers_in("3.5%") == {"3.5"}
    assert numbers_in("See [1] and [2, 3]") == set()  # citation markers are not figures


def test_unsupported_numbers_lists_only_the_missing_ones():
    assert unsupported_numbers("Fee is 15 000 KZT [1].", "The fee is 15000 KZT.") == []
    assert unsupported_numbers("Fee is 16 000 KZT.", "The fee is 15 000 KZT.") == ["16000"]
    assert unsupported_numbers("Closes 5 November 2026, fee 20.", "Closes on 5 November 2026.") == ["20"]


# --- through the chat

def test_correct_citation_is_answered_with_its_source(client, answerer):
    status, sources = outcome(client, answerer, "Registration closes on 5 November 2026 [{reg}].")
    assert status == "answered" and sources[0]["page"] == 1 and "5 November 2026" in sources[0]["quote"]


def test_numerical_mismatch_is_rejected(client, answerer):
    status, sources = outcome(client, answerer, "Registration closes on 6 November 2026 [{reg}].")
    assert status == "not_found" and sources == []


def test_wrong_number_for_the_fee_is_rejected_even_with_a_real_excerpt(client, answerer):
    status, _ = outcome(client, answerer, "The fee is 25 000 KZT [{reg}].", question="What is the fee?")
    assert status == "not_found"


def test_thousands_separator_variants_are_accepted(client, answerer):
    status, _ = outcome(client, answerer, "The fee is 15000 KZT [{reg}].", question="What is the fee in KZT?")
    assert status == "answered"


def test_invented_citation_number_is_rejected(client, answerer):
    status, sources = outcome(client, answerer, "Registration closes on 5 November 2026 [9].")
    assert status == "not_found" and sources == []


def test_answer_without_any_citation_is_not_found(client, answerer):
    status, _ = outcome(client, answerer, "Registration closes on 5 November 2026.")
    assert status == "not_found"


def test_model_refusal_is_not_found(client, answerer):
    status, _ = outcome(client, answerer, "NOT_FOUND")
    assert status == "not_found"


def test_each_claim_is_checked_against_its_own_sources(client, answerer):
    # The first claim is right, the second states a number that no excerpt contains: only the first keeps a source.
    status, sources = outcome(
        client, answerer, "Registration closes on 5 November 2026 [{reg}]. The prize is 9,000,000 KZT [{reg}].",
        question="When does registration close and what is the prize?",
    )
    assert status == "answered" and len(sources) == 1


def test_multiple_sources_are_all_kept_when_every_claim_holds(client, answerer):
    status, sources = outcome(
        client, answerer,
        "Registration closes on 5 November 2026 [{reg}]. Teams have at most 3 members [{team}].",
        question="When does registration close and how many members may a team have?",
    )
    assert status == "answered" and {s["page"] for s in sources} == {1, 2}


def test_a_sentence_citing_two_excerpts_can_take_its_figures_from_either(client, answerer):
    status, sources = outcome(
        client, answerer,
        "Registration closes on 5 November 2026 and teams have at most 3 members [{reg}][{team}].",
        question="When does registration close and how many members may a team have?",
    )
    assert status == "answered" and len(sources) == 2


# --- only verified text is shown

def shown(client, answerer, reply, question="Tell me about registration, fee, teams and prize"):
    """(text the reader saw, saved message content, status) for a scripted reply."""
    document = ready_document(client, pages=PAGES)

    async def stream(question, excerpts, language, history):
        number = {key: next((e.number for e in excerpts if word in e.text), 9) for key, word in (("reg", "Registration"), ("team", "Teams"))}
        yield reply.format(**number)

    answerer.stream = stream
    conversation = conversation_for(client, document)
    events = ask(client, conversation, question)
    text = "".join(data["text"] for name, data in events if name == "token")
    saved = client.get(f"/api/v1/conversations/{conversation}/messages").json()["items"][-1]
    return text, saved["content"], dict(events)["done"]["answerStatus"]


def test_a_correct_answer_is_shown_unchanged(client, answerer):
    reply = "Registration closes on 5 November 2026 [{reg}].\nThe fee is 15 000 KZT [{reg}]."
    text, saved, status = shown(client, answerer, reply)
    assert status == "answered" and text == saved and "5 November 2026" in text and "15 000 KZT" in text


def test_the_unsupported_sentence_is_removed_from_what_is_shown_and_saved(client, answerer):
    reply = "Registration closes on 5 November 2026 [{reg}]. The prize is 9,000,000 KZT [{reg}]."
    text, saved, status = shown(client, answerer, reply)
    assert status == "answered"
    assert "5 November 2026" in text and "9,000,000" not in text and text == saved


def test_every_sentence_citing_a_source_is_checked_not_only_the_first(client, answerer):
    reply = "Registration closes on 5 November 2026 [{reg}]. The fee is 99 KZT [{reg}]."
    text, _, status = shown(client, answerer, reply)
    assert status == "answered" and "99" not in text


def test_an_uncited_sentence_with_an_invented_number_is_removed(client, answerer):
    reply = "Registration closes on 5 November 2026 [{reg}]. There are 400 participants."
    text, _, status = shown(client, answerer, reply)
    assert status == "answered" and "400" not in text


def test_an_uncited_sentence_without_figures_is_kept(client, answerer):
    reply = "Here is what the document says. Registration closes on 5 November 2026 [{reg}]."
    text, _, _ = shown(client, answerer, reply)
    assert text.startswith("Here is what the document says.")


def test_nothing_is_shown_when_every_claim_fails(client, answerer):
    text, saved, status = shown(client, answerer, "Registration closes on 6 November 2026 [{reg}].")
    assert status == "not_found" and text == "" and saved == ""


def test_every_kind_of_thousands_space_is_the_same_separator():
    """Found with a real model: it wrote "450 000" with U+202F, which was rejected as the numbers 450 and 000."""
    for space in (" ", "\u00a0", "\u2007", "\u2009", "\u202f"):
        assert numbers_in(f"Rent is 450{space}000 tenge") == {"450000"}, repr(space)
    assert unsupported_numbers("Rent is 450\u202f000 tenge [1].", "Арендная плата 450 000 тенге.") == []
    assert unsupported_numbers("Rent is 450\u202f001 tenge [1].", "Арендная плата 450 000 тенге.") == ["450001"]
