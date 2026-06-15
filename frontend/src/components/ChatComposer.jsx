import React, { useState, useRef, useEffect } from 'react';
import { FaSpinner, FaPaperPlane } from 'react-icons/fa';
import { FiPaperclip, FiImage, FiMoreVertical } from 'react-icons/fi';
import VoiceRecordButton from './VoiceRecordButton';

// Curated follow-up prompts shown in the hover fan above the send button.
// Kept static for now; swap to AI-generated suggestions in a follow-up.
const QUICK_PROMPTS = [
  'Explain it simpler',
  'Give an example',
  'Summarize this',
  'What should I ask next?',
  'Go deeper',
];

// Fan layout: chips arc up-and-left from the send button.
// Tuned so the widest chip clears the model picker and the screen edge.
const FAN_POSITIONS = [
  { x: -150, y: -36  },
  { x: -190, y: -94  },
  { x: -156, y: -154 },
  { x: -76,  y: -184 },
  { x:  10,  y: -168 },
];

// Models offered in the in-chat picker (playground / personal bots only).
export const CHAT_MODEL_OPTIONS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'deepseek-chat', label: 'Deepseek Chat' },
];

/**
 * v2-style chat composer: a single rounded card with the textarea on top and a
 * round-icon action row (attach / image / voice / more / model picker) plus a
 * circular send button. Fully controlled — all state and handlers come in as
 * props so it can be reused without owning any chat logic.
 */
