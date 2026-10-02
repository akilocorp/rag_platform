// @language  JavaScript (React / JSX)
// @updated   2026-10-02
// @changed   Attachment-chip remove button is always shown (24px) on touch screens, which never fire hover.
// @changed   Prior: Enter no longer sends while an IME (Chinese/Japanese) composition is in progress.
// @changed   Prior: Bigger composer controls: send/mic 32->36px, attach/equation/+ 28->32px, glyphs 16px,
//            model/effort pills get more padding; text + action-row clearance right-12 -> right-14
//            so copy never runs under the wider send button.
// @changed   Prior: New alwaysExpanded prop — real chat surfaces (1:1 chat, group chat, Experiential) pass it
//            so the composer never collapses to the 48px pill mid-conversation; only the landing-page
//            demo keeps the original expand-on-focus/collapse-on-blur behavior.
// @changed   Prior: PromptInput is now the single composer used everywhere — 1:1 chat (ChatPage), the
//            Experiential simulator, group chat, and the landing page's "Try it" demo all render
//            this same component. It gained an "external mode" superset of props so every real
//            feature ChatComposer/GroupChatPage had keeps working: showEquation swaps the plain
//            textarea for RichMathInput (inline MathQuill, ƒ× button) so equation editing survives
//            the reskin; onAttachPick/attachInputRef/onAttachChange/imageInputRef/onImageChange let
//            a caller own real file-upload wiring (KB attach) instead of PromptInput's own
//            client-side image-blob demo attachments; attachmentsSlot renders a caller-supplied chip
//            row (KB file chips, URL-detected chips) above the card; onVoiceTranscribed switches the
//            mic from the demo's browser Speech-Recognition simulation to the real
//            MediaRecorder -> POST /audio/transcribe pipeline (VoiceRecordButton's actual behavior,
//            inlined so the single morphing mic/arrow/stop button stays one button instead of two);
//            model/onModelChange makes the model picker controlled (real pages own the selected
//            model as external state) while models keeps accepting either label strings (landing,
//            unchanged contract) or {id,label} objects (real app); isLoading/isSending/
//            onSendAnimationEnd port the send-button disabled/spinner/launch-animation states;
//            quoteReply/onCancelQuoteReply renders group chat's reply-preview chip; hasAiReplied/
//            quickPrompts ports the locked hover-fan quick-prompt selector onto the action button.
//            None of this changes default behavior for existing callers that don't pass the new
//            props — LandingV2's call site is unmodified and renders identically.
// @changed   Prior: .prompt-scrollbar (the textarea) now overrides the global `textarea, textarea:focus`
//            rule in index.css (gray border always-on + blue focus box-shadow, meant for plain
//            legacy form inputs) with border: none / box-shadow: none. That global rule was drawing
//            a sharp-cornered rectangle around the textarea, poking out past the rounded card's own
//            border — visible mainly on focus. The prior overflow-clip fix below didn't touch this;
//            different cause, same symptom ("double border").
// @changed   Prior: Main Input Card: moved overflow-clip onto its own inset layer, separate from the
//            bordered card, so the clip mask and the border curve no longer anti-alias into a
//            visible double border.
// @changed   Prior: Collapsed/expanded max-width bumped again (400/640 -> 480/760) for LandingV2's "Try it"
//            section, which wanted a bigger composer. Only call site is LandingV2, so no other page is
//            affected.
// @changed   Prior: Main input card's focus state dropped the separate focus-within:ring-1 ring-[#F9D0C4] and
//            made the focus border fully opaque (border-[#FA6C43] instead of /50). Stacking a
//            translucent border with a same-ish-colored ring just outside it read as a faint double
//            border instead of one clean line.
//            Prior: new file: ported from the Aceternity/21st.dev ai-chat-input.tsx demo to this project's
//            plain-JS/Vite convention. Shadcn CSS-variable tokens (bg-card, text-foreground, bg-primary,
//            etc.) are hardcoded to this app's actual brand palette instead of a global theme layer.
//            Per-model CDN logo icons dropped (no equivalent asset for this app's real model list) for a
//            single generic icon from react-icons, the icon family already used everywhere else in this
//            codebase. The effort/reasoning-level control is now optional (hidden unless an `efforts`
//            array is passed) since it has no real meaning for this product.
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { FiCpu, FiPaperclip, FiImage, FiX } from 'react-icons/fi';
import { FaSpinner } from 'react-icons/fa';
import { TbMathFunction } from 'react-icons/tb';
import { cn } from '../../lib/utils';
import apiClient from '../../api/apiClient';
import RichMathInput from '../RichMathInput';

// ----------------------------------------------------------------------
// Transition Physics
// ----------------------------------------------------------------------
const SPRING_TRANSITION = 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
const SMOOTH_HEIGHT_TRANSITION = 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.15s ease-out';

// Hover-fan quick-prompt tiers, ported verbatim from the old ChatComposer — vertical
// pop-out column, right-aligned with the action button, staggered deploy/close.
const TAB_TIERS = [
  { dy: -132, deployDelay: 120, closeDelay: 0 },
  { dy: -88, deployDelay: 60, closeDelay: 60 },
  { dy: -44, deployDelay: 0, closeDelay: 120 },
];
const DWELL_MS = 1500;
const DEPLOY_MS = 320;
const PULSE_MS = 560;
const LEAVE_GRACE_MS = 320;
const DEFAULT_QUICK_PROMPTS = ['Explain it simpler', 'Give an example', 'Go deeper'];

// Models offered in the in-chat picker (playground / personal bots only). Moved here from the
// retired ChatComposer.jsx — this is the sole model-picker implementation now.
export const CHAT_MODEL_OPTIONS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'deepseek-chat', label: 'Deepseek Chat' },
];

