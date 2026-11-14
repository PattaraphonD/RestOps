"""Copy the shared business logic into the Apps Script project and the Supabase Edge Function.

app/js/core.js, costing.js and pricing.js are the sources of truth. Run this after changing them:

    python tools/build_backend.py

It writes backend/Core.gs, Costing.gs and Pricing.gs. Paste them with Server.gs and appsscript.json into the
Apps Script editor (or push them with clasp).
"""
from pathlib import Path

root = Path(__file__).resolve().parent.parent
for name in ("core", "costing", "pricing"):
    src = (root / "app" / "js" / f"{name}.js").read_text(encoding="utf-8")
    header = (
        f"// GENERATED from app/js/{name}.js by tools/build_backend.py. Do not edit here;\n"
        f"// edit app/js/{name}.js and run the script again.\n\n"
    )
    out = root / "backend" / f"{name.capitalize()}.gs"
    out.write_text(header + src, encoding="utf-8", newline="\n")
    print(f"Wrote {out.relative_to(root)} ({len(src):,} chars)")

# Supabase Edge Function: the same rules plus the Postgres server layer. Each file also sets its global
# on globalThis, because Deno loads them as ES modules (top-level `var` is module-scoped there).
shared = root / "supabase" / "functions" / "_shared"
shared.mkdir(parents=True, exist_ok=True)
files = [(root / "app" / "js" / f"{n}.js", g) for n, g in (("costing", "RestoCosting"), ("pricing", "RestoPricing"), ("core", "RestoCore"))]
files += [(root / "server" / f"{n}.js", g) for n, g in (("types", "RestoPgTypes"), ("store", "RestoStore"), ("pg", "RestoPg"),
                                                         ("handler", "RestoHandler"), ("http", "RestoHttp"), ("pgjs", "RestoPgjs"))]
for src_path, glob in files:
    src = src_path.read_text(encoding="utf-8")
    rel = src_path.relative_to(root).as_posix()
    out = shared / src_path.name
    out.write_text(f"// GENERATED from {rel} by tools/build_backend.py. Do not edit here.\n" + src +
                   f"\nglobalThis.{glob} = {glob};\n", encoding="utf-8", newline="\n")
    print(f"Wrote {out.relative_to(root)}")
(shared / "manifest.json").write_text((root / "server" / "manifest.json").read_text(encoding="utf-8"), encoding="utf-8", newline="\n")
print(f"Wrote {(shared / 'manifest.json').relative_to(root)}")
