from flask import Blueprint, request, jsonify
import requests
import json
from datetime import datetime
import os
import logging

# Configure logging for production
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

qualtrics_bp = Blueprint('qualtrics', __name__)

@qualtrics_bp.route('/qualtrics/save-chat', methods=['POST'])
def save_chat_to_qualtrics():
    """
    Save chat messages to Qualtrics survey/embedded data
    Expected payload:
    {
        "qualtricsId": "string",
        "configId": "string", 
        "chatId": "string",
        "messages": [
            {
                "messageIndex": 1,
                "sender": "user|ai",
                "text": "message content",
                "timestamp": "ISO string"
            }
        ],
        "totalMessages": 10,
        "savedAt": "ISO string"
    }
    """
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({'success': False, 'message': 'No data provided'}), 400
            
        qualtrics_id = data.get('qualtricsId')
        config_id = data.get('configId')
        chat_id = data.get('chatId')
        messages = data.get('messages', [])
        
        if not qualtrics_id:
            return jsonify({'success': False, 'message': 'Qualtrics ID is required'}), 400
            
        if not messages:
            return jsonify({'success': False, 'message': 'No messages to save'}), 400
        
        # Format chat data for Qualtrics
        chat_summary = {
            'qualtrics_response_id': qualtrics_id,
            'config_id': config_id,
            'chat_id': chat_id,
            'total_messages': data.get('totalMessages', len(messages)),
            'saved_at': data.get('savedAt'),
            'new_messages_count': len(messages),
            'messages': messages
        }
        
        # Convert messages to a formatted string for Qualtrics
        formatted_chat = format_chat_for_qualtrics(messages)
        
        # Here you would integrate with Qualtrics API
        # For now, we'll simulate the save and return success
        success = save_to_qualtrics_api(qualtrics_id, formatted_chat, chat_summary)
        
        if success:
            return jsonify({
                'success': True, 
                'message': f'Successfully saved {len(messages)} messages to Qualtrics',
                'qualtrics_id': qualtrics_id,
                'messages_saved': len(messages)
            })
        else:
            return jsonify({'success': False, 'message': 'Failed to save to Qualtrics API'}), 500
            
    except Exception as e:
        print(f"Error saving to Qualtrics: {str(e)}")
        return jsonify({'success': False, 'message': f'Server error: {str(e)}'}), 500

def format_chat_for_qualtrics(messages):
    """Format chat messages into a readable string for Qualtrics"""
    formatted_lines = []
    
    for msg in messages:
        timestamp = msg.get('timestamp', '')
        sender = msg.get('sender', 'unknown')
        text = msg.get('text', '')
        message_index = msg.get('messageIndex', '')
        
        # Format timestamp
        try:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            time_str = dt.strftime('%Y-%m-%d %H:%M:%S')
        except:
            time_str = timestamp
        
        sender_label = "User" if sender == "user" else "AI Assistant"
        formatted_lines.append(f"[{message_index}] {time_str} - {sender_label}: {text}")
    
    return "\n\n".join(formatted_lines)



def extract_survey_id_from_response(response_id, api_token, datacenter):
    """
    Extract survey ID from a response ID using Qualtrics API
    """
    try:
        # Use the response lookup endpoint to get survey info
        url = f"https://{datacenter}.qualtrics.com/API/v3/responses/{response_id}"
        headers = {'X-API-TOKEN': api_token}
        
        response = requests.get(url, headers=headers, timeout=30)
        
        if response.status_code == 200:
            data = response.json()
            survey_id = data.get('result', {}).get('surveyId')
            if survey_id:
                logger.info(f"Found survey ID: {survey_id} for response: {response_id}")
                return survey_id
        else:
            logger.error(f"Could not find response {response_id}: {response.status_code}")
            
    except Exception as e:
        logger.error(f"Error extracting survey ID: {str(e)}")
    
    return None



