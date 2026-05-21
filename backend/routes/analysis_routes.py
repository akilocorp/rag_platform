import logging
import re

from bson import ObjectId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, message_to_dict
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory

logger = logging.getLogger(__name__)
analysis_bp = Blueprint('analysis', __name__)


def _parse_json(text):
    """Extract first {...} block from LLM output and parse it."""
    import json
    text = text.strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            pass
    return json.loads(text)


def _llm_json(api_key, prompt):
    llm = ChatOpenAI(model='gpt-4o-mini', api_key=api_key, temperature=0.2, max_tokens=500)
    response = llm.invoke([HumanMessage(content=prompt)])
    return _parse_json(response.content)


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
    if not lines:
        logger.warning(f'_get_transcript: no messages for SessionId={session_id!r}')
    return '\n'.join(lines)


def _analyze_one(api_key, system_prompt, transcript, display_name, session_id, message_count, grading_criteria=''):
    if not transcript.strip():
        return {
            'session_id': session_id, 'display_name': display_name,
            'score': 0, 'message_count': message_count,
            'summary': 'No interaction recorded for this session.',
            'strengths': [], 'improvements': ['Student did not engage with the simulation.'],
        }

    context = system_prompt.strip() or 'a general AI assistant conversation'
    criteria_block = f"\nGrading criteria from professor:\n{grading_criteria.strip()}\n" if grading_criteria and grading_criteria.strip() else ''
    criteria_suffix = ' Follow the professor\'s grading criteria above.' if criteria_block else ''
    prompt = f"""You are an academic performance evaluator assessing a student's participation in an AI-assisted simulation.

The AI assistant's role and instructions were:
{context}
{criteria_block}
Student conversation transcript:
{transcript}

Evaluate this student and return a JSON object with exactly these fields:
{{
  "score": <integer 0-100>,
  "summary": "<2-3 sentence summary of overall performance>",
  "strengths": ["<specific strength>", "<another strength>"],
  "improvements": ["<specific area to improve>", "<another area>"]
}}

Base the score on: relevance and depth of responses, quality of reasoning, and how well the student engaged with the simulation goals.{criteria_suffix} Return only the JSON object."""

    try:
        result = _llm_json(api_key, prompt)
        if not isinstance(result, dict):
            raise ValueError(f'LLM returned non-dict: {type(result)}')
        result.setdefault('score', 0)
        result.setdefault('summary', '')
        result.setdefault('strengths', [])
        result.setdefault('improvements', [])
    except Exception as e:
        logger.error(f'Per-session analysis failed for {session_id}: {e}')
        result = {'score': 0, 'summary': 'Analysis failed for this session.', 'strengths': [], 'improvements': []}

    result['session_id'] = session_id
    result['display_name'] = display_name
    result['message_count'] = message_count
    return result


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
        return _llm_json(api_key, prompt)
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
        for s in sessions[:5]:  # first 5 only
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
        logger.info(f'analyze_config: config={config_id} total_sessions={len(sessions)} users_col={users_col.name}')
        if not sessions:
            return jsonify({'error': 'No sessions found for this config'}), 400

        sessions_with_msgs = sum(1 for s in sessions if s.get('message_count', 0) > 0)
        logger.info(f'analyze_config: sessions_with_messages={sessions_with_msgs}')

        # Sample first 3 sessions for diagnostics
        for s in sessions[:3]:
            logger.info(f'  session sample: session_id={s.get("session_id")!r} msg_count={s.get("message_count")} email={s.get("user_email")!r}')

        mongo_client = db.client
        db_name = db.name

        labeled = []
        anon_count = 0
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

        analyses = []
        for item in labeled:
            try:
                if item['message_count'] == 0:
                    analyses.append({
                        'session_id': item['session_id'], 'display_name': item['display_name'],
                        'score': 0, 'message_count': 0,
                        'summary': 'No interaction recorded for this session.',
                        'strengths': [], 'improvements': ['Student did not engage with the simulation.'],
                    })
                    continue
                logger.info(f'  fetching transcript for session={item["session_id"]!r}')
                transcript = _get_transcript(mongo_client, db_name, item['session_id'])
                logger.info(f'  transcript lines={len(transcript.splitlines())} for session={item["session_id"]!r}')
                analyses.append(_analyze_one(api_key, system_prompt, transcript,
                                             item['display_name'], item['session_id'], item['message_count'],
                                             grading_criteria))
            except Exception as e:
                logger.error(f'Failed to analyze session {item["session_id"]}: {e}')
                analyses.append({
                    'session_id': item['session_id'], 'display_name': item['display_name'],
                    'score': 0, 'message_count': item['message_count'],
                    'summary': 'Could not analyze this session.', 'strengths': [], 'improvements': [],
                })

        scored = [a for a in analyses if a.get('score', 0) > 0]
        avg_score = round(sum(a['score'] for a in scored) / len(scored)) if scored else 0
        summary = _build_class_summary(api_key, system_prompt, scored) if scored else {
            'overall_insight': 'No completed sessions to analyze.',
            'common_strengths': [], 'common_weaknesses': [],
        }

        analyses.sort(key=lambda a: a.get('score', 0), reverse=True)

        return jsonify({
            'class_summary': {
                'avg_score': avg_score,
                'total_sessions': len(sessions),
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
        logger.error(f'analyze_config error for {config_id}: {tb}')
        return jsonify({'error': f'{type(e).__name__}: {str(e)}', 'traceback': tb}), 500
