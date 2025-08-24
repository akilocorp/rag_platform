Qualtrics.SurveyEngine.addOnReady(function() {
        // Hide this question UI automatically (so respondents don't see the storage field)
        try { this.hide(); } catch (e) {}
        // Initialize once, do not wipe existing history
        window.ragChatHistory = window.ragChatHistory || [];
        window.ragChatConfig = window.ragChatConfig || {
            configId: '68a36fc52603648eff7b9c1f', // Replace with real config ID in production
            responseId: '${e://Field/ResponseID}',
            hiddenQuestionId: undefined,
            messageCount: 0,
            initialized: true,
            parentInitTime: new Date().toISOString()
        };

        // Debug toggle and helpers (enable verbose logs during testing; disable for prod)
        window.RAG_DEBUG_ENABLED = (typeof window.RAG_DEBUG_ENABLED === 'boolean') ? window.RAG_DEBUG_ENABLED : true;
        function dlog() { try { if (window.RAG_DEBUG_ENABLED) console.log.apply(console, arguments); } catch (e) {} }
        function dwarn() { try { if (window.RAG_DEBUG_ENABLED) console.warn.apply(console, arguments); } catch (e) {} }
        function derror() { try { if (window.RAG_DEBUG_ENABLED) console.error.apply(console, arguments); } catch (e) {} }

        // Detect the current question's ID dynamically and use it as hiddenQuestionId
        try {
          var currentQID = (this && this.questionId) || (this && this.getQuestionInfo && this.getQuestionInfo().QuestionID);
          if (currentQID) {
            window.ragChatConfig.hiddenQuestionId = currentQID;
            console.log('🧭 Detected hosting QuestionID:', currentQID);
          } else {
            console.warn('⚠️ Could not detect hosting QuestionID; will rely on config or fallback during save');
          }
        } catch (e) {
          console.warn('⚠️ Error detecting hosting QuestionID:', e);
        }

        // Allowlist for origins — ES5 array
       var allowedOrigins = [
           'https://ust.az1.qualtrics.com'
       ];

        // Basic telemetry
        window.ragDebugStats = window.ragDebugStats || { messages: 0, saves: 0, rejected: 0 };
        console.log('🚀 Qualtrics parent ready. Config:', JSON.parse(JSON.stringify(window.ragChatConfig)));
        // Periodic stats (every 30s) while debugging
        if (!window.__ragStatsInterval) {
          window.__ragStatsInterval = setInterval(function() {
            if (window.RAG_DEBUG_ENABLED) {
              console.log('📈 RAG debug stats', {
                time: new Date().toISOString(),
                stats: window.ragDebugStats,
                messageCount: window.ragChatHistory.length, 
                hiddenQuestionId: (window.ragChatConfig && window.ragChatConfig.hiddenQuestionId) ? window.ragChatConfig.hiddenQuestionId : null
              });
            }
          }, 30000);
        }

        // Listen for messages from iframe
        window.addEventListener('message', function(event) {
            var isAllowed = allowedOrigins.indexOf(event.origin) !== -1;
            var info = { time: new Date().toISOString(), origin: event.origin, allowed: isAllowed, type: (event && event.data && event.data.type) };
            if (!isAllowed) {
                window.ragDebugStats.rejected++;
                var payloadSample = '';
                try { payloadSample = JSON.stringify(event && event.data); } catch (e) { payloadSample = '[unserializable]'; }
                if (payloadSample && payloadSample.length > 200) { payloadSample = payloadSample.slice(0,200); }
                console.warn('⛔ Rejected postMessage (origin not allowed):', info, 'payload sample:', payloadSample);
                return;
            }

            console.log('📥 postMessage received:', info);

            if (event && event.data && event.data.type === 'CHAT_MESSAGE') {
                var message = {
                    sender: event.data.sender,
                    content: event.data.content,
                    timestamp: (event.data && event.data.timestamp) ? event.data.timestamp : new Date().toISOString(),
                    messageIndex: window.ragChatHistory.length + 1
                };

                window.ragChatHistory.push(message);
                window.ragChatConfig.messageCount = window.ragChatHistory.length;
                window.ragDebugStats.messages++;

                console.log('📨 Captured message', {
                  index: message.messageIndex,
                  sender: message.sender,
                  preview: (message.content || '').substring(0, 120)
                });
            }

            if (event && event.data && event.data.type === 'INIT_RAG_CONFIG') {
                // Allow iframe to set/override config safely (manual merge, ES5)
                var current = window.ragChatConfig || {};
                var payload = (event.data && event.data.payload) ? event.data.payload : {};
                for (var k in payload) {
                  if (Object.prototype.hasOwnProperty.call(payload, k)) {
                    current[k] = payload[k];
                  }
                }
                current.initialized = true;
                window.ragChatConfig = current;
                console.log('🧩 Config updated from iframe:', window.ragChatConfig);
            }

             // Listen for save requests from iframe
             if (event && event.data && event.data.type === 'SAVE_RAG_CHAT') {
                 console.log('💾 Save request received from iframe');
                 // Prefer central save if provided by qualtricsIntegration.js
                 if (typeof window.saveRAGChatToQualtrics === 'function') {
                   var ok = window.saveRAGChatToQualtrics();
                   window.ragDebugStats.saves += ok ? 1 : 0;
                   console.log('💾 Central save result:', ok);
                 } else {
                   saveRagChatHistory();
                 }
             }
         });

         console.log('✅ RAG Qualtrics parent listener initialized. Allowed origins:', allowedOrigins);
     });

     // Helper function to write to hidden question using DOM
     function writeToHiddenQuestion(qid, value) {
       var hiddenInput = document.querySelector('input[id^="' + qid + '"]');
       if (hiddenInput) {
         hiddenInput.value = value;
       } else {
         console.error('❌ Could not find hidden input for question ID:', qid);
       }
     }

     Qualtrics.SurveyEngine.addOnPageSubmit(function() {
         console.log('📤 Page submit triggered - saving chat history...');

         if (window.ragChatHistory && window.ragChatHistory.length > 0) {

             // Format chat history for readable display
             var formattedMessages = window.ragChatHistory.map(function(msg, index) {
                 var timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
                     year: 'numeric',
                     month: '2-digit',
                     day: '2-digit',
                     hour: '2-digit',
                     minute: '2-digit',
                     second: '2-digit',
                     hour12: false
                 });
                 
                 var sender = msg.sender === 'user' ? 'User' : 'AI Assistant';
                 return '[' + timestamp + '] ' + sender + ': ' + msg.content;
             });
             
             // Create comprehensive transcript
             var transcript = [
                 '=== RAG CHAT CONVERSATION TRANSCRIPT ===',
                 'Survey Response ID: ' + window.ragChatConfig.responseId,
                 'Chat Configuration ID: ' + window.ragChatConfig.configId,
                 'Total Messages: ' + window.ragChatHistory.length,
                 'Conversation Started: ' + new Date(window.ragChatHistory[0].timestamp).toLocaleString(),
                 'Transcript Generated: ' + new Date().toLocaleString(),
                 '',
                 '=== CONVERSATION MESSAGES ===',
                 formattedMessages.join('\n'),
                 '',
                 '=== END OF TRANSCRIPT ==='
             ].join('\n');
             
             // Save to multiple locations for reliability
            try {
               var qid = (window.ragChatConfig && window.ragChatConfig.hiddenQuestionId)
                 ? window.ragChatConfig.hiddenQuestionId
                 : ((this && this.questionId) || (this && this.getQuestionInfo && this.getQuestionInfo().QuestionID));
               if (!qid) {
                 console.warn('⚠️ Cannot save transcript: hosting QuestionID not detected.');
                 return;
               }
               // Method 1: Save to hidden question (DOM-based, ES5)
               writeToHiddenQuestion(qid, transcript);

               // Method 2: Save to embedded data (backup)
               Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_transcript', transcript);
               Qualtrics.SurveyEngine.setEmbeddedData('rag_message_count', window.ragChatHistory.length);
               Qualtrics.SurveyEngine.setEmbeddedData('rag_config_id', (window.ragChatConfig && window.ragChatConfig.configId) ? window.ragChatConfig.configId : '');
               Qualtrics.SurveyEngine.setEmbeddedData('rag_response_id', (window.ragChatConfig && window.ragChatConfig.responseId) ? window.ragChatConfig.responseId : '');
               Qualtrics.SurveyEngine.setEmbeddedData('rag_saved_at', new Date().toISOString());

               console.log('✅ Chat history saved successfully!');
               console.log('📊 Saved ' + window.ragChatHistory.length + ' messages to ' + qid);

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
            var formattedMessages = window.ragChatHistory.map(function(msg, index) {
                var timestamp = new Date(msg.timestamp).toLocaleString('en-US', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
                var sender = msg.sender === 'user' ? 'User' : 'AI Assistant';
                return '[' + timestamp + '] ' + sender + ': ' + msg.content;
            });
            
            // Create comprehensive transcript
            var startedTs = (window.ragChatHistory[0] && window.ragChatHistory[0].timestamp) ? window.ragChatHistory[0].timestamp : new Date().toISOString();
            var transcript = [
                '=== RAG CHAT CONVERSATION TRANSCRIPT ===',
                'Survey Response ID: ' + window.ragChatConfig.responseId,
                'Chat Configuration ID: ' + window.ragChatConfig.configId,
                'Total Messages: ' + window.ragChatHistory.length,
                'Conversation Started: ' + new Date(startedTs).toLocaleString(),
                'Transcript Generated: ' + new Date().toLocaleString(),
                '',
                '=== CONVERSATION MESSAGES ===',
                formattedMessages.join('\n'),
                '',
                '=== END OF TRANSCRIPT ==='
            ].join('\n');
            
            // Save to multiple locations for reliability
           try {
               var qid = (window.ragChatConfig && window.ragChatConfig.hiddenQuestionId)
                 ? window.ragChatConfig.hiddenQuestionId
                 : ((this && this.questionId) || (this && this.getQuestionInfo && this.getQuestionInfo().QuestionID));
               if (!qid) {
                 console.warn('⚠️ Cannot save transcript: hosting QuestionID not detected.');
                 return;
               }
               // Method 1: Save to hidden question (DOM-based, ES5)
               writeToHiddenQuestion(qid, transcript);

               // Method 2: Save to embedded data (backup)
               Qualtrics.SurveyEngine.setEmbeddedData('rag_chat_transcript', transcript);
               Qualtrics.SurveyEngine.setEmbeddedData('rag_message_count', window.ragChatHistory.length);
               Qualtrics.SurveyEngine.setEmbeddedData('rag_config_id', (window.ragChatConfig && window.ragChatConfig.configId) ? window.ragChatConfig.configId : '');
               Qualtrics.SurveyEngine.setEmbeddedData('rag_response_id', (window.ragChatConfig && window.ragChatConfig.responseId) ? window.ragChatConfig.responseId : '');
               Qualtrics.SurveyEngine.setEmbeddedData('rag_saved_at', new Date().toISOString());

               console.log('✅ Chat history saved successfully!');
               console.log('📊 Saved ' + window.ragChatHistory.length + ' messages to ' + qid);

           } catch (error) {
               console.error('❌ Error saving chat history:', error);
           }
        } else {
            console.log('ℹ️ No chat history to save');
        }
    }