"""
Auto-import every sibling module so each method file's `method(...)` call
registers on import.

Adding a new pedagogy = drop a `.py` file in this folder that calls
`method(...)`. No edits to this file or to the registry — the import machinery
handles it.

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
