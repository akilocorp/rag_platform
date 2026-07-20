"""
Deterministic chart computation for experiential labs.

The generation model no longer *invents* chart numbers — it writes the lab's
model as a small Python function (`simulate(p)`), and we EXECUTE it here, once
per layer, to produce the exact series. A capital-per-worker line computed from
a real accumulation equation cannot slope the wrong way, which is the entire
point: the math, not the model's intuition, draws the curve.

Safety: the model code is generated server-side from a professor's prompt, but
we still treat it as untrusted. It runs through a strict AST allow-list (no
imports beyond `math`, no dunder access, no `while`, no I/O) plus a curated
builtins set and a wall-clock timeout. Without imports or attribute access to
dunders the code cannot reach anything dangerous — it can only do arithmetic.
Any violation, error, or shape mismatch raises ModelError and the caller falls
back to the model's illustrative numbers, so a bad function never breaks a lab.
"""
import ast
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout


class ModelError(Exception):
    """Raised when generated model code is unsafe, broken, or mis-shaped."""


# Wall-clock cap per simulate() call. Arithmetic over a handful of periods is
# instant; this only fires on a pathological loop the AST check didn't bound.
_TIMEOUT_SECONDS = 2.0

# Builtins the model function may call. Pure, side-effect-free, math-only.
_SAFE_BUILTINS = {
    'range': range, 'len': len, 'float': float, 'int': int, 'abs': abs,
    'min': min, 'max': max, 'sum': sum, 'round': round, 'enumerate': enumerate,
    'zip': zip, 'sorted': sorted, 'bool': bool, 'list': list, 'tuple': tuple,
    'dict': dict, 'True': True, 'False': False, 'None': None,
}
# Callables reachable as bare names inside the code.
_ALLOWED_CALL_NAMES = set(_SAFE_BUILTINS.keys())

# Safe methods callable on values (lists/dicts). Dunders are blocked separately,
# and risky string methods (.format/.format_map, which can reach attributes via
# the format mini-language) are deliberately NOT here.
_SAFE_METHODS = {
    'get', 'append', 'extend', 'insert', 'pop', 'keys', 'values', 'items',
    'index', 'count', 'copy', 'setdefault',
}

# AST node types the validator permits. Everything else is rejected.
_ALLOWED_NODES = (
    ast.Module, ast.FunctionDef, ast.arguments, ast.arg, ast.Return,
    ast.Assign, ast.AugAssign, ast.AnnAssign, ast.For, ast.If, ast.Expr,
    ast.Pass, ast.Break, ast.Continue,
    # expressions
    ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call,
    ast.Name, ast.Load, ast.Store, ast.Constant, ast.List, ast.Tuple,
    ast.Dict, ast.Set, ast.Subscript, ast.Slice, ast.Attribute,
    ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.comprehension,
    ast.keyword, ast.Starred,
    # operators
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Lt, ast.Gt, ast.LtE, ast.GtE, ast.Eq, ast.NotEq,
    ast.And, ast.Or, ast.Not,
)
# Older Pythons expose subscript indices via ast.Index; tolerate if present.
if hasattr(ast, 'Index'):
    _ALLOWED_NODES = _ALLOWED_NODES + (ast.Index,)


def _validate_ast(tree):
    """Walk the tree; raise ModelError on the first disallowed construct."""
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise ModelError(f"disallowed syntax: {type(node).__name__}")
        # No name may start with an underscore (blocks dunder traversal).
        if isinstance(node, ast.Name) and node.id.startswith('_'):
            raise ModelError(f"disallowed name: {node.id}")
        if isinstance(node, ast.arg) and node.arg.startswith('_'):
            raise ModelError(f"disallowed arg: {node.arg}")
        # Attribute access: `math.<fn>` or a whitelisted safe method; never a dunder.
        if isinstance(node, ast.Attribute):
            if node.attr.startswith('_'):
                raise ModelError(f"disallowed attribute: {node.attr}")
            is_math = isinstance(node.value, ast.Name) and node.value.id == 'math'
            if not is_math and node.attr not in _SAFE_METHODS:
                raise ModelError(f"disallowed attribute: {node.attr}")
        # Calls must target a whitelisted bare name or a `math.<fn>`.
        if isinstance(node, ast.Call):
            fn = node.func
            if isinstance(fn, ast.Name):
                if fn.id not in _ALLOWED_CALL_NAMES:
                    raise ModelError(f"call to non-whitelisted function: {fn.id}")
            elif isinstance(fn, ast.Attribute):
                pass  # already constrained to math.<name> above
            else:
                raise ModelError("unsupported call target")


def _compile_simulate(code):
    """Validate + compile the model code, returning its `simulate` callable."""
    if not isinstance(code, str) or 'def simulate' not in code:
        raise ModelError("model.code must define simulate(p)")
    try:
        tree = ast.parse(code, mode='exec')
    except SyntaxError as e:
        raise ModelError(f"syntax error: {e}")
    _validate_ast(tree)
    namespace = {}
    exec(compile(tree, '<model>', 'exec'),  # noqa: S102 — sandboxed above
         {'__builtins__': _SAFE_BUILTINS, 'math': math}, namespace)
    fn = namespace.get('simulate')
    if not callable(fn):
        raise ModelError("model.code defines no callable simulate")
    return fn


def _coerce_series(value, variables, horizon):
    """Validate simulate()'s return into {var: [horizon clean floats]}."""
    if not isinstance(value, dict):
        raise ModelError("simulate() must return a dict of series")
    out = {}
    for var in variables:
        arr = value.get(var)
        if not isinstance(arr, (list, tuple)) or len(arr) != horizon:
            raise ModelError(f"series '{var}' must have {horizon} values")
        clean = []
        for x in arr:
            if isinstance(x, bool) or not isinstance(x, (int, float)):
                raise ModelError(f"series '{var}' has a non-number value")
            xf = float(x)
            if not math.isfinite(xf):
                raise ModelError(f"series '{var}' has a non-finite value")
            clean.append(round(xf, 4))
        out[var] = clean
    return out


def run_model(code, param_sets, variables, horizon):
    """Compute one series-dict per param set by running generated model code.

    Args:
        code: Python source defining `simulate(p) -> {var: [horizon numbers]}`.
        param_sets: list of parameter dicts (one per lab layer).
        variables: the chart keys each result must contain.
        horizon: required length of every series (e.g. 8 quarters).

    Returns:
        list aligned with param_sets, each `{var: [floats]}`.

    Raises:
        ModelError on any unsafe code, runtime error, timeout, or bad shape.
    """
    if not variables:
        raise ModelError("no variables to compute")
    if not isinstance(horizon, int) or horizon < 2 or horizon > 64:
        raise ModelError("horizon must be an int in [2, 64]")
    fn = _compile_simulate(code)

    results = []
    with ThreadPoolExecutor(max_workers=1) as pool:
        for params in param_sets:
            p = dict(params) if isinstance(params, dict) else {}
            try:
                value = pool.submit(fn, p).result(timeout=_TIMEOUT_SECONDS)
            except FutureTimeout:
                raise ModelError("simulate() timed out")
            except ModelError:
                raise
            except Exception as e:  # noqa: BLE001 — any model bug → fallback
                raise ModelError(f"simulate() raised: {e}")
            results.append(_coerce_series(value, variables, horizon))
    return results
