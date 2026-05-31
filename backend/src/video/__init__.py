"""Video-upload analysis feature.

Two decoupled stages:
  - pipeline.py  : runs Whisper + Hume (+ MediaPipe in phase 2) in parallel and
                   merges into raw `video_collected_data` (knows nothing about scoring).
  - scoring.py   : reads collected data + a config's `scoring_spec` and produces
                   the three composite scores (Confidence / Competence / Passion)
                   plus LLM feedback into `video_scores`.

The only contract between them is the collected-data schema (`schema_version`).
"""
