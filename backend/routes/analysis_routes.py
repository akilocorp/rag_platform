import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, message_to_dict
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory

logger = logging.getLogger(__name__)
analysis_bp = Blueprint('analysis', __name__)

BATCH_SIZE = 20          # sessions per LLM call
BATCH_CONCURRENCY = 5    # parallel batch calls
MAX_STUDENT_WORDS = 600  # cap per session to stay within context limits


def _parse_json(text):
    """Extract first {...} or [...] block from LLM output and parse it."""
    text = text.strip()
    # Try array first, then object
    for pattern in (r'\[.*\]', r'\{.*\}'):
        match = re.search(pattern, text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except Exception:
                pass
    return json.loads(text)


def _llm(api_key, prompt, max_tokens=600):
    llm = ChatOpenAI(model='gpt-4o-mini', api_key=api_key, temperature=0.2, max_tokens=max_tokens)
    response = llm.invoke([HumanMessage(content=prompt)])
    return response.content


def _get_transcript(mongo_client, db_name, session_id):
    # Reuse the existing MongoClient — do NOT pass connection_string or each call
    # creates a new client, exhausting the Atlas connection pool across 100s of sessions.
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
    """Return only the student lines, truncated to MAX_STUDENT_WORDS words."""
    lines = [l for l in transcript.splitlines() if l.startswith('[Student]:')]
    text = '\n'.join(lines)
    words = text.split()
    if len(words) > MAX_STUDENT_WORDS:
        text = ' '.join(words[:MAX_STUDENT_WORDS]) + ' [truncated]'
    return text


def _analyze_batch(api_key, system_prompt, batch, grading_criteria=''):
    """
    Analyze a list of session dicts [{session_id, display_name, message_count, student_text}]
    in a SINGLE LLM call. Returns a list of result dicts in the same order.
    """
    context = system_prompt.strip() or 'a general AI assistant conversation'
    criteria_block = f"\nGrading criteria from professor:\n{grading_criteria.strip()}\n" if grading_criteria and grading_criteria.strip() else ''
    criteria_note = ' Prioritize the professor\'s grading criteria when scoring.' if criteria_block else ''

    sections = []
    for i, item in enumerate(batch, 1):
        student_text = item['student_text'].strip() or '[no messages]'
        sections.append(f"=== Session {i} | session_id: {item['session_id']} ===\n{student_text}")

    combined = '\n\n'.join(sections)

    prompt = f"""You are a strict academic evaluator grading students' participation in an AI-assisted simulation.

The AI played this role:
{context}
{criteria_block}
Below are student messages ONLY (AI responses are excluded). Grade each student purely on what they wrote.

SCORING RULES:
- Greetings, one-word replies, or filler ("hi", "hello", "ok") → score 0-15.
- Substantive, relevant responses needed for score > 50.
- Depth and specificity needed for score > 70.{criteria_note}

{combined}

Return a JSON array with exactly {len(batch)} objects, one per session IN THE SAME ORDER, each with:
{{"session_id": "<the session_id shown above>", "score": <0-100>, "summary": "<2-3 sentences on student messages only>", "strengths": ["..."], "improvements": ["..."]}}

Return ONLY the JSON array, no other text."""

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

Return a JSON object with exactly these fields:
{{
  "overall_insight": "<3-4 sentence paragraph about how the class performed overall, key trends, and notable observations>",
  "common_strengths": ["<pattern across multiple students>", "<another common strength>"],
  "common_weaknesses": ["<common gap>", "<another common weakness>"]
}}

Return only the JSON object."""

    try:
        raw = _llm(api_key, prompt, max_tokens=600)
        return _parse_json(raw)
    except Exception as e:
        logger.error(f'Class summary failed: {e}')
        return {'overall_insight': 'Unable to generate class summary.', 'common_strengths': [], 'common_weaknesses': []}


@analysis_bp.route('/config/<string:config_id>/analyze-debug', methods=['GET'])
@jwt_required()
def analyze_debug(config_id):
    """Diagnostic: show raw session/history data for a config."""
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
                history_sample = {
                    'count': len(raw),
                    'first_entry_type': type(raw[0]).__name__ if raw else None,
                    'first_entry_preview': str(raw[0])[:300] if raw else None,
                }
            result.append({
                'session_id': sid,
                'user_id': s.get('user_id'),
                'history_doc_found': hist_doc is not None,
                'history_keys': list(hist_doc.keys()) if hist_doc else None,
                'history_sample': history_sample,
            })
        return jsonify({'sessions': result, 'total': len(sessions)})
    except Exception as e:
        import traceback
        return jsonify({'error': str(e), 'tb': traceback.format_exc()}), 500


@analysis_bp.route('/config/<string:config_id>/analyze', methods=['POST'])
@jwt_required()
def analyze_config(config_id):
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

        # --- Step 1: fetch sessions with live message counts ---
        users_col = current_app.config['MONGO_COLLECTION']
        pipeline = [
            {'$match': {'config_id': config_id}},
            {
                '$lookup': {
                    'from': 'chat_histories',
                    'let': {'sid': '$session_id'},
                    'pipeline': [
                        {'$match': {'$expr': {'$eq': ['$SessionId', '$$sid']}}},
                        {'$count': 'n'},
                    ],
                    'as': 'msg_count',
                }
            },
            {
                '$lookup': {
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
                }
            },
            {
                '$project': {
                    'session_id': 1,
                    'message_count': {'$ifNull': [{'$arrayElemAt': ['$msg_count.n', 0]}, 0]},
                    'user_email': {'$ifNull': [{'$arrayElemAt': ['$user_info.email', 0]}, None]},
                }
            },
        ]
        sessions = list(db['chat_session_metadata'].aggregate(pipeline))
        total = len(sessions)
        sessions_with_msgs = sum(1 for s in sessions if s.get('message_count', 0) > 0)
        print(f'[analyze] config={config_id} total_sessions={total} with_messages={sessions_with_msgs}', flush=True)

        if not sessions:
            return jsonify({'error': 'No sessions found for this config'}), 400

        mongo_client = db.client
        db_name = db.name
        anon_count = 0
        labeled = []
        for s in sessions:
            display = s.get('user_email')
            if not display:
                anon_count += 1
                display = f'Anonymous #{anon_count}'
            labeled.append({
                'session_id': s.get('session_id', str(s['_id'])),
                'display_name': display,
                'message_count': s.get('message_count', 0),
            })

        # --- Step 2: fetch transcripts in parallel (fast DB queries) ---
        print(f'[analyze] fetching transcripts for {sessions_with_msgs} sessions with messages...', flush=True)

        def _fetch_transcript(item):
            if item['message_count'] == 0:
                return item['session_id'], ''
            try:
                transcript = _get_transcript(mongo_client, db_name, item['session_id'])
                student_text = _student_only(transcript)
                return item['session_id'], student_text
            except Exception as e:
                print(f'[analyze] ERROR fetching transcript for {item["session_id"]}: {e}', flush=True)
                return item['session_id'], ''

        transcript_map = {}
        with ThreadPoolExecutor(max_workers=25) as executor:
            for sid, text in executor.map(_fetch_transcript, labeled):
                transcript_map[sid] = text

        print(f'[analyze] transcripts fetched. non-empty={sum(1 for t in transcript_map.values() if t)}', flush=True)

        # Build batch input, skip sessions with no student text (score 0 immediately)
        to_analyze = []
        zero_results = []
        for item in labeled:
            student_text = transcript_map.get(item['session_id'], '')
            if not student_text:
                zero_results.append({
                    'session_id': item['session_id'], 'display_name': item['display_name'],
                    'score': 0, 'message_count': item['message_count'],
                    'summary': 'No interaction recorded for this session.',
                    'strengths': [], 'improvements': ['Student did not engage with the simulation.'],
                })
            else:
                to_analyze.append({**item, 'student_text': student_text})

        # --- Step 3: batch LLM calls ---
        batches = [to_analyze[i:i + BATCH_SIZE] for i in range(0, len(to_analyze), BATCH_SIZE)]
        print(f'[analyze] {len(to_analyze)} sessions to grade → {len(batches)} batches of {BATCH_SIZE}', flush=True)

        llm_results = {}  # session_id → result dict

        def _run_batch(batch_index, batch):
            print(f'[analyze] batch {batch_index+1}/{len(batches)} starting ({len(batch)} sessions)', flush=True)
            try:
                results = _analyze_batch(api_key, system_prompt, batch, grading_criteria)
                # Map back by session_id (LLM should return them in order)
                out = {}
                for i, item in enumerate(batch):
                    if i < len(results):
                        r = results[i]
                        r['session_id'] = item['session_id']   # enforce correct id
                        r['display_name'] = item['display_name']
                        r['message_count'] = item['message_count']
                        r.setdefault('score', 0)
                        r.setdefault('summary', '')
                        r.setdefault('strengths', [])
                        r.setdefault('improvements', [])
                        out[item['session_id']] = r
                    else:
                        out[item['session_id']] = {
                            'session_id': item['session_id'], 'display_name': item['display_name'],
                            'score': 0, 'message_count': item['message_count'],
                            'summary': 'Could not analyze this session.', 'strengths': [], 'improvements': [],
                        }
                print(f'[analyze] batch {batch_index+1}/{len(batches)} done', flush=True)
                return out
            except Exception as e:
                print(f'[analyze] batch {batch_index+1} FAILED: {type(e).__name__}: {e}', flush=True)
                return {
                    item['session_id']: {
                        'session_id': item['session_id'], 'display_name': item['display_name'],
                        'score': 0, 'message_count': item['message_count'],
                        'summary': 'Analysis failed for this session.', 'strengths': [], 'improvements': [],
                    }
                    for item in batch
                }

        with ThreadPoolExecutor(max_workers=BATCH_CONCURRENCY) as executor:
            futures = {executor.submit(_run_batch, i, b): i for i, b in enumerate(batches)}
            for future in as_completed(futures):
                llm_results.update(future.result())

        # Merge: zero_results + llm_results, preserving original order
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
        print(f'[analyze] scored={len(scored)} avg={avg_score}', flush=True)

        summary = _build_class_summary(api_key, system_prompt, scored) if scored else {
            'overall_insight': 'No completed sessions to analyze.',
            'common_strengths': [], 'common_weaknesses': [],
        }

        analyses.sort(key=lambda a: a.get('score', 0), reverse=True)

        print(f'[analyze] done. returning results.', flush=True)
        return jsonify({
            'class_summary': {
                'avg_score': avg_score,
                'total_sessions': total,
                'overall_insight': summary.get('overall_insight', ''),
                'common_strengths': summary.get('common_strengths', []),
                'common_weaknesses': summary.get('common_weaknesses', []),
            },
            'top_performers': analyses[:3],
            'students': analyses,
        })

    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        print(f'[analyze] FATAL ERROR: {tb}', flush=True)
        logger.error(f'analyze_config error for {config_id}: {tb}')
        return jsonify({'error': f'{type(e).__name__}: {str(e)}', 'traceback': tb}), 500
