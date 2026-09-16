// @language JavaScript (React)
// @updated 2026-09-16
// @changed Reverted the section order again: HERO is back above TRY IT so "ACTRLabs" is the first
//          thing visible. HERO dropped its h-screen/justify-end (bottom-anchored, full-viewport)
//          treatment for a compact top-anchored one — the wordmark now renders immediately below the
//          nav instead of needing a full scroll's worth of empty space to resolve at the bottom.
//          HERO and TRY IT both switched from a hard-locked #FFFFFF to the page's default #FAFAF7 (same
//          as PHILOSOPHY below them), removing the seam/color-disconnect between the hero area and
//          the scroll-driven philosophy text.
// @changed Prior: Swapped section order: TRY IT (composer) now sits above HERO instead of below it, so a
//          visitor can start typing before the wordmark scrolls in. Fixed the "ACTRLabs" heading
//          overflowing into the pitch-text column beside it — its fontSize clamp was scaled off
//          100vw (13vw/200px cap) instead of the ~66vw its lg:col-span-8 column actually gets, so it
//          rendered wider than the column at common desktop widths. Recalibrated to clamp(56px, 9vw,
//          150px), which fits the column across breakpoints. No padding/whitespace values changed.
// @changed Prior: Copy pass across the whole page: dropped every em dash from user-facing text in favor of
//          periods/commas, and rewrote PHILOSOPHY_PARAGRAPHS as plain full sentences instead of the
//          "icons as language" inline-image tokens (research-study clipboard, sprockets, iPad,
//          laptop, wifi) — those read as clutter rather than language, and the paragraphs are now
//          longer/fuller as a result. Rendering logic for the token array is untouched; it already
//          no-ops on tokens without a `src`.
// @changed Prior: Bento grid's third cell (was "Built to Be Studied," generic research-logging copy) is
//          now "Exports Straight to Qualtrics" — resolves the open question from the manager-
//          feedback pass about where Qualtrics belongs (bento cell, not the course-sync section).
//          Reuses the survey-clipboard icon, which fits a Qualtrics pitch even better than the
//          cell it replaced. Mirrors the "chat logs export straight to Qualtrics" phrasing already
//          in the Teachers testimonial quote, for consistency.
//          Prior: PromptInput is back, as its own "Try it yourself" section right after the hero instead
//          of living inside it — same composer/credits/register-modal logic as before, just
//          re-homed and restyled for a light bg instead of the old dark hero. AnimatedGradient
//          (components/ui/animated-gradient.jsx) is deleted outright — confirmed nothing else in
//          the app imported it, and unlike PromptInput there was no reason to keep a WebGL shader
//          component around "just in case."
//          Prior: Manager-feedback pass. Hero fully replaced: the scroll-revealed dark mass (GSAP
//          clip-path timeline + continuous WebGL2 shader + PromptInput chat composer + a
//          per-keystroke typewriter effect) is gone, swapped for a static white hero modeled on a
//          template the team supplied — a giant word-by-word pull-up (new
//          components/ui/words-pull-up.jsx, framer-motion, fires once on scroll-into-view) of
//          "ACTRLabs" itself, plus a short pitch + a "Get started" CTA. This is also the fix for
//          the reported browser-overload: that hero was 3-4 independent animation systems running
//          concurrently on load, not counting the rest of the page's own GSAP work. The nav no
//          longer fades in on scroll — it's visible from the first frame now, which is the actual
//          fix for "make sure people know they've landed on the right page." Removed with the
//          composer: MODEL_OPTIONS, HERO_PROMPTS, LANDING_FREE_CREDITS, the /api/usage/me credits
//          fetch, and the register-gate modal (nothing left to gate — there's no free-chat demo in
//          the hero to hit a credit limit on). PHILOSOPHY_PARAGRAPHS rewritten to speak to
//          educators/researchers building simulations, not students studying. TESTIMONIAL_PANELS
//          drops the student entry; the audience accordion (one expanded, two collapsed to a rail,
//          auto-rotating every 7s) is replaced by a static 2-column side-by-side layout — no
//          activePanel state, both videos autoplay together once in view. App.jsx's root route now
//          points here instead of /home (reusing the existing isLoggedIn()-based RootRedirect
//          pattern, not a new auth mechanism).
//          Prior: Hero gradient bugfix + recolor: the AnimatedGradient config/noise/style objects were
//          inline JSX literals, so every LandingV2 re-render (incl. every ~22-42ms keystroke of the
//          hero typewriter effect) gave AnimatedGradient a new `config` reference, and its WebGL
//          setup effect depends on that — tearing down and rebuilding the whole GL program and
//          resetting elapsed time constantly. That was the "jittery, loops every 2s" bug, not a
//          shader/perf issue. Hoisted to module-level HERO_GRADIENT_CONFIG/NOISE/STYLE constants so
//          the reference is stable across renders. Also swapped color2 from orange (#FA6C43) to
//          gray (#8C8C8C) and eased motion params (speed/distortion/swirl/iterations all down) per
//          request for a calmer feel now that the actual stutter is fixed.
//          Prior: Dark overlay (the fixed black fill behind the hero, clip-path-revealed on scroll)
//          now fills with a live WebGL2 shader gradient (new components/ui/animated-gradient.jsx,
//          ported from a 21st.dev demo) in brand black/orange, instead of a flat #1F1F1F. The
//          clip-path + opacity scroll animation on darkOverlayRef is untouched — only its fill changed.
//          Prior: Students testimonial panel: swapped placeholder (Sarah Chen) for a real student,
//          Ekramul Haque Khan (Chemical Engineering, HKUST), with his photo as avatar + video poster.
//          Prior: Features (bento) section rebuilt from solid pastel tiles into a hairline-bordered "case study"
//          style panel (one outer container, split featured row + 4-cell grid row), with fresh
//          learning/research-focused copy. SmallFeatureTile replaced by BentoCell + BENTO_CELLS.
//          Prior: Composer wrapper: items-start -> items-center + mx-auto. It was left-anchoring the credits bar
//          and PromptInput, so the expand-on-focus width transition (400px -> 640px) only grew rightward
//          from a fixed left edge instead of outward from a shared center; items-center recenters the
//          child continuously as its width animates, which also fixes the whole block reading as left-of-
//          center instead of centered in the hero.
//          Prior: Composer wrapper: added w-full max-w-2xl. It sits in a `flex items-center` column (the hero
//          content stack), which doesn't stretch children to full width — the wrapper had no explicit
//          width at all, so it (and PromptInput's own w-full inside it) collapsed to shrink-fit content
//          instead of ever reaching PromptInput's 400/640px caps. This is why two rounds of widening
//          PromptInput's own max-width did nothing: the real bottleneck was one level up, here.
//          Prior: Hero composer rebuilt around PromptInput (components/ui/ai-chat-input, ported from a 21st.dev
//          demo): real expand/collapse pill, working attachment picker + gallery, real browser voice-to-
//          text, all using the real MODEL_OPTIONS list. Replaces the old always-open white card + dead
//          attach/voice buttons. Credits bar restyled to sit on the dark hero directly (was inside the old
//          shared white card); register-modal prompt preview now reads a `lastPrompt` snapshot taken at
//          submit time, since PromptInput clears its own value once onSubmit returns.
//          Prior: Testimonial video panel: dropped its box-shadow. "See it in action" heading:
//          mb-4 -> mb-24 so it isn't nearly touching the tilted screenshot card below it
//          (Card's own -mt-12 was pulling the card up further than the old margin allowed for).
//          Prior: Added a product-showcase section (ContainerScroll, Framer Motion) between the
//          testimonial panels and the closer, revealing a real dashboard screenshot instead
//          of leaving the "show the product" gap from the locked spec unfilled.
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { motion } from 'framer-motion';
import { FaArrowRight } from 'react-icons/fa';
import { ContainerScroll } from '../components/ui/container-scroll-animation';
import { PromptInput } from '../components/ui/ai-chat-input';
import { WordsPullUp } from '../components/ui/words-pull-up';

