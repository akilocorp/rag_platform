# Pedagogical methods

Each file here is one **teaching pedagogy** for experiential labs. A method owns
the **system prompt** (the spine the model must follow when generating a lab) and
some human-facing metadata. The professor picks a method in the lab generator and
**fine-tunes it with their own design prompt** — their prompt is combined with the
method's `system_prompt` at generation time, so the method sets the *shape* and the
professor fills the *content*.

## Add a method = drop a file

Create `your_method.py` in this folder:

```python
from src.experiential.methods.base import method

SYSTEM_PROMPT = """You are an instructional designer ...
Output ONE JSON object matching the ExperientialConfig schema ..."""

method(
    id='your-method',                       # stable kebab id (sent as `template`)
    label='Your method (short label)',       # dropdown label
    description='One line on what this pedagogy does.',
    system_prompt=SYSTEM_PROMPT,
    prompt_hint='Placeholder guiding the professor\'s own design prompt.',
)
```

That's it — no edits to `__init__.py`, `registry.py`, the routes, or the frontend.
The folder auto-discovers the file on import, `GET /api/experiential/methods` lists
it, and the picker shows it. An id collision raises at import time.

## Important constraint

The lab **player** (`frontend/src/pages/ExperientialPage.jsx`) and the **schema
validator** (`frontend/src/configs/experiential/schema.js`) only know how to render
the `predict → commit → reveal → explain` shape: `predictionVariables`, `layers`
(baseline + complications), `probes`, `synthesis`, `scoring`.

So a method here can freely change the *framing, discipline, layer count, variables,
scoring weights, and tone* — but its `system_prompt` must still emit that schema. A
genuinely different *flow* (Socratic dialogue, branching case, build-the-model) also
needs a new player + schema; this folder alone won't render it.
