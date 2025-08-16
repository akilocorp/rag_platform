
 Create Qualtrics Survey Structure

#### 2.1 Add Hidden Storage Question
1. **Create Text Entry Question**:
   - Question Type: "Text Entry" → "Long Answer Text"
   - Question Text: "Chat History Storage" (will be hidden)
   - **Important**: Note the Question ID (e.g., `QID1_ChatHistory`)

2. **Hide the Question**:
   ```html
   <!-- Option 1: CSS Hidden -->
   <div style="display: none;">This question stores chat data</div>
   
   <!-- Option 2: Use Display Logic -->
   <!-- Set display logic to "Never show this question" -->
   ```

#### 2.2 Add Chat Interface Question
1. **Create HTML/Text Question**:
   - Question Type: "Text/Graphic"
   - This will contain your chat iframe



**Add iframe HTML**:
   ```html
   <div style="width: 100%; height: 600px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
     <iframe 
       src="https://your-deployed-app.com/chat/YOUR_CONFIG_ID?qualtricsId=${e://Field/ResponseID}"
       width="100%" 
       height="100%" 
       frameborder="0"
       style="border: none;"
       allow="clipboard-read; clipboard-write">
     </iframe>
   </div>
   ```



   3.1 Add JavaScript to Chat Question
1. **Select the question containing your iframe**
2. **Click "Advanced Question Options" → "Add JavaScript"**
3. **Paste the complete integration code**:

```javascript
Qualtrics.SurveyEngine.addOnReady(function() {
    // Initialize RAG chat integration
    console.log('🚀 RAG Qualtrics integration starting...');
    
    // Global chat history storage
    window.ragChatHistory = [];
    window.ragChatConfig = {
        configId: 'YOUR_CONFIG_ID', // Replace with actual config ID
        responseId: '${e://Field/ResponseID}',
        hiddenQuestionId: 'QID1_ChatHistory', // Replace with your hidden question QID
        messageCount: 0,
        initialized: true
    };
    
    // Listen for messages from iframe
    window.addEventListener('message', function(event) {
        // Verify origin for security (replace with your domain)
        if (event.origin !== 'https://your-deployed-app.com') {
            return;
        }
        
        if (event.data.type === 'CHAT_MESSAGE') {
            const message = {
                sender: event.data.sender,
                content: event.data.content,
                timestamp: new Date().toISOString(),
                messageIndex: window.ragChatHistory.length + 1
            };
            
            window.ragChatHistory.push(message);
            window.ragChatConfig.messageCount = window.ragChatHistory.length;
            
            console.log('📨 Message captured:', message.sender, ':', message.content.substring(0, 50) + '...');
        }
    });
    
    console.log('✅ RAG Qualtrics integration initialized');
});

Qualtrics.SurveyEngine.addOnPageSubmit(function() {
    console.log('📤 Page submit triggered - saving chat history...');
    
    if (window.ragChatHistory && window.ragChatHistory.length > 0) {
        // Format chat history for readable display
        const formattedMessages = window.ragChatHistory.map((msg, index) => {
            const timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });
            
            const sender = msg.sender === 'user' ? 'User' : 'AI Assistant';
            return `[${timestamp}] ${sender}: ${msg.content}`;
        });
        
        // Create comprehensive transcript
        const transcript = [
            '=== RAG CHAT CONVERSATION TRANSCRIPT ===',
            `Survey Response ID: ${window.ragChatConfig.responseId}`,
            `Chat Configuration ID: ${window.ragChatConfig.configId}`,
            `Total Messages: ${window.ragChatHistory.length}`,
            `Conversation Started: ${new Date(window.ragChatHistory[0]?.timestamp).toLocaleString()}`,
            `Transcript Generated: ${new Date().toLocaleString()}`,
            '',
            '=== CONVERSATION MESSAGES ===',
            ...formattedMessages,
            '',
            '=== END OF TRANSCRIPT ==='
        ].join('\n');
        
        // Save to multiple locations for reliability
        try {
            // Method 1: Save to hidden question
            Qualtrics.SurveyEngine.setQuestionValue(window.ragChatConfig.hiddenQuestionId, transcript);
            
            // Method 2: Save to embedded data (backup)
            Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_transcript', transcript);
            Qualtrics.SurveyEngine.setEmbeddedData('rag_message_count', window.ragChatHistory.length);
            Qualtrics.SurveyEngine.setEmbeddedData('rag_config_id', window.ragChatConfig.configId);
            Qualtrics.SurveyEngine.setEmbeddedData('rag_response_id', window.ragChatConfig.responseId);
            Qualtrics.SurveyEngine.setEmbeddedData('rag_saved_at', new Date().toISOString());
            
            console.log('✅ Chat history saved successfully!');
            console.log(`📊 Saved ${window.ragChatHistory.length} messages`);
            
        } catch (error) {
            console.error('❌ Error saving chat history:', error);
        }
    } else {
        console.log('ℹ️ No chat history to save');
    }
});

// Optional: Add unload handler for additional safety
Qualtrics.SurveyEngine.addOnUnload(function() {
    console.log('🔄 Page unloading - final save attempt...');
    // Trigger save one more time
    if (window.ragChatHistory && window.ragChatHistory.length > 0) {
        // Quick save without formatting
        const quickTranscript = JSON.stringify(window.ragChatHistory);
        Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_backup', quickTranscript);
    }
});
```










Make sure to replace these placeholders:

'YOUR_CONFIG_ID' → Your actual config ID
'https://your-deployed-app.com' → Your actual domain
'QID1_ChatHistory' → Your actual hidden question ID