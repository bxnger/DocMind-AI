"""DOCX files with what real Word documents contain: tracked changes, text boxes, nested tables, footnotes, images.

Found with an edge-case file: insertions, text boxes, nested tables and footnotes were silently missing from the
search index and from the text reader. The final text of the document is what is indexed.
"""

import base64
import io
import zipfile

from docx import Document
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import Inches

from app.extraction import docx_blocks, extract_docx, find_block
from tests.conftest import upload
from tests.test_chat import ask, conversation_for

PIXEL = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
FOOTNOTES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
    '<w:footnote w:id="2"><w:p><w:r><w:t>Penalty is 0.5 percent per day SNOTE.</w:t></w:r></w:p></w:footnote>'
    "</w:footnotes>"
)


def make_edge_docx() -> bytes:
    doc = Document()
    doc.add_heading("Supply agreement", level=1)
    doc.add_paragraph("Plain paragraph: delivery takes 30 days PLAINMARK.")
    doc.add_picture(io.BytesIO(PIXEL), width=Inches(1))
    paragraph = doc.add_paragraph("Start. ")
    paragraph._p.append(parse_xml(f'<w:ins {nsdecls("w")} w:id="1" w:author="A"><w:r><w:t>Inserted words INSMARK. </w:t></w:r></w:ins>'))
    paragraph._p.append(parse_xml(f'<w:del {nsdecls("w")} w:id="2" w:author="A"><w:r><w:delText>Deleted words DELMARK. </w:delText></w:r></w:del>'))
    box = doc.add_paragraph("Paragraph with a text box. ")
    box._p.append(
        parse_xml(
            '<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:pict>'
            '<v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="t1"><v:textbox><w:txbxContent>'
            "<w:p><w:r><w:t>Boxed text BOXMARK: fine is 5 percent.</w:t></w:r></w:p>"
            "</w:txbxContent></v:textbox></v:shape></w:pict></w:r>"
        )
    )
    table = doc.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Outer cell OUTERMARK"
    table.cell(0, 1).add_table(rows=1, cols=1).cell(0, 0).text = "Nested cell NESTMARK"
    doc.sections[0].header.paragraphs[0].text = "Header HEADMARK"
    foot = doc.add_paragraph("Claim with a footnote")
    foot._p.append(parse_xml(f'<w:r {nsdecls("w")}><w:footnoteReference w:id="2"/></w:r>'))
    foot.add_run(". More text.")

    buffer = io.BytesIO()
    doc.save(buffer)
    source = zipfile.ZipFile(io.BytesIO(buffer.getvalue()))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename == "[Content_Types].xml":
                data = data.replace(
                    b"</Types>",
                    b'<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>',
                )
            elif item.filename == "word/_rels/document.xml.rels":
                data = data.replace(
                    b"</Relationships>",
                    b'<Relationship Id="rIdFn1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>',
                )
            target.writestr(item, data)
        target.writestr("word/footnotes.xml", FOOTNOTES)
    return out.getvalue()


def test_the_final_text_is_indexed_including_insertions_boxes_nested_tables_and_footnotes(tmp_path):
    path = tmp_path / "edge.docx"
    path.write_bytes(make_edge_docx())
    text = " ".join(segment.text for segment in extract_docx(path))
    for present in ("PLAINMARK", "INSMARK", "BOXMARK", "OUTERMARK", "NESTMARK", "SNOTE"):
        assert present in text, present
    assert "DELMARK" not in text  # deleted text is not part of the document any more
    assert "HEADMARK" not in text  # headers and footers are not extracted (documented)


def test_the_reader_has_the_same_content_with_the_right_kinds(tmp_path):
    path = tmp_path / "edge.docx"
    path.write_bytes(make_edge_docx())
    blocks = docx_blocks(path)
    kinds = {block["kind"] for block in blocks}
    assert {"heading", "paragraph", "text_box", "table_row", "footnote"} <= kinds
    footnote = blocks[find_block(blocks, "Penalty is 0.5 percent")]
    assert footnote["kind"] == "footnote" and footnote["section"] == "Footnotes"
    assert [block["index"] for block in blocks] == list(range(len(blocks)))


def test_a_document_without_footnotes_has_no_footnotes_section(tmp_path):
    doc = Document()
    doc.add_paragraph("Only a body paragraph.")
    path = tmp_path / "plain.docx"
    doc.save(path)
    assert [segment.location for segment in extract_docx(path)] == [None]


def test_a_footnote_can_be_cited_and_located(client, answerer):
    created = upload(client, "edge.docx", make_edge_docx()).json()
    answerer.reply = "The penalty is 0.5 percent per day [1]."
    events = dict(ask(client, conversation_for(client, created["id"]), "What is the penalty per day?"))
    assert events["done"]["answerStatus"] == "answered"
    source = events["sources"]["sources"][0]
    blocks = client.get(f"/api/v1/documents/{created['id']}/text").json()["blocks"]
    assert blocks[source["paragraph"]]["kind"] == "footnote" and source["location"] == "Footnotes"
