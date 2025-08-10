# Qualtrics Integration Setup

This document explains how to set up the Qualtrics integration for saving chat conversations directly to Qualtrics surveys.

## Overview

The RAG platform now supports saving chat conversations to Qualtrics when a Qualtrics ID is provided in the URL. The feature allows:

- **Incremental saves**: Save new messages without duplicating previously saved ones
- **Automatic formatting**: Chat messages are formatted for easy reading in Qualtrics
- **Embedded data**: Chat data is saved as embedded data in the Qualtrics response

## URL Structure

### Without Qualtrics Integration
```
/chat/{configId}/{chatId}
```

### With Qualtrics Integration
```
/chat/{configId}/{chatId}/{qualtricsId}
```

When a `qualtricsId` is present in the URL, a green "Save to Qualtrics" button will appear next to the send button.

## Environment Variables

Add these variables to your `.env` file in the backend directory:

```env
# Qualtrics API Configuration
QUALTRICS_API_TOKEN=your_qualtrics_api_token_here
QUALTRICS_DATACENTER=yourdatacenterid
QUALTRICS_SURVEY_ID=your_survey_id_here
```

### How to Get These Values:

1. **QUALTRICS_API_TOKEN**: 
   - Log into Qualtrics
   - Go to Account Settings > Qualtrics IDs
   - Generate an API token

2. **QUALTRICS_DATACENTER**: 
   - Found in your Qualtrics URL (e.g., if your URL is `https://university.qualtrics.com`, then `university` is your datacenter)

3. **QUALTRICS_SURVEY_ID**: 
   - The ID of the survey where you want to save chat data
   - Found in the survey URL or survey settings

## How It Works

### Frontend
1. When `qualtricsId` is present in URL parameters, the "Save to Qualtrics" button becomes visible
2. Button shows the number of new messages to be saved
3. Clicking the button sends new messages (since last save) to the backend
4. Success/error messages are displayed to the user

### Backend
1. Receives chat data via `/api/qualtrics/save-chat` endpoint
2. Formats messages into readable text
3. Saves data to Qualtrics as embedded data using their API
4. Tracks which messages have been saved to avoid duplicates

## Data Format in Qualtrics

The chat data is saved as embedded data with these fields:

- `chat_data`: Formatted conversation text
- `chat_summary`: JSON metadata about the chat
- `last_updated`: Timestamp of last save
- `total_messages`: Total number of messages in conversation
- `new_messages_count`: Number of new messages in this save

### Example Chat Data Format:
```
[1] 2025-01-09 15:30:00 - User: Hello, how can you help me?

[2] 2025-01-09 15:30:05 - AI Assistant: I'm here to help you with any questions you have about our platform.

[3] 2025-01-09 15:30:15 - User: Can you explain the features?
```

## Testing the Integration

### Test API Configuration
```bash
curl http://localhost:5001/api/qualtrics/test
```

This will return the configuration status:
```json
{
  "api_token_configured": true,
  "datacenter_configured": true,
  "survey_id_configured": true,
  "ready_for_production": true
}
```

### Development Mode
If Qualtrics credentials are not configured, the system will simulate successful saves for development purposes.

## Usage Examples

### Embed in Qualtrics Survey
```html
<iframe 
  src="https://your-domain.com/chat/config123/session456/Q_3fKd8mN2pL9qR7" 
  width="100%" 
  height="600px"
  frameborder="0">
</iframe>
```

### Direct Link with Qualtrics ID
```
https://your-domain.com/chat/config123/session456/Q_3fKd8mN2pL9qR7
```

## Security Notes

- API tokens should be kept secure and not exposed in frontend code
- The system validates that the Qualtrics ID exists before attempting saves
- All API calls to Qualtrics are made server-side for security

## Troubleshooting

### Button Not Visible
- Check that the URL contains all three parameters: `configId`, `chatId`, and `qualtricsId`
- Verify the URL structure matches: `/chat/{configId}/{chatId}/{qualtricsId}`

### Save Fails
- Check backend logs for detailed error messages
- Verify Qualtrics API credentials are correct
- Ensure the survey ID exists and is accessible with your API token
- Check that the Qualtrics response ID (qualtricsId) exists in the survey

### No New Messages to Save
- The system tracks previously saved messages
- If all current messages have been saved before, you'll see "No new messages to save!"
- Continue the conversation and try saving again
