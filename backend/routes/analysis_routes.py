import json
import logging
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, message_to_dict
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory

logger = logging.getLogger(__name__)
analysis_bp = Blueprint('analysis', __name__)

BATCH_SIZE = 20
BATCH_CONCURRENCY = 5
MAX_STUDENT_WORDS = 600

# In-memory job store: job_id -> {status, progress, result, error}
_jobs = {}


def _parse_json(text):
    text = text.strip()
    for pattern in (r'\[.*\]', r'\{.*\}'):
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
    return json.loads(text)


def _llm(api_key, prompt, max_tokens=600):
    llm = ChatOpenAI(model='gpt-5', api_key=api_key, max_tokens=max_tokens)
    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content


def _get_transcript(mongo_client, db_name, session_id):
    history = MongoDBChatMessageHistory(
        connection_string=None,
        client=mongo_client,
        session_id=session_id,
        database_name=db_name,
        collection_name='chat_histories',
        create_index=False,
    )
    lines = []
    for msg in history.messages:
        d = message_to_dict(msg)
        role = 'Student' if d.get('type') == 'human' else 'AI'
        content = (d.get('data') or {}).get('content', '')
        if isinstance(content, list):
            content = ' '.join(b.get('text', '') for b in content if isinstance(b, dict))
        if content:
            lines.append(f'[{role}]: {content}')
    return '\n'.join(lines)


def _student_only(transcript):
    lines = [l for l in transcript.splitlines() if l.startswith('[Student]:')]
    text = '\n'.join(lines)
    words = text.split()
    if len(words) > MAX_STUDENT_WORDS:
        text = ' '.join(words[:MAX_STUDENT_WORDS]) + ' [truncated]'
    return text


def _analyze_batch(api_key, system_prompt, batch, grading_criteria=''):
    context = system_prompt.strip() or 'a general AI assistant conversation'
    criteria_block = f"\nGrading criteria from professor:\n{grading_criteria.strip()}\n" if grading_criteria and grading_criteria.strip() else ''
    criteria_note = ' Prioritize the professor\'s grading criteria when scoring.' if criteria_block else ''

    sections = []
    for i, item in enumerate(batch, 1):
        student_text = item['student_text'].strip() or '[no messages]'
        sections.append(f"=== Session {i} | session_id: {item['session_id']} ===\n{student_text}")

    prompt = f"""You are a strict academic evaluator grading students' participation in an AI-assisted simulation.

The AI played this role:
{context}
{criteria_block}
Below are student messages ONLY (AI responses excluded). Grade each student on what they wrote.

SCORING RULES:
- Greetings, one-word replies, or filler ("hi", "hello", "ok") → score 0-15.
- Substantive, relevant responses needed for score > 50.
- Depth and specificity needed for score > 70.{criteria_note}

{chr(10).join(sections)}

Return a JSON array with exactly {len(batch)} objects, one per session IN ORDER:
{{"session_id": "<the session_id shown above>", "score": <0-100>, "summary": "<2-3 sentences on student messages only>", "strengths": ["..."], "improvements": ["..."]}}

Return ONLY the JSON array."""

    raw = _llm(api_key, prompt, max_tokens=250 * len(batch))
    results = _parse_json(raw)
    if not isinstance(results, list):
        raise ValueError(f'Expected list, got {type(results).__name__}: {raw[:200]}')
    return results


def _build_class_summary(api_key, system_prompt, analyses):
    context = system_prompt.strip() or 'a general AI assistant conversation'
    lines = '\n'.join(f'- Score {a["score"]}/100: {a["summary"]}' for a in analyses)
    prompt = f"""You are summarizing class-wide performance for a professor.

The simulation scenario was: {context}

Individual student results:
{lines}

Return a JSON object:
{{
  "overall_insight": "<3-4 sentence paragraph>",
  "common_strengths": ["<pattern>", "<another>"],
  "common_weaknesses": ["<gap>", "<another>"]
}}

Return only the JSON object."""
    try:
        return _parse_json(_llm(api_key, prompt, max_tokens=600))
    except Exception as e:
        logger.error(f'Class summary failed: {e}')
        return {'overall_insight': 'Unable to generate class summary.', 'common_strengths': [], 'common_weaknesses': []}