const ChatComposer = ({
  input, setInput, inputRef,
  onSend, onPaste,
  isLoading, isSending, onSendAnimationEnd,
  onAttachPick, attachInputRef, onAttachChange, isUploading,
  imageInputRef, onImageChange,
  showVoice, onVoiceTranscribed,
  showOptions, setShowOptions, optionsRef,
  showModelPicker, model, onModelChange,
  attachments,
  hasAiReplied,
}) => {
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const closeTimerRef = useRef(null);

  const openQuickPrompts = () => {
    if (!hasAiReplied || isLoading) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setShowQuickPrompts(true);
  };
  const scheduleClose = () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => setShowQuickPrompts(false), 140);
  };

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  return (
    <div className="w-full rounded-[28px] bg-white border border-gray-200 shadow-[0_10px_40px_rgba(31,31,31,0.08)] p-3 sm:p-4">
      {attachments && (
        <div className="flex flex-wrap items-center gap-2 mb-2 px-1">
          {attachments}
        </div>
      )}
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        onPaste={onPaste}
        placeholder="Type a message..."
        rows={1}
        className="w-full min-h-[44px] max-h-[200px] resize-none overflow-y-auto scrollbar-hide bg-transparent text-[#222] placeholder-gray-400 border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent focus:shadow-none px-1 py-2 text-base sm:text-lg"
        disabled={isLoading}
      />

      <div className="h-px mx-1 my-2" style={{ backgroundColor: 'rgba(31,31,31,0.08)' }} />

      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-1">
          <button
            onClick={onAttachPick}
            disabled={isUploading}
            title="Attach files"
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-[#FA6C43] hover:bg-gray-100 transition-colors disabled:opacity-50 shrink-0"
          >
            {isUploading ? <FaSpinner className="animate-spin text-base" /> : <FiPaperclip className="text-base" />}
          </button>
          <input
            ref={attachInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onAttachChange}
            accept=".pdf,.txt,.md,.docx,.pptx"
          />
          <button
            onClick={() => imageInputRef.current?.click()}
            disabled={isUploading}
            title="Attach image"
            className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-[#FA6C43] hover:bg-gray-100 transition-colors disabled:opacity-50 shrink-0"
          >
            <FiImage className="text-base" />
          </button>
          <input
            ref={imageInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={onImageChange}
          />
          {showVoice && (
            <VoiceRecordButton onTranscribed={onVoiceTranscribed} disabled={isLoading} />
          )}
          <div className="relative shrink-0" ref={optionsRef}>
            <button
              onClick={() => setShowOptions(v => !v)}
              title="More options"
              className="w-9 h-9 rounded-full flex items-center justify-center text-gray-500 hover:text-[#FA6C43] hover:bg-gray-100 transition-colors"
            >
              <FiMoreVertical className="text-base" />
            </button>
            {showOptions && (
              <div className="absolute bottom-full left-0 mb-2 w-44 bg-white rounded-xl shadow-lg border border-gray-100 p-1 z-50">
                <button
                  className="group w-full flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-[#FFF5F2] rounded-lg transition-colors"
                  onClick={() => setShowOptions(false)}
                >
                  <span className="inline-flex transition-transform duration-200 ease-out group-hover:rotate-[-15deg]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#FA6C43" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" y1="19" x2="12" y2="23"/>
                      <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                  </span>
                  Live Drills
                </button>
              </div>
            )}
          </div>
          {/* Model picker — only on free playground / personal bots */}
          {showModelPicker && (
            <select
              value={model || CHAT_MODEL_OPTIONS[0].id}
              onChange={(e) => onModelChange(e.target.value)}
              aria-label="Model"
              className="ml-1 text-xs font-semibold rounded-full px-2.5 py-1.5 outline-none cursor-pointer hover:bg-gray-100 transition-colors text-[#222] border border-gray-200 bg-[#F5F3EE]"
            >
              {CHAT_MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          )}
        </div>

        <div
          className="relative shrink-0"
          onMouseEnter={openQuickPrompts}
          onMouseLeave={scheduleClose}
        >
          {showQuickPrompts && (
            <div
              className="absolute bottom-1/2 right-1/2 pointer-events-none z-40"
              style={{ width: 0, height: 0 }}
            >
              {QUICK_PROMPTS.map((prompt, i) => {
                const pos = FAN_POSITIONS[i] || FAN_POSITIONS[FAN_POSITIONS.length - 1];
                return (
                  <button
                    key={prompt}
                    onClick={() => {
                      setShowQuickPrompts(false);
                      onSend(prompt);
                    }}
                    className="pointer-events-auto absolute whitespace-nowrap px-3.5 py-1.5 rounded-full bg-white text-sm font-medium text-[#1F1F1F] border border-gray-200 shadow-[0_8px_24px_rgba(31,31,31,0.12)] hover:bg-[#FFF5F2] hover:border-[#FA6C43] hover:text-[#FA6C43] transition-colors animate-chip-pop"
                    style={{
                      left: `${pos.x}px`,
                      top: `${pos.y}px`,
                      animationDelay: `${i * 55}ms`,
                      '--cx': '0px',
                      '--cy': '0px',
                    }}
                  >
                    {prompt}
                  </button>
                );
              })}
            </div>
          )}

          <button
            onClick={() => onSend()}
            disabled={isLoading || !input.trim()}
            title="Send"
            className="group relative w-11 h-11 rounded-full flex items-center justify-center bg-[#FA6C43] hover:bg-[#E55B34] text-white shadow-[0_6px_16px_rgba(250,108,67,0.45)] disabled:opacity-50 transition-all active:scale-95 overflow-hidden"
          >
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[-2px] rounded-full opacity-0 group-hover:opacity-100 group-hover:animate-send-sweep"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0deg, transparent 200deg, #FFD3B6 270deg, #FFFFFF 320deg, transparent 360deg)',
              }}
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-[2px] rounded-full bg-[#FA6C43] group-hover:bg-[#E55B34] transition-colors"
            />
            <span className="relative z-10 flex items-center justify-center">
              {isSending ? (
                <FaPaperPlane className="animate-send-launch text-lg" onAnimationEnd={onSendAnimationEnd} />
              ) : isLoading ? (
                <FaSpinner className="animate-spin text-lg" />
              ) : (
                <FaPaperPlane className="text-lg" />
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatComposer;
