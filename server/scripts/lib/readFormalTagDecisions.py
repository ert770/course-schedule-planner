# Read reviewed formal-tag workbook -> JSON list of tag ids marked for downweighting.
# Sheets are addressed by position; decision falls back to the suggestion column when blank.
import json, sys
import openpyxl
src, out = sys.argv[1], sys.argv[2]
book = openpyxl.load_workbook(src, read_only=True)
DOWN = "\u964d\u6b0a"   # downweight
KEEP = "\u4fdd\u7559"   # keep
rows = []
for sheet in book.worksheets[1:]:
    it = sheet.iter_rows(values_only=True)
    head = list(next(it))
    name_i, sug_i, dec_i, id_i = 0, 2, 3, len(head) - 1
    for r in it:
        if not r or not r[id_i]:
            continue
        decision = (r[dec_i] or "").strip() if isinstance(r[dec_i], str) else ""
        final = decision or r[sug_i]
        if final not in (DOWN, KEEP):
            raise SystemExit("undecided row: %r" % (r[:4],))
        rows.append({"id": r[id_i], "name": r[name_i], "sheet": sheet.title, "final": final, "overridden": bool(decision and decision != r[sug_i])})
json.dump(rows, open(out, "w", encoding="utf-8"), ensure_ascii=False)
print("rows", len(rows), "down", sum(1 for x in rows if x["final"] == DOWN), "overridden", sum(1 for x in rows if x["overridden"]))
