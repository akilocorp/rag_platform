import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { FaSpinner, FaPaperPlane } from 'react-icons/fa';
import { FiPaperclip, FiImage, FiMoreVertical } from 'react-icons/fi';
import VoiceRecordButton from './VoiceRecordButton';

// Curated follow-up prompts shown when the cascading tab fan deploys.
const QUICK_PROMPTS = [
  'Explain it simpler',
  'Give an example',
  'Go deeper',
];

// Cascading-tab layout: each tier sits at a stepped offset from the send
// button center. Top tier is highest + closest to button horizontally;
// bottom tier is lowest + furthest left. Deploy delay staggers the cone
// "unfold" outward; close delay reverses it so the bottom collapses first.
const TAB_TIERS = [
  { dx: -105, dy: -70, deployDelay: 0,   closeDelay: 120 },
  { dx: -135, dy: -40, deployDelay: 60,  closeDelay: 60  },
  { dx: -165, dy: -10, deployDelay: 120, closeDelay: 0   },
];

const DWELL_MS = 1500;
const DEPLOY_MS = 320;
const PULSE_MS = 560;

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
  // Two-stage mount: showQuickPrompts gates DOM presence, isFanOpen gates
  // the transform. We mount first, then flip transform on the next frame so
  // the transition has a true start point and we don't snap to "open".
  const [showQuickPrompts, setShowQuickPrompts] = useState(false);
  const [isFanOpen, setIsFanOpen] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const dwellTimerRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const closeTimerRef = useRef(null);

  const handleSendHoverEnter = () => {
    if (!hasAiReplied || isLoading) return;
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (showQuickPrompts) {
      setIsFanOpen(true);
      return;
    }
    dwellTimerRef.current = setTimeout(() => {
      setShowQuickPrompts(true);
      setIsPulsing(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setIsPulsing(false), PULSE_MS);
    }, DWELL_MS);
  };

  const handleSendHoverLeave = () => {
    if (dwellTimerRef.current) {
      clearTimeout(dwellTimerRef.current);
      dwellTimerRef.current = null;
    }
    if (!showQuickPrompts) return;
    setIsFanOpen(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    const maxCloseDelay = Math.max(...TAB_TIERS.map((t) => t.closeDelay));
    closeTimerRef.current = setTimeout(
      () => setShowQuickPrompts(false),
      DEPLOY_MS + maxCloseDelay + 40,
    );
  };

  useLayoutEffect(() => {
    if (!showQuickPrompts) return;
    const id = requestAnimationFrame(() => setIsFanOpen(true));
    return () => cancelAnimationFrame(id);
  }, [showQuickPrompts]);

  useEffect(() => () => {
    if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
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
          onMouseEnter={handleSendHoverEnter}
          onMouseLeave={handleSendHoverLeave}
        >
          {showQuickPrompts && (
            <div
              className="absolute bottom-1/2 right-1/2 pointer-events-none z-0"
              style={{ width: 0, height: 0 }}
              aria-hidden={!isFanOpen}
            >
              {QUICK_PROMPTS.map((prompt, i) => {
                const tier = TAB_TIERS[i] || TAB_TIERS[TAB_TIERS.length - 1];
                const targetTransform =
                  `translate(calc(-50% + ${tier.dx}px), calc(-50% + ${tier.dy}px))`;
                const restTransform = 'translate(-50%, -50%)';
                const delay = isFanOpen ? tier.deployDelay : tier.closeDelay;
                return (
                  <button
                    key={prompt}
                    onClick={() => {
                      handleSendHoverLeave();
                      onSend(prompt);
                    }}
                    className={`absolute left-0 top-0 whitespace-nowrap px-4 py-1.5 rounded-full bg-white text-sm font-medium text-[#1F1F1F] border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] ${isFanOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
                    style={{
                      transform: isFanOpen ? targetTransform : restTransform,
                      opacity: isFanOpen ? 1 : 0,
                      transition: `transform ${DEPLOY_MS}ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, opacity ${isFanOpen ? 180 : 100}ms ease-out ${delay}ms`,
                    }}
                    tabIndex={isFanOpen ? 0 : -1}
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
            className={`relative z-10 w-11 h-11 rounded-full flex items-center justify-center bg-[#FA6C43] hover:bg-[#E55B34] text-white transition-colors active:scale-95 ${isPulsing ? 'animate-send-pulse' : ''}`}
          >
            <span className={`flex items-center justify-center transition-opacity ${isLoading || !input.trim() ? 'opacity-50' : 'opacity-100'}`}>
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
