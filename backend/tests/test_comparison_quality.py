"""Comparison: a deleted clause must not be paired with its neighbour, numbering must not look like a change."""

from app.comparison import Sentence, compare, strip_clause_number


def sentences(*texts):
    return [Sentence(text, 1, None, text) for text in texts]


def kinds(a, b):
    return [(d["type"], (d["a"] or {}).get("quote"), (d["b"] or {}).get("quote")) for d in compare(sentences(*a), sentences(*b))]


def test_deleted_clause_does_not_steal_the_partner_of_the_changed_one():
    result = kinds(
        ["1. The Supplier delivers goods within 10 days.", "2. The Supplier delivers spare parts within 20 days.", "3. Payment is due within 30 days."],
        ["1. The Supplier delivers goods within 10 days.", "3. Payment is due within 45 days."],
    )
    assert result == [
        ("removed", "2. The Supplier delivers spare parts within 20 days.", None),
        ("changed", "3. Payment is due within 30 days.", "3. Payment is due within 45 days."),
    ]


def test_similar_sibling_clauses_pair_with_their_own_counterpart():
    result = kinds(
        ["Fee for category A is 10 USD per day.", "Fee for category B is 20 USD per day."],
        ["Fee for category B is 25 USD per day."],
    )
    assert result == [
        ("removed", "Fee for category A is 10 USD per day.", None),
        ("changed", "Fee for category B is 20 USD per day.", "Fee for category B is 25 USD per day."),
    ]


def test_renumbering_after_a_deletion_is_not_reported_as_a_changed_figure():
    differences = compare(
        sentences("1. Goods are delivered within 10 days.", "2. Spare parts are delivered within 20 days.", "3. Payment is due within 30 days."),
        sentences("1. Goods are delivered within 10 days.", "2. Payment is due within 30 days."),
    )
    assert [d["type"] for d in differences] == ["removed", "changed"]
    assert differences[1]["explanation"] == "Only the clause number differs"


def test_a_real_number_change_is_still_explained_by_the_numbers():
    differences = compare(sentences("5.1 Payment is due within 30 days."), sentences("5.1 Payment is due within 45 days."))
    assert differences[0]["type"] == "changed" and "30" in differences[0]["explanation"] and "45" in differences[0]["explanation"]
    assert "5.1" not in differences[0]["explanation"]


def test_moved_text_is_one_difference_not_an_add_and_a_remove():
    differences = compare(
        sentences("Alpha clause is here.", "Beta clause is here.", "Gamma clause is here.", "Delta clause is here."),
        sentences("Gamma clause is here.", "Alpha clause is here.", "Beta clause is here.", "Delta clause is here."),
    )
    assert [(d["type"], d["explanation"]) for d in differences] == [("changed", "Moved to a different place")]


def test_repeated_paragraphs_are_matched_one_to_one():
    differences = compare(sentences("Pay on time.", "Pay on time.", "Pay on time."), sentences("Pay on time.", "Pay on time."))
    assert [d["type"] for d in differences] == ["removed"]


def test_result_is_deterministic_and_ids_are_stable():
    a = sentences("A one is 1.", "A two is 2.", "A three is 3.", "A four is 4.")
    b = sentences("A two is 22.", "A three is 33.", "A five is 5.")
    first = compare(a, b)
    assert first == compare(a, b)
    assert [d["id"] for d in first] == [str(i) for i in range(1, len(first) + 1)]


def test_clause_number_stripping_only_touches_a_leading_number():
    assert strip_clause_number("5.1 Payment.") == "Payment."
    assert strip_clause_number("(4) Payment.") == "Payment."
    assert strip_clause_number("№ 7 Payment.") == "Payment."
    assert strip_clause_number("2026 was a good year.") == "2026 was a good year."
    assert strip_clause_number("Pay 5.1 USD.") == "Pay 5.1 USD."


def test_large_rewritten_block_still_pairs_changed_sentences_in_place():
    # More than 50 x 50 unmatched sentences: only nearby positions are compared, so it stays fast.
    a = [f"Clause {chr(97 + i % 26)}{i} states the obligation of party number {i} in detail." for i in range(120)]
    b = [text.replace("obligation", "duty") for text in a]
    differences = compare(sentences(*a), sentences(*b))
    assert len(differences) == 120 and {d["type"] for d in differences} == {"changed"}


def test_thousands_are_one_number_and_only_changed_figures_are_listed():
    differences = compare(
        sentences("Арендная плата составляет 450 000 тенге в месяц с 1 января 2027 года."),
        sentences("Арендная плата составляет 500 000 тенге в месяц с 1 января 2027 года."),
    )
    assert differences[0]["explanation"] == "Numbers differ: 450 000 vs 500 000"
