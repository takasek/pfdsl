package adr

schema_version := 2
rule_ids := {"adr-heading", "adr-index", "adr-replacement"}

adrs contains doc if {
    some doc in input.documents
    doc.name != "README.md"
}
index := doc if {
    some doc in input.documents
    doc.name == "README.md"
}
id(doc) := concat("", ["ADR-", split(doc.name, "-")[0]])
finding(rule, doc, line, msg) := {"rule": rule, "path": doc.path, "line": line, "message": msg}

valid_title(doc) if {
    regex.match(`^[0-9]{4}-.+\.md$`, doc.name)
    b := doc.blocks[0]
    b.kind == "heading"
    b.level == 1
    startswith(b.text, concat("", [id(doc), ":"]))
}
deny contains finding("adr-heading", doc, 1, "File number must match the ADR H1") if {
    some doc in adrs
    not valid_title(doc)
}
deny contains finding("adr-heading", doc, 1, "Duplicate ADR number") if {
    some doc in adrs
    some other in adrs
    doc.path != other.path
    id(doc) == id(other)
}

# The index uses one bullet per ADR, with its ID before the title link.
in_index(line) if {
    headings := [b | some b in index.blocks; b.kind == "heading"; b.level <= 2; b.line < line]
    last := headings[count(headings)-1]
    last.level == 2
    last.text == "一覧"
}
index_links contains l if {
    some pos, l in index.links
    in_index(l.line)
    not earlier_link_on_line(pos, l.line)
}
earlier_link_on_line(pos, line) if {
    some before, l in index.links
    before < pos
    l.line == line
}
listed(doc) if {
    some l in index_links
    l.target == doc.path
    l.kind == "file"
}
deny contains finding("adr-index", doc, 1, "ADR is absent from the index") if {
    some doc in adrs
    not listed(doc)
}
block_links(b) := [link | some link in index_links; link.line >= b.line; link.line <= b.end_line]

# regomark keeps list text in order, but strips blank lines between items.
# Pair the rows with ordered primary links only when every row has one.
balanced(b) if { count(split(b.text, "\n")) == count(block_links(b)) }
matches_index_row(b, l, doc) if {
    balanced(b)
    earlier := [other | some other in block_links(b); other.line < l.line]
    row := split(b.text, "\n")[count(earlier)]
    startswith(row, concat("", [id(doc), " ", l.text]))
}
matches_index_row(b, l, doc) if {
    not balanced(b)
    some row in split(b.text, "\n")
    startswith(row, concat("", [id(doc), " ", l.text]))
}
correct_entry(l) if {
    some doc in adrs
    doc.path == l.target
    l.kind == "file"
    some b in index.blocks
    b.kind == "list"
    b.line <= l.line
    b.end_line >= l.line
    matches_index_row(b, l, doc)
}
deny contains finding("adr-index", index, l.line, "Index entry does not match an ADR file and ID") if {
    some l in index_links
    not correct_entry(l)
}
# Check every ADR reference on an explicit replacement metadata line.
replacement_line(s) if { regex.match(`(?i)^(partially )?supersedes:`, s) }
replacement_line(s) if {
    startswith(s, "Status:")
    regex.match(`(?i)superseded (?:in part )?by|で部分上書き`, s)
}
exists_id(ref) if {
    some doc in adrs
    ref == id(doc)
}
metadata contains row if {
    some doc in adrs
    some b in doc.blocks
    b.kind in {"list", "paragraph"}
    some offset, line in split(b.text, "\n")
    replacement_line(line)
    some ref in regex.find_n(`ADR-[0-9]*`, line, -1)
    # Blank source lines are omitted from block text. Bound each item's
    # possible location by the number of text lines before and after it.
    first := b.line + offset
    last := b.end_line - count(split(b.text, "\n")) + 1 + offset
    row := {"doc": doc, "line": source_line(b, offset), "first": first, "last": last, "text": line, "ref": ref}
}
# When blank lines were stripped, the block start is the reliable fallback.
source_line(b, offset) := b.line + offset if {
    count(split(b.text, "\n")) == b.end_line - b.line + 1
} else := b.line
deny contains finding("adr-replacement", row.doc, row.line, concat("", ["Replacement refers to missing ", row.ref])) if {
    some row in metadata
    not exists_id(row.ref)
}
deny contains finding("adr-replacement", row.doc, l.line, "Replacement link does not resolve to the named ADR") if {
    some row in metadata
    some l in row.doc.links
    l.line >= row.first
    l.line <= row.last
    contains(row.text, l.text)
    row.ref in regex.find_n(`ADR-[0-9]+`, l.text, -1)
    exists_id(row.ref)
    not correct_target(l, row.ref)
}
correct_target(l, ref) if {
    some doc in adrs
    id(doc) == ref
    doc.path == l.target
    l.kind == "file"
}

# A missing link has no location in links; cite the index list block.
deny contains finding("adr-index", index, b.line, "Each index row must have a title link") if {
    some b in index.blocks
    b.kind == "list"
    in_index(b.line)
    not balanced(b)
}
deny contains finding("adr-index", index, l.line, "Duplicate ADR index entry") if {
    some l in index_links
    some earlier in index_links
    earlier.line < l.line
    earlier.target == l.target
}
