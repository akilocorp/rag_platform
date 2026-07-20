"""
Auto-import every sibling module so `@widget` decorators register on import.

Adding a new widget = drop a `.py` file in this folder. No edits to this file
or to the registry. Files starting with `_` are ignored.
"""
import importlib
import pkgutil

_pkg = __name__
for _, modname, _ in pkgutil.iter_modules(__path__):
    if modname.startswith('_'):
        continue
    importlib.import_module(f"{_pkg}.{modname}")
