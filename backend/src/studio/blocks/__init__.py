# @language  Python
# @updated   2026-09-07
# @changed   New file: auto-import every sibling block module, mirroring
#            src/agentic/tools/__init__.py.
"""
Auto-import every sibling module so `@block` decorators register on import.

Adding a new block = drop a `.py` file in this folder. No edits to this file
or to registry.py — the import machinery handles it.

`base.py` is excluded (it owns the registry itself); files starting with `_`
are ignored.
"""
import importlib
import pkgutil

_pkg = __name__
for _, modname, _ in pkgutil.iter_modules(__path__):
    if modname.startswith('_') or modname == 'base':
        continue
    importlib.import_module(f"{_pkg}.{modname}")
