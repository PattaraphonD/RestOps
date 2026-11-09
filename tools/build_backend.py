"""Copy the shared business logic into the Apps Script project.

app/js/core.js is the single source of truth. Run this after changing it:

    python tools/build_backend.py

It writes backend/Core.gs. Paste Core.gs, Server.gs and appsscript.json into the
Apps Script editor (or push them with clasp).
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = (root / "app" / "js" / "core.js").read_text(encoding="utf-8")
header = (
    "// GENERATED from app/js/core.js by tools/build_backend.py. Do not edit here;\n"
    "// edit app/js/core.js and run the script again.\n\n"
)
out = root / "backend" / "Core.gs"
out.write_text(header + src, encoding="utf-8", newline="\n")
print(f"Wrote {out.relative_to(root)} ({len(src):,} chars)")
