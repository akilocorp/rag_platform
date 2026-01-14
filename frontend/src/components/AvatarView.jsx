import React, { useEffect, useRef, useState, memo } from 'react';
import * as LiveKitClient from 'livekit-client';
import { FaSpinner, FaPlay, FaMicrophone, FaSignal, FaTimes } from 'react-icons/fa'; // Added FaTimes
import apiClient from '../api/apiClient';

const AvatarView = memo(({ config, onAvatarReady, onUserVoiceInput, isProcessing, onEndSession }) => {
  const [isReady, setIsReady] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isListening, setIsListening] = useState(false);
  
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const requestRef = useRef();
  const roomRef = useRef(null);
  
  // Store session data locally to ensure we can kill it
  const activeSessionRef = useRef(null);

  // Speech Recognition Refs
  const recognitionRef = useRef(null);
  const transcriptBuffer = useRef(""); 
  const isIntentionalStop = useRef(false); 
  const latestVoiceCallback = useRef(onUserVoiceInput); 

  useEffect(() => {
      latestVoiceCallback.current = onUserVoiceInput;
  }, [onUserVoiceInput]);

  // --- 1. GREEN SCREEN LOGIC ---
  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.paused || video.readyState < 2) {
      requestRef.current = requestAnimationFrame(processFrame);
      return;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: true });
    
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth; 
      canvas.height = video.videoHeight;
    }
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
      let h = 0;
      if (delta !== 0) {
        if (max === r) h = ((g - b) / delta) % 6;
        else if (max === g) h = (b - r) / delta + 2;
        else h = (r - g) / delta + 4;
      }
      h = Math.round(h * 60); if (h < 0) h += 360;
      const s = max === 0 ? 0 : delta / max, v = max / 255;
      
      if (h >= 70 && h <= 160 && s > 0.2 && v > 0.15 && g > r * 1.1 && g > b * 1.1) {
          data[i + 3] = 0; 
      }
    }
    ctx.putImageData(imageData, 0, 0);
    requestRef.current = requestAnimationFrame(processFrame);
  };

  // --- 2. SESSION CONTROL LOGIC ---
  
  const startSession = async () => {
    if (!config?.heygen_avatar_id) return;
    setIsConnecting(true);
    
    try {
      const createRes = await apiClient.post('/heygen/create-session', { avatar_id: config.heygen_avatar_id });
      const { session_id, url, access_token, heygen_token } = createRes.data.data;
      
      // Store locally for cleanup
      activeSessionRef.current = { session_id, heygen_token };

      await apiClient.post('/heygen/start-session', { session_id, heygen_token });

      const room = new LiveKitClient.Room();
      roomRef.current = room;
      
      room.on(LiveKitClient.RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === "video" && videoRef.current) {
          track.attach(videoRef.current);
          videoRef.current.onplay = () => { 
             requestRef.current = requestAnimationFrame(processFrame); 
          };
        }
        if (track.kind === "audio") track.attach().play().catch(() => {});
      });

      await room.connect(url, access_token);
      
      setIsReady(true);
      if (onAvatarReady) onAvatarReady({ session_id, heygen_token });

    } catch (err) {
      console.error("Avatar failed:", err);
      alert("Failed to start avatar. Please try again.");
    } finally { 
      setIsConnecting(false); 
    }
  };

  const endSession = async () => {
      console.log("🛑 Ending Avatar Session...");
      
      // 1. Stop Mic
      isIntentionalStop.current = true;
      if (recognitionRef.current) recognitionRef.current.abort();
      setIsListening(false);

      // 2. Disconnect Video
      if (roomRef.current) roomRef.current.disconnect();
      cancelAnimationFrame(requestRef.current);

      // 3. Kill Session on Backend
      if (activeSessionRef.current) {
          try {
              await apiClient.post('/heygen/stop-session', { 
                  session_id: activeSessionRef.current.session_id,
                  heygen_token: activeSessionRef.current.heygen_token
              });
              console.log("✅ Session terminated on server.");
          } catch(e) {
              console.error("Failed to stop session:", e);
          }
      }

      // 4. Reset State & Notify Parent
      setIsReady(false);
      activeSessionRef.current = null;
      if (onEndSession) onEndSession();
  };

  // --- 3. ROBUST SPEECH RECOGNITION ---
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true; 
    recognition.lang = 'en-US';
    recognition.interimResults = true; 

    recognition.onstart = () => {
        console.log("🎤 Microphone Active");
        transcriptBuffer.current = ""; 
        setIsListening(true);
    };

    recognition.onend = () => {
        if (transcriptBuffer.current.trim().length > 0 && latestVoiceCallback.current) {
            latestVoiceCallback.current(transcriptBuffer.current);
            transcriptBuffer.current = ""; 
        }

        if (!isIntentionalStop.current) {
            try { recognition.start(); } catch (e) {}
        } else {
            setIsListening(false);
        }
    };
    
    recognition.onerror = (event) => {
        if (event.error === 'no-speech') return;
        
        // Handle Network Errors Gracefully
        if (event.error === 'network') {
             console.warn("🎤 Network error detected. Pausing briefly...");
             isIntentionalStop.current = true;
             setTimeout(() => {
                 isIntentionalStop.current = false;
                 // Don't auto-restart immediately to avoid loops, let user press button
                 setIsListening(false); 
             }, 1000);
             return;
        }

        if (['not-allowed', 'service-not-allowed'].includes(event.error)) {
            setIsListening(false);
            isIntentionalStop.current = true;
        }
    };

    recognition.onresult = (event) => {
      let finalTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
          } else {
              transcriptBuffer.current = event.results[i][0].transcript;
          }
      }
      if (finalTranscript) {
          transcriptBuffer.current = finalTranscript;
      }
    };
    
    recognitionRef.current = recognition;

    return () => {
        isIntentionalStop.current = true;
        recognition.abort();
    };
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;

    if (isListening) {
      isIntentionalStop.current = true; 
      recognitionRef.current.stop();    
    } else {
      isIntentionalStop.current = false;
      try {
        recognitionRef.current.start();
      } catch (e) { console.warn("Mic start error:", e); }
    }
  };

  // Cleanup on Unmount
  useEffect(() => {
    return () => {
        // Ensure we kill the session if the user navigates away using the back button
        if (activeSessionRef.current) {
            apiClient.post('/heygen/stop-session', { 
                session_id: activeSessionRef.current.session_id,
                heygen_token: activeSessionRef.current.heygen_token
            }).catch(() => {});
        }
        roomRef.current?.disconnect();
        cancelAnimationFrame(requestRef.current);
        if (recognitionRef.current) {
            isIntentionalStop.current = true;
            recognitionRef.current.abort();
        }
    };
  }, []);

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-gray-800 to-gray-900 overflow-hidden">
      
      {/* EXIT BUTTON */}
      {isReady && (
          <button 
            onClick={endSession}
            className="absolute top-6 right-6 z-50 p-3 bg-red-500/80 hover:bg-red-600 text-white rounded-full shadow-lg backdrop-blur-sm transition-all hover:scale-110"
            title="End Session"
          >
              <FaTimes className="text-xl" />
          </button>
      )}

      {/* START SCREEN */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center z-20 bg-gray-900/80 backdrop-blur-sm">
          <button 
            onClick={startSession} 
            disabled={isConnecting}
            className="px-8 py-4 bg-indigo-600 rounded-full font-bold text-white hover:bg-indigo-500 flex items-center gap-3 shadow-2xl active:scale-95 transition-all disabled:opacity-50 text-lg"
          >
            {isConnecting ? <FaSpinner className="animate-spin" /> : <FaPlay />} 
            {isConnecting ? "Connecting to Avatar..." : "Start Voice Chat"}
          </button>
        </div>
      )}

      <video ref={videoRef} autoPlay playsInline muted className="hidden" crossOrigin="anonymous" />
      <canvas ref={canvasRef} className="h-[70vh] w-auto object-contain z-0 mt-10 transition-all duration-500" />

      {/* CONTROLS OVERLAY */}
      {isReady && (
        <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-4 z-20">
            <div className="h-6">
                {isListening && <p className="text-green-400 font-semibold animate-pulse">Listening...</p>}
                {isProcessing && <p className="text-indigo-400 font-semibold animate-pulse">Thinking...</p>}
            </div>

            <button 
                onClick={toggleListening}
                disabled={isProcessing}
                className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl shadow-xl transition-all duration-300 ${
                    isListening 
                        ? 'bg-red-500 text-white scale-110 ring-4 ring-red-500/30' 
                        : isProcessing 
                            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                            : 'bg-white text-indigo-600 hover:bg-indigo-50 hover:scale-105'
                }`}
            >
                {isProcessing ? <FaSpinner className="animate-spin" /> : (isListening ? <FaSignal className="animate-pulse" /> : <FaMicrophone />)}
            </button>
            
            <p className="text-gray-400 text-sm">
                {isListening ? "Tap to send" : "Tap to speak"}
            </p>
        </div>
      )}
    </div>
  );
});

export default AvatarView;