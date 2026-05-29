import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

const HERO_PROMPTS = [
  'Explain the first law of thermodynamics',
  'Type 1 vs Type 2 Bipolar disorder?',
  'Walk me through CRISPR gene editing',
  'Why did the Roman Empire fall?',
  'Derive the Black-Scholes equation',
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
      'Stop paying for multiple subscriptions just to access the best tools. Actrlabs breaks the platform lock-in by giving you unified access to the leading state-of-the-art AI models—all in one place.',
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

// Small feature tile used in the redesigned bento. Light-blue card with
// a bold title and a short body. Pure presentational — no mockup zone,
// no accent eyebrow. Three of these fill the left/right "feature
// highlight" slots around the Canvas hero and the contact CTA.
const SmallFeatureTile = ({ title, body, className = '' }) => (
  <div
    className={`relative overflow-hidden transition-all duration-300 shadow-[0_12px_32px_rgba(31,31,31,0.08)] hover:scale-[1.012] hover:shadow-[0_20px_48px_rgba(31,31,31,0.15)] ${className}`}
    style={{
      backgroundColor: '#D9E5F2',
      borderRadius: '32px',
      minHeight: '150px',
    }}
  >
    <div className="absolute inset-0 p-6 lg:p-7 flex flex-col justify-center">
      <h3
        className="text-lg lg:text-xl tracking-tight leading-[1.1] mb-2"
        style={{
          color: '#1F1F1F',
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          letterSpacing: '-0.02em',
        }}
      >
        {title}
      </h3>
      <p
        className="text-[12px] lg:text-[13px] leading-snug"
        style={{ color: '#3A3A3A', fontFamily: FONT_BODY }}
      >
        {body}
      </p>
    </div>
  </div>
);

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

// Three audience panels for the horizontal accordion. One is expanded at
// a time; the others collapse to a narrow vertical-label rail. Body copy
// is intentionally placeholder (lorem ipsum) — to be replaced with real
// audience pitches.
// Panel bg colors match the bento tile pastels for visual cohesion.
const TESTIMONIAL_PANELS = [
  {
    id: 'students',
    title: 'Students',
    body:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    icon: '/illustrations/icon-question.png',
    iconAlt: 'Question mark',
    bg: '#FDE3D8',
    accent: '#C8472A',
    metric: '1,420 ACTIVE',
  },
  {
    id: 'teachers',
    title: 'Teachers',
    body:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident.',
    icon: '/illustrations/icon-pencil.png',
    iconAlt: 'Pencil',
    bg: '#F4ECD8',
    accent: '#A8832D',
    metric: '84 BOTS BUILT',
  },
  {
    id: 'researchers',
    title: 'Researchers',
    body:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Sunt in culpa qui officia deserunt mollit anim id est laborum.',
    icon: '/illustrations/icon-glasses.png',
    iconAlt: 'Glasses',
    bg: '#D9E5F2',
    accent: '#3E6493',
    metric: '27 STUDIES',
  },
];

// Philosophy paragraph as an ARRAY of paragraphs, each a sequence of
// tokens (text chunks + inline brand icons). Splitting into separate
// paragraphs gives breathing room between thoughts and lets the
// cinematic word-by-word scrub feel less like a wall of text.
// Icons stand in for the nouns they depict ("icons as language") —
// the noun word is omitted when its icon is present.
const PHILOSOPHY_PARAGRAPHS = [
  [
    { text: 'ACTRlabs makes learning easier and more engaging — for teachers and students alike.' },
  ],
  [
    { text: 'Our platform is available on' },
    { src: '/illustrations/ipad.png', alt: 'iPad' },
    { text: ',' },
    { src: '/illustrations/icon-laptop.png', alt: 'laptop' },
    { text: ', and the' },
    { src: '/illustrations/wifi-internet.svg', alt: 'web' },
    { text: '.' },
  ],
  [
    { text: "Whether you're the" },
    { src: '/illustrations/sprockets-engineering.svg', alt: 'engineering' },
    { text: 'student breaking the grade curve, the' },
    { src: '/illustrations/briefcase-business.svg', alt: 'business' },
    { text: 'student building generational wealth, or the' },
    { src: '/illustrations/survey-clipboard-research.svg', alt: 'humanities surveying' },
    { text: "student polling peers every day — our AI bot meets you right where you are." },
  ],
];

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LandingV2 = () => {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const navRef = useRef(null);
  const heroRef = useRef(null);
  const darkOverlayRef = useRef(null);
  const heroContentRef = useRef(null);
  const logoRef = useRef(null);
  const philosophyRef = useRef(null);
  const philosophyTextRef = useRef(null);
  const wordRefs = useRef([]);
  const scrollCueRef = useRef(null);
  const skipIntroRef = useRef(null);
  const ctaIconRefs = useRef([]);
  const ctaRef = useRef(null);
  const featureGridRef = useRef(null);

  // Audience accordion state. The 7s interval restarts whenever
  // `activePanel` changes — clicking a collapsed pane resets the timer
  // so the user gets the full 7s on their chosen panel before
  // auto-rotation moves on.
  const [activePanel, setActivePanel] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setActivePanel((i) => (i + 1) % TESTIMONIAL_PANELS.length);
    }, 7000);
    return () => clearInterval(id);
  }, [activePanel]);

  // Hero composer attach-menu state. Outside-click closes the menu.
  const [attachOpen, setAttachOpen] = useState(false);
  const attachRef = useRef(null);
  useEffect(() => {
    if (!attachOpen) return;
    const handler = (e) => {
      if (attachRef.current && !attachRef.current.contains(e.target)) {
        setAttachOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [attachOpen]);

  // Hero composer input value + register-gate modal. Submit (Enter or
  // send button) opens the modal instead of routing anywhere — anonymous
  // visitors have to register before they can chat.
  const [promptValue, setPromptValue] = useState('');
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const handleComposerSubmit = (e) => {
    if (e) e.preventDefault();
    setShowRegisterModal(true);
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
      // ---- HERO TRANSITION ----------------------------------------------
      // The whole screen starts as a dark mass. As the user scrolls, that
      // mass shrinks via a circular clip-path until it's small enough to
      // BE the natural dark dot inside the A.
      //
      // Phases (all on a 0..1 timeline driven by hero scroll):
      //   0.05 – 0.22 : headline text fades out FAST — gone well before
      //                  the dark mass shrinks anywhere near it.
      //   0    – 0.55 : clip-path circle shrinks 2400px → 14px.
      //   0.55 – 0.65 : dark overlay opacity 1 → 0 — the logo's natural
      //                  dot takes over visually with no break.
      //   0.65 – 1.0  : logo scales down + slides to its nav-aligned
      //                  position (center of logo box at left:48 top:30).
      //
      // Easing is power2.inOut throughout — uniform deceleration, no
      // expo "spring" feel.

      // Seed the initial logo position via GSAP so the migration tween
      // can interpolate cleanly. Initial state: dot of logo at viewport
      // center; logo's natural top-left at (50% - 55.25%×W, 50% - 71.11%×H).
      gsap.set(logoRef.current, {
        top: '50%',
        left: '50%',
        xPercent: -55.25,
        yPercent: -71.11,
        scale: 1,
      });

      const heroTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8,
        },
      });

      heroTl
        // The full hero content stack — pill, headline, subhead, chat
        // input — fades together as one unit. Same timing as the old
        // headline fade so the dot→A reveal still feels uninterrupted.
        .to(heroContentRef.current, { opacity: 0, duration: 0.17, ease: 'power2.out' }, 0.05)
        // Scroll cue + skip-intro lose their reason to exist the moment
        // the user has scrolled. Fade them along with the hero content.
        .to(scrollCueRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' }, 0.05)
        .to(skipIntroRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' }, 0.05)
        .fromTo(
          darkOverlayRef.current,
          { '--clip-radius': '2400px' },
          { '--clip-radius': '14px', duration: 0.55, ease: 'power2.inOut' },
          0
        )
        .to(darkOverlayRef.current, { opacity: 0, duration: 0.1, ease: 'sine.out' }, 0.55)
        // Different pull-back: instead of migrating the logo into the
        // top-left corner (where it overlapped the philosophy column),
        // it gently lifts and fades after the dot→A reveal completes.
        // Keeps the screen clear for the word-by-word scrub below.
        .to(
          logoRef.current,
          {
            yPercent: -85,
            scale: 0.9,
            opacity: 0,
            duration: 0.3,
            ease: 'power2.inOut',
          },
          0.65
        );

      // ---- NAV HIDE-UNTIL-PAST-HERO ------------------------------------
      // Nav starts invisible and fades in once the bottom of the hero
      // section has scrolled past the top of the viewport. Reverses on
      // scroll-up so the nav disappears again when re-entering the hero.
      gsap.set(navRef.current, { opacity: 0 });
      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'bottom top',
        onEnter: () => gsap.to(navRef.current, { opacity: 1, duration: 0.35, ease: 'power2.out' }),
        onLeaveBack: () => gsap.to(navRef.current, { opacity: 0, duration: 0.35, ease: 'power2.out' }),
      });

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

      {/* === PERSISTENT TOP NAV === */}
      <nav
        ref={navRef}
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between gap-3 px-6 lg:px-12 py-3"
        style={{
          // Nav text is always dark: the nav sits at z=40 behind the
          // dark overlay (z=60), so it's only ever visible against the
          // off-white page bg. The earlier white-on-dark state was dead
          // code that desynced Sign in's reveal from Get started's.
          '--nav-fg': '#1F1F1F',
          '--nav-fg-soft': '#1F1F1F',
          backgroundColor: '#FFFFFF',
          borderBottom: '1px solid rgba(31,31,31,0.08)',
        }}
      >
        <Link to="/" className="flex items-center transition-opacity hover:opacity-80">
          <img
            src="/actrlabs-wordmark.jpg"
            alt="ACTRLabs — Redefining Learning"
            className="h-8 w-auto select-none"
            draggable={false}
          />
        </Link>
        <div className="flex items-center gap-3">
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

      {/* === LOGO LAYER ===
          Positioned with the SVG's natural dot (measured at 55.25% /
          71.11% in logo-A-color.jpg by sampling the orange pixels)
          sitting at viewport center. When the dark overlay's clip-path
          shrinks to ~14px at viewport center, it merges seamlessly
          with the logo's real dark dot.

          Initial transform is set via gsap.set() in useLayoutEffect so
          the migration tween can interpolate cleanly to its end state
          (xPercent: -50, yPercent: -50, top: 30px, left: 48px, scale:
          0.21) without unit mismatches. */}
      <img
        ref={logoRef}
        src="/logo-A.svg"
        alt="ACTRLabs"
        className="fixed pointer-events-none select-none"
        style={{
          width: '260px',
          height: 'auto',
          opacity: 1,
          zIndex: 50,
        }}
      />

      {/* === DARK OVERLAY ===
          Covers the entire viewport with a dark fill, but is clipped to a
          circle whose radius shrinks on scroll. As it shrinks, the white
          page bg + the dark A logo behind become visible — and when the
          radius is small enough, the dark circle seamlessly *becomes* the
          dot of the A. */}
      <div
        ref={darkOverlayRef}
        className="fixed inset-0 pointer-events-none"
        style={{
          backgroundColor: '#1F1F1F',
          clipPath: 'circle(var(--clip-radius, 2400px) at 50% 50%)',
          WebkitClipPath: 'circle(var(--clip-radius, 2400px) at 50% 50%)',
          zIndex: 60,
          willChange: 'clip-path',
        }}
      />


      {/* === HERO === */}
      <section
        ref={heroRef}
        className="relative h-screen flex items-center justify-center"
      >
        {/* Hero content stack — pill, headline, subhead, chat input —
            sits in front of the dark overlay (z=70) so it's readable
            while the dark mass covers the screen. The whole stack
            fades out at the start of scroll (see heroTl above) so the
            dot→A reveal can play unobstructed. */}
        <div
          ref={heroContentRef}
          className="absolute inset-0 flex flex-col items-center justify-center text-center px-6"
          style={{ zIndex: 70 }}
        >
          {/* Announcement pill — solid white against the dark hero so it
              reads as a callout, not chrome. */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
            style={{
              backgroundColor: '#FFFFFF',
              boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#FA6C43' }} />
            <span
              className="text-xs font-semibold"
              style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
            >
              UI System Revamped
            </span>
          </div>

          {/* Headline — italic line over a giant solid LEARNING word.
              Two-line stack with tight leading for drama. */}
          <h1
            className="mb-6 max-w-5xl"
            style={{
              fontFamily: FONT_DISPLAY,
              color: '#FFFFFF',
              lineHeight: 0.92,
              letterSpacing: '-0.045em',
            }}
          >
            <span
              className="block"
              style={{
                fontWeight: 500,
                fontStyle: 'italic',
                fontSize: 'clamp(28px, 4.5vmin, 56px)',
                letterSpacing: '-0.02em',
                marginBottom: '0.08em',
              }}
            >
              We&rsquo;re ready to revolutionize
            </span>
            <span
              className="block"
              style={{
                fontWeight: 900,
                color: '#FA6C43',
                fontSize: 'clamp(88px, 16vmin, 200px)',
                textTransform: 'uppercase',
                letterSpacing: '-0.055em',
                lineHeight: 0.88,
              }}
            >
              Learning
            </span>
          </h1>

          {/* Subhead */}
          <p
            className="max-w-xl mb-10"
            style={{
              color: 'rgba(255,255,255,0.6)',
              fontFamily: FONT_BODY,
              fontSize: 'clamp(15px, 1.6vmin, 18px)',
              lineHeight: 1.55,
            }}
          >
            Upload your syllabus, slides, and notes. Get an AI tutor your students can actually trust — trained on what you actually teach.
          </p>

          {/* Composer — single white card. Top-left credits progress
              bar, big "Ask anything" input, and a bottom row with
              attach (+ dropdown), voice, and a circular orange send
              button. Visual-only for now; routing lands later. */}
          <div
            className="w-full max-w-2xl text-left rounded-[28px] p-5"
            style={{
              backgroundColor: '#FFFFFF',
              boxShadow:
                '0 28px 70px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.03)',
            }}
          >
            {/* Top-left credits indicator */}
            <div className="flex items-center gap-2.5 px-1 mb-4">
              <div
                className="relative h-1.5 rounded-full overflow-hidden"
                style={{ width: '80px', backgroundColor: '#EFEFEF' }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: '38%', backgroundColor: '#FA6C43' }}
                />
              </div>
              <span
                className="text-[11px] font-semibold"
                style={{ color: '#6B6B6B', fontFamily: FONT_BODY, letterSpacing: '0.01em' }}
              >
                123 credits left
              </span>
            </div>

            {/* Input — placeholder cycles through HERO_PROMPTS via a
                typewriter effect (see useEffect in component body).
                Submit (Enter or the send button) opens the register-gate
                modal — anonymous visitors can't actually send. */}
            <form onSubmit={handleComposerSubmit}>
            <input
              type="text"
              placeholder={typedPrompt}
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              className="w-full bg-transparent outline-none border-none px-1 py-2 text-xl placeholder:text-gray-400"
              style={{ color: '#1F1F1F', fontFamily: FONT_BODY, boxShadow: 'none' }}
            />

            {/* Divider between input and actions */}
            <div className="h-px mx-1 mt-3" style={{ backgroundColor: 'rgba(31,31,31,0.08)' }} />

            {/* Bottom row: actions left, send right */}
            <div className="flex items-center justify-between mt-3 px-1">
              <div className="flex items-center gap-1.5">
                {/* Attach button + dropdown */}
                <div className="relative" ref={attachRef}>
                  <button
                    type="button"
                    onClick={() => setAttachOpen((o) => !o)}
                    aria-label="Attach"
                    aria-expanded={attachOpen}
                    className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100"
                    style={{ color: '#1F1F1F' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 3v10M3 8h10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                  {attachOpen && (
                    <div
                      className="absolute left-0 w-52 rounded-2xl py-2 z-20 landing-menu-in"
                      style={{
                        bottom: 'calc(100% + 10px)',
                        backgroundColor: '#FFFFFF',
                        boxShadow:
                          '0 18px 48px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.04)',
                      }}
                    >
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-left transition-colors hover:bg-gray-50"
                        style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
                        onClick={() => setAttachOpen(false)}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ color: '#1F1F1F', flexShrink: 0 }}>
                          <path
                            d="M4 1.5h5.5L13 5v8.5a1 1 0 01-1 1H4a1 1 0 01-1-1v-11a1 1 0 011-1z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M9.5 1.5V5H13"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="font-medium">Attach file</span>
                      </button>
                      <button
                        type="button"
                        className="w-full px-3 py-2.5 flex items-center gap-3 text-sm text-left transition-colors hover:bg-gray-50"
                        style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
                        onClick={() => setAttachOpen(false)}
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ color: '#1F1F1F', flexShrink: 0 }}>
                          <path
                            d="M1.5 4.5a1 1 0 011-1h3.5L7.5 5h6a1 1 0 011 1v6.5a1 1 0 01-1 1h-11a1 1 0 01-1-1v-8z"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span className="font-medium">Attach folder</span>
                      </button>
                    </div>
                  )}
                </div>
                {/* Voice */}
                <button
                  type="button"
                  aria-label="Voice"
                  className="w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-gray-100"
                  style={{ color: '#1F1F1F' }}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path
                      d="M8 2a2 2 0 00-2 2v4a2 2 0 004 0V4a2 2 0 00-2-2z"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M3.5 8a4.5 4.5 0 009 0M8 12.5V15"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              {/* Send button — circular, orange, slim white up-arrow */}
              <button
                type="submit"
                aria-label="Send"
                className="w-11 h-11 rounded-full flex items-center justify-center transition-all hover:opacity-90 active:scale-95"
                style={{
                  backgroundColor: '#FA6C43',
                  boxShadow: '0 6px 16px rgba(250,108,67,0.45)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path
                    d="M10 16V4M10 4l-5 5M10 4l5 5"
                    stroke="#FFFFFF"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            </form>
          </div>
        </div>

        <div ref={scrollCueRef} className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none" style={{ zIndex: 70 }}>
          <span
            className="text-[10px] uppercase tracking-[0.22em]"
            style={{ color: 'rgba(255,255,255,0.55)', fontFamily: FONT_BODY }}
          >
            scroll
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className="animate-bounce"
            style={{ color: 'rgba(255,255,255,0.55)' }}
          >
            <path
              d="M3 5l4 4 4-4"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <button
          ref={skipIntroRef}
          onClick={() => document.getElementById('cta')?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-10 right-6 lg:right-12 text-xs font-medium hover:opacity-90 transition-opacity"
          style={{ color: 'rgba(255,255,255,0.55)', fontFamily: FONT_BODY, zIndex: 70 }}
        >
          Skip intro →
        </button>
      </section>

      {/* === PHILOSOPHY (icons-as-language + word-by-word scrub) ===
          Sits between the cinematic and the UVPs. Brand illustrations
          stand in for the audience nouns (iPad, laptop, web,
          engineering, business, humanities) — the noun word is
          omitted when its icon is present. Every word starts at a
          near-white tone and darkens to #1F1F1F as the user scrolls
          — staggered, so it reads like the user is following along
          with the scroll. */}
      <section
        ref={philosophyRef}
        className="relative min-h-screen flex flex-col items-center justify-center px-6 lg:px-24 py-32 mt-[400px]"
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
                      <img
                        key={`p${pi}-i${ti}`}
                        src={tok.src}
                        alt={tok.alt}
                        className="inline-block align-middle mx-2"
                        style={{
                          height: '1em',
                          width: 'auto',
                          verticalAlign: '-0.15em',
                        }}
                      />
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
          4-column asymmetric bento. Top row: wide peach "Fetches Canvas
          Files" hero (cols 1-3) holding the SyllabusMockup + a small
          gray feature tile on col 4. Bottom rows: two small gray
          feature tiles stacked on col 1, with a 3-col × 2-row orange
          "missing a feature?" mailto-CTA filling the rest. Grid
          auto-flow places tiles in JSX order; see the comment at each
          tile for its target cell. */}
      <section
        id="features"
        className="relative z-10 px-6 lg:px-10 py-12 lg:py-16"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div
          ref={featureGridRef}
          className="grid grid-cols-1 lg:grid-cols-4 gap-5 max-w-7xl mx-auto"
        >
          {/* TOP-LEFT — Canvas hero (lg: cols 1-3, row 1) */}
          <div
            className="relative overflow-hidden lg:col-span-3 transition-all duration-300 shadow-[0_18px_48px_rgba(31,31,31,0.10)] hover:scale-[1.005] hover:shadow-[0_28px_64px_rgba(31,31,31,0.18)]"
            style={{
              backgroundColor: '#FDE3D8',
              borderRadius: '40px',
              minHeight: '340px',
            }}
          >
            <div
              className="absolute z-10 p-8 lg:p-10 overflow-hidden"
              style={{ top: 0, left: 0, right: '50%', bottom: 0 }}
            >
              <h2
                className="text-2xl lg:text-[1.85rem] tracking-tight mb-5"
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
                className="text-sm lg:text-[14px] leading-snug max-w-[300px]"
                style={{ color: '#3A3A3A', fontFamily: FONT_BODY }}
              >
                It&rsquo;s a massive pain to keep re-uploading your lecture notes, only for the AI to start making things up halfway through your study session.
              </p>
            </div>
            <div
              className="absolute"
              style={{ top: 0, left: '50%', right: 0, bottom: 0 }}
            >
              <SyllabusMockup />
            </div>
          </div>

          {/* TOP-RIGHT — Any Model (lg: col 4, row 1) */}
          <SmallFeatureTile
            title="Any Model"
            body="Switch between Claude, GPT-4o, Gemini, and Haiku in the same chat — no extra subscriptions."
          />

          {/* MID-LEFT — Cites Its Sources (lg: col 1, row 2) */}
          <SmallFeatureTile
            title="Cites Its Sources"
            body="Every answer footnoted back to your uploaded files or live web results."
          />

          {/* BOTTOM-RIGHT CTA — orange mailto (lg: cols 2-4, rows 2-3).
              Solid orange tile with the isolated white A logo (body +
              dot) overlaid on the left half as an inline SVG. */}
          <a
            href="mailto:hello@actrlab.com?subject=Feature%20suggestion%20for%20ACTRLabs"
            className="group relative overflow-hidden lg:col-span-3 lg:row-span-2 flex items-center transition-all duration-300 shadow-[0_18px_48px_rgba(250,108,67,0.28)] hover:scale-[1.005] hover:shadow-[0_28px_64px_rgba(250,108,67,0.40)]"
            style={{
              backgroundColor: '#FA6C43',
              borderRadius: '40px',
              minHeight: '320px',
            }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 615.88 475.73"
              className="absolute pointer-events-none"
              style={{
                left: '4%',
                top: '50%',
                transform: 'translateY(-50%)',
                width: '36%',
                height: 'auto',
              }}
            >
              <path
                fill="#FFFFFF"
                d="M367,26.66q-21.86,2.07-43.55,5.46c-1.68.25-3.37.52-5.05.79l-3.05.51-2,.34c-1.17.19-2.34.39-3.5.6-.58.09-1.16.2-1.73.3l-3.54.63h-.07q-15.12,2.73-30.13,6-5.76,12.07-11.53,24.14-21.11,44.13-42.2,88.27-18.71,39.18-37.44,78.34Q162.84,274.53,142.54,317l-3.87,8.1q-6,12.51-12,25A80.3,80.3,0,0,0,114,351.92l-2.11.38-1.27.23-1.5.29c-.59.11-1.18.23-1.76.36s-1.2.24-1.79.37-1.3.27-2,.42q-3.23.72-6.43,1.54C77,360.7,57.55,369.1,41.2,382.1c-25.55,21.62-22.29,47.66,10.39,58.42,23.85,8.47,49.62,6.54,74.48,5.61,17.83-.95,35.59-2.72,53.32-4.78q3-5.88,6-11.76,23.34-45.63,46.7-91.22,23-44.82,45.88-89.64l48-93.86L339,129.59q7.27-14.19,14.54-28.4,9.74-19,19.45-38Q382.77,44,392.58,24.88q-3.43.16-6.85.37Q376.32,25.81,367,26.66ZM604.56,474.44c-4,.22-8,.45-12,.63l-1.21,0-1.15,0c-3.86.07-7.73-.1-11.58-.15q-25.86-.37-51.74-.72c-4.58-.06-9.18-.19-13.77,0-1.65.06-3.29.13-4.94.22l-3.44.17-5.65.31-15.59.77c-.24-.6-.48-1.2-.72-1.78q-1.23-3-2.47-5.92l-6.76-16.18q-1.95-4.67-3.89-9.33L449.21,393.6q-21-50.19-41.92-100.39-20.6-49.35-41.21-98.71L351.24,159q-5,9.67-9.91,19.35-23.79,46.47-47.57,92.94-23,45-46,89.92-19.64,38.29-39.22,76.6-4,7.83-8,15.66L195.09,464h0l-6.34.77-2.14.25c-2,.25-4,.48-6,.71l-4.67.53-2.58.29-3.63.4c-12.71,1.36-25.43,2.52-38.19,3.27-35.89,1.61-75.1,4.31-106.72-15.82-30.09-17.52-32.22-56-9.6-80.67,24.43-26.68,60-39.78,95.18-45.89q4.26-8.93,8.53-17.84,20.28-42.39,40.54-84.81,18.58-38.9,37.18-77.8Q217.81,103.13,239,58.89q2.45-5.14,4.9-10.26l4.35-9.09q4.62-9.69,9.25-19.36l4.73-1.1L266.92,18l4-.88,2.4-.51c1.69-.37,3.39-.73,5.08-1.08l2.46-.5,2.9-.59,3.78-.75Q310.58,9.17,333.86,6A624.82,624.82,0,0,1,401.49.18l1.86,0,1.92,0c1.64,0,3.29,0,4.94-.06h7l2.11,0h.24l2.56,0,2.53,0,3.08.08c.69,1.77,1.4,3.53,2.1,5.3h0L437.54,25q9.9,24.93,19.81,49.85,20,50.18,39.87,100.36,19.35,48.67,38.68,97.34t38.64,97.26q15.93,40.07,31.85,80.14,4.11,10.32,8.21,20.67c.42,1.06.87,2.12,1.28,3.19Z"
              />
              <path
                fill="#FFFFFF"
                d="M126.07,446.13c-24.86.93-50.63,2.85-74.48-5.62-32.68-10.76-35.93-36.8-10.39-58.42,16.36-13,35.78-21.4,56-26.59q3.21-.83,6.43-1.54l2-.42c.6-.13,1.2-.26,1.79-.37l1.76-.36,1.5-.29,1.27-.23,2.11-.37a80.47,80.47,0,0,1,12.73-1.78q6-12.52,12-25c1.29-2.7,2.58-5.39,3.88-8.09q20.3-42.49,40.6-84.95,18.73-39.17,37.44-78.33,21.09-44.14,42.2-88.28,5.76-12.06,11.53-24.14,15-3.29,30.13-6h.07l3.54-.62,1.73-.31c1.17-.2,2.33-.41,3.5-.6l2-.34,3.05-.5c1.68-.28,3.37-.54,5.06-.8q21.68-3.37,43.54-5.46c8.52-.76,17.06-1.37,25.61-1.78Q382.76,44,373,63.2l-19.45,38L339,129.58q-6.47,12.64-12.94,25.29-24,46.92-48,93.86-23,44.81-45.89,89.63-23.35,45.6-46.69,91.22l-6,11.76c-16.46,1.92-33,3.58-49.52,4.57Z"
              />
              <path
                fill="#FFFFFF"
                d="M330.18,389.33c-9.07-1.62-17.44-6.25-24.32-12.24-14.21-12.38-19.95-32.75-15.46-50.85a51.33,51.33,0,0,1,43.17-38.5,41.12,41.12,0,0,1,8.71-.43l.51,0c.28,0,.55,0,.82,0h.14a9.42,9.42,0,0,1,1.08.1c1.86.17,3.69.44,5.53.77,15.38,2.78,28.55,13.27,35.82,26.92a51.54,51.54,0,0,1-26.45,71.41,53.29,53.29,0,0,1-6.93,2.24l-.34.08-.68.18a54.22,54.22,0,0,1-6.83,1.08c-.63.07-1.25.12-1.88.16A54.71,54.71,0,0,1,330.18,389.33Z"
              />
            </svg>
            {/* Spacer that pushes the text past the A artwork on the left. */}
            <div className="flex-shrink-0" style={{ width: '45%' }} aria-hidden />
            <div className="flex-1 pr-8 lg:pr-12">
              <h2
                className="text-white text-3xl lg:text-[2.5rem] tracking-tight leading-[1.05] mb-5"
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                }}
              >
                Are we missing<br />a feature?
              </h2>
              <span
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all group-hover:scale-[1.04] shadow-md"
                style={{
                  backgroundColor: '#FFFFFF',
                  color: '#1F1F1F',
                  fontFamily: FONT_BODY,
                }}
              >
                Get in touch &middot; Suggest features
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
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

          {/* BOTTOM-LEFT — Observable Sandbox (lg: col 1, row 3) */}
          <SmallFeatureTile
            title="Observable Sandbox"
            body="Researcher-grade view of every student &harr; bot exchange &mdash; latency, citations, model variant."
          />
        </div>
      </section>

      {/* === AUDIENCE ACCORDION ===
          Horizontal 3-panel accordion. One panel is expanded
          (`calc(100% - 212px)` wide); the other two collapse to a 90px
          rail showing a vertical-text label. Auto-rotates every 7s; the
          interval restarts on click via the activePanel dep on the
          useEffect. Width transitions are pure CSS — no layout libs. */}
      <section
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

          <div className="flex gap-4 w-full">
            {TESTIMONIAL_PANELS.map((p, i) => {
              const isActive = i === activePanel;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setActivePanel(i)}
                  aria-expanded={isActive}
                  aria-label={p.title}
                  className="relative overflow-hidden rounded-3xl text-left cursor-pointer"
                  style={{
                    width: isActive ? 'calc(100% - 212px)' : '90px',
                    flexShrink: 0,
                    backgroundColor: p.bg,
                    border: '1px solid rgba(31,31,31,0.06)',
                    minHeight: '480px',
                    transition:
                      'width 700ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 300ms ease',
                    boxShadow: isActive
                      ? '0 24px 56px rgba(31,31,31,0.15), inset 0 1px 0 rgba(255,255,255,0.5)'
                      : '0 12px 32px rgba(31,31,31,0.08), inset 0 1px 0 rgba(255,255,255,0.5)',
                  }}
                >
                  {/* Collapsed rail label — visible when not active. */}
                  <div
                    className="absolute inset-0 flex items-center justify-center transition-opacity duration-500"
                    style={{
                      opacity: isActive ? 0 : 1,
                      pointerEvents: isActive ? 'none' : 'auto',
                    }}
                  >
                    <span
                      style={{
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        color: '#1F1F1F',
                        fontFamily: FONT_DISPLAY,
                        fontSize: '1.4rem',
                        fontWeight: 800,
                        letterSpacing: '0.02em',
                      }}
                    >
                      {p.title}
                    </span>
                  </div>

                  {/* Expanded view — visible when active. */}
                  <div
                    className="absolute inset-0 p-10 lg:p-12 flex flex-col transition-opacity duration-500"
                    style={{
                      opacity: isActive ? 1 : 0,
                      pointerEvents: isActive ? 'auto' : 'none',
                    }}
                  >
                    <h3
                      className="text-4xl lg:text-5xl tracking-tight leading-[1.05] mb-6"
                      style={{
                        color: '#1F1F1F',
                        fontFamily: FONT_DISPLAY,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                      }}
                    >
                      {p.title}
                    </h3>
                    <p
                      className="text-base lg:text-lg leading-relaxed max-w-xl"
                      style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
                    >
                      {p.body}
                    </p>
                    <div className="mt-auto">
                      <span
                        className="inline-block px-3 py-1.5 rounded-full text-[10px] font-bold uppercase"
                        style={{
                          backgroundColor: 'rgba(31,31,31,0.06)',
                          border: '1px solid rgba(31,31,31,0.10)',
                          color: '#1F1F1F',
                          letterSpacing: '0.18em',
                          fontFamily: FONT_BODY,
                        }}
                      >
                        {p.metric}
                      </span>
                    </div>
                    <img
                      src={p.icon}
                      alt={p.iconAlt}
                      aria-hidden
                      className="absolute right-10 lg:right-16 top-1/2 w-36 h-36 lg:w-48 lg:h-48 object-contain pointer-events-none"
                      style={{
                        transform: 'translateY(-50%) rotate(-12deg)',
                        opacity: 0.78,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progress dots — show + jump to a panel; also visualize the
              auto-rotate position. */}
          <div className="flex items-center justify-center gap-2.5 mt-10">
            {TESTIMONIAL_PANELS.map((_, i) => (
              <button
                key={i}
                onClick={() => setActivePanel(i)}
                aria-label={`Show panel ${i + 1}`}
                className="h-2.5 rounded-full transition-all duration-500 ease-out"
                style={{
                  width: i === activePanel ? 32 : 10,
                  backgroundColor: i === activePanel ? '#FA6C43' : 'rgba(31,31,31,0.18)',
                }}
              />
            ))}
          </div>
        </div>
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
        style={{ backgroundColor: '#FAFAF7', color: '#888', fontFamily: FONT_BODY }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-6xl mx-auto">
          <span>&copy; 2026 ACTRLabs</span>
          <div className="flex items-center gap-5">
            <Link to="/about" className="hover:opacity-80">About</Link>
            <a href="mailto:hello@actrlab.com" className="hover:opacity-80">Contact</a>
            <Link to="/login" className="hover:opacity-80">Sign in</Link>
          </div>
        </div>
      </footer>

      {/* Register-gate modal. Opened when an anonymous visitor tries to
          submit the hero composer. Backdrop click + Escape close it
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
            {promptValue.trim() && (
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
                  {promptValue}
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
        @keyframes landing-menu-in {
          from { opacity: 0; transform: translateY(4px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .landing-menu-in {
          animation: landing-menu-in 140ms ease-out;
          transform-origin: bottom left;
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-icon-float img { animation: none; }
          .landing-cta-pulse { animation: none; }
          .landing-menu-in { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default LandingV2;
