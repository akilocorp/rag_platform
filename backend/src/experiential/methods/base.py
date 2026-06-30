"""
Pedagogical method primitives — a `method()` registration helper + the
module-level registry dict it populates.

A "method" is one teaching pedagogy for experiential labs. It owns the SYSTEM
PROMPT (the spine the model must follow) and a few human-facing fields. The
professor fine-tunes a method at generation time by writing their own design
prompt — that prompt is combined with the method's `system_prompt`, so the
method sets the shape and the professor fills the content.

See README.md in this folder for the dev workflow ("how to add a method").
"""
from dataclasses import dataclass
from typing import Dict


@dataclass
class Method:
    id: str            # stable kebab id, sent as `template` from the client
    label: str         # short dropdown label
    description: str    # one line: what this pedagogy does (shown under the picker)
    system_prompt: str  # the spine the model must follow when generating a lab
    prompt_hint: str = ''  # placeholder guiding the professor's own design prompt
    # The FRONTEND method id (validator + player) that this prompt's output is
    # rendered by. Generated labs are stamped config.method = schema. Several
    # prompt-methods can share one frontend schema (e.g. econ + generic both
    # target 'predict-reveal'); a brand-new flow sets its own.
    schema: str = 'predict-reveal'


# id -> Method. Populated as a side-effect of importing the method modules.
METHODS: Dict[str, Method] = {}


def method(id: str, label: str, description: str, system_prompt: str,
           prompt_hint: str = '', schema: str = 'predict-reveal'):
    """Register a pedagogical method. Call once per method file.

    Raises on id collision so two files can't silently claim the same id.
    """
    if id in METHODS:
        raise ValueError(
            f"Method id collision: '{id}' is already registered "
            f"(by {METHODS[id].__module__ if hasattr(METHODS[id], '__module__') else 'another file'})"
        )
    m = Method(
        id=id,
        label=label,
        description=description,
        system_prompt=system_prompt,
        prompt_hint=prompt_hint,
        schema=schema,
    )
    METHODS[id] = m
    return m
