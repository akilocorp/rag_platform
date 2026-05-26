"""Auto-import every sibling module so `register_preset` calls run on import.

Adding a new assignment type = drop a `.py` file in this folder. No edits to
this file or to the registry. `base.py` is excluded (it owns the registry);
files starting with `_` are ignored.
"""
import importlib
import pkgutil

_pkg = __name__
for _, modname, _ in pkgutil.iter_modules(__path__):
    if modname.startswith('_') or modname == 'base':
        continue
    importlib.import_module(f"{_pkg}.{modname}")
