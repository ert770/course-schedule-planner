# Read the reviewed synonym workbook (2026-10-14-tag-synonym-candidates.xlsx) and write the
# approved alias -> canonical pairs as JSON for scripts/applyTagSynonyms.js.
# Columns are located by header text from the UTF-8 payload so this file stays ASCII only.
# A blank decision means "agree with the suggestion"; only explicit decisions count for the
# "needs review" sheet, whose suggestion is not a decision.
import json
import sys

from openpyxl import load_workbook

MERGE = "合併"          # merge
NO_MERGE = "不合併"  # do not merge


def main(workbook_path, output_path):
    book = load_workbook(workbook_path, read_only=True)
    approved, rejected, undecided = [], [], []
    for sheet in book.worksheets[1:]:
        rows = sheet.iter_rows(values_only=True)
        head = list(next(rows))
        alias_i, canonical_i, suggestion_i, decision_i = 0, 1, 2, 3
        alias_id_i, canonical_id_i = len(head) - 2, len(head) - 1
        for row in rows:
            if not row or not row[alias_id_i]:
                continue
            decision = row[decision_i].strip() if isinstance(row[decision_i], str) else ""
            final = decision or (row[suggestion_i] if row[suggestion_i] in (MERGE, NO_MERGE) else "")
            item = {
                "sheet": sheet.title,
                "alias": row[alias_i], "aliasId": row[alias_id_i],
                "canonical": row[canonical_i], "canonicalId": row[canonical_id_i],
            }
            if final == MERGE:
                approved.append(item)
            elif final == NO_MERGE:
                rejected.append(item)
            else:
                undecided.append(item)
    with open(output_path, "w", encoding="utf-8") as handle:
        json.dump({"approved": approved, "rejected": rejected, "undecided": undecided}, handle, ensure_ascii=False, indent=1)
    print("approved", len(approved), "rejected", len(rejected), "undecided", len(undecided))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
