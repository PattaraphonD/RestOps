"""Check app text: every key used in the app exists in the Thai dictionary.

    python tools/check_i18n.py
"""
import re, sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent / "app" / "js"
src = (root / "i18n.js").read_text(encoding="utf-8")

def block(name):
    start = src.index(f"const {name} = {{")
    depth, i = 0, src.index("{", start)
    for j in range(i, len(src)):
        depth += src[j] == "{"
        depth -= src[j] == "}"
        if depth == 0:
            return src[i:j]
    raise SystemExit(f"could not parse {name}")

key_re = re.compile(r"'([a-zA-Z]+\.[A-Za-z0-9.]+)'\s*:")
th = set(key_re.findall(block("th")))
problems = []

used, prefixes = set(), set()
for f in root.rglob("*.js"):
    if f.name in ("i18n.js", "core.js"):
        continue
    code = f.read_text(encoding="utf-8")
    used |= set(re.findall(r"\bt\(\s*'([^']+)'", code))
    used |= set(re.findall(r"'((?:stock|home|common|sales)\.reason\w+)'", code))
    prefixes |= set(re.findall(r"\bt\(\s*`([a-z]+\.[A-Za-z.]*)\$\{", code))
problems += [f"used but missing: {k}" for k in sorted(used - th)]
problems += [f"no keys for dynamic prefix: {p}" for p in sorted(prefixes) if not any(k.startswith(p) for k in th)]

print(f"{len(th)} Thai keys, {len(used)} literal keys used, dynamic prefixes: {sorted(prefixes)}")
if problems:
    print("\n".join(problems))
    sys.exit(1)
print("All text present.")
