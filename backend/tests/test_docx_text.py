"""DOCX: the extracted-text reader endpoint and the paragraph index carried by chat sources."""

from app.extraction import docx_blocks, find_block
from tests.conftest import make_docx, upload
from tests.test_chat import ask, conversation_for

SECTIONS = [
    ("Terms", ["The lease lasts 11 months.", "The rent is 450 USD per month."]),
    ("Termination", ["Either party may end the lease with 30 days notice."]),
]


def ready_docx(client, sections=SECTIONS) -> str:
    created = upload(client, "lease.docx", make_docx(sections)).json()
    assert client.get(f"/api/v1/documents/{created['id']}").json()["status"] == "ready"
    return created["id"]


def test_blocks_are_headings_paragraphs_and_sections(tmp_path):
    path = tmp_path / "lease.docx"
    path.write_bytes(make_docx(SECTIONS))
    blocks = docx_blocks(path)
    assert [(b["kind"], b["section"], b["text"]) for b in blocks] == [
        ("heading", "Terms", "Terms"),
        ("paragraph", "Terms", "The lease lasts 11 months."),
        ("paragraph", "Terms", "The rent is 450 USD per month."),
        ("heading", "Termination", "Termination"),
        ("paragraph", "Termination", "Either party may end the lease with 30 days notice."),
    ]
    assert [b["index"] for b in blocks] == [0, 1, 2, 3, 4]
    assert find_block(blocks, "The rent is 450 USD") == 2 and find_block(blocks, "not in the file") is None


def test_text_endpoint_for_docx(client):
    document = ready_docx(client)
    body = client.get(f"/api/v1/documents/{document}/text").json()
    assert body["kind"] == "docx" and body["documentId"] == document
    assert body["blocks"][2] == {"index": 2, "kind": "paragraph", "section": "Terms", "page": None, "text": "The rent is 450 USD per month."}


def test_text_endpoint_for_pdf_has_one_block_per_page(client):
    from tests.test_chat import ready_document

    document = ready_document(client, pages=("First page text.", "Second page text."))
    body = client.get(f"/api/v1/documents/{document}/text").json()
    assert [(b["kind"], b["page"], b["text"]) for b in body["blocks"]] == [
        ("page", 1, "First page text."),
        ("page", 2, "Second page text."),
    ]


def test_text_endpoint_errors(client):
    assert client.get("/api/v1/documents/nope/text").status_code == 404
    from tests.conftest import make_pdf

    scan = upload(client, "scan.pdf", make_pdf([""])).json()
    assert client.get(f"/api/v1/documents/{scan['id']}/text").status_code == 409


def test_a_docx_source_carries_the_paragraph_to_navigate_to(client, answerer):
    document = ready_docx(client)
    answerer.reply = "The rent is 450 USD per month [1]."
    events = dict(ask(client, conversation_for(client, document), "What is the rent?"))
    source = events["sources"]["sources"][0]
    assert source["page"] is None and source["location"] == "Terms"
    blocks = client.get(f"/api/v1/documents/{document}/text").json()["blocks"]
    assert source["quote"] in blocks[source["paragraph"]]["text"]


def test_docx_numbers_are_checked_like_pdf_numbers(client, answerer):
    document = ready_docx(client)
    answerer.reply = "The rent is 999 USD per month [1]."
    events = dict(ask(client, conversation_for(client, document), "What is the rent?"))
    assert events["done"]["answerStatus"] == "not_found"