// Plain identifiers so the hero's JSX tags aren't member expressions
// (<motion.p>) — this project's eslint config has no react/JSX-aware
// no-unused-vars handling, which otherwise flags `motion` as unused despite
// being referenced only via a tag name.
const MotionP = motion.p;
const MotionDiv = motion.div;

gsap.registerPlugin(ScrollTrigger);

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";
const FONT_SERIF = "'Newsreader', Georgia, serif";
const FONT_SCRIPT = "'Caveat', 'Segoe Script', cursive";

// Placeholder prompts cycled by the "Try it" composer's typewriter effect.
const HERO_PROMPTS = [
  'Explain the first law of thermodynamics',
  'Type 1 vs Type 2 Bipolar disorder?',
  'Walk me through CRISPR gene editing',
  'Why did the Roman Empire fall?',
  'Derive the Black-Scholes equation',
];

// Free credits we promise on the landing (1 message = 1 credit). The
// backend's anon_lifetime_cap is the safety net (usually larger); this is
// the smaller display cap that drives the credits bar + register-gate copy.
const LANDING_FREE_CREDITS = 2;

// Models a free user can pick straight from the composer. Subset of the
// backend ALLOWED_MODELS (usage/limits.py) — sent as model_override.
const MODEL_OPTIONS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'gpt-4.1', label: 'GPT-4.1' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'deepseek-chat', label: 'Deepseek Chat' },
];

const UVPS = [
  {
    id: 'syllabus',
    icon: '/illustrations/icon-question.png',
    iconAlt: 'Question mark',
    headline: 'No PDF hassles anymore.',
    body:
      'Stop the tedious cycle of downloading, organizing, and manually uploading course materials. Actrlabs connects directly to your Canvas dashboard, pulling your lecture notes, syllabi, and readings in real-time.',
    side: 'left',
  },
  {
    id: 'models',
    icon: '/illustrations/icon-pencil.png',
    iconAlt: 'Pencil',
    headline: 'Your Intelligence, Your Terms.',
    body:
      'Stop paying for multiple subscriptions just to access the best tools. Actrlabs breaks the platform lock-in by giving you unified access to the leading state-of-the-art AI models, all in one place.',
    side: 'right',
  },
  {
    id: 'research',
    icon: '/illustrations/icon-glasses.png',
    iconAlt: 'Glasses',
    headline: 'Test. Iterate. Evolve.',
    body:
      'We provide a dedicated sandbox where students, educators, and researchers can observe how AI interacts with academic content in real-time.',
    side: 'left',
  },
];

// Feature cell for the redesigned "case study" style bento — a hairline-
// bordered grid cell (illustration + headline + body + arrow link) instead
// of a solid pastel tile. `borderRight` is dropped on the last cell in a row
// so the outer container's own border closes off the edge.
const BentoCell = ({ icon, iconAlt, title, body, linkLabel, borderRight = true }) => (
  <div
    className={`group relative flex flex-col justify-between gap-8 p-8 lg:p-9 border-t lg:border-t-0 first:border-t-0 transition-colors duration-300 hover:bg-[#FAFAF7] ${
      borderRight ? 'lg:border-r' : ''
    }`}
    style={{ borderColor: 'rgba(31,31,31,0.08)' }}
  >
    <img src={icon} alt={iconAlt} className="w-10 h-10" draggable={false} />
    <div>
      <h3
        className="text-xl tracking-tight mb-2.5"
        style={{ color: '#1F1F1F', fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: '-0.02em' }}
      >
        {title}
      </h3>
      <p
        className="text-[15px] leading-snug mb-5"
        style={{ color: '#1F1F1F', fontFamily: FONT_BODY, fontWeight: 500 }}
      >
        {body}
      </p>
      <span
        className="inline-flex items-center gap-1.5 text-sm font-semibold"
        style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
      >
        {linkLabel}
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          className="transition-transform duration-300 group-hover:translate-x-1"
        >
          <path
            d="M3 7h8M7 3l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  </div>
);

const BENTO_CELLS = [
  {
    id: 'models',
    icon: '/illustrations/wifi-internet.svg',
    iconAlt: 'Connection icon',
    title: 'Any Model, One Login',
    body: 'Run the same question through Claude, GPT-4o, or Gemini without juggling separate subscriptions or tabs.',
    linkLabel: 'Compare the models',
  },
  {
    id: 'citations',
    icon: '/illustrations/magnifying-glass.svg',
    iconAlt: 'Magnifying glass icon',
    title: 'Every Answer, Footnoted',
    body: 'No more chasing down where a claim came from. Each response links straight back to the page or passage it was pulled from.',
    linkLabel: 'See a real citation',
  },
  {
    id: 'qualtrics',
    icon: '/illustrations/survey-clipboard-research.svg',
    iconAlt: 'Survey clipboard icon',
    title: 'Exports Straight to Qualtrics',
    body: 'Every chat log, response, and score syncs directly into Qualtrics. No manual exports, no reformatting, just data your IRB already trusts.',
    linkLabel: 'See the Qualtrics export',
  },
];

