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
        query = "日本語の成果物"
        assert text.count(query) == 1, text
        fragments = page.search_for(query)
        assert fragments, query
        # The minimal graph has three stroked nodes. The output label must
        # fit inside one of them after WebKit chooses its fallback font.
        assert any(
            shape["type"] == "s"
            and all(shape["rect"].contains(fragment) for fragment in fragments)
            for shape in page.get_drawings()
        ), fragments