// ----------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------
function MorphingText({ text }) {
  const [width, setWidth] = useState('auto');
  const spanRef = useRef(null);

  useEffect(() => {
    if (spanRef.current) {
      setWidth(spanRef.current.offsetWidth);
    }
  }, [text]);

  return (
    <span
      className="relative inline-flex items-center justify-center overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]"
      style={{ width }}
    >
      <span ref={spanRef} className="invisible whitespace-nowrap px-1">
        {text}
      </span>
      <span
        key={text}
        className="absolute inset-0 flex items-center justify-center whitespace-nowrap animate-in fade-in zoom-in-95 duration-300"
      >
        {text}
      </span>
    </span>
  );
}

// A single generic glyph for every model — this app's real model list (GPT-4o Mini, Claude
// Sonnet 4.6, ...) has no per-brand logo assets, unlike the source component's fake model
// names which hotlinked a third-party icon mirror.
function ModelIcon({ className }) {
  return <FiCpu className={className} aria-hidden />;
}

function ArrowUpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="5" y="1" width="4" height="7" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.75 6.5V7a4.25 4.25 0 0 0 8.5 0v-.5M7 11.25V13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M7 2.5V11.5M2.5 7H11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2.5 2.5L11.5 11.5M11.5 2.5L2.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DynamicBarsIcon({ level }) {
  const isMediumOrHigh = level === 'Medium' || level === 'Max Effort';
  const isHigh = level === 'Max Effort';

  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="8" width="2.5" height="4.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={1} />
      <rect x="5.75" y="5" width="2.5" height="7.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={isMediumOrHigh ? 1 : 0.3} />
      <rect x="10" y="2" width="2.5" height="10.5" rx="1" fill="currentColor" className="transition-opacity duration-300" opacity={isHigh ? 1 : 0.3} />
    </svg>
  );
}

// ----------------------------------------------------------------------
// Attachment Thumbnail (internal/demo image-blob attachments only)
// ----------------------------------------------------------------------
function AttachmentThumb({ attachment, index, onRemove, onOpen, registerRef }) {
  const [isHovered, setIsHovered] = useState(false);
  const btnRef = useRef(null);

  return (
    <button
      ref={(el) => {
        btnRef.current = el;
        registerRef(attachment.id, el);
      }}
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        if (btnRef.current) {
          onOpen(attachment, btnRef.current.getBoundingClientRect());
        }
      }}
      style={{ animationDelay: `${index * 35}ms`, animationFillMode: 'backwards' }}
      className={cn(
        'group relative size-12 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-[#F5F3EE] outline-none',
        'transition-transform duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:scale-[1.04] active:scale-[0.96]',
        'animate-in fade-in slide-in-from-top-3 zoom-in-90 duration-400'
      )}
      aria-label={`Open preview of ${attachment.name}`}
    >
      <img src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      <span className={cn('absolute inset-0 flex items-start justify-end bg-black/0 transition-colors duration-200', isHovered && 'bg-black/25')}>
        <span
          role="button" tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
          onClick={(e) => { e.stopPropagation(); onRemove(attachment.id); }}
          className={cn(
            'm-1 flex size-4 items-center justify-center rounded-full bg-white/90 text-[#1F1F1F]/70 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-white hover:text-[#1F1F1F] hover:scale-110',
            isHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-50 pointer-events-none',
            // touch screens never fire hover, so the remove button is always shown (and bigger) there
            '[@media(hover:none)]:opacity-100 [@media(hover:none)]:scale-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:size-6'
          )}
          aria-label={`Remove ${attachment.name}`}
        >
          <CloseIcon />
        </span>
      </span>
    </button>
  );
}

