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
 * Add a message to the RAG chat history
 * @param {string} sender - 'user' or 'ai'
 * @param {string} content - Message content
 * @returns {boolean} Success status
 */
function addRAGMessage(sender, content) {
    console.log('🔍 DEBUG: addMessageToQualtrics called with:', { sender, content: content.substring(0, 50) + '...' });
    
    if (typeof window === 'undefined') {
        console.log('🔍 DEBUG: Window is undefined');
        return false;
    }
    
    console.log('🔍 DEBUG: Window is defined');
    
    // Initialize if needed
    if (!window.ragChatHistory) {
        window.ragChatHistory = [];
    }
    
    // Create message object
    const message = {
        sender: sender,
        content: content,
        timestamp: new Date().toISOString(),
        messageIndex: window.ragChatHistory.length + 1
    };
    
    // Add to local history
    window.ragChatHistory.push(message);
    
    // Send message to parent window (for Qualtrics iframe context)
    if (window.parent && window.parent !== window) {
        try {
            console.log('📤 Sending message to parent window via postMessage');
            window.parent.postMessage({
                type: 'CHAT_MESSAGE',
                sender: sender,
                content: content,
                timestamp: message.timestamp,
                messageIndex: message.messageIndex
            }, '*');
        } catch (error) {
            console.warn('Failed to send message to parent window:', error);
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
    
    // Try to detect Qualtrics in current window only (avoid CORS)
    let qualtricsEngine = null;
    
    if (typeof Qualtrics !== 'undefined' && Qualtrics.SurveyEngine) {
        qualtricsEngine = Qualtrics.SurveyEngine;
        console.log('🔍 DEBUG: Using current window Qualtrics');
    } else {
        console.log('🔍 DEBUG: No Qualtrics found in current window - will use postMessage');
    }
    
    if (!qualtricsEngine) {
        console.log('ℹ️ No Qualtrics in current window - iframe context detected');
        
        // In iframe context, rely on ChatPage.jsx postMessage to parent
        console.log('📤 Relying on ChatPage.jsx postMessage for save');
        return true; // Let ChatPage.jsx handle the save via postMessage
    }
    
    let saveSuccess = false;
    const config = window.ragChatConfig || {};
    
    try {
        console.log('📤 Saving chat history to Qualtrics...');
        
        // Method 1: Save formatted transcript to hidden question
        if (opts.useHiddenQuestion && config.hiddenQuestionId) {
            try {
                const transcript = formatChatHistoryForQualtrics();
                qualtricsEngine.setQuestionValue(config.hiddenQuestionId, transcript);
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
                
                qualtricsEngine.setEmbeddedData('rag_chat_transcript', transcript);
                qualtricsEngine.setEmbeddedData('rag_message_count', window.ragChatHistory.length);
                qualtricsEngine.setEmbeddedData('rag_config_id', config.configId || 'unknown');
                qualtricsEngine.setEmbeddedData('rag_response_id', config.responseId || 'unknown');
                qualtricsEngine.setEmbeddedData('rag_chat_id', config.chatId || 'unknown');
                qualtricsEngine.setEmbeddedData('rag_saved_at', new Date().toISOString());
                
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
                
                qualtricsEngine.setEmbeddedData('rag_chat_raw', JSON.stringify(rawData));
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


// Export functions to global scope for Qualtrics survey use
if (typeof window !== 'undefined') {
    window.saveRAGChatToQualtrics = saveRAGChatToQualtrics;
    window.formatChatHistoryForQualtrics = formatChatHistoryForQualtrics;
    window.addMessageToQualtrics = addMessageToQualtrics;
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
