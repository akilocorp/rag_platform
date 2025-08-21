/**
 * RAG Platform - Qualtrics Client-Side Integration Utility
 * 
 * This utility provides functions for capturing chat conversations within Qualtrics surveys.
 * It handles message storage, formatting, and automatic saving on page navigation.
 * 
 * Usage:
 * 1. Import this utility in your chat interface
 * 2. Call addMessageToQualtrics() for each user/AI message
 * 3. The integration automatically saves data when users navigate in Qualtrics
 * 
 * @version 2.0.0
 * @author RAG Platform Team
 */

// Initialize global storage if not already present
if (typeof window !== 'undefined') {
         window.ragChatHistory = window.ragChatHistory || [];
         window.ragChatConfig = window.ragChatConfig || null;
     }
     
     /**
      * Initialize RAG chat integration with Qualtrics
      * @param {Object} config - Configuration object
      * @param {string} config.configId - Chat configuration ID
      * @param {string} config.responseId - Qualtrics response ID
      * @param {string} config.hiddenQuestionId - QID of hidden question to store data
      * @param {string} [config.chatId] - Optional chat session ID
      */
     function initializeRAGQualtrics(config) {
         if (!config || !config.configId || !config.responseId) {
             console.error('RAG Qualtrics: Missing required configuration parameters');
             return false;
         }
         
         window.ragChatConfig = {
             configId: config.configId,
             responseId: config.responseId,
             chatId: config.chatId || `chat_${Date.now()}`,
             hiddenQuestionId: config.hiddenQuestionId || 'QID1_ChatHistory',
             messageCount: 0,
             initialized: true,
             startTime: new Date().toISOString()
         };
         
         // Reset chat history for new session
         window.ragChatHistory = [];
         
         console.log('🚀 RAG Qualtrics integration initialized:', {
             configId: window.ragChatConfig.configId,
             responseId: window.ragChatConfig.responseId,
             hiddenQuestionId: window.ragChatConfig.hiddenQuestionId
         });
         
         return true;
     }
     
     /**
      * Add message to chat history
      * @param {string} sender - Message sender ('user' or 'ai')
      * @param {string} content - Message content
      * @param {Object} [metadata] - Optional metadata
      */
     function addRAGMessage(sender, content, metadata = {}) {
         if (!sender || !content) {
             console.warn('RAG Qualtrics: Invalid message parameters');
             return false;
         }
         
         // Ensure chat history exists
         if (!window.ragChatHistory) {
             window.ragChatHistory = [];
         }
         
         const message = {
             sender: sender,
             content: content,
             timestamp: new Date().toISOString(),
             messageIndex: window.ragChatHistory.length + 1,
             ...metadata
         };
         
         window.ragChatHistory.push(message);
         
         // Update config if available
         if (window.ragChatConfig) {
             window.ragChatConfig.messageCount = window.ragChatHistory.length;
         }
         
         console.log('📨 Message added to RAG history:', {
             sender: message.sender,
             content: message.content.substring(0, 50) + (message.content.length > 50 ? '...' : ''),
             messageIndex: message.messageIndex
         });
         
         // Send to parent window (Qualtrics) if in iframe
         if (window.parent !== window) {
             try {
                 window.parent.postMessage({
                     type: 'CHAT_MESSAGE',
                     sender: sender,
                     content: content,
                     timestamp: message.timestamp,
                     messageIndex: message.messageIndex
                 }, '*'); // In production, specify exact origin
             } catch (error) {
                 console.warn('Could not send message to parent window:', error);
             }
         }
         
         return true;
     }
     
     /**
      * Format chat history for Qualtrics storage
      * @param {Object} [options] - Formatting options
      * @param {boolean} [options.includeMetadata=true] - Include metadata in transcript
      * @param {boolean} [options.prettyTimestamps=true] - Format timestamps for readability
      * @returns {string} Formatted chat transcript
      */
     function formatChatHistoryForQualtrics(options = {}) {
         const opts = {
             includeMetadata: true,
             prettyTimestamps: true,
             ...options
         };
         
         if (!window.ragChatHistory || window.ragChatHistory.length === 0) {
             return opts.includeMetadata ? '=== RAG CHAT TRANSCRIPT ===\nNo messages recorded\n=== END TRANSCRIPT ===' : '';
         }
         
         // Format messages with proper timestamps
         const formattedMessages = window.ragChatHistory.map((msg, index) => {
             let timestamp;
             if (opts.prettyTimestamps) {
                 timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
                     year: 'numeric',
                     month: '2-digit',
                     day: '2-digit',
                     hour: '2-digit',
                     minute: '2-digit',
                     second: '2-digit',
                     hour12: false
                 });
             } else {
                 timestamp = msg.timestamp;
             }
             
             const sender = msg.sender === 'user' ? 'User' : 'AI Assistant';
             return `[${timestamp}] ${sender}: ${msg.content}`;
         });
         
         if (!opts.includeMetadata) {
             return formattedMessages.join('\n');
         }
         
         // Build comprehensive metadata
         const config = window.ragChatConfig || {};
         const firstMessage = window.ragChatHistory[0];
         const lastMessage = window.ragChatHistory[window.ragChatHistory.length - 1];
         
         const transcript = [
             '=== RAG CHAT CONVERSATION TRANSCRIPT ===',
             `Survey Response ID: ${config.responseId || 'unknown'}`,
             `Chat Configuration ID: ${config.configId || 'unknown'}`,
             `Chat Session ID: ${config.chatId || 'unknown'}`,
             `Total Messages: ${window.ragChatHistory.length}`,
             `Conversation Started: ${firstMessage ? new Date(firstMessage.timestamp).toLocaleString() : 'unknown'}`,
             `Last Message: ${lastMessage ? new Date(lastMessage.timestamp).toLocaleString() : 'unknown'}`,
             `Transcript Generated: ${new Date().toLocaleString()}`,
             '',
             '=== CONVERSATION MESSAGES ===',
             ...formattedMessages,
             '',
             '=== END OF TRANSCRIPT ==='
         ].join('\n');
         
         return transcript;
     }
     
     /**
      * Save chat history to Qualtrics using multiple storage methods
      * This provides redundancy and ensures data is captured reliably
      * @param {Object} [options] - Save options
      * @param {boolean} [options.useHiddenQuestion=true] - Save to hidden question
      * @param {boolean} [options.useEmbeddedData=true] - Save to embedded data
      * @param {boolean} [options.includeRawData=true] - Include raw JSON backup
      * @returns {boolean} Success status
      */
     function saveRAGChatToQualtrics(options = {}) {
         const opts = {
             useHiddenQuestion: true,
             useEmbeddedData: true,
             includeRawData: true,
             ...options
         };
         
         console.log('🔍 DEBUG: saveRAGChatToQualtrics called with options:', opts);
         console.log('🔍 DEBUG: window.ragChatHistory:', window.ragChatHistory);
         console.log('🔍 DEBUG: window.ragChatConfig:', window.ragChatConfig);
         
         if (!window.ragChatHistory || window.ragChatHistory.length === 0) {
             console.log('ℹ️ No chat history to save - history length:', window.ragChatHistory?.length || 0);
             return true;
         }
         
         // Check if we're in a Qualtrics environment
         console.log('🔍 DEBUG: Checking Qualtrics environment...');
         console.log('🔍 DEBUG: typeof Qualtrics:', typeof Qualtrics);
         console.log('🔍 DEBUG: Qualtrics.SurveyEngine:', typeof Qualtrics !== 'undefined' ? Qualtrics.SurveyEngine : 'undefined');
         
         if (typeof Qualtrics === 'undefined' || !Qualtrics.SurveyEngine) {
             console.warn('⚠️ Qualtrics SurveyEngine not available - saving to local storage as fallback');
             
             // Fallback: Save to localStorage for debugging
             try {
                 const fallbackData = {
                     transcript: formatChatHistoryForQualtrics(),
                     messageCount: window.ragChatHistory.length,
                     savedAt: new Date().toISOString(),
                     config: window.ragChatConfig || {}
                 };
                 localStorage.setItem('rag_chat_fallback', JSON.stringify(fallbackData));
                 console.log('💾 Chat data saved to localStorage as fallback');
                 return true;
             } catch (error) {
                 console.error('Failed to save to localStorage:', error);
                 return false;
             }
         }
         
         let saveSuccess = false;
         const config = window.ragChatConfig || {};
         
         try {
             console.log('📤 Saving chat history to Qualtrics...');
             
             // Method 1: Save formatted transcript to hidden question
             if (opts.useHiddenQuestion && config.hiddenQuestionId) {
                 try {
                     const transcript = formatChatHistoryForQualtrics();
                     Qualtrics.SurveyEngine.setQuestionValue(config.hiddenQuestionId, transcript);
                     console.log('✅ Transcript saved to hidden question:', config.hiddenQuestionId);
                     saveSuccess = true;
                 } catch (error) {
                     console.error('❌ Failed to save to hidden question:', error);
                 }
             }
             
             // Method 2: Save to embedded data fields (backup)
             if (opts.useEmbeddedData) {
                 try {
                     const transcript = formatChatHistoryForQualtrics();
                     
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_transcript', transcript);
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_message_count', window.ragChatHistory.length);
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_config_id', config.configId || 'unknown');
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_response_id', config.responseId || 'unknown');
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_id', config.chatId || 'unknown');
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_saved_at', new Date().toISOString());
                     
                     console.log('✅ Data saved to embedded data fields');
                     saveSuccess = true;
                 } catch (error) {
                     console.error('❌ Failed to save to embedded data:', error);
                 }
             }
             
             // Method 3: Save raw JSON data (emergency backup)
             if (opts.includeRawData) {
                 try {
                     const rawData = {
                         config: config,
                         messages: window.ragChatHistory,
                         savedAt: new Date().toISOString()
                     };
                     
                     Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_raw', JSON.stringify(rawData));
                     console.log('✅ Raw data backup saved');
                 } catch (error) {
                     console.error('❌ Failed to save raw data backup:', error);
                 }
             }
             
             if (saveSuccess) {
                 console.log(`📊 Successfully saved ${window.ragChatHistory.length} messages to Qualtrics`);
             }
             
             return saveSuccess;
             
         } catch (error) {
             console.error('❌ Error saving chat history to Qualtrics:', error);
             return false;
         }
     }
     
     /**
      * Setup Qualtrics event handlers for automatic data saving
      * Registers handlers for page submit and unload events
      * @param {Object} [options] - Handler options
      * @param {boolean} [options.enableUnloadHandler=true] - Add unload handler for safety
      * @param {boolean} [options.enableReadyHandler=true] - Add ready handler for initialization
      */
     function setupQualtricsPageSubmitHandler(options = {}) {
         const opts = {
             enableUnloadHandler: true,
             enableReadyHandler: true,
             ...options
         };
         
         if (typeof Qualtrics === 'undefined' || !Qualtrics.SurveyEngine) {
             console.warn('Qualtrics SurveyEngine not available - handlers not registered');
             return false;
         }
         
         try {
             // Primary handler: Save on page submit (Next/Submit button)
             Qualtrics.SurveyEngine.addOnPageSubmit(function() {
                 console.log('📤 Qualtrics page submit triggered - saving chat history');
                 saveRAGChatToQualtrics();
             });
             
             // Safety handler: Save on page unload (browser navigation, close, etc.)
             if (opts.enableUnloadHandler) {
                 Qualtrics.SurveyEngine.addOnUnload(function() {
                     console.log('🔄 Page unloading - emergency save attempt');
                     if (window.ragChatHistory && window.ragChatHistory.length > 0) {
                         // Quick save with minimal processing
                         saveRAGChatToQualtrics({ useHiddenQuestion: false, includeRawData: true });
                     }
                 });
             }
             
             // Ready handler: Initialize when survey page loads
             if (opts.enableReadyHandler) {
                 Qualtrics.SurveyEngine.addOnReady(function() {
                     console.log('🚀 Qualtrics survey page ready - RAG integration active');
                     
                     // Listen for messages from iframe (if chat is embedded)
                     window.addEventListener('message', function(event) {
                         // Security: In production, verify event.origin
                         if (event.data && event.data.type === 'CHAT_MESSAGE') {
                             addRAGMessage(event.data.sender, event.data.content, {
                                 fromIframe: true,
                                 originalTimestamp: event.data.timestamp
                             });
                         }
                     });
                 });
             }
             
             console.log('✅ Qualtrics event handlers registered successfully');
             return true;
             
         } catch (error) {
             console.error('❌ Error setting up Qualtrics handlers:', error);
             return false;
         }
     }
     
     /**
      * Convenience function for chat interface integration
      * This is the main function your chat app should call for each message
      * @param {string} sender - 'user' or 'ai'
      * @param {string} content - Message content
      */
     function addMessageToQualtrics(sender, content) {
         return addRAGMessage(sender, content);
     }
     
     /**
      * Get current chat statistics
      * @returns {Object} Statistics object
      */
     function getChatStatistics() {
         return {
             messageCount: window.ragChatHistory ? window.ragChatHistory.length : 0,
             isInitialized: !!(window.ragChatConfig && window.ragChatConfig.initialized),
             configId: window.ragChatConfig?.configId || null,
             responseId: window.ragChatConfig?.responseId || null,
             startTime: window.ragChatConfig?.startTime || null
         };
     }
     
     // Auto-setup if running in Qualtrics context
     if (typeof window !== 'undefined' && typeof Qualtrics !== 'undefined') {
         setupQualtricsPageSubmitHandler();
         console.log(' Auto-setup completed for Qualtrics context');
     }
     
     // Test function to verify complete integration flow
     function testQualtricsIntegration() {
         console.log(' Starting comprehensive Qualtrics integration test...');
     
         // Test 1: Check environment
         console.log(' Test 1: Environment Check');
         console.log('  - typeof window:', typeof window);
         console.log('  - typeof Qualtrics:', typeof Qualtrics);
         console.log('  - Qualtrics.SurveyEngine:', typeof Qualtrics !== 'undefined' ? !!Qualtrics.SurveyEngine : 'N/A');
         console.log('  - window.ragChatHistory exists:', !!window.ragChatHistory);
         console.log('  - window.ragChatConfig exists:', !!window.ragChatConfig);
     
         // Test 2: Initialize test data
         console.log(' Test 2: Initialize Test Data');
         if (!window.ragChatHistory) {
             window.ragChatHistory = [];
         }
     
         // Add test messages
         const testMessages = [
             { sender: 'user', content: 'Hello, this is a test message', timestamp: new Date().toISOString(), messageIndex: 1 },
             { sender: 'ai', content: 'This is a test AI response', timestamp: new Date().toISOString(), messageIndex: 2 }
         ];
     
         window.ragChatHistory.push(...testMessages);
         console.log('  - Added test messages. Total count:', window.ragChatHistory.length);
         console.log('  - Test messages:', window.ragChatHistory);
     
         // Test 3: Test message tracking function
         console.log(' Test 3: Message Tracking Function');
         try {
             const result1 = addMessageToQualtrics('user', 'Test user message');
             const result2 = addMessageToQualtrics('ai', 'Test AI response');
             console.log('  - User message tracking result:', result1);
             console.log('  - AI message tracking result:', result2);
             console.log('  - Final ragChatHistory length:', window.ragChatHistory.length);
         } catch (error) {
             console.error('  - Message tracking test failed:', error);
         }
     
         // Test 4: Test save function
         console.log(' Test 4: Save Function');
         try {
             const saveResult = saveRAGChatToQualtrics();
             console.log('  - Save function result:', saveResult);
         } catch (error) {
             console.error('  - Save function test failed:', error);
         }
     
         // Test 5: Check localStorage fallback
         console.log(' Test 5: LocalStorage Fallback Check');
         try {
             const fallbackData = localStorage.getItem('rag_chat_fallback');
             if (fallbackData) {
                 const parsed = JSON.parse(fallbackData);
                 console.log('  - Fallback data found in localStorage');
                 console.log('  - Message count in fallback:', parsed.messageCount);
                 console.log('  - Saved at:', parsed.savedAt);
             } else {
                 console.log('  - No fallback data in localStorage');
             }
         } catch (error) {
             console.error('  - LocalStorage check failed:', error);
         }
     
         console.log(' Qualtrics integration test completed!');
         console.log(' Check the logs above for any issues or failures');
     
         return {
             environmentOk: typeof window !== 'undefined',
             qualtricsAvailable: typeof Qualtrics !== 'undefined' && !!Qualtrics.SurveyEngine,
             historyLength: window.ragChatHistory?.length || 0,
             testCompleted: true
         };
     }
     
     // Export functions to global scope for Qualtrics survey use
     if (typeof window !== 'undefined') {
         window.saveRAGChatToQualtrics = saveRAGChatToQualtrics;
         window.formatChatHistoryForQualtrics = formatChatHistoryForQualtrics;
         window.addMessageToQualtrics = addMessageToQualtrics;
         window.testQualtricsIntegration = testQualtricsIntegration;
     }
     
     // Export functions for use in chat interface and Qualtrics surveys
     if (typeof window !== 'undefined') {
         window.RAGQualtrics = {
             // Core functions
             initialize: initializeRAGQualtrics,
             addMessage: addRAGMessage,
             addMessageToQualtrics: addMessageToQualtrics, // Convenience alias
             formatHistory: formatChatHistoryForQualtrics,
             saveToQualtrics: saveRAGChatToQualtrics,
             setupHandler: setupQualtricsPageSubmitHandler,
             getStats: getChatStatistics,
     
             // Utility functions
             reset: function() {
                 window.ragChatHistory = [];
                 window.ragChatConfig = null;
                 console.log('🔄 RAG Qualtrics integration reset');
             },
             
             // Debug functions
             debug: {
                 showHistory: () => console.table(window.ragChatHistory),
                 showConfig: () => console.log(window.ragChatConfig),
                 testSave: () => saveRAGChatToQualtrics(),
                 getTranscript: () => formatChatHistoryForQualtrics()
             }
         };
         
         // Also expose the main function globally for easy access
         window.addMessageToQualtrics = addMessageToQualtrics;
     }
     
     // ES6 module exports (if using module system)
     if (typeof module !== 'undefined' && module.exports) {
         module.exports = {
             initializeRAGQualtrics,
             addRAGMessage,
             addMessageToQualtrics,
             formatChatHistoryForQualtrics,
             saveRAGChatToQualtrics,
             setupQualtricsPageSubmitHandler,
             getChatStatistics
         };
     }
     