# @language  Python
# @updated   2026-07-20
# @changed   Create the src.models package so manager_exercise_session imports cleanly.
"""src.models — durable Mongo persistence models for the RAG platform.

Sibling model classes historically live under ``backend/models/`` (see
``models/experiential_session.py``). The Manager Exercise contract places its
session model under ``backend/src/models/`` and asks for this ``__init__.py`` so
``from src.models.manager_exercise_session import ManagerExerciseSession`` works
regardless of namespace-package resolution.
"""
