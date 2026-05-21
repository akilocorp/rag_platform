import json
import logging
import re

from bson import ObjectId
from flask import Blueprint, current_app, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)
analysis_bp = Blueprint('analysis', __name__)


def _parse_json(text):
    """Extract first {...} block from LLM output and parse it."""
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


def _get_transcript(chat_histories, session_id):
    doc = chat_histories.find_one({'SessionId': session_id})
    if not doc:
        return ''
    lines = []
    for entry in (doc.get('History') or []):
        role = 'Student' if entry.get('type') == 'human' else 'AI'
        data = entry.get('data') or {}
        content = data.get('content', '')
        if isinstance(content, list):
            content = ' '.join(b.get('text', '') for b in content if isinstance(b, dict))
        if content:
            lines.append(f'[{role}]: {content}')
    return '\n'.join(lines)


def _analyze_one(api_key, system_prompt, transcript, display_name, session_id, message_count):
    if not transcript.strip():
        return {
            'session_id': session_id, 'display_name': display_name,
            'score': 0, 'message_count': message_count,
            'summary': 'No interaction recorded for this session.',
            'strengths': [], 'improvements': ['Student did not engage with the simulation.'],
        }

    context = system_prompt.strip() or 'a general AI assistant conversation'
    prompt = f"""You are an academic performance evaluator assessing a student's participation in an AI-assisted simulation.

The AI assistant's role and instructions were:
{context}

Student conversation transcript:
{transcript}

Evaluate this student and return a JSON object with exactly these fields:
{{
  "score": <integer 0-100>,
  "summary": "<2-3 sentence summary of overall performance>",
  "strengths": ["<specific strength>", "<another strength>"],
  "improvements": ["<specific area to improve>", "<another area>"]
}}

Base the score on: relevance and depth of responses, quality of reasoning, and how well the student engaged with the simulation goals. Return only the JSON object."""

    try:
        result = _llm_json(api_key, prompt)
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
        sessions = list(db['chat_session_metadata'].find({'config_id': config_id}))
        if not sessions:
            return jsonify({'error': 'No sessions found for this config'}), 400

        users_col = current_app.config['MONGO_COLLECTION']
        chat_histories = db['chat_histories']

        labeled = []
        anon_count = 0
        for s in sessions:
            uid = s.get('user_id', '')
            display = None
            if uid and uid != 'anonymous':
                try:
                    user = users_col.find_one({'_id': ObjectId(uid)})
                    if user:
                        display = user.get('email')
                except Exception:
                    pass
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
            transcript = _get_transcript(chat_histories, item['session_id'])
            analyses.append(_analyze_one(api_key, system_prompt, transcript,
                                         item['display_name'], item['session_id'], item['message_count']))

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
        return jsonify({'error': f'{type(e).__name__}: {str(e)}'}), 500
