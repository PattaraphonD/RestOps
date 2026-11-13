"""Copy the shared business logic into the Apps Script project.

app/js/core.js and app/js/costing.js are the sources of truth. Run this after changing it:

    python tools/build_backend.py

It writes backend/Core.gs and backend/Costing.gs. Paste Core.gs, Costing.gs, Server.gs and appsscript.json into the
Apps Script editor (or push them with clasp).
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
for name in ("core", "costing"):
    src = (root / "app" / "js" / f"{name}.js").read_text(encoding="utf-8")
    header = (
        f"// GENERATED from app/js/{name}.js by tools/build_backend.py. Do not edit here;\n"
        f"// edit app/js/{name}.js and run the script again.\n\n"
    )
    out = root / "backend" / f"{name.capitalize()}.gs"
    out.write_text(header + src, encoding="utf-8", newline="\n")
    print(f"Wrote {out.relative_to(root)} ({len(src):,} chars)")