// SyllabusMockup lives in the right half of the Canvas hero tile and
// positions its Canvas cards absolutely. Negative right offsets bleed
// past the tile's outer edge and get clipped by the tile's
// overflow:hidden — that's the "tilted card peeking off the corner"
// effect.
const SyllabusFileRow = ({ type, name, status }) => {
  const typeColors = {
    PDF: '#C8472A',
    DOCX: '#3E6493',
    PPT: '#A8832D',
  };
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-gray-50">
      <span
        className="text-[8px] font-bold px-1.5 py-0.5 rounded text-white"
        style={{ backgroundColor: typeColors[type] || '#888' }}
      >
        {type}
      </span>
      <span className="text-[10px] text-gray-800 flex-1 truncate">{name}</span>
      {status === 'syncing' ? (
        <span
          className="w-3 h-3 rounded-full border-2 border-gray-300 border-t-[#FA6C43]"
          style={{ animation: 'landing-spin 1s linear infinite' }}
          aria-hidden
        />
      ) : (
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
          <circle cx="6" cy="6" r="6" fill="#10A37F" />
          <path d="M3.5 6.2l1.7 1.6 3.3-3.4" stroke="#fff" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
};

const SyllabusMockup = () => (
  <>
    {/* Tilted secondary course card peeking behind */}
    <div
      className="absolute bottom-[200px] right-[-30px] w-[240px] bg-white rounded-xl shadow-lg border border-gray-200 p-3 pointer-events-none"
      style={{ transform: 'rotate(6deg)', fontFamily: FONT_BODY }}
      aria-hidden
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#A8832D' }} />
        <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500">HIST 204</span>
      </div>
      <div className="h-1.5 bg-gray-200 rounded mb-1.5"></div>
      <div className="h-1.5 bg-gray-100 rounded w-3/4"></div>
    </div>

    {/* Main Canvas-styled course panel */}
    <div
      className="absolute bottom-[20px] right-[-10px] w-[340px] bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden pointer-events-none"
      style={{ transform: 'rotate(-3deg)', fontFamily: FONT_BODY }}
      aria-hidden
    >
      {/* Canvas-styled header */}
      <div
        className="px-3.5 py-2.5 flex items-center justify-between"
        style={{ backgroundColor: '#C8472A' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-white/95 flex items-center justify-center">
            <span className="text-[10px] font-black" style={{ color: '#C8472A' }}>C</span>
          </div>
          <span className="text-[11px] font-bold text-white tracking-wide">Canvas</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-white/95" style={{ animation: 'landing-pulse-dot 1.8s ease-in-out infinite' }} />
          <span className="text-[9px] font-semibold text-white/95 uppercase tracking-wider">Live</span>
        </div>
      </div>

      {/* Course title row */}
      <div className="px-3.5 pt-3 pb-2 border-b border-gray-100">
        <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400 mb-0.5">PSYC 301</div>
        <div className="text-[12px] font-bold text-gray-800">Research Methods · Fall</div>
      </div>

      {/* File list */}
      <div className="px-2 py-2 space-y-0.5">
        <SyllabusFileRow type="PDF"  name="lecture-3-hypothesis.pdf" status="synced" />
        <SyllabusFileRow type="DOCX" name="syllabus-v2.docx"          status="synced" />
        <SyllabusFileRow type="PPT"  name="week-4-anova.pptx"         status="syncing" />
        <SyllabusFileRow type="PDF"  name="reading-list.pdf"          status="synced" />
      </div>

      {/* Footer */}
      <div className="px-3.5 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
        <span className="text-[9px] text-gray-500">Auto-sync every 5 min</span>
        <span className="text-[9px] font-semibold" style={{ color: '#10A37F' }}>4 files ready</span>
      </div>
    </div>
  </>
);

// Two audience panels, shown side by side (no accordion — the student
// panel was dropped, and two panels fit on screen at once with room to
// breathe). Each renders a real testimonial: name, role + university pill,
// contextual quote, and an autoplay portrait video of the person speaking.
// Drop a recording at /testimonials/<id>.mp4 (with matching .jpg poster)
// and it lights up — the dark frame bg keeps an empty video looking
// intentional until the file lands.
// Panel bg colors match the bento tile pastels for visual cohesion.
const TESTIMONIAL_PANELS = [
  {
    id: 'teachers',
    title: 'Teachers',
    name: 'T. Bradford Bitterly',
    role: 'Assistant Professor',
    university: 'HKUST',
    quote:
      'ACTRLabs lets me design custom activities that give my students more individualized feedback than I could offer alone. For research, I can build interactive studies that were previously unfeasible, and chat logs export straight to Qualtrics.',
    videoSrc: '/testimonials/teachers.mp4',
    posterSrc: '/testimonials/teachers.jpg',
    avatarSrc: '/testimonials/bitterly.jpg',
    bg: '#F4ECD8',
    accent: '#A8832D',
  },
  {
    id: 'researchers',
    title: 'Researchers',
    name: 'Dr. Priya Patel',
    role: 'Learning Sciences',
    university: 'Stanford University',
    quote:
      'For the first time, I can watch students actually reason with AI, not in a focus group, but inside the coursework itself. That kind of visibility didn’t exist before.',
    videoSrc: '/testimonials/researchers.mp4',
    posterSrc: '/testimonials/researchers.jpg',
    bg: '#D9E5F2',
    accent: '#3E6493',
  },
];

// Philosophy paragraph as an ARRAY of paragraphs, each a sequence of
// tokens (currently plain text chunks only). Splitting into separate
// paragraphs gives breathing room between thoughts and lets the
// cinematic word-by-word scrub feel less like a wall of text. The
// inline brand-icon tokens ("icons as language") were tried here and
// dropped in favor of writing the nouns out in full — the icons read
// as decorative clutter rather than language, especially in a dense
// sentence like the second paragraph below.
const PHILOSOPHY_PARAGRAPHS = [
  [
    { text: 'ACTRLabs is how educators and researchers build AI simulations and bots, without writing a line of code. What used to take a developer, a survey platform, and weeks of back and forth now takes an afternoon.' },
  ],
  [
    { text: 'Design a research study for your lab, or an interactive course simulation for your classroom, on the same platform. Both start from the same builder: set a persona, write the instructions, attach your readings, and publish.' },
  ],
  [
    { text: 'Available on iPad, laptop, and the web, so students can join from whatever device they already have open. Set it up once, and it runs itself for every student who shows up, with every conversation logged and ready to export.' },
  ],
];

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LandingV2 = () => {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const philosophyRef = useRef(null);
  const philosophyTextRef = useRef(null);
  const wordRefs = useRef([]);
  const ctaIconRefs = useRef([]);
  const ctaRef = useRef(null);
  const featureGridRef = useRef(null);

  // Tailor the document title for this route. index.html holds the
  // default/shared head; this gives the v2 landing its own title without
  // pulling in a per-route head library.
  useEffect(() => {
    const prev = document.title;
    document.title = 'ACTRLabs: AI Tutors & Chatbots That Redefine Learning';
    return () => { document.title = prev; };
  }, []);

  // Testimonial videos. Each panel renders a <video> whose ref lands in
  // this array — both autoplay (not just one) since the two panels are
  // shown side by side now, not one-at-a-time in an accordion. Gated on
  // the section being in view so it doesn't burn bandwidth before the
  // visitor scrolls this far. Browser autoplay requires muted +
  // playsInline, both set on the <video> below.
  const videoRefs = useRef([]);
  const testimonialsSectionRef = useRef(null);
  const [testimonialsInView, setTestimonialsInView] = useState(false);
  useEffect(() => {
    const el = testimonialsSectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setTestimonialsInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => setTestimonialsInView(e.isIntersecting)),
      { threshold: 0.2 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    videoRefs.current.forEach((v) => {
      if (!v) return;
      if (testimonialsInView) {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else {
        v.pause();
      }
    });
  }, [testimonialsInView]);

  // "Try it" composer (components/ui/ai-chat-input's PromptInput) — its own
  // dedicated section now, right after the hero, rather than living inside
  // it. Owns its own text/model/attachment state internally and hands it
  // back at submit time, so this page only needs to react to that
  // submission. Submit starts a real free chat against the shared
  // playground bot, carrying the typed prompt + model into ChatPage. Usage
  // caps (warn nudge + create-account block) are enforced there. The
  // register modal remains only as a fallback if the bot can't load, and
  // shows back what was typed — captured into `lastPrompt` here since
  // PromptInput clears its own value once onSubmit returns.
  const [composerSending, setComposerSending] = useState(false);
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [lastPrompt, setLastPrompt] = useState('');

  // Real credit count for the credits bar. Fetched once on mount from
  // /api/usage/me, then clamped to LANDING_FREE_CREDITS. Population other
  // than "anon" (logged-in) shows the full cap and defers to the in-chat
  // limiter.
  const [creditsRemaining, setCreditsRemaining] = useState(LANDING_FREE_CREDITS);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/usage/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.population !== 'anon' || data.cap == null || data.remaining == null) {
          setCreditsRemaining(LANDING_FREE_CREDITS);
          return;
        }
        const used = Math.max(0, data.cap - data.remaining);
        setCreditsRemaining(Math.max(0, LANDING_FREE_CREDITS - used));
      })
      .catch(() => { /* keep optimistic default */ });
    return () => { cancelled = true; };
  }, []);

  const handleComposerSubmit = async (text, meta) => {
    const trimmed = text.trim();
    if (!trimmed || composerSending) return;
    setLastPrompt(trimmed);
    if (creditsRemaining <= 0) {
      setShowRegisterModal(true);
      return;
    }
    // PromptInput only knows the model's display label — map it back to the id the backend
    // expects (model_override). Falls back to the first real model if something odd came
    // through (e.g. an empty models list).
    const modelId = MODEL_OPTIONS.find((m) => m.label === meta?.model)?.id || MODEL_OPTIONS[0].id;
    setComposerSending(true);
    try {
      const res = await fetch('/api/config/playground', { credentials: 'include' });
      if (!res.ok) throw new Error('playground unavailable');
      const { config_id } = await res.json();
      const chatId = `chat_${Date.now()}`;
      navigate(`/chat/${config_id}/${chatId}`, { state: { firstMessage: trimmed, model: modelId } });
    } catch {
      setComposerSending(false);
      setShowRegisterModal(true);
    }
  };
  useEffect(() => {
    if (!showRegisterModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowRegisterModal(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showRegisterModal]);

  // Typewriter placeholder cycling through HERO_PROMPTS. Type → hold →
  // erase → brief pause → next. Reduced-motion users see a static
  // "Ask anything…" string instead. Pure setTimeout chain — no rAF
  // needed since the cadence is character-scale, not frame-scale.
  const [typedPrompt, setTypedPrompt] = useState(HERO_PROMPTS[0]);
  useEffect(() => {
    if (reducedMotion()) {
      setTypedPrompt('Ask anything…');
      return;
    }
    let idx = 0;
    let charIdx = 0;
    let phase = 'typing';
    let timeoutId = null;
    const tick = () => {
      const full = HERO_PROMPTS[idx];
      if (phase === 'typing') {
        charIdx += 1;
        setTypedPrompt(full.slice(0, charIdx));
        if (charIdx >= full.length) {
          phase = 'holding';
          timeoutId = setTimeout(tick, 1600);
          return;
        }
        timeoutId = setTimeout(tick, 42);
      } else if (phase === 'holding') {
        phase = 'erasing';
        timeoutId = setTimeout(tick, 22);
      } else if (phase === 'erasing') {
        charIdx -= 1;
        setTypedPrompt(full.slice(0, Math.max(0, charIdx)));
        if (charIdx <= 0) {
          phase = 'typing';
          idx = (idx + 1) % HERO_PROMPTS.length;
          charIdx = 0;
          timeoutId = setTimeout(tick, 320);
          return;
        }
        timeoutId = setTimeout(tick, 22);
      }
    };
    setTypedPrompt('');
    timeoutId = setTimeout(tick, 600);
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  useLayoutEffect(() => {
    if (reducedMotion()) return;

    const ctx = gsap.context(() => {
      // Hero and nav are no longer scroll-driven — the nav is visible
      // from the first frame (see the "brand needs to read as legit
      // immediately" note on the nav itself) and the hero is a static
      // white section, not a scroll-revealed dark mass. What's left here
      // is the two animations that were never hero-specific.

      // (Focal-point word scrub for the philosophy section is handled
      // by a scroll-tied rAF loop in a separate useEffect below — it
      // tracks each word's signed distance from viewport center so the
      // spotlight follows the user's eye AND words stay dark once
      // they've passed above the focal line.)

      // ---- BENTO FADE-UP -----------------------------------------------
      // The whole 3-tile bento fades up as one cohesive block on enter.
      if (featureGridRef.current) {
        gsap.fromTo(
          featureGridRef.current,
          { opacity: 0, y: 40 },
          {
            opacity: 1,
            y: 0,
            duration: 0.9,
            ease: 'power3.out',
            scrollTrigger: { trigger: featureGridRef.current, start: 'top 80%' },
          }
        );
      }

      // ---- CLOSER STAGGER -----------------------------------------------
      // The 4 icons stagger in. The CTA button's pulse is owned by the
      // landing-cta-pulse CSS animation (continuous when idle, paused on
      // hover) — no GSAP box-shadow tween here, since GSAP's inline
      // styles would override the keyframe loop.
      ScrollTrigger.create({
        trigger: ctaRef.current,
        start: 'top 75%',
        onEnter: () => {
          ctaIconRefs.current.forEach((el, i) => {
            if (!el) return;
            gsap.fromTo(
              el,
              { opacity: 0, y: 24 },
              { opacity: 1, y: 0, duration: 0.55, delay: i * 0.16, ease: 'power3.out' }
            );
          });
        },
        once: true,
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  // ---- PHILOSOPHY WORD SCRUB (highlight-as-you-read) -------------------
  // Each word darkens as it approaches the vertical middle of the
  // viewport and STAYS dark after it passes. The reader's eye sees a
  // "highlighter" sweep down the paragraphs — words ahead are light,
  // the focal line is being scrubbed in, words already read are locked
  // dark. No fade-back as text moves up past the focal point.
  //
  // Why a rAF loop instead of a GSAP scrub: a scrub timeline reverses
  // when the user scrolls back, un-darkening previously-read words. A
  // per-frame signed-distance check keeps the persistence we want and
  // is cheap (one getBoundingClientRect + one style write per word per
  // scroll frame). Writing directly to el.style.color survives React
  // re-renders (e.g. when the testimonial carousel ticks).
  useEffect(() => {
    if (reducedMotion()) {
      for (const el of wordRefs.current) {
        if (el) el.style.color = '#1F1F1F';
      }
      return;
    }

    const LIGHT = { r: 232, g: 229, b: 221 }; // #E8E5DD
    const DARK = { r: 31, g: 31, b: 31 };     // #1F1F1F
    const lerp = (a, b, t) => Math.round(a + (b - a) * t);

    let rafId = null;
    let scheduled = false;

    const update = () => {
      scheduled = false;
      const section = philosophyRef.current;
      if (!section) return;
      const sRect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      if (sRect.bottom < 0 || sRect.top > vh) return;

      const viewportCenter = vh / 2;
      // fade = distance below focal line over which a word darkens from
      //        light → dark as it approaches. Once a word's center reaches
      //        the focal line (or rises above it), it locks dark.
      const fade = vh * 0.32;

      for (const el of wordRefs.current) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const wordCenter = r.top + r.height / 2;
        const signed = wordCenter - viewportCenter;
        let t;
        if (signed <= 0) t = 1;
        else if (signed >= fade) t = 0;
        else {
          const x = 1 - signed / fade;
          t = x * x * (3 - 2 * x);
        }
        el.style.color = `rgb(${lerp(LIGHT.r, DARK.r, t)}, ${lerp(LIGHT.g, DARK.g, t)}, ${lerp(LIGHT.b, DARK.b, t)})`;
      }
    };

    const onScroll = () => {
      if (scheduled) return;
      scheduled = true;
      rafId = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="relative min-h-screen overflow-x-hidden"
      style={{
        // Page bg is always the warm off-white; the dark overlay above
        // handles the "dark hero" feel. Once the overlay shrinks/fades,
        // the page already looks light without a separate bg transition.
        backgroundColor: '#FAFAF7',
        fontFamily: FONT_BODY,
      }}
    >
      {/* === NOTEBOOK PAPER GRID === */}
      {/* Fixed-position so it doesn't scroll. Very faint horizontal rules
          + a soft margin line on the left. Only visible on light bg. */}
      <div
        aria-hidden
        className="fixed inset-0 pointer-events-none z-[1]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(to bottom, transparent 0 27px, rgba(31,31,31,0.05) 27px, rgba(31,31,31,0.05) 28px), linear-gradient(to right, transparent 0 64px, rgba(250,108,67,0.16) 64px, rgba(250,108,67,0.16) 66px, transparent 66px)',
        }}
      />

      {/* === PERSISTENT TOP NAV ===
          Always visible from the first frame now — no GSAP opacity gate.
          The old hero hid this until the visitor scrolled past a dark
          intro mass, which meant the one thing that says "you're on the
          real ACTRLabs site" (the wordmark) didn't render until a scroll
          gesture. That's the exact "looks like it could be a scam" gap
          the brand-visibility ask was about; the fix is just not hiding it. */}
      <nav
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between gap-3 px-6 lg:px-12 py-3"
        style={{
          '--nav-fg': '#1F1F1F',
          '--nav-fg-soft': '#1F1F1F',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid rgba(31,31,31,0.08)',
        }}
      >
        <Link to="/" className="flex items-center transition-opacity hover:opacity-80">
          <img
            src="/actrlabs-wordmark.jpg"
            alt="ACTRLabs: Redefining Learning"
            className="h-8 w-auto select-none"
            draggable={false}
          />
        </Link>
        <div className="flex items-center gap-3">
          <Link
            to="/userguide"
            className="text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ color: 'var(--nav-fg-soft)', fontFamily: FONT_BODY }}
          >
            Guide
          </Link>
          <Link
            to="/login"
            className="text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ color: 'var(--nav-fg-soft)', fontFamily: FONT_BODY }}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="px-4 py-2 text-sm font-semibold transition-all hover:scale-105"
            style={{
              backgroundColor: '#FA6C43',
              color: '#FFFFFF',
              fontFamily: FONT_BODY,
              borderRadius: '12px',
            }}
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* === HERO ===
          Replaces the old scroll-revealed dark mass (GSAP clip-path timeline
          + a continuously-running WebGL2 shader canvas + a per-keystroke
          typewriter effect) with a static hero modeled on a template the
          team supplied: a giant word-by-word pull-up of the brand name
          itself, beside a short pitch + CTA. This is also the fix for the
          "overloaded my browser" report — that combination was 3-4
          independent animation systems running at once on page load;
          WordsPullUp is one useInView check that fires once and stops, not
          a continuous loop. Back to being the first section (above TRY IT)
          so "ACTRLabs" is the first thing a visitor sees. Top-anchored
          instead of the old h-screen/justify-end (bottom-anchored,
          full-viewport) treatment — that pushed the wordmark down near the
          fold on shorter viewports; this renders it immediately below the
          nav with no scroll required. Background matches the page's
          default FAFAF7 (was a hard-locked #FFFFFF) so there's no seam
          against TRY IT or PHILOSOPHY below it — "no gradient/video
          competing with the mark" from the original request was about
          motion, not this specific hex. Heading fontSize clamp is scaled
          to the lg:col-span-8 column's actual width (~66% of viewport, not
          the full 100vw) — the old 13vw/200px cap sized "ACTRLabs" wider
          than its own column at common desktop widths, so it spilled into
          the pitch-text column beside it. */}
      <section className="relative w-full overflow-hidden" style={{ backgroundColor: '#FAFAF7' }}>
        <div className="px-6 lg:px-12 pt-28 lg:pt-36 pb-16 lg:pb-20 w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-end">
            <div className="lg:col-span-8">
              <h1
                className="leading-[0.85] tracking-[-0.04em]"
                style={{
                  fontFamily: FONT_DISPLAY,
                  color: '#1F1F1F',
                  fontWeight: 800,
                  fontSize: 'clamp(56px, 9vw, 150px)',
                }}
              >
                <WordsPullUp text="ACTRLabs" showAsterisk />
              </h1>
            </div>

            <div className="lg:col-span-4 flex flex-col gap-6 pb-2">
              <MotionP
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
                style={{ color: '#1F1F1F', fontFamily: FONT_BODY, fontWeight: 500, lineHeight: 1.5 }}
                className="text-base lg:text-lg"
              >
                The platform educators and researchers use to build AI simulations and bots for their classroom and studies, no engineering required.
              </MotionP>

              <MotionDiv
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
              >
                <Link
                  to="/register"
                  className="group inline-flex items-center gap-2 self-start rounded-full py-1.5 pl-6 pr-1.5 text-base font-semibold transition-all hover:gap-3"
                  style={{ backgroundColor: '#FA6C43', color: '#FFFFFF', fontFamily: FONT_BODY }}
                >
                  Get started
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full transition-transform group-hover:scale-110"
                    style={{ backgroundColor: '#1F1F1F' }}
                  >
                    <FaArrowRight className="h-4 w-4" style={{ color: '#FFFFFF' }} />
                  </span>
                </Link>
              </MotionDiv>
            </div>
          </div>
        </div>
      </section>

      {/* === TRY IT ===
          PromptInput's own dedicated section, back below the HERO above
          (see that comment for why). PromptInput carries its own
          white/bordered card chrome (border + shadow), so it stays legible
          against this bg. Uses the same FAFAF7 as HERO and PHILOSOPHY —
          previously locked to #FFFFFF, which read as a disconnected seam
          against PHILOSOPHY's FAFAF7 right below it. */}
      <section className="relative px-6 py-20 lg:py-28" style={{ backgroundColor: '#FAFAF7' }}>
        <div className="max-w-2xl mx-auto flex flex-col items-center text-center">
          <span
            className="block text-xs font-bold uppercase tracking-[0.22em] mb-4"
            style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
          >
            Try it yourself
          </span>
          <h2
            className="text-3xl lg:text-5xl tracking-tight leading-[1.08] mb-10"
            style={{
              color: '#1F1F1F',
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            Ask it anything.
          </h2>

          <div className="w-full flex flex-col items-center gap-3">
            {/* Credits counter — driven by /api/usage/me. At 0, the submit
                handler opens the register modal instead of starting a chat. */}
            <div className="flex items-center gap-2.5 px-1">
              <div
                className="relative h-1.5 rounded-full overflow-hidden"
                style={{ width: '80px', backgroundColor: 'rgba(31,31,31,0.1)' }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
                  style={{
                    width: `${(creditsRemaining / LANDING_FREE_CREDITS) * 100}%`,
                    backgroundColor: '#FA6C43',
                  }}
                />
              </div>
              <span
                className="text-[11px] font-semibold"
                style={{ color: 'rgba(31,31,31,0.55)', fontFamily: FONT_BODY, letterSpacing: '0.01em' }}
              >
                {creditsRemaining === 0
                  ? 'Out of credits, sign up'
                  : `${creditsRemaining} ${creditsRemaining === 1 ? 'credit' : 'credits'} left`}
              </span>
            </div>

            {/* Placeholder cycles through HERO_PROMPTS via a typewriter effect (see
                useEffect in component body). Submit (Enter or the send button) opens the
                register-gate modal — anonymous visitors can't actually send. */}
            <PromptInput
              placeholder={typedPrompt}
              models={MODEL_OPTIONS.map((m) => m.label)}
              onSubmit={handleComposerSubmit}
            />
          </div>
        </div>
      </section>

      {/* === PHILOSOPHY (icons-as-language + word-by-word scrub) ===
          Sits directly below the hero now — no top margin needed. The old
          400px margin was scroll runway for the hero's own dark-mass
          reveal timeline; the new hero is a normal h-screen section with
          nothing left to reveal, so this section just follows it. Brand
          illustrations stand in for the audience nouns — the noun word is
          omitted when its icon is present. Every word starts at a
          near-white tone and darkens to #1F1F1F as the user scrolls
          — staggered, so it reads like the user is following along
          with the scroll. */}
      <section
        ref={philosophyRef}
        className="relative min-h-screen flex flex-col items-center justify-center px-6 lg:px-24 py-32"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div
          ref={philosophyTextRef}
          className="max-w-4xl text-2xl lg:text-4xl leading-[1.45] space-y-10"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 700,
            letterSpacing: '-0.015em',
            // Initial near-white color lives on the PARENT so words inherit
            // it. Putting it on each span as inline style would let React's
            // reconciliation clobber the rAF runtime color values on every
            // re-render (e.g. when the testimonial carousel auto-rotates).
            color: '#E8E5DD',
          }}
        >
          {(() => {
            // Reset the ref array on each render so spans get re-bound
            // to fresh refs (avoids stale closures after HMR). Word
            // index is global across paragraphs so the wave continues
            // through the whole section.
            wordRefs.current = [];
            return PHILOSOPHY_PARAGRAPHS.map((tokens, pi) => (
              <p key={`p-${pi}`}>
                {tokens.map((tok, ti) => {
                  if (tok.src) {
                    return (
                      <span
                        key={`p${pi}-i${ti}`}
                        className="group relative inline-block align-middle mx-2"
                      >
                        <img
                          src={tok.src}
                          alt={tok.alt}
                          className="inline-block align-middle"
                          style={{
                            height: '1em',
                            width: 'auto',
                            verticalAlign: '-0.15em',
                          }}
                        />
                        {tok.label && (
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute left-1/2 bottom-full mb-2 opacity-0 translate-y-1 -translate-x-1/2 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-200 ease-out whitespace-nowrap z-20"
                            style={{
                              backgroundColor: '#FA6C43',
                              color: '#FFFFFF',
                              fontFamily: FONT_BODY,
                              fontWeight: 600,
                              fontSize: '0.7rem',
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              padding: '2px 10px',
                              borderRadius: '6px',
                              boxShadow: '0 6px 18px rgba(31,31,31,0.18)',
                            }}
                          >
                            {tok.label}
                          </span>
                        )}
                      </span>
                    );
                  }
                  if (tok.text) {
                    const parts = tok.text.split(/(\s+)/);
                    return parts.map((p, ppi) => {
                      if (!p) return null;
                      if (/^\s+$/.test(p)) {
                        return <span key={`p${pi}-t${ti}-s${ppi}`}>{p}</span>;
                      }
                      // Push in the ref callback rather than capturing
                      // `wordRefs.current.length` at JSX-creation time —
                      // the array isn't populated until React commits the
                      // refs, so reading length during render gave every
                      // word the same index (0) and only the last word
                      // ended up in the array.
                      return (
                        <span
                          key={`p${pi}-t${ti}-w${ppi}`}
                          ref={(el) => {
                            if (el) wordRefs.current.push(el);
                          }}
                        >
                          {p}
                        </span>
                      );
                    });
                  }
                  return null;
                })}
              </p>
            ));
          })()}
        </div>
      </section>

      {/* === FEATURES (BENTO) ===
          Redesigned as a single bordered "case study" panel (inspired by a
          shadcn case-study block): a featured row up top (Canvas-sync copy
          left, SyllabusMockup framed on a peach panel right), then a
          hairline-divided 4-cell row below (Any Model / Cites Sources /
          Observable Sandbox / mailto CTA). featureGridRef stays on the
          single outer container so the existing GSAP fade-up still
          animates it as one block. */}
      <section
        id="features"
        className="relative z-10 px-6 lg:px-10 py-12 lg:py-16"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div
          ref={featureGridRef}
          className="max-w-7xl mx-auto overflow-hidden shadow-[0_18px_48px_rgba(31,31,31,0.10)]"
          style={{ backgroundColor: '#FFFFFF', borderRadius: '40px', border: '1px solid rgba(31,31,31,0.08)' }}
        >
          {/* Featured row */}
          <div className="relative grid lg:grid-cols-2" style={{ minHeight: '380px' }}>
            <div
              className="relative z-10 p-8 lg:p-12 flex flex-col justify-center gap-5 border-b lg:border-b-0 lg:border-r"
              style={{ borderColor: 'rgba(31,31,31,0.08)' }}
            >
              <span
                className="text-xs font-bold uppercase tracking-[0.22em]"
                style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
              >
                Course sync
              </span>
              <h2
                className="text-2xl lg:text-[1.85rem] tracking-tight"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.0,
                }}
              >
                <span
                  style={{
                    backgroundColor: '#FA6C43',
                    color: '#FFFFFF',
                    padding: '0.25em 0.4em',
                    borderRadius: '12px',
                    position: 'relative',
                    zIndex: 2,
                  }}
                >
                  Fetches Canvas
                </span>
                <br />
                <span
                  style={{
                    position: 'relative',
                    display: 'inline-block',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backgroundColor: '#FA6C43',
                      borderRadius: '12px',
                      zIndex: 1,
                    }}
                  />
                  <span
                    style={{
                      position: 'relative',
                      zIndex: 3,
                      padding: '0.25em 0.4em',
                      color: '#FFFFFF',
                      display: 'inline-block',
                    }}
                  >
                    Files
                  </span>
                </span>
              </h2>
              <p
                className="text-[15px] lg:text-base leading-snug max-w-[340px]"
                style={{ color: '#1F1F1F', fontFamily: FONT_BODY, fontWeight: 500 }}
              >
                Connect a course once and every syllabus, slide deck, and reading stays in sync. No re-uploading the same lecture notes every week just to keep the bot from making things up.
              </p>
              <span
                className="group inline-flex items-center gap-1.5 text-sm font-semibold cursor-default"
                style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
              >
                See how the sync works
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden
                  className="transition-transform duration-300 group-hover:translate-x-1"
                >
                  <path
                    d="M3 7h8M7 3l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </div>
            <div className="relative overflow-hidden" style={{ backgroundColor: '#FDE3D8', minHeight: '320px' }}>
              <SyllabusMockup />
            </div>
          </div>

          {/* Cell row — 3 data-driven feature cells + the mailto CTA */}
          <div className="grid lg:grid-cols-4" style={{ borderTop: '1px solid rgba(31,31,31,0.08)' }}>
            {BENTO_CELLS.map((cell) => (
              <BentoCell key={cell.id} {...cell} />
            ))}

            <a
              href="mailto:hello@actrlab.com?subject=Feature%20suggestion%20for%20ACTRLabs"
              className="group relative flex flex-col justify-between gap-8 p-8 lg:p-9 border-t lg:border-t-0 lg:border-l transition-transform"
              style={{ backgroundColor: '#FA6C43', borderColor: 'rgba(255,255,255,0.25)' }}
            >
              <img src="/logo-A-white.svg" alt="" aria-hidden="true" className="w-10 h-10" draggable={false} />
              <div>
                <h3
                  className="text-xl tracking-tight mb-2.5 text-white"
                  style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: '-0.02em' }}
                >
                  Missing something?
                </h3>
                <p
                  className="text-[15px] leading-snug mb-5 text-white/85"
                  style={{ fontFamily: FONT_BODY, fontWeight: 500 }}
                >
                  Tell us what would make this more useful for your course or lab. We read every note.
                </p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-white">
                  Get in touch
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 14 14"
                    fill="none"
                    aria-hidden
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  >
                    <path
                      d="M3 7h8M7 3l4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* === TESTIMONIALS ===
          Two panels, side by side — both always expanded (the student
          panel was dropped, and two fit at once with room to breathe, so
          the old accordion/auto-rotate/rail-collapse machinery is gone
          along with it). Section ref drives the IntersectionObserver that
          gates video autoplay — both videos stay paused until this
          section enters view. */}
      <section
        ref={testimonialsSectionRef}
        className="relative px-6 lg:px-10 py-24 z-10"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div className="max-w-7xl mx-auto">
          <span
            className="block text-xs font-bold uppercase tracking-[0.22em] mb-4"
            style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
          >
            Who it&rsquo;s for
          </span>
          <h2
            className="text-3xl lg:text-5xl tracking-tight leading-[1.08] mb-12 max-w-3xl"
            style={{
              color: '#1F1F1F',
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              letterSpacing: '-0.02em',
            }}
          >
            Built for the people who actually use it.
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {TESTIMONIAL_PANELS.map((p, i) => (
              <div
                key={p.id}
                className="relative overflow-hidden rounded-3xl p-8 lg:p-10 flex flex-col"
                style={{
                  backgroundColor: '#FFFFFF',
                  border: '1px solid rgba(31,31,31,0.08)',
                  boxShadow: '0 24px 56px rgba(31,31,31,0.1), inset 0 1px 0 rgba(255,255,255,0.6)',
                }}
              >
                {/* Portrait testimonial video — autoplays muted once the
                    section is in view (videoRefs effect above), paused
                    when it scrolls out. */}
                <div
                  className="relative overflow-hidden w-full mb-7"
                  style={{ aspectRatio: '16 / 9', backgroundColor: '#1F1F1F', borderRadius: '20px' }}
                >
                  <video
                    ref={(el) => { videoRefs.current[i] = el; }}
                    src={p.videoSrc}
                    poster={p.posterSrc}
                    muted
                    playsInline
                    loop
                    preload="metadata"
                    className="w-full h-full object-cover"
                  />
                  <img
                    src="/logo-A-white.svg"
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="absolute pointer-events-none select-none"
                    style={{ top: '14px', right: '14px', width: '28px', height: 'auto', zIndex: 10 }}
                  />
                </div>

                {/* Editorial testimonial: ringed avatar, serif quote, a
                    handwritten signature + sans meta line. */}
                <div className="flex items-start gap-4 mb-5">
                  <div
                    className="rounded-full overflow-hidden shrink-0"
                    style={{
                      width: '48px',
                      height: '48px',
                      backgroundColor: '#1F1F1F',
                      boxShadow: `0 0 0 2px #FFFFFF, 0 0 0 4px ${p.accent}`,
                    }}
                  >
                    <img
                      src={p.avatarSrc || p.posterSrc}
                      alt=""
                      aria-hidden
                      draggable={false}
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.opacity = '0'; }}
                    />
                  </div>
                  <div>
                    <div
                      style={{
                        fontFamily: FONT_SCRIPT,
                        fontWeight: 600,
                        color: '#1F1F1F',
                        fontSize: '2rem',
                        lineHeight: 1,
                        letterSpacing: '0.005em',
                      }}
                    >
                      {p.name}
                    </div>
                    <div
                      className="mt-1.5"
                      style={{
                        fontFamily: FONT_BODY,
                        fontWeight: 500,
                        fontSize: '0.88rem',
                        color: 'rgba(31,31,31,0.6)',
                      }}
                    >
                      {p.role} at <span style={{ color: p.accent, fontWeight: 700 }}>{p.university}</span>
                    </div>
                  </div>
                </div>
                <p
                  className="leading-snug"
                  style={{
                    color: '#1F1F1F',
                    fontFamily: FONT_SERIF,
                    fontSize: '1.2rem',
                    lineHeight: 1.45,
                    fontWeight: 400,
                  }}
                >
                  &ldquo;{p.quote}&rdquo;
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* === PRODUCT SHOWCASE ===
          Fills the "polished product screenshot" gap flagged in the LandingV2 spec — a
          scroll-tilt reveal of the actual assistant dashboard, not a stock photo. Framer
          Motion drives this (its own useScroll target), independent of the GSAP timeline
          the rest of the page runs on — the two don't touch the same elements. */}
      <section style={{ backgroundColor: '#FAFAF7' }}>
        <ContainerScroll
          titleComponent={
            <h2
              className="text-5xl lg:text-7xl tracking-tight text-center mb-24"
              style={{
                color: '#1F1F1F',
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                letterSpacing: '-0.02em',
              }}
            >
              See it in action
            </h2>
          }
        >
          <img
            src="/guide-media/config-list.png"
            alt="The ACTRLabs assistant dashboard, showing a grid of configured bots"
            className="mx-auto rounded-2xl object-cover h-full w-full object-top"
            draggable={false}
          />
        </ContainerScroll>
      </section>

      {/* === CLOSER === */}
      <section
        id="cta"
        ref={ctaRef}
        className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24 z-10"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div className="flex items-center justify-center gap-6 mb-12">
          {UVPS.map((uvp, i) => (
            <div
              key={uvp.id}
              ref={(el) => (ctaIconRefs.current[i] = el)}
              className="w-14 h-14 landing-icon-float"
              style={{ opacity: 0 }}
            >
              <img
                src={uvp.icon}
                alt=""
                className="w-full h-full object-contain"
                style={{ animationDelay: `${i * 0.4}s` }}
              />
            </div>
          ))}
          <div
            ref={(el) => (ctaIconRefs.current[3] = el)}
            className="w-14 h-14 landing-icon-float"
            style={{ opacity: 0 }}
          >
            <img
              src="/illustrations/icon-hand.png"
              alt=""
              className="w-full h-full object-contain"
              style={{ animationDelay: '1.2s' }}
            />
          </div>
        </div>

        <h2
          className="text-5xl lg:text-7xl tracking-tight text-center mb-4"
          style={{
            color: '#1F1F1F',
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          Don&rsquo;t miss out.
        </h2>
        <p
          className="text-lg text-gray-600 text-center mb-10 max-w-xl"
          style={{ fontFamily: FONT_BODY }}
        >
          Build a custom AI tutor for your class in minutes. No engineering, no lock-in. We'll be right here.
        </p>

        <button
          data-cta
          onClick={() => navigate('/register')}
          className="landing-cta-pulse px-10 py-4 text-lg font-bold text-white shadow-lg active:scale-95 transition-all hover:opacity-95"
          style={{
            backgroundColor: '#FA6C43',
            fontFamily: FONT_BODY,
            borderRadius: '12px',
          }}
        >
          Build your own bot
        </button>
      </section>

      {/* === FOOTER === */}
      <footer
        className="px-6 lg:px-12 py-8 text-sm relative z-10"
        style={{ backgroundColor: '#1f1f1f', color: '#B8B8B8', fontFamily: FONT_BODY }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-6xl mx-auto">
          <span>&copy; 2026 ACTRLabs</span>
          <div className="flex items-center gap-5" style={{ color: '#EDEDED' }}>
            <Link to="/about" className="hover:opacity-80">About</Link>
            <a href="mailto:hello@actrlab.com" className="hover:opacity-80">Contact</a>
            <Link to="/login" className="hover:opacity-80">Sign in</Link>
          </div>
        </div>
      </footer>

      {/* Register-gate modal. Opened when an anonymous visitor tries to
          submit the "Try it" composer. Backdrop click + Escape close it
          (Escape wired in the component-body useEffect above). */}
      {showRegisterModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center px-6"
          style={{ backgroundColor: 'rgba(15,15,15,0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowRegisterModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="register-gate-title"
        >
          <div
            className="relative w-full max-w-md rounded-[28px] p-7 text-left"
            style={{
              backgroundColor: '#FFFFFF',
              boxShadow: '0 32px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowRegisterModal(false)}
              aria-label="Close"
              className="absolute flex items-center justify-center transition-colors hover:bg-gray-100"
              style={{
                top: '14px',
                right: '14px',
                width: '32px',
                height: '32px',
                borderRadius: '9999px',
                color: '#6B6B6B',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                <path
                  d="M2 2l10 10M12 2L2 12"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <h2
              id="register-gate-title"
              className="mb-3"
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 800,
                fontSize: '26px',
                lineHeight: 1.1,
                letterSpacing: '-0.025em',
                color: '#1F1F1F',
              }}
            >
              Create an account to chat
            </h2>
            <p
              className="mb-6"
              style={{
                fontFamily: FONT_BODY,
                color: '#5A5A5A',
                fontSize: '15px',
                lineHeight: 1.5,
              }}
            >
              Sign up free to send your first prompt and start building your AI tutor on Actrlabs.
            </p>
            {lastPrompt.trim() && (
              <div
                className="mb-6 rounded-2xl p-3"
                style={{
                  backgroundColor: '#F5F3EE',
                  fontFamily: FONT_BODY,
                  color: '#3A3A3A',
                  fontSize: '13px',
                  lineHeight: 1.45,
                }}
              >
                <div
                  className="mb-1"
                  style={{
                    fontSize: '10px',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    color: '#8B8B8B',
                    fontWeight: 600,
                  }}
                >
                  Your prompt
                </div>
                <div
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {lastPrompt}
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('/register')}
              className="w-full py-3 text-sm font-semibold transition-all hover:opacity-95 active:scale-[0.99]"
              style={{
                backgroundColor: '#FA6C43',
                color: '#FFFFFF',
                fontFamily: FONT_BODY,
                borderRadius: '14px',
                boxShadow: '0 8px 20px rgba(250,108,67,0.35)',
              }}
            >
              Sign up free
            </button>
            <div
              className="mt-4 text-center text-sm"
              style={{ color: '#6B6B6B', fontFamily: FONT_BODY }}
            >
              Already have an account?{' '}
              <Link
                to="/login"
                style={{ color: '#FA6C43', fontWeight: 600 }}
                className="hover:underline"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Closer-icon idle float + CTA pulse + reduced-motion fallback */}
      <style>{`
        @keyframes landing-icon-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .landing-icon-float img {
          animation: landing-icon-float 3.2s ease-in-out infinite;
          will-change: transform;
        }
        @keyframes landing-cta-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(250,108,67,0.55), 0 8px 24px rgba(250,108,67,0.25);
            transform: scale(1);
          }
          70% {
            box-shadow: 0 0 0 22px rgba(250,108,67,0), 0 8px 24px rgba(250,108,67,0.25);
            transform: scale(1.03);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(250,108,67,0), 0 8px 24px rgba(250,108,67,0.25);
            transform: scale(1);
          }
        }
        .landing-cta-pulse {
          animation: landing-cta-pulse 2.2s ease-out infinite;
          will-change: transform, box-shadow;
        }
        .landing-cta-pulse:hover {
          animation: none;
        }
        @keyframes landing-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes landing-pulse-dot {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-icon-float img { animation: none; }
          .landing-cta-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default LandingV2;
