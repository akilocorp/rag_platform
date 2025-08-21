Qualtrics.SurveyEngine.addOnReady(function() {
         console.log('🚀 RAG Qualtrics integration starting...');
         
         // Global chat history storage
         window.ragChatHistory = [];
         window.ragChatConfig = {
             configId: '68a36fc52603648eff7b9c1f', // Replace with actual config ID
             responseId: '${e://Field/ResponseID}',
             hiddenQuestionId: 'QID2', // This will be Question 2's ID
             messageCount: 0,
             initialized: true
         };
         
         // Listen for messages from iframe
         window.addEventListener('message', function(event) {
             // Verify origin for security (replace with your domain)
             if (event.origin !== 'https://app.bitterlylab.com') {
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
             
             // Listen for save requests from iframe
             if (event.data.type === 'SAVE_RAG_CHAT') {
                 console.log('💾 Save request received from iframe');
                 // Trigger immediate save using the same logic as page submit
                 saveRagChatHistory();
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
                 
                 console.log('✅ Chat history saved successfully!');
                 console.log(`📊 Saved ${window.ragChatHistory.length} messages`);
                 
             } catch (error) {
                 console.error('❌ Error saving chat history:', error);
             }
         } else {
             console.log('ℹ️ No chat history to save');
         }
     });
     
     // Create reusable save function
     function saveRagChatHistory() {
         console.log('📤 Saving chat history...');
         
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
                 
                 console.log('✅ Chat history saved successfully!');
                 console.log(`📊 Saved ${window.ragChatHistory.length} messages`);
                 
             } catch (error) {
                 console.error('❌ Error saving chat history:', error);
             }
         } else {
             console.log('ℹ️ No chat history to save');
         }
     }
     