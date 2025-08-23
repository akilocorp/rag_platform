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
    // Debug toggle (can be switched on/off at runtime)
    window.RAG_DEBUG_ENABLED = window.RAG_DEBUG_ENABLED ?? true;
}

// Lightweight debug logger respecting the toggle
function dlog(...args) { try { if (typeof window !== 'undefined' && window.RAG_DEBUG_ENABLED) console.log(...args); } catch (_) {} }
function dwarn(...args) { try { if (typeof window !== 'undefined' && window.RAG_DEBUG_ENABLED) console.warn(...args); } catch (_) {} }
function derror(...args) { try { if (typeof window !== 'undefined' && window.RAG_DEBUG_ENABLED) console.error(...args); } catch (_) {} }

/**
 * Initialize RAG chat integration with Qualtrics
 * @param {Object} config - Configuration object
 * @param {string} config.configId - Chat configuration ID
 * @param {string} config.responseId - Qualtrics response ID
 * @param {string} [config.chatId] - Optional chat session ID
 */
function initializeRAGQualtrics(config) {
    if (!config || !config.configId || !config.responseId) {
        derror('RAG Qualtrics: Missing required configuration parameters');
        return false;
    }
    
    const prev = window.ragChatConfig || {};
    const nextChatId = config.chatId || prev.chatId || `chat_${Date.now()}`;
    const isSameSession = prev.initialized && prev.chatId === nextChatId && prev.responseId === config.responseId;

    window.ragChatConfig = {
        configId: config.configId,
        responseId: config.responseId,
        chatId: nextChatId,
        messageCount: window.ragChatHistory ? window.ragChatHistory.length : 0,
        initialized: true,
        startTime: prev.startTime || new Date().toISOString()
    };
    
    // Only reset history if clearly a new session
    if (!isSameSession || !Array.isArray(window.ragChatHistory)) {
        window.ragChatHistory = [];
    }
    
    dlog('🚀 RAG Qualtrics integration initialized:', {
        configId: window.ragChatConfig.configId,
        responseId: window.ragChatConfig.responseId,
        // Hidden QuestionID is now detected by the Qualtrics parent script
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
    dlog('🔍 DEBUG: addMessageToQualtrics called with:', { sender, content: (content ?? '').substring(0, 50) + '...' });
    
    if (typeof window === 'undefined') {
        dlog('🔍 DEBUG: Window is undefined');
        return false;
    }
    
    dlog('🔍 DEBUG: Window is defined');
    
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
            dlog('📤 Sending message to parent window via postMessage');
            window.parent.postMessage({
                type: 'CHAT_MESSAGE',
                sender: sender,
                content: content,
                timestamp: message.timestamp,
                messageIndex: message.messageIndex
            }, '*');
        } catch (error) {
            dwarn('Failed to send message to parent window:', error);
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
    const opts = { includeRawData: true, ...options };

    dlog('🔍 DEBUG: saveRAGChatToQualtrics called with options:', opts);
    dlog('🔍 DEBUG: window.ragChatHistory length:', window.ragChatHistory?.length || 0);
    dlog('🔍 DEBUG: window.ragChatConfig:', window.ragChatConfig);

    if (!window.ragChatHistory || window.ragChatHistory.length === 0) {
        dlog('ℹ️ No chat history to save - skipping');
        return true;
    }

    const config = window.ragChatConfig || {};
    const transcript = formatChatHistoryForQualtrics();
    const payload = {
        type: 'SAVE_RAG_CHAT',
        data: {
            transcript,
            metadata: {
                messageCount: window.ragChatHistory.length,
                configId: config.configId || 'unknown',
                responseId: config.responseId || 'unknown',
                chatId: config.chatId || 'unknown',
                savedAt: new Date().toISOString()
            },
            raw: opts.includeRawData ? {
                config,
                messages: window.ragChatHistory,
                savedAt: new Date().toISOString()
            } : undefined
        }
    };

    // Prefer delegating to parent (Qualtrics) which detects the hosting QuestionID
    const isInIframe = !!(window.parent && window.parent !== window);
    dlog('🔍 DEBUG: Environment check:', { isInIframe });

    if (isInIframe) {
        try {
            dlog('💾 Posting SAVE_RAG_CHAT to parent with payload:', {
                meta: payload.data.metadata,
                transcriptPreview: transcript.substring(0, 120) + '...'
            });
            window.parent.postMessage(payload, '*');
            return true;
        } catch (error) {
            derror('❌ Failed to post SAVE_RAG_CHAT to parent:', error);
            return false;
        }
    }

    // Not in iframe: cannot save to Qualtrics directly per new architecture
    dwarn('⚠️ Not in iframe; cannot save to Qualtrics directly. Storing backup locally for debugging.');
    try {
        const backupKey = `rag_chat_backup_${config.chatId || 'unknown'}`;
        localStorage.setItem(backupKey, JSON.stringify(payload.data));
        dlog('🗄️ Local backup saved under key:', backupKey);
        return true;
    } catch (e) {
        derror('❌ Failed to save local backup:', e);
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
        dwarn('Qualtrics SurveyEngine not available - handlers not registered');
        return false;
    }
    
    try {
        // Primary handler: Save on page submit (Next/Submit button)
        Qualtrics.SurveyEngine.addOnPageSubmit(function() {
            dlog('📤 Qualtrics page submit triggered - requesting parent-controlled save');
            // Parent script (paste.js) is source of truth; trigger via postMessage as well
            try { window.postMessage({ type: 'SAVE_RAG_CHAT' }, '*'); } catch (_) {}
        });
        
        // Safety handler: Save on page unload (browser navigation, close, etc.)
        if (opts.enableUnloadHandler) {
            Qualtrics.SurveyEngine.addOnUnload(function() {
                dlog('🔄 Page unloading - requesting parent-controlled save');
                try { window.postMessage({ type: 'SAVE_RAG_CHAT' }, '*'); } catch (_) {}
            });
        }
        
        // Ready handler: Initialize when survey page loads
        if (opts.enableReadyHandler) {
            Qualtrics.SurveyEngine.addOnReady(function() {
                dlog('🚀 Qualtrics survey page ready - using parent paste.js as source of truth');
                // No-op listener here to avoid double-handling; parent paste.js owns saving
            });
        }
        
        dlog('✅ Qualtrics event handlers registered successfully (delegated mode)');
        return true;
        
    } catch (error) {
        derror('❌ Error setting up Qualtrics handlers:', error);
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
    // Prevent auto-setup to avoid conflicts with the new parent-controlled architecture.
    dlog('ℹ️ Qualtrics detected; skipping auto-setup because parent paste.js controls saving.');
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
            dlog('🔄 RAG Qualtrics integration reset');
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