def _run_analysis(job_id, config_id, api_key, system_prompt, grading_criteria, mongo_client, db_name, users_col_name, labeled):
    """Background thread: runs full analysis and writes result to _jobs[job_id]."""
    try:
        total = len(labeled)
        print(f'[job {job_id[:8]}] start: {total} sessions', flush=True)

        # Step 1: fetch transcripts in parallel
        _jobs[job_id]['progress'] = f'Loading transcripts (0/{total})…'

        def _fetch(item):
            if item['message_count'] == 0:
                return item['session_id'], ''
            try:
                t = _get_transcript(mongo_client, db_name, item['session_id'])
                return item['session_id'], _student_only(t)
            except Exception as e:
                print(f'[job {job_id[:8]}] transcript error {item["session_id"]}: {e}', flush=True)
                return item['session_id'], ''

        transcript_map = {}
        with ThreadPoolExecutor(max_workers=25) as ex:
            for sid, text in ex.map(_fetch, labeled):
                transcript_map[sid] = text

        non_empty = sum(1 for t in transcript_map.values() if t)
        print(f'[job {job_id[:8]}] transcripts done. non-empty={non_empty}', flush=True)
        _jobs[job_id]['progress'] = f'Transcripts loaded. Grading {non_empty} sessions…'

        # Step 2: split into batches
        to_analyze = []
        zero_results = []
        for item in labeled:
            text = transcript_map.get(item['session_id'], '')
            if not text:
                zero_results.append({
                    'session_id': item['session_id'], 'display_name': item['display_name'],
                    'score': 0, 'message_count': item['message_count'],
                    'summary': 'No interaction recorded for this session.',
                    'strengths': [], 'improvements': ['Student did not engage with the simulation.'],
                })
            else:
                to_analyze.append({**item, 'student_text': text})

        batches = [to_analyze[i:i + BATCH_SIZE] for i in range(0, len(to_analyze), BATCH_SIZE)]
        total_batches = len(batches)
        print(f'[job {job_id[:8]}] {len(to_analyze)} to grade → {total_batches} batches', flush=True)

        # Step 3: run batch LLM calls
        llm_results = {}
        completed_batches = 0

        def _run_batch(batch_index, batch):
            nonlocal completed_batches
            print(f'[job {job_id[:8]}] batch {batch_index+1}/{total_batches} start', flush=True)
            try:
                results = _analyze_batch(api_key, system_prompt, batch, grading_criteria)
                out = {}
                for i, item in enumerate(batch):
                    r = results[i] if i < len(results) else {}
                    r['session_id'] = item['session_id']
                    r['display_name'] = item['display_name']
                    r['message_count'] = item['message_count']
                    r.setdefault('score', 0)
                    r.setdefault('summary', '')
                    r.setdefault('strengths', [])
                    r.setdefault('improvements', [])
                    out[item['session_id']] = r
                completed_batches += 1
                _jobs[job_id]['progress'] = f'Grading… {completed_batches}/{total_batches} batches done'
                print(f'[job {job_id[:8]}] batch {batch_index+1}/{total_batches} done', flush=True)
                return out
            except Exception as e:
                print(f'[job {job_id[:8]}] batch {batch_index+1} FAILED: {e}', flush=True)
                completed_batches += 1
                _jobs[job_id]['progress'] = f'Grading… {completed_batches}/{total_batches} batches done'
                return {
                    item['session_id']: {
                        'session_id': item['session_id'], 'display_name': item['display_name'],
                        'score': 0, 'message_count': item['message_count'],
                        'summary': 'Analysis failed for this session.', 'strengths': [], 'improvements': [],
                    }
                    for item in batch
                }

        with ThreadPoolExecutor(max_workers=BATCH_CONCURRENCY) as ex:
            futures = {ex.submit(_run_batch, i, b): i for i, b in enumerate(batches)}
            for future in as_completed(futures):
                llm_results.update(future.result())

        # Merge results preserving order
        analyses = []
        for item in labeled:
            sid = item['session_id']
            if sid in llm_results:
                analyses.append(llm_results[sid])
            else:
                analyses.append(next((r for r in zero_results if r['session_id'] == sid), {
                    'session_id': sid, 'display_name': item['display_name'],
                    'score': 0, 'message_count': item['message_count'],
                    'summary': 'No interaction recorded for this session.',
                    'strengths': [], 'improvements': [],
                }))

        scored = [a for a in analyses if a.get('score', 0) > 0]
        avg_score = round(sum(a['score'] for a in scored) / len(scored)) if scored else 0
        print(f'[job {job_id[:8]}] grading done. scored={len(scored)} avg={avg_score}', flush=True)

        _jobs[job_id]['progress'] = 'Generating class summary…'
        summary = _build_class_summary(api_key, system_prompt, scored) if scored else {
            'overall_insight': 'No completed sessions to analyze.',
            'common_strengths': [], 'common_weaknesses': [],
        }

        analyses.sort(key=lambda a: a.get('score', 0), reverse=True)

        _jobs[job_id].update({
            'status': 'done',
            'progress': 'Done',
            'result': {
                'class_summary': {
                    'avg_score': avg_score,
                    'total_sessions': total,
                    'overall_insight': summary.get('overall_insight', ''),
                    'common_strengths': summary.get('common_strengths', []),
                    'common_weaknesses': summary.get('common_weaknesses', []),
                },
                'top_performers': analyses[:3],
                'students': analyses,
            },
        })
        print(f'[job {job_id[:8]}] complete.', flush=True)

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'[job {job_id[:8]}] FATAL: {tb}', flush=True)
        _jobs[job_id].update({'status': 'error', 'error': f'{type(e).__name__}: {str(e)}'})