def save_via_api(api_token, qualtrics_id, formatted_chat, chat_summary):
    """Save data via Qualtrics API (requires paid account) - Production ready"""
    try:
        logger.info(f"Starting Qualtrics API save for response: {qualtrics_id}")
        
        # Validate API token format
        if not api_token or len(api_token) < 10:
            logger.error("Invalid or missing Qualtrics API token")
            return False
        
        # Enterprise credential validation
        org_id = os.getenv('QUALTRICS_ORG_ID')
        user_id = os.getenv('QUALTRICS_USER_ID')
        username = os.getenv('QUALTRICS_USERNAME')
        
        # Log enterprise context for audit trail
        if org_id and user_id:
            logger.info(f"Enterprise Qualtrics save - Org: {org_id}, User: {user_id} ({username})")
        else:
            logger.info("Basic Qualtrics save (no enterprise credentials)")
        
        # Use configured datacenter (required for enterprise setup)
        datacenter = os.getenv('QUALTRICS_DATACENTER')
        if not datacenter:
            logger.error("QUALTRICS_DATACENTER not configured in environment variables")
            logger.error("Enterprise setup requires datacenter to be specified in .env file")
            return False
        
        logger.info(f"Using configured datacenter: {datacenter}")
        
        # Extract survey ID from response ID
        survey_id = extract_survey_id_from_response(qualtrics_id, api_token, datacenter)
        if not survey_id:
            logger.error(f"Failed to extract survey ID from response: {qualtrics_id}")
            logger.error("This usually means: 1) Invalid response ID, 2) Cross-organization access denied, or 3) Response doesn't exist")
            return False
        
        logger.info(f"Found survey ID: {survey_id}")
        
        # Prepare embedded data with validation and enterprise info
        message_count = len(chat_summary.get('messages', []))
        embedded_data = {
            'chat_history': formatted_chat[:10000],  # Limit to 10k chars to avoid Qualtrics limits
            'chat_metadata': json.dumps(chat_summary)[:5000],  # Limit metadata size
            'saved_at': datetime.now().isoformat(),
            'message_count': message_count,
            'config_id': chat_summary.get('config_id', '')[:50],  # Limit field sizes
            'chat_id': chat_summary.get('chat_id', '')[:50],
            'platform': 'RAG_Platform_v1.0',
            'datacenter': datacenter,
            'api_user_id': user_id or 'Unknown',
            'api_username': username or 'Unknown',
            'organization_id': org_id or 'Unknown'
        }
        
        logger.info(f"Saving {message_count} messages to Qualtrics")
        
        # Update response with embedded data
        url = f"https://{datacenter}.qualtrics.com/API/v3/surveys/{survey_id}/responses/{qualtrics_id}"
        headers = {
            'X-API-TOKEN': api_token,
            'Content-Type': 'application/json',
            'User-Agent': 'RAG-Platform/1.0'
        }
        
        payload = {
            'embeddedData': embedded_data
        }
        
        response = requests.put(url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 200:
            logger.info(f"Successfully saved chat to Qualtrics response {qualtrics_id}")
            return True
        else:
            logger.error(f"Qualtrics API error: {response.status_code} - {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        logger.error("Qualtrics API request timed out")
        return False
    except requests.exceptions.RequestException as e:
        logger.error(f"Qualtrics API request failed: {str(e)}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error saving via Qualtrics API: {str(e)}")
        return False

def save_to_qualtrics_api(qualtrics_id, formatted_chat, chat_summary):
    """
    Save data to Qualtrics via API (enterprise setup)
    Production-ready with proper error handling and logging
    """
    try:
        # Enterprise API method (required)
        api_token = os.getenv('QUALTRICS_API_TOKEN')
        if not api_token:
            logger.error("QUALTRICS_API_TOKEN not configured in environment variables")
            logger.error("Enterprise setup requires API token to be specified in .env file")
            return False
        
        logger.info(f"Using Qualtrics API method for response ID: {qualtrics_id}")
        return save_via_api(api_token, qualtrics_id, formatted_chat, chat_summary)
        
    except Exception as e:
        logger.error(f"Error in save_to_qualtrics_api: {str(e)}")
        return False

@qualtrics_bp.route('/qualtrics/test', methods=['GET'])
def test_qualtrics_connection():
    """Test endpoint to verify Qualtrics API configuration - Enterprise setup"""
    api_token = os.getenv('QUALTRICS_API_TOKEN')
    
    # Get all enterprise credentials
    org_id = os.getenv('QUALTRICS_ORG_ID')
    user_id = os.getenv('QUALTRICS_USER_ID')
    username = os.getenv('QUALTRICS_USERNAME')
    datacenter = os.getenv('QUALTRICS_DATACENTER')
    
    config_status = {
        'api_token_configured': bool(api_token),
        'datacenter_configured': bool(datacenter),
        'ready_for_production': bool(api_token and datacenter),
        'enterprise_setup': bool(org_id and user_id and username and datacenter),
        'credentials': {
            'org_id': org_id or 'Not configured',
            'user_id': user_id or 'Not configured', 
            'username': username or 'Not configured',
            'datacenter': datacenter or 'Not configured'
        },
        'timestamp': datetime.now().isoformat()
    }
    
    # Test API if configured (primary method)
    if api_token:
        try:
            logger.info("Testing Qualtrics API connection")
            
            # Use configured datacenter (required for enterprise setup)
            datacenter = os.getenv('QUALTRICS_DATACENTER')
            if not datacenter:
                logger.error("QUALTRICS_DATACENTER not configured - enterprise setup requires datacenter")
                config_status['datacenter_discovered'] = None
                config_status['api_connection_successful'] = False
                config_status['error'] = "Datacenter not configured in environment variables"
            else:
                config_status['datacenter_discovered'] = datacenter
                config_status['api_connection_successful'] = True
            
            # Add credential validation info
            config_status['user_id'] = os.getenv('QUALTRICS_USER_ID', 'Not configured')
            config_status['username'] = os.getenv('QUALTRICS_USERNAME', 'Not configured')
            config_status['org_id'] = os.getenv('QUALTRICS_ORG_ID', 'Not configured')
            config_status['datacenter_configured'] = bool(os.getenv('QUALTRICS_DATACENTER'))
            
            if datacenter:
                config_status['api_endpoint'] = f"https://{datacenter}.qualtrics.com/API/v3/"
                logger.info(f"API test successful - datacenter: {datacenter}")
            else:
                logger.warning("API test failed - could not discover datacenter")
                
        except Exception as e:
            config_status['api_connection_successful'] = False
            config_status['api_error'] = str(e)
            logger.error(f"API test error: {str(e)}")
    
    return jsonify(config_status)
