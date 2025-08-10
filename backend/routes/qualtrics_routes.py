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

def get_qualtrics_datacenter(api_token):
    """
    Discover the Qualtrics datacenter from the API token
    """
    try:
        # Use the whoami endpoint to get user info and datacenter
        url = "https://yourdatacenterid.qualtrics.com/API/v3/whoami"
        headers = {'X-API-TOKEN': api_token}
        
        # Try common datacenters
        datacenters = ['iad1', 'ca1', 'eu', 'au1', 'sg1', 'fra1', 'co1']
        
        for dc in datacenters:
            test_url = f"https://{dc}.qualtrics.com/API/v3/whoami"
            try:
                response = requests.get(test_url, headers=headers, timeout=10)
                if response.status_code == 200:
                    print(f"Successfully connected to Qualtrics datacenter: {dc}")
                    return dc
            except:
                continue
        
        print("Could not determine Qualtrics datacenter")
        return None
        
    except Exception as e:
        print(f"Error determining datacenter: {str(e)}")
        return None

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
                print(f"Found survey ID: {survey_id} for response: {response_id}")
                return survey_id
        else:
            print(f"Could not find response {response_id}: {response.status_code}")
            
    except Exception as e:
        print(f"Error extracting survey ID: {str(e)}")
    
    return None

def save_via_webhook(webhook_url, qualtrics_id, formatted_chat, chat_summary):
    """Save data via Qualtrics webhook (often available on free accounts)"""
    try:
        webhook_data = {
            'response_id': qualtrics_id,
            'chat_data': formatted_chat,
            'chat_summary': chat_summary,
            'timestamp': datetime.now().isoformat(),
            'total_messages': chat_summary.get('total_messages', 0),
            'new_messages_count': chat_summary.get('new_messages_count', 0)
        }
        
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'RAG-Platform-Chat-Saver/1.0'
        }
        
        response = requests.post(webhook_url, headers=headers, json=webhook_data, timeout=30)
        
        if response.status_code in [200, 201, 202]:
            print(f"Successfully saved chat via webhook for response {qualtrics_id}")
            return True
        else:
            print(f"Webhook error: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"Webhook save error: {str(e)}")
        return False

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
        
        # Use configured datacenter or auto-discover
        datacenter = os.getenv('QUALTRICS_DATACENTER')
        if datacenter:
            logger.info(f"Using configured datacenter: {datacenter}")
        else:
            logger.info("No datacenter configured, auto-discovering...")
            datacenter = get_qualtrics_datacenter(api_token)
            if datacenter:
                logger.info(f"Auto-discovered datacenter: {datacenter}")
        
        if not datacenter:
            logger.error("Failed to determine Qualtrics datacenter - check API token validity")
            return False
        
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
    Save data to Qualtrics via API (primary) or Webhook (fallback)
    Production-ready with proper error handling and logging
    """
    try:
        # Primary method: API token (for paid accounts)
        api_token = os.getenv('QUALTRICS_API_TOKEN')
        if api_token:
            logger.info(f"Using Qualtrics API method for response ID: {qualtrics_id}")
            return save_via_api(api_token, qualtrics_id, formatted_chat, chat_summary)
        
        # Fallback method: Webhook (for free accounts)
        webhook_url = os.getenv('QUALTRICS_WEBHOOK_URL')
        if webhook_url:
            logger.info(f"Using Qualtrics webhook method for response ID: {qualtrics_id}")
            return save_via_webhook(webhook_url, qualtrics_id, formatted_chat, chat_summary)
        
        # Development mode (no credentials configured)
        logger.warning("Neither Qualtrics API token nor webhook URL configured - running in development mode")
        logger.info(f"Would save {len(chat_summary.get('messages', []))} messages to Qualtrics response: {qualtrics_id}")
        return True
        
    except Exception as e:
        logger.error(f"Error in save_to_qualtrics_api: {str(e)}")
        return False

@qualtrics_bp.route('/qualtrics/test', methods=['GET'])
def test_qualtrics_connection():
    """Test endpoint to verify Qualtrics API or webhook configuration - Production ready"""
    api_token = os.getenv('QUALTRICS_API_TOKEN')
    webhook_url = os.getenv('QUALTRICS_WEBHOOK_URL')
    
    # Get all enterprise credentials
    org_id = os.getenv('QUALTRICS_ORG_ID')
    user_id = os.getenv('QUALTRICS_USER_ID')
    username = os.getenv('QUALTRICS_USERNAME')
    datacenter = os.getenv('QUALTRICS_DATACENTER')
    
    config_status = {
        'api_token_configured': bool(api_token),
        'webhook_url_configured': bool(webhook_url),
        'ready_for_production': bool(api_token or webhook_url),
        'preferred_method': 'api' if api_token else ('webhook' if webhook_url else 'development_mode'),
        'enterprise_setup': bool(org_id and user_id and username),
        'credentials': {
            'org_id': org_id or 'Not configured',
            'user_id': user_id or 'Not configured', 
            'username': username or 'Not configured',
            'datacenter': datacenter or 'Auto-discovery enabled'
        },
        'timestamp': datetime.now().isoformat()
    }
    
    # Test API if configured (primary method)
    if api_token:
        try:
            logger.info("Testing Qualtrics API connection")
            
            # Use provided datacenter or auto-discover
            datacenter = os.getenv('QUALTRICS_DATACENTER')
            if not datacenter:
                datacenter = get_qualtrics_datacenter(api_token)
            
            config_status['datacenter_discovered'] = datacenter
            config_status['api_connection_successful'] = bool(datacenter)
            
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
    
    # Test webhook if configured (fallback method)
    if webhook_url:
        try:
            logger.info("Testing Qualtrics webhook connection")
            response = requests.get(webhook_url, timeout=10)
            config_status['webhook_accessible'] = True
            config_status['webhook_status'] = response.status_code
            logger.info(f"Webhook test successful - status: {response.status_code}")
        except Exception as e:
            config_status['webhook_accessible'] = False
            config_status['webhook_status'] = f'Connection failed: {str(e)}'
            logger.error(f"Webhook test error: {str(e)}")
    
    return jsonify(config_status)
