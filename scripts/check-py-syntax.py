"""Check Python syntax for webapp backend files."""
import glob
import py_compile
import sys

files = ["main.py"] + glob.glob("api/*.py")
errors = []
for f in files:
    try:
        py_compile.compile(f, doraise=True)
    except py_compile.PyCompileError as e:
        errors.append(str(e))

if errors:
    for e in errors:
        print(e, file=sys.stderr)
    sys.exit(1)
print(f"Syntax OK ({len(files)} files)")