@analysis_bp.route('/config/<string:config_id>/analyze-debug', methods=['GET'])
@jwt_required()
def analyze_debug(config_id):
    try:
        user_id = get_jwt_identity()
        db = current_app.config['MONGO_DB']
        config_doc = db['config_collections'].find_one({'_id': ObjectId(config_id)})
        if not config_doc or str(config_doc.get('user_id', '')) != user_id:
            return jsonify({'error': 'Not found or forbidden'}), 403
        sessions = list(db['chat_session_metadata'].find({'config_id': config_id}))
        result = []
        for s in sessions[:5]:
            sid = s.get('session_id', str(s['_id']))
            hist_doc = db['chat_histories'].find_one({'SessionId': sid})
            history_sample = None
            if hist_doc:
                raw = hist_doc.get('History') or []
                history_sample = {'count': len(raw), 'first_entry_preview': str(raw[0])[:300] if raw else None}
            result.append({'session_id': sid, 'history_doc_found': hist_doc is not None, 'history_sample': history_sample})
        return jsonify({'sessions': result, 'total': len(sessions)})
    except Exception as e:
        import traceback
        return jsonify({'error': str(e), 'tb': traceback.format_exc()}), 500


@analysis_bp.route('/config/<string:config_id>/analyze', methods=['POST'])
@jwt_required()
def analyze_config(config_id):
    """Start an async analysis job. Returns {job_id} immediately."""
    try:
        user_id = get_jwt_identity()
        db = current_app.config['MONGO_DB']
        api_key = current_app.config['OPENAI_API_KEY']

        config_doc = db['config_collections'].find_one({'_id': ObjectId(config_id)})
        if not config_doc:
            return jsonify({'error': 'Config not found'}), 404
        if str(config_doc.get('user_id', '')) != user_id:
            return jsonify({'error': 'Forbidden'}), 403

        system_prompt = config_doc.get('instructions', '') or ''
        grading_criteria = (request.get_json(silent=True) or {}).get('grading_criteria', '')

        users_col = current_app.config['MONGO_COLLECTION']
        pipeline = [
            {'$match': {'config_id': config_id}},
            {'$lookup': {
                'from': 'chat_histories',
                'let': {'sid': '$session_id'},
                'pipeline': [{'$match': {'$expr': {'$eq': ['$SessionId', '$$sid']}}}, {'$count': 'n'}],
                'as': 'msg_count',
            }},
            {'$lookup': {
                'from': users_col.name,
                'let': {'uid': '$user_id'},
                'pipeline': [
                    {'$match': {'$expr': {'$and': [
                        {'$ne': ['$$uid', 'anonymous']},
                        {'$eq': [{'$toString': '$_id'}, '$$uid']},
                    ]}}},
                    {'$project': {'email': 1, '_id': 0}},
                ],
                'as': 'user_info',
            }},
            {'$project': {
                'session_id': 1,
                'message_count': {'$ifNull': [{'$arrayElemAt': ['$msg_count.n', 0]}, 0]},
                'user_email': {'$ifNull': [{'$arrayElemAt': ['$user_info.email', 0]}, None]},
                'qualtrics_id': 1,
                'student_label': 1,
            }},
        ]
        sessions = list(db['chat_session_metadata'].aggregate(pipeline))
        if not sessions:
            return jsonify({'error': 'No sessions found for this config'}), 400

        labeled = []
        for s in sessions:
            sid = s.get('session_id', str(s['_id']))
            display = (
                s.get('student_label')
                or s.get('user_email')
                or (f"Q:{s['qualtrics_id']}" if s.get('qualtrics_id') else None)
                or f"Session {sid[:8]}"
            )
            labeled.append({
                'session_id': sid,
                'display_name': display,
                'message_count': s.get('message_count', 0),
            })

        job_id = str(uuid.uuid4())
        _jobs[job_id] = {'status': 'running', 'progress': 'Starting…', 'result': None, 'error': None}

        t = threading.Thread(
            target=_run_analysis,
            args=(job_id, config_id, api_key, system_prompt, grading_criteria,
                  db.client, db.name, users_col.name, labeled),
            daemon=True,
        )
        t.start()

        print(f'[analyze] started job {job_id[:8]} for config {config_id} ({len(labeled)} sessions)', flush=True)
        return jsonify({'job_id': job_id, 'total_sessions': len(labeled)})

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'[analyze] start error: {tb}', flush=True)
        return jsonify({'error': f'{type(e).__name__}: {str(e)}', 'traceback': tb}), 500


@analysis_bp.route('/config/<string:config_id>/analyze/<string:job_id>', methods=['GET'])
@jwt_required()
def analyze_status(config_id, job_id):
    """Poll job status. Returns {status, progress, result?, error?}."""
    job = _jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)
