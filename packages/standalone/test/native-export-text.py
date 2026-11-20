"""Check the same output PDF with MuPDF, independently of PDFKit."""

import sys

import pymupdf

pdf, case, *queries = sys.argv[1:]
with pymupdf.open(pdf) as document:
    page = document[0]
    text = page.get_text()
    for query in queries:
        assert query in text, (case, query, text)

    if case == "minimal":
        assert (page.rect.width, page.rect.height) == (306, 51), page.rect
        (label,) = page.search_for("日本語の成果物")
        # The minimal graph has three stroked nodes. The output label must
        # fit inside one of them after WebKit chooses its fallback font.
        assert any(
            shape["type"] == "s" and shape["rect"].contains(label)
            for shape in page.get_drawings()
        ), label