// ----------------------------------------------------------------------
// Shared-Element Gallery Modal (internal/demo image-blob attachments only)
// ----------------------------------------------------------------------
function AttachmentGalleryModal({ attachment, originRect, onClose }) {
  const [phase, setPhase] = useState('opening');
  const [targetRect, setTargetRect] = useState(null);
  const imgRef = useRef(null);

  useEffect(() => {
    const maxW = Math.min(window.innerWidth * 0.86, 560);
    const maxH = Math.min(window.innerHeight * 0.78, 720);

    const naturalW = attachment.width || 800;
    const naturalH = attachment.height || 600;
    const scale = Math.min(maxW / naturalW, maxH / naturalH, 1.6);

    const width = naturalW * scale;
    const height = naturalH * scale;

    setTargetRect({
      top: (window.innerHeight - height) / 2,
      left: (window.innerWidth - width) / 2,
      width,
      height,
      radius: 20,
    });

    const raf = requestAnimationFrame(() => setPhase('open'));
    return () => cancelAnimationFrame(raf);
  }, [attachment]);

  const handleClose = useCallback(() => setPhase('closing'), []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const isOpen = phase === 'open';
  const isClosing = phase === 'closing';

  const geometry = isOpen && targetRect
    ? targetRect
    : { top: originRect.top, left: originRect.left, width: originRect.width, height: originRect.height, radius: 12 };

  const animEasing = isClosing ? 'ease-out' : 'cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  const animDur = isClosing ? '0.3s' : '0.45s';
  const flipTransition = `top ${animDur} ${animEasing}, left ${animDur} ${animEasing}, width ${animDur} ${animEasing}, height ${animDur} ${animEasing}, border-radius ${animDur} ${animEasing}`;

  return (
    <div className="fixed inset-0 z-[100]" onClick={handleClose} role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-white/70 backdrop-blur-md transition-opacity duration-400" style={{ opacity: isOpen ? 1 : 0 }} />
      <div
        style={{
          position: 'fixed',
          top: geometry.top, left: geometry.left, width: geometry.width, height: geometry.height,
          borderRadius: geometry.radius, transition: flipTransition, overflow: 'hidden',
          boxShadow: isOpen ? '0 24px 60px -12px rgb(0 0 0 / 0.35)' : '0 0px 0px 0px rgb(0 0 0 / 0)',
        }}
        className="bg-[#F5F3EE]"
        onTransitionEnd={() => { if (phase === 'closing') onClose(); }}
        onClick={(e) => e.stopPropagation()}
      >
        <img ref={imgRef} src={attachment.url} alt={attachment.name} className="size-full object-cover" draggable={false} />
      </div>

      <button
        type="button" onClick={handleClose}
        style={{ opacity: isOpen ? 1 : 0, transform: isOpen ? 'scale(1)' : 'scale(0.7)' }}
        className={cn(
          'fixed right-4 top-4 flex size-9 items-center justify-center rounded-full bg-white/90 text-[#1F1F1F]/70 shadow-md backdrop-blur-sm',
          'transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] hover:bg-white hover:text-[#1F1F1F]',
          !isOpen && 'pointer-events-none'
        )}
      >
        <span className="scale-150"><CloseIcon /></span>
      </button>
    </div>
  );
}

// ----------------------------------------------------------------------
// Main Component
// ----------------------------------------------------------------------

// `models` accepts either a plain string[] of labels (landing page's original contract — the
// caller maps the label back to whatever id it needs in onSubmit) or a {id,label}[] (the real
// app's CHAT_MODEL_OPTIONS shape). `efforts` defaults to empty, which hides the reasoning-level
// control entirely: it's a real shadcn-demo affordance but has no product meaning here unless a
// caller opts in with real levels.
export const PromptInput = React.forwardRef(
  (
    {
      onSubmit,
      placeholder = 'Ask anything',
      className,
      models = [],
      efforts = [],
      defaultValue = '',
      value: controlledValue,
      onChange,
      maxAttachments = 6,
      // --- external/real-app mode (all optional; omitted = identical to the old landing-only demo) ---
      inputRef,
      onPaste,
      isLoading = false,
      isSending = false,
      onSendAnimationEnd,
      showAttach = true,
      onAttachPick,
      attachInputRef,
      onAttachChange,
      isUploading = false,
      imageInputRef,
      onImageChange,
      attachmentsSlot,
      showVoice = true,
      onVoiceTranscribed,
      model: controlledModel,
      onModelChange,
      showEquation = false,
      quoteReply,
      onCancelQuoteReply,
      hasAiReplied = false,
      quickPrompts,
      alwaysExpanded = false,
    },
    ref
  ) => {
    // Real chat surfaces pass alwaysExpanded so the composer never collapses to the 48px
    // pill mid-conversation — only the landing-page demo (and its expand-on-focus intro)
    // keeps the collapse/expand behavior. _setExpanded is the raw setter; setExpanded below
    // is a no-op guard so every existing setExpanded(...) call site below just works.
    const [expanded, _setExpanded] = useState(alwaysExpanded);
    const setExpanded = useCallback((v) => {
      if (alwaysExpanded) return;
      _setExpanded(v);
    }, [alwaysExpanded]);
    const [isSmoothResize, setIsSmoothResize] = useState(false);
    const [localValue, setLocalValue] = useState(defaultValue);
    const normalizedModels = models.map((m) => (typeof m === 'string' ? { id: m, label: m } : m));
    const isModelControlled = typeof onModelChange === 'function';
    const [internalModelId, setInternalModelId] = useState(normalizedModels[0]?.id);
    const selectedModelId = isModelControlled ? controlledModel : internalModelId;
    const selectedModelObj = normalizedModels.find((m) => m.id === selectedModelId) || normalizedModels[0];
    const [effortIndex, setEffortIndex] = useState(Math.min(1, Math.max(0, efforts.length - 1)));
    const [isModelSelectOpen, setIsModelSelectOpen] = useState(false);

    const isExternalAttach = typeof onAttachPick === 'function';
    const isRealVoice = typeof onVoiceTranscribed === 'function';

    const [attachments, setAttachments] = useState([]);
    const [activeAttachment, setActiveAttachment] = useState(null);

    // Audio/Voice recording states — shared between the demo (Web Speech API) and real
    // (MediaRecorder -> /audio/transcribe) paths so the single morphing button works either way.
    const [isRecording, setIsRecording] = useState(false);
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [audioData, setAudioData] = useState(new Array(5).fill(0));
    const valueRef = useRef(controlledValue !== undefined ? controlledValue : localValue);

    // Refs for Web Audio & Speech Recognition cleanup (demo path)
    const streamRef = useRef(null);
    const audioContextRef = useRef(null);
    const rafRef = useRef(null);
    const recognitionRef = useRef(null);
    const demoIntervalRef = useRef(null);
    const demoTextIntervalRef = useRef(null);
    // Real-voice path: MediaRecorder + its chunk buffer
    const mediaRecorderRef = useRef(null);
    const mediaChunksRef = useRef([]);

    const [hoverStyle, setHoverStyle] = useState({ opacity: 0, transform: 'translateY(0px) scale(0.95)', transition: 'none' });
    const [containerHeight, setContainerHeight] = useState(116);
    const [textareaHeight, setTextareaHeight] = useState(68);
    const [isScrolling, setIsScrolling] = useState(false);

    // Hover-fan quick-prompt selector state, ported from ChatComposer.
    const [showQuickPrompts, setShowQuickPrompts] = useState(false);
    const [isFanOpen, setIsFanOpen] = useState(false);
    const [isPulsing, setIsPulsing] = useState(false);
    const dwellTimerRef = useRef(null);
    const pulseTimerRef = useRef(null);
    const closeTimerRef = useRef(null);
    const leaveTimerRef = useRef(null);
    const promptList = (Array.isArray(quickPrompts) && quickPrompts.length === 3) ? quickPrompts : DEFAULT_QUICK_PROMPTS;

    const isControlled = controlledValue !== undefined;
    const value = isControlled ? controlledValue : localValue;
    const hasValue = value.trim() !== '' || attachments.length > 0;
    const hasAttachments = attachments.length > 0;
    const hasExternalAttachments = attachmentsSlot != null;
    const hasEfforts = efforts.length > 0;

    const textareaRef = useRef(null);
    const richInputRef = useRef(null);
    const internalContainerRef = useRef(null);
    const topFadeRef = useRef(null);
    const bottomFadeRef = useRef(null);
    const fileInputRef = useRef(null);
    const thumbRefs = useRef(new Map());

    // Sync value ref for audio callback closure
    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    // Mirror the editable DOM node up to an external inputRef, if the caller wants direct access
    // (e.g. for imperative focus() calls). Auto-height is owned entirely by this component now.
    useEffect(() => {
      if (inputRef) inputRef.current = textareaRef.current;
    });

    const updateFades = () => {
      const el = textareaRef.current;
      if (!el) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      if (topFadeRef.current) {
        topFadeRef.current.style.opacity = Math.min(scrollTop / 20, 1).toString();
      }
      if (bottomFadeRef.current) {
        const bottomScroll = scrollHeight - clientHeight - scrollTop;
        bottomFadeRef.current.style.opacity = Math.min(Math.max(bottomScroll - 16, 0) / 10, 1).toString();
      }
    };

    const handleValueChange = useCallback((val) => {
      setIsSmoothResize(true);
      if (!isControlled) setLocalValue(val);
      onChange?.(val);
    }, [isControlled, onChange]);

    const expand = () => {
      setIsSmoothResize(false);
      setExpanded(true);
    };

    // --- Demo Voice Recording Logic (browser Speech Recognition, no caller onVoiceTranscribed) ---
    const stopRecording = useCallback(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
      if (demoIntervalRef.current) {
        window.clearInterval(demoIntervalRef.current);
        demoIntervalRef.current = null;
      }
      if (demoTextIntervalRef.current) {
        window.clearInterval(demoTextIntervalRef.current);
        demoTextIntervalRef.current = null;
      }
      setIsRecording(false);
      setAudioData(new Array(5).fill(0));
    }, []);

    const startRecording = useCallback(async () => {
      setIsSmoothResize(false);
      setExpanded(true);

      let stream = null;
      try {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      } catch (err) {
        console.warn('Microphone access denied or unavailable. Falling back to simulated voice mode for demo.', err);
      }

      setIsRecording(true);

      // Simulation function for browsers/sandboxes without mic or SpeechRecognition support.
      function simulateText() {
        const fakeText = 'Can you build a high fidelity Framer Motion layout animation for a dark mode dashboard?';
        const words = fakeText.split(' ');
        let i = 0;
        let currentBase = valueRef.current;
        demoTextIntervalRef.current = window.setInterval(() => {
          if (i < words.length) {
            currentBase = (currentBase ? currentBase + ' ' : '') + words[i];
            handleValueChange(currentBase);
            i++;
          } else {
            stopRecording();
          }
        }, 300);
      }

      if (stream) {
        streamRef.current = stream;

        // Setup Web Audio API for visualizer
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;

        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const updateVisualizer = () => {
          analyser.getByteFrequencyData(dataArray);
          const bands = new Array(5).fill(0);
          const step = Math.floor(dataArray.length / 5);
          for (let i = 0; i < 5; i++) {
            let sum = 0;
            for (let j = 0; j < step; j++) {
              sum += dataArray[i * step + j];
            }
            bands[i] = sum / step / 255; // normalize to 0-1
          }
          setAudioData(bands);
          rafRef.current = requestAnimationFrame(updateVisualizer);
        };
        updateVisualizer();

        // Setup Speech Recognition
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
          const recognition = new SpeechRecognition();
          recognition.continuous = true;
          recognition.interimResults = true;

          let baseline = valueRef.current;

          recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; ++i) {
              if (event.results[i].isFinal) {
                finalTranscript += event.results[i][0].transcript;
              } else {
                interimTranscript += event.results[i][0].transcript;
              }
            }

            if (finalTranscript) {
              baseline += (baseline ? ' ' : '') + finalTranscript;
            }

            handleValueChange((baseline + (interimTranscript ? ' ' + interimTranscript : '')).trim());
          };

          recognition.onerror = (e) => {
            console.error('Speech recognition error', e);
            stopRecording();
          };

          recognition.onend = () => {
            stopRecording();
          };

          recognitionRef.current = recognition;
          recognition.start();
        } else {
          console.warn('Speech Recognition API not supported in this browser. Using simulated text.');
          simulateText();
        }
      } else {
        // Fallback simulated visualizer
        demoIntervalRef.current = window.setInterval(() => {
          setAudioData(Array.from({ length: 5 }, () => Math.random() * 0.8 + 0.1));
        }, 100);
        simulateText();
      }
    }, [handleValueChange, stopRecording]);

    // --- Real Voice Recording Logic (MediaRecorder -> POST /audio/transcribe) ---
    // Same backend contract as VoiceRecordButton.jsx: record webm/opus, upload as multipart,
    // hand the transcribed text to the caller (who typically auto-sends it, per ChatPage's
    // handleVoiceTranscribed). Used instead of the demo path whenever onVoiceTranscribed is passed,
    // so real chat surfaces get real server-side transcription rather than the client-only
    // Speech-Recognition/simulated-text fallback (Chrome-only and explicitly a demo affordance).
    const startRealRecording = useCallback(async () => {
      setIsSmoothResize(false);
      setExpanded(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
        const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        mediaChunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) mediaChunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          const blob = new Blob(mediaChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          mediaChunksRef.current = [];
          setIsRecording(false);
          if (blob.size === 0) return;
          setIsTranscribing(true);
          try {
            const fd = new FormData();
            const ext = (recorder.mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
            fd.append('audio', blob, `recording.${ext}`);
            const res = await apiClient.post('/audio/transcribe', fd, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            const text = (res.data?.text || '').trim();
            if (text) onVoiceTranscribed?.(text);
          } catch (e) {
            console.error('Transcription failed', e);
          } finally {
            setIsTranscribing(false);
          }
        };
        recorder.start();
        mediaRecorderRef.current = recorder;
        setIsRecording(true);
      } catch (e) {
        console.error('Microphone access failed', e);
      }
    }, [onVoiceTranscribed]);

    const stopRealRecording = useCallback(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    }, []);

    // Keep textarea auto-scrolled to bottom while recording
    useEffect(() => {
      if (isRecording && textareaRef.current) {
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, [value, isRecording]);

    // Ensure cleanup of mic/streams on unmount
    useEffect(() => {
      return () => {
        stopRecording();
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
        }
        attachments.forEach((a) => URL.revokeObjectURL(a.url));
        if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
        if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stopRecording]);

    useEffect(() => {
      if ((value.trim() !== '' || hasAttachments) && !expanded) {
        setIsSmoothResize(false);
        setExpanded(true);
      }
    }, [value, expanded, hasAttachments]);

    useEffect(() => {
      if (expanded && !isRecording) {
        const timer = setTimeout(() => {
          if (showEquation) {
            richInputRef.current?.focus();
          } else if (textareaRef.current) {
            textareaRef.current.focus();
            const length = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(length, length);
          }
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [expanded, isRecording, showEquation]);

    // ONLY updates height on value/text change. Adding attachments leaves this completely isolated.
    // Works for both the plain <textarea> and RichMathInput's contentEditable div — RichMathInput
    // mirrors its DOM node onto the same textareaRef specifically so this effect keeps working.
    useEffect(() => {
      if (!textareaRef.current) return;
      const el = textareaRef.current;

      const currentHeight = el.style.height;
      el.style.transition = 'none';
      el.style.height = '0px';
      const scrollHeight = el.scrollHeight;
      el.style.height = currentHeight;
      void el.offsetHeight;
      el.style.transition = '';

      const newHeight = Math.max(68, Math.min(scrollHeight, 160));
      el.style.height = `${newHeight}px`;

      setTextareaHeight(newHeight);
      setIsScrolling(scrollHeight > 160);

      setTimeout(updateFades, 0);
    }, [value, expanded]);

    useEffect(() => {
      setContainerHeight(Math.max(116, textareaHeight + 48));
      setTimeout(updateFades, 0);
    }, [textareaHeight]);

    useEffect(() => {
      if (!isModelSelectOpen) return;
      const handleOutsideClick = (e) => {
        if (internalContainerRef.current && !internalContainerRef.current.contains(e.target)) {
          setIsModelSelectOpen(false);
        }
      };
      document.addEventListener('mousedown', handleOutsideClick);
      return () => document.removeEventListener('mousedown', handleOutsideClick);
    }, [isModelSelectOpen]);

    const handleBlur = (e) => {
      if (internalContainerRef.current && internalContainerRef.current.contains(e.relatedTarget)) return;
      if (value.trim() === '' && !hasAttachments && !hasExternalAttachments && !isRecording) {
        setIsSmoothResize(false);
        setExpanded(false);
        setIsModelSelectOpen(false);
      }
    };

    // Submits arbitrary text (the fan's quick prompts bypass the current draft entirely, same as
    // the old ChatComposer's onSend(prompt)); falls back to the live value for a normal send.
    const submitText = (text) => {
      if (isLoading) return;
      const trimmed = (text ?? value).trim();
      if (!trimmed && !hasAttachments && !hasExternalAttachments) return;
      setIsSmoothResize(false);
      onSubmit?.(trimmed, {
        model: selectedModelObj?.id,
        effort: hasEfforts ? efforts[effortIndex] : undefined,
        attachments: attachments.map((a) => a.file),
      });
      handleValueChange('');
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
      setAttachments([]);
      setExpanded(false);
      setIsModelSelectOpen(false);
    };

    const handleSubmit = () => submitText(value);

    const cycleEffort = (e) => {
      e.stopPropagation();
      setEffortIndex((prev) => (prev + 1) % efforts.length);
    };

    const openFileChooser = (e) => {
      e.stopPropagation();
      fileInputRef.current?.click();
    };

    const handleFilesChosen = async (e) => {
      const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith('image/'));
      e.target.value = '';

      if (files.length === 0) return;
      const room = Math.max(0, maxAttachments - attachments.length);
      const accepted = files.slice(0, room);

      if (!expanded) { setIsSmoothResize(false); setExpanded(true); }
      else { setIsSmoothResize(true); }

      for (const file of accepted) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => addAttachment(file, url, img.naturalWidth, img.naturalHeight);
        img.onerror = () => addAttachment(file, url, 800, 600);
        img.src = url;
      }
    };

    const addAttachment = (file, url, width, height) => {
      const id = `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`;
      setAttachments((prev) => [...prev, { id, file, url, name: file.name, width, height }]);
    };

    const removeAttachment = (id) => {
      setIsSmoothResize(true);
      setAttachments((prev) => {
        const target = prev.find((a) => a.id === id);
        if (target) URL.revokeObjectURL(target.url);
        return prev.filter((a) => a.id !== id);
      });
      thumbRefs.current.delete(id);
    };

    // --- Hover-fan quick-prompt selector (ported from ChatComposer) ---
    const handleSendHoverEnter = () => {
      if (!hasAiReplied || isLoading || isRecording) return;
      if (dwellTimerRef.current) clearTimeout(dwellTimerRef.current);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
        leaveTimerRef.current = null;
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
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => {
        setIsFanOpen(false);
        if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
        const maxCloseDelay = Math.max(...TAB_TIERS.map((t) => t.closeDelay));
        closeTimerRef.current = setTimeout(
          () => setShowQuickPrompts(false),
          DEPLOY_MS + maxCloseDelay + 40,
        );
      }, LEAVE_GRACE_MS);
    };

    useEffect(() => {
      if (!showQuickPrompts) return;
      const id = requestAnimationFrame(() => setIsFanOpen(true));
      return () => cancelAnimationFrame(id);
    }, [showQuickPrompts]);

    // Calculate action button states
    const canRecord = showVoice && !isLoading;
    const showStop = isRecording;
    const showTranscribing = isTranscribing && !isRecording;
    const showSpinner = showTranscribing || (isLoading && !isSending && !isRecording);
    // isSending forces the arrow to stay put (instead of morphing to the mic the instant the
    // draft clears) so its launch animation can finish and fire onSendAnimationEnd — otherwise
    // the parent's isSending flag never resets and the loading spinner breaks on every message
    // after the first.
    const showMic = !hasValue && canRecord && !isRecording && !showSpinner && !isSending;
    const showArrow = !showStop && !showSpinner && !showMic;

    const onActionButtonClick = (e) => {
      e.preventDefault();
      if (isRecording) {
        if (isRealVoice) stopRealRecording(); else stopRecording();
      } else if (hasValue) {
        handleSubmit();
      } else if (canRecord) {
        if (isRealVoice) startRealRecording(); else startRecording();
      }
    };

    return (
      <>
        {/* Outer Wrapper for positioning and max-width scaling */}
        <div
          ref={(node) => {
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
            internalContainerRef.current = node;
          }}
          onBlur={handleBlur}
          className={cn('relative flex flex-col w-full', className)}
          style={{
            maxWidth: expanded ? 760 : 480,
            transition: isSmoothResize ? 'max-width 0.15s ease-out' : 'max-width 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
          }}
        >
          {!isExternalAttach && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleFilesChosen}
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
            />
          )}
          {isExternalAttach && (
            <>
              <input
                ref={attachInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={onAttachChange}
                accept=".pdf,.txt,.md,.docx,.pptx"
                tabIndex={-1}
                aria-hidden="true"
              />
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={onImageChange}
                tabIndex={-1}
                aria-hidden="true"
              />
            </>
          )}

          {/* Quote-reply chip (group chat) — sits above everything else, cancel returns focus to a fresh draft. */}
          {quoteReply && (
            <div className="mb-2 flex items-center gap-3 rounded-xl border-l-2 border-[#FA6C43] bg-[#F9D0C4]/20 pl-3 pr-2 py-2 animate-chip-in">
              <div className="flex-1 min-w-0">
                <span className="block text-[11px] font-bold text-[#C2410C] truncate">Replying to {quoteReply.sender}</span>
                <span className="block text-[12px] text-gray-500 truncate">{quoteReply.text}</span>
              </div>
              <button
                type="button"
                onClick={onCancelQuoteReply}
                title="Cancel reply"
                className="p-1.5 rounded-lg text-gray-400 hover:text-[#FA6C43] hover:bg-white transition-colors"
              >
                <FiX className="text-sm" />
              </button>
            </div>
          )}

          {/* Externally-supplied attachment chips (KB file chips, URL-detected chips, ...) —
              simple wrapping row, independent of the internal image-blob strip below. */}
          {hasExternalAttachments && (
            <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
              {attachmentsSlot}
            </div>
          )}

          {/* Independent Attachment Tab (Slides up from behind the prompt input) — internal
              client-side image-blob attachments only (landing demo). */}
          <div
            aria-hidden={!hasAttachments}
            style={{
              height: hasAttachments && expanded ? 68 : 0,
              transition: isSmoothResize
                ? 'height 0.15s ease-out'
                : 'height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            }}
            className="w-full relative z-0 overflow-hidden"
          >
            <div
              style={{
                position: 'absolute',
                bottom: -8,
                left: 20,
                right: 20,
                height: 68,
                transform: hasAttachments && expanded ? 'translateY(0)' : 'translateY(100%)',
                opacity: hasAttachments && expanded ? 1 : 0,
                transition: isSmoothResize
                  ? 'transform 0.15s ease-out, opacity 0.15s ease-out'
                  : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.3s ease-out',
              }}
              className="border border-gray-200 border-b-0 bg-[#F5F3EE] rounded-t-2xl px-2 pt-2 pb-1 flex items-start gap-2 overflow-x-auto prompt-scrollbar"
            >
              {attachments.map((attachment, index) => (
                <AttachmentThumb
                  key={attachment.id}
                  attachment={attachment}
                  index={index}
                  onRemove={removeAttachment}
                  onOpen={(a, rect) => setActiveAttachment({ attachment: a, rect })}
                  registerRef={(id, el) => thumbRefs.current.set(id, el)}
                />
              ))}
            </div>
          </div>

          {/* Main Input Card */}
          <div
            onMouseDown={(e) => {
              const isTextarea = e.target === textareaRef.current;
              if (expanded && !isTextarea && !isRecording) {
                e.preventDefault();
                if (showEquation) richInputRef.current?.focus();
                else textareaRef.current?.focus();
              }
            }}
            style={{
              borderRadius: 24,
              height: expanded ? containerHeight : 48,
              transition: isSmoothResize ? SMOOTH_HEIGHT_TRANSITION : SPRING_TRANSITION,
            }}
            className={cn(
              'relative w-full border border-gray-200 bg-white shadow-sm focus-within:border-[#FA6C43] hover:border-gray-300 z-10',
              expanded ? 'cursor-text' : 'cursor-default'
            )}
          >
            {/* Clipping lives on its own inset layer, not the bordered card above —
                a border and an overflow clip on the same box anti-alias their curves
                slightly differently, which showed up as a faint second border just
                inside the real one. */}
            <div
              className="absolute inset-0"
              style={{ borderRadius: 23, overflow: expanded ? 'visible' : 'hidden' }}
            >
            <style dangerouslySetInnerHTML={{ __html: `
              .prompt-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-track { background: transparent; }
              .prompt-scrollbar::-webkit-scrollbar-thumb { background: transparent; border-radius: 4px; }
              .prompt-scrollbar:hover::-webkit-scrollbar-thumb { background: rgba(31,31,31,0.25); }
              .prompt-scrollbar, .prompt-scrollbar:focus { border: none; box-shadow: none; }
            `}} />

            {showEquation ? (
              <RichMathInput
                ref={richInputRef}
                domRef={textareaRef}
                value={value}
                onChange={handleValueChange}
                onSend={handleSubmit}
                onPaste={onPaste}
                placeholder={expanded ? placeholder : ''}
                disabled={isRecording || isLoading}
                className={cn(
                  'prompt-scrollbar absolute top-0 inset-x-0 z-[1] w-full pl-4 pr-14 py-3.5 text-sm leading-[22px] text-[#1F1F1F] outline-none cursor-text',
                  expanded ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1 pointer-events-none',
                  isScrolling ? 'overflow-y-auto' : 'overflow-y-hidden'
                )}
              />
            ) : (
              <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => handleValueChange(e.target.value)}
                onScroll={updateFades}
                onPaste={onPaste}
                onKeyDown={(e) => {
                  // Enter mid-IME-composition (Chinese/Japanese) confirms the candidate, it must not send.
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                  if (e.key === 'Escape' && value.trim() === '' && !hasAttachments && !hasExternalAttachments) {
                    setIsSmoothResize(false);
                    setExpanded(false);
                    setIsModelSelectOpen(false);
                  }
                }}
                placeholder={placeholder}
                aria-label="Prompt"
                disabled={isRecording || isLoading}
                style={{
                  transition: isSmoothResize
                    ? 'height 0.15s ease-out'
                    : 'opacity 0.3s ease-out, transform 0.3s ease-out, height 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                }}
                className={cn(
                  'prompt-scrollbar absolute top-0 inset-x-0 z-[1] w-full resize-none bg-transparent pl-4 pr-14 py-3.5 text-sm leading-[22px] text-[#1F1F1F] outline-none placeholder:font-medium placeholder:text-gray-400 cursor-text',
                  expanded ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 -translate-y-1 pointer-events-none',
                  isScrolling ? 'overflow-y-auto' : 'overflow-y-hidden',
                  isRecording && 'pointer-events-none'
                )}
              />
            )}

            <div
              ref={topFadeRef}
              className="absolute left-4 right-14 top-0 z-[2] h-8 bg-gradient-to-b from-white via-white/90 to-transparent pointer-events-none"
            />
            <div
              ref={bottomFadeRef}
              className="absolute left-4 right-14 z-[2] h-8 bg-gradient-to-t from-white via-white/90 to-transparent pointer-events-none"
              style={{
                opacity: 0,
                top: `${textareaHeight - 32}px`,
                transition: isSmoothResize ? 'top 0.15s ease-out' : 'top 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
              }}
            />

            <button
              type="button"
              onClick={expand}
              style={{ transition: isSmoothResize ? 'none' : 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)' }}
              className={cn(
                'absolute inset-x-0 top-0 z-[1] cursor-text pl-4 pr-14 py-[15px] text-left text-sm font-medium leading-[17px] text-gray-400 outline-none',
                !expanded ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-105 translate-y-1 pointer-events-none'
              )}
              aria-label="Open prompt input"
            >
              {placeholder}
            </button>

            {/* Bottom Actions Wrapper - Hides when recording to make space for visualizer */}
            <div
              className={cn(
                'absolute bottom-2 left-3 right-14 z-[10] flex items-center gap-0 transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
                expanded && !isRecording ? 'opacity-100 blur-0 translate-y-0 pointer-events-auto' : 'opacity-0 blur-sm translate-y-2 pointer-events-none'
              )}
            >
              {normalizedModels.length > 0 && (
                <div className="relative">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsModelSelectOpen((prev) => !prev);
                    }}
                    className={cn(
                      'group flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[#1F1F1F]/50 transition-all duration-200 outline-none hover:bg-gray-100 hover:text-[#1F1F1F] cursor-default',
                      isModelSelectOpen ? 'bg-gray-100 text-[#1F1F1F]' : ''
                    )}
                    aria-label={`Select model. Current: ${selectedModelObj?.label}`}
                  >
                    <ModelIcon className="size-4 opacity-70 group-hover:opacity-100 transition-opacity" />
                    <span className="text-xs font-semibold select-none transition-colors">
                      <MorphingText text={selectedModelObj?.label} />
                    </span>
                  </button>

                  <div
                    style={{ transformOrigin: 'bottom left' }}
                    onMouseLeave={() => {
                      setHoverStyle((prev) => ({
                        ...prev, opacity: 0, transform: prev.transform.replace('scale(1)', 'scale(0.95)'), transition: 'opacity 0.2s ease-in, transform 0.2s ease-out',
                      }));
                    }}
                    className={cn(
                      'absolute bottom-full left-0 mb-2.5 z-50 w-48 rounded-2xl border border-gray-200 bg-white/95 p-1 shadow-xl backdrop-blur-md flex flex-col gap-0.5 transition-all duration-400 cursor-default',
                      isModelSelectOpen
                        ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto ease-[cubic-bezier(0.34,1.56,0.64,1)]'
                        : 'opacity-0 scale-95 translate-y-3 pointer-events-none ease-[cubic-bezier(0.175,0.885,0.32,1.275)]'
                    )}
                  >
                    <div className="relative flex flex-col gap-0.5">
                      <div style={hoverStyle} className="absolute left-0 right-0 top-0 h-8 -z-10 rounded-xl bg-gray-100 pointer-events-none" />
                      {normalizedModels.map((m, idx) => (
                        <button
                          key={m.id}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseEnter={() => {
                            setHoverStyle((prev) => ({
                              opacity: 1, transform: `translateY(${idx * 34}px) scale(1)`,
                              transition: prev.opacity === 0 ? 'opacity 0.15s ease-out' : 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.15s ease',
                            }));
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isModelControlled) onModelChange(m.id); else setInternalModelId(m.id);
                            setIsModelSelectOpen(false);
                          }}
                          className="group relative flex h-8 w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs font-medium text-[#1F1F1F]/80 outline-none active:scale-[0.98] cursor-default"
                        >
                          <span className="flex items-center gap-2">
                            <ModelIcon className="size-3.5 opacity-85 group-hover:opacity-100 transition-opacity" />
                            {m.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {hasEfforts && (
                <button
                  type="button" onMouseDown={(e) => e.preventDefault()} onClick={cycleEffort}
                  className="group flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[#1F1F1F]/50 transition-all duration-200 hover:bg-gray-100 hover:text-[#1F1F1F] outline-none cursor-default"
                >
                  <DynamicBarsIcon level={efforts[effortIndex]} />
                  <span className="text-xs font-semibold select-none transition-colors"><MorphingText text={efforts[effortIndex]} /></span>
                </button>
              )}

              <div className="ml-auto flex items-center gap-0.5">
                {showAttach && showEquation && (
                  <button
                    type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => richInputRef.current?.insertMath()}
                    disabled={isLoading}
                    title="Insert equation"
                    className="flex size-8 items-center justify-center rounded-full text-[#1F1F1F]/50 transition-all duration-200 hover:bg-gray-100 hover:text-[#1F1F1F] outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <TbMathFunction className="text-base" />
                  </button>
                )}
                {showAttach && isExternalAttach && (
                  <>
                    <button
                      type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={onAttachPick}
                      disabled={isUploading}
                      title="Attach files"
                      className="flex size-8 items-center justify-center rounded-full text-[#1F1F1F]/50 transition-all duration-200 hover:bg-gray-100 hover:text-[#1F1F1F] outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {isUploading ? <FaSpinner className="animate-spin text-base" /> : <FiPaperclip className="text-base" />}
                    </button>
                    <button
                      type="button" onMouseDown={(e) => e.preventDefault()}
                      onClick={() => imageInputRef?.current?.click()}
                      disabled={isUploading}
                      title="Attach image"
                      className="flex size-8 items-center justify-center rounded-full text-[#1F1F1F]/50 transition-all duration-200 hover:bg-gray-100 hover:text-[#1F1F1F] outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <FiImage className="text-base" />
                    </button>
                  </>
                )}
                {showAttach && !isExternalAttach && (
                  <button
                    type="button" onMouseDown={(e) => e.preventDefault()} onClick={openFileChooser} disabled={attachments.length >= maxAttachments}
                    className="flex size-8 items-center justify-center rounded-full text-[#1F1F1F]/50 transition-all duration-200 hover:bg-gray-100 hover:text-[#1F1F1F] outline-none cursor-default disabled:opacity-40 disabled:pointer-events-none"
                  >
                    <PlusIcon />
                  </button>
                )}
              </div>
            </div>

            {/* Audio Wave Visualizer Overlay — demo path only; real MediaRecorder mode has no
                live level data without a second AudioContext analyser, so it just shows the
                red stop icon on the action button while recording. */}
            {!isRealVoice && (
              <div
                className={cn(
                  'absolute right-14 bottom-2 z-[10] flex h-8 items-center justify-end gap-[3px] transition-all duration-400 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]',
                  isRecording ? 'w-16 opacity-100 translate-x-0' : 'w-0 opacity-0 translate-x-4 pointer-events-none'
                )}
              >
                {audioData.map((val, i) => (
                  <div
                    key={i}
                    className="w-1 rounded-full bg-[#FA6C43] transition-[height] duration-75 ease-out"
                    style={{ height: `${Math.max(4, val * 24)}px` }}
                  />
                ))}
              </div>
            )}

            {/* Action button + hover-fan quick-prompt selector, wrapped together so the fan can
                anchor off the button's own position (ported from ChatComposer's send button). */}
            <div
              className="absolute right-2 bottom-2 z-[10]"
              onMouseEnter={handleSendHoverEnter}
              onMouseLeave={handleSendHoverLeave}
            >
              {showQuickPrompts && (
                <div
                  className="absolute bottom-1/2 right-0 pointer-events-none z-0"
                  style={{ width: 0, height: 0 }}
                  aria-hidden={!isFanOpen}
                >
                  {promptList.map((prompt, i) => {
                    const tier = TAB_TIERS[i] || TAB_TIERS[TAB_TIERS.length - 1];
                    const targetTransform = `translate(-100%, calc(-50% + ${tier.dy}px))`;
                    const restTransform = 'translate(-100%, -50%)';
                    const delay = isFanOpen ? tier.deployDelay : tier.closeDelay;
                    return (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => {
                          handleSendHoverLeave();
                          submitText(prompt);
                        }}
                        className={`absolute left-0 top-0 whitespace-nowrap px-4 py-1.5 rounded-full bg-white text-sm font-medium text-[#1F1F1F] border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] shadow-md ${isFanOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
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
                type="button"
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onClick={onActionButtonClick}
                disabled={showSpinner || (!hasValue && !canRecord && !isRecording)}
                aria-label={showArrow ? 'Send prompt' : showStop ? 'Stop recording' : showSpinner ? 'Working' : 'Use voice input'}
                style={{ borderRadius: 9999 }}
                className={cn(
                  'relative flex h-9 w-9 items-center justify-center bg-[#FA6C43] text-white transition-all duration-300 hover:bg-[#E55B34] outline-none focus-visible:ring-2 focus-visible:ring-[#F9D0C4] cursor-default disabled:opacity-50',
                  isPulsing && 'animate-send-pulse'
                )}
              >
                <span className="relative flex h-full w-full items-center justify-center">
                  <span className={cn('absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]', showArrow ? 'opacity-100 scale-100 rotate-0 blur-none' : 'opacity-0 scale-50 rotate-45 blur-[1px] pointer-events-none')}>
                    <span className={isSending ? 'animate-send-launch' : ''} onAnimationEnd={isSending ? onSendAnimationEnd : undefined}>
                      <ArrowUpIcon />
                    </span>
                  </span>
                  <span className={cn('absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]', showMic ? 'opacity-100 scale-100 rotate-0 blur-none' : 'opacity-0 scale-50 -rotate-45 blur-[1px] pointer-events-none')}>
                    <MicIcon />
                  </span>
                  <span className={cn('absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]', showStop ? 'opacity-100 scale-100 rotate-0 blur-none' : 'opacity-0 scale-50 rotate-45 blur-[1px] pointer-events-none')}>
                    <StopIcon />
                  </span>
                  <span className={cn('absolute inset-0 flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)]', showSpinner ? 'opacity-100 scale-100 rotate-0 blur-none' : 'opacity-0 scale-50 rotate-45 blur-[1px] pointer-events-none')}>
                    <FaSpinner className="animate-spin text-sm" />
                  </span>
                </span>
              </button>
            </div>
            </div>
          </div>
        </div>

        {activeAttachment && (
          <AttachmentGalleryModal
            attachment={activeAttachment.attachment} originRect={activeAttachment.rect} onClose={() => setActiveAttachment(null)}
          />
        )}
      </>
    );
  }
);

PromptInput.displayName = 'PromptInput';
