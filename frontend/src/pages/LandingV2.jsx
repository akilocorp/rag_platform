import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

const UVPS = [
  {
    id: 'syllabus',
    icon: '/illustrations/icon-question.png',
    iconAlt: 'Question mark',
    headline: 'Trained on your syllabus, not the internet.',
    body:
      'Upload your slides, readings, and PDFs. Your bot answers from your files — not from generic training data. Your students get answers grounded in what you actually teach.',
    side: 'left',
  },
  {
    id: 'models',
    icon: '/illustrations/icon-pencil.png',
    iconAlt: 'Pencil',
    headline: 'Pick the AI for the lesson, not the lesson for the AI.',
    body:
      'Claude for analysis. GPT for code. Gemini for math. Haiku for quick tutoring. One platform, six models — pick the right one per bot, swap any time.',
    side: 'right',
  },
  {
    id: 'research',
    icon: '/illustrations/icon-glasses.png',
    iconAlt: 'Glasses',
    headline: 'Built for research, not just for class.',
    body:
      'Embed in Qualtrics surveys. Capture full transcripts. Run A/B variants on the same bot. Group-chat matching for cohort studies. We built this to be a research instrument, not just a tutoring tool.',
    side: 'left',
  },
];

// Per-feature visual identity for the bento. Each tile gets its own
// pastel `copyBg` and an `accentColor` for the eyebrow + divider.
// Mockups (SyllabusMockup / ModelsMockup / ResearchMockup) are built
// inline per tile and bleed off one edge with a slight tilt.
const FEATURE_VISUALS = {
  syllabus: { copyBg: '#FDE3D8', accentColor: '#C8472A' },
  models:   { copyBg: '#F4ECD8', accentColor: '#A8832D' },
  research: { copyBg: '#D9E5F2', accentColor: '#3E6493' },
};

// --- BENTO COMPONENTS ----------------------------------------------------
// A single tile split into two NON-OVERLAPPING absolute zones inside the
// tile's overflow:hidden box: a copy zone (~40%) and a mockup zone (~60%).
// `mockupSide` picks the split axis:
//   'bottom' → vertical split (copy on top, mockup on bottom) — used by
//              the tall Syllabus hero.
//   'right'  → horizontal split (copy on left, mockup on right) — used
//              by the short Models + Research tiles.
// Hover lift (scale + deeper shadow) runs on pure CSS :hover — no React
// state, no z-index dance, no page-wide blur overlay.
const BentoTile = ({
  id,
  index,
  uvp,
  visual,
  className = '',
  mockupSide = 'right',
  children,
}) => {
  const isVertical = mockupSide === 'bottom';
  const copyZoneStyle = isVertical
    ? { top: 0, left: 0, right: 0, bottom: '60%' }
    : { top: 0, left: 0, right: '58%', bottom: 0 };
  const mockupZoneStyle = isVertical
    ? { top: '40%', left: 0, right: 0, bottom: 0 }
    : { top: 0, left: '42%', right: 0, bottom: 0 };

  return (
    <div
      className={`relative overflow-hidden transition-all duration-300 shadow-[0_18px_48px_rgba(31,31,31,0.10)] hover:scale-[1.012] hover:shadow-[0_28px_64px_rgba(31,31,31,0.18)] ${className}`}
      style={{
        backgroundColor: visual.copyBg,
        borderRadius: '40px',
      }}
    >
      {/* Copy zone — fixed 40% of tile, hard-bounded so body text can
          never wrap into the mockup zone. */}
      <div className="absolute z-10 p-7 lg:p-8 overflow-hidden" style={copyZoneStyle}>
        <span
          className="inline-block text-[11px] font-bold uppercase tracking-[0.22em] mb-3"
          style={{ color: visual.accentColor, fontFamily: FONT_BODY }}
        >
          {`0${index + 1} / 03`}
        </span>
        <h2
          className={`tracking-tight leading-[1.1] mb-2.5 ${
            isVertical ? 'text-2xl lg:text-[1.9rem]' : 'text-base lg:text-[1.15rem]'
          }`}
          style={{
            color: '#1F1F1F',
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          {uvp.headline}
        </h2>
        <div
          className="h-px w-12 mb-2.5"
          style={{ backgroundColor: visual.accentColor, opacity: 0.5 }}
        />
        <p
          className={`leading-snug ${
            isVertical ? 'text-[12.5px] lg:text-[13px]' : 'text-[10.5px] lg:text-[11px]'
          }`}
          style={{ color: '#3A3A3A', fontFamily: FONT_BODY }}
        >
          {uvp.body}
        </p>
      </div>
      {/* Mockup zone — 60% of tile, positioned context for the mockup's
          absolute children. Mockups bleed past the *tile* right/bottom
          edges (clipped by tile overflow-hidden) but never past the zone
          edge that abuts the copy zone. */}
      <div className="absolute" style={mockupZoneStyle}>
        {children}
      </div>
    </div>
  );
};

// Mockups receive an already-positioned mockup zone as their parent
// (via BentoTile), so coordinates here are RELATIVE TO THAT ZONE.
// Negative offsets bleed past the tile's outer edges (right/bottom) and
// get clipped by the tile's overflow:hidden — that's the "tilted card
// peeking off the corner" effect. They never cross the zone edge that
// borders the copy zone.
const SyllabusMockup = () => (
  <>
    <div
      className="absolute bottom-[150px] right-[200px] w-20 h-24 bg-white rounded-lg shadow-md border border-gray-200 p-2 pointer-events-none"
      style={{ transform: 'rotate(-16deg)' }}
      aria-hidden
    >
      <div className="text-[8px] font-bold text-gray-400 mb-1">PDF</div>
      <div className="h-1 bg-gray-300 rounded mb-1"></div>
      <div className="h-1 bg-gray-200 rounded mb-1 w-3/4"></div>
      <div className="h-1 bg-gray-200 rounded w-1/2"></div>
    </div>
    <div
      className="absolute bottom-[110px] right-[80px] w-20 h-24 bg-white rounded-lg shadow-md border border-gray-200 p-2 pointer-events-none"
      style={{ transform: 'rotate(11deg)' }}
      aria-hidden
    >
      <div className="text-[8px] font-bold text-gray-400 mb-1">PDF</div>
      <div className="h-1 bg-gray-300 rounded mb-1"></div>
      <div className="h-1 bg-gray-200 rounded mb-1 w-2/3"></div>
      <div className="h-1 bg-gray-200 rounded w-1/2"></div>
    </div>
    <div
      className="absolute bottom-[20px] right-[-10px] w-[320px] bg-white rounded-2xl p-3.5 shadow-2xl space-y-2 border border-gray-100 pointer-events-none"
      style={{ transform: 'rotate(-3deg)', fontFamily: FONT_BODY }}
      aria-hidden
    >
      <div
        className="ml-8 px-3 py-2 rounded-2xl text-sm"
        style={{ backgroundColor: '#FA6C43', color: '#fff' }}
      >
        What&rsquo;s the difference between Type I and Type II error?
      </div>
      <div className="mr-6 px-3 py-2 rounded-2xl bg-gray-100 text-sm text-gray-800">
        Per your Week 3 lecture (slide 14): Type I rejects a true null hypothesis&hellip;
        <div className="mt-2 inline-flex items-center gap-1 bg-white rounded-full px-2 py-0.5 text-[10px] border border-gray-200 text-gray-600">
          <span>&#128196;</span> lecture-3.pdf
        </div>
      </div>
    </div>
  </>
);

const ModelPill = ({ color, label, selected }) => (
  <div
    className="bg-white rounded-full pl-3 pr-4 py-2 shadow-md flex items-center gap-2 text-sm min-w-[160px]"
    style={{
      borderColor: selected ? '#FA6C43' : 'rgba(0,0,0,0.05)',
      borderWidth: selected ? '2px' : '1px',
      borderStyle: 'solid',
      fontFamily: FONT_BODY,
    }}
  >
    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }}></div>
    <span className="font-semibold text-gray-800">{label}</span>
    {selected && <span className="ml-auto text-[14px] font-bold" style={{ color: '#FA6C43' }}>&#10003;</span>}
  </div>
);

const ModelsMockup = () => (
  <div
    className="absolute pointer-events-none flex flex-col gap-2"
    style={{
      right: '-30px',
      top: '50%',
      transform: 'translateY(-50%) rotate(-5deg)',
    }}
    aria-hidden
  >
    <ModelPill color="#D97757" label="Claude" selected={false} />
    <ModelPill color="#10A37F" label="GPT-4o"  selected={true}  />
    <ModelPill color="#4285F4" label="Gemini"  selected={false} />
    <ModelPill color="#A855F7" label="Haiku"   selected={false} />
  </div>
);

const ResearchMockup = () => (
  <div
    className="absolute pointer-events-none w-[260px]"
    style={{
      right: '-20px',
      top: '50%',
      transform: 'translateY(-50%) rotate(3deg)',
    }}
    aria-hidden
  >
    <div
      className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
      style={{ fontFamily: FONT_BODY }}
    >
      <div className="bg-slate-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
        <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Cognitive Load Study</span>
        <span className="text-[9px] text-slate-500">Q4/12</span>
      </div>
      <div className="p-3.5 space-y-2.5">
        <div className="text-[11px] font-semibold text-gray-800 leading-snug">How clear was the bot&rsquo;s response?</div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`w-6 h-6 rounded text-[10px] flex items-center justify-center font-semibold ${
                n === 3 ? 'text-white' : 'bg-gray-100 text-gray-500'
              }`}
              style={n === 3 ? { backgroundColor: '#3E6493' } : {}}
            >
              {n}
            </span>
          ))}
        </div>
        <div className="bg-gray-50 rounded-md p-2 mt-1 border border-gray-100">
          <div className="text-[8px] uppercase tracking-wider text-gray-400 mb-1">Embedded chat</div>
          <div className="text-[10px] text-gray-700">&ldquo;Per slide 14, Type I error is&hellip;&rdquo;</div>
        </div>
      </div>
    </div>
  </div>
);

// Three audience panels for the horizontal accordion. One is expanded at
// a time; the others collapse to a narrow vertical-label rail. Body copy
// is intentionally placeholder (lorem ipsum) — to be replaced with real
// audience pitches.
// Panel bg colors use rgba with 0.55 alpha so the backdrop-filter blur
// on each panel actually has something to do — the cream page bg + the
// notebook grid behind get a soft frosted-glass look through the tint.
const TESTIMONIAL_PANELS = [
  {
    id: 'students',
    title: 'Students',
    body:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
    icon: '/illustrations/icon-question.png',
    iconAlt: 'Question mark',
    bg: 'rgba(253, 227, 216, 0.55)',
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
    bg: 'rgba(244, 236, 216, 0.55)',
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
    bg: 'rgba(217, 229, 242, 0.55)',
    accent: '#3E6493',
    metric: '27 STUDIES',
  },
];

// Philosophy paragraph as an ARRAY of paragraphs, each a sequence of
// tokens (text chunks + inline brand icons). Splitting into separate
// paragraphs gives breathing room between thoughts and lets the
// cinematic word-by-word scrub feel less like a wall of text.
const PHILOSOPHY_PARAGRAPHS = [
  [
    { text: 'Every class moves at the speed of small things — the' },
    { icon: 'hand', alt: 'hand' },
    { text: 'raised in the back row, the question scribbled in' },
    { icon: 'pencil', alt: 'pencil' },
    { text: ', the' },
    { icon: 'calculator', alt: 'calculator' },
    { text: 'tap that solves a problem two minutes before the bell.' },
  ],
  [
    { text: 'We built ACTRlabs for the educators already showing up for those moments. Upload your syllabus, slides, and readings; pick the AI model that fits your class; share it in one link.' },
  ],
  [
    { text: 'Whether your students are on' },
    { icon: 'laptop', alt: 'laptop' },
    { text: 'in lecture halls or chasing' },
    { icon: 'hashtag', alt: 'hashtag' },
    { text: 'between classes — your bot meets them with what you actually teach, not the open internet.' },
  ],
  [
    { icon: 'glasses', alt: 'glasses' },
    { text: 'on, notebooks open, every question gets a real answer.' },
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
        className="fixed top-0 left-0 right-0 z-40 flex items-center justify-end gap-3 px-6 lg:px-12 py-4"
        style={{
          // Nav text is always dark: the nav sits at z=40 behind the
          // dark overlay (z=60), so it's only ever visible against the
          // off-white page bg. The earlier white-on-dark state was dead
          // code that desynced Sign in's reveal from Get started's.
          '--nav-fg': '#1F1F1F',
          '--nav-fg-soft': '#1F1F1F',
          backgroundColor: 'rgba(255,255,255,0.06)',
          backdropFilter: 'blur(14px) saturate(140%)',
          WebkitBackdropFilter: 'blur(14px) saturate(140%)',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
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
          {/* "New" pill — left empty for now, just a small accent dot +
              the word "New". Real announcement copy slots in next to it
              when there's something to announce. */}
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-8"
            style={{
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#FA6C43' }} />
            <span
              className="text-xs font-medium"
              style={{ color: 'rgba(255,255,255,0.7)', fontFamily: FONT_BODY }}
            >
              New
            </span>
          </div>

          {/* Headline */}
          <h1
            className="mb-6 max-w-4xl"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              color: '#FFFFFF',
              fontSize: 'clamp(44px, 7.5vmin, 96px)',
              lineHeight: 0.98,
              letterSpacing: '-0.045em',
            }}
          >
            Are you ready to redefine{' '}
            <span style={{ color: '#FA6C43' }}>Learning</span>?
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

          {/* Glass chat-input card — visual only for now. Typing works
              (it's a real <input>) but the send button + actions are
              wired to nothing. Redirect-to-register hookup lands later. */}
          <div
            className="w-full max-w-2xl rounded-3xl p-1.5"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              backdropFilter: 'blur(24px) saturate(140%)',
              WebkitBackdropFilter: 'blur(24px) saturate(140%)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08)',
            }}
          >
            <div
              className="rounded-[20px] p-5"
              style={{ backgroundColor: 'rgba(255,255,255,0.025)' }}
            >
              {/* Input + send button */}
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Ask anything…"
                  className="flex-1 bg-transparent outline-none text-base placeholder:text-white/40"
                  style={{ color: '#FFF', fontFamily: FONT_BODY }}
                />
                <button
                  type="button"
                  aria-label="Send"
                  className="w-10 h-10 rounded-xl flex items-center justify-center transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#FFF', color: '#1F1F1F' }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path
                      d="M8 14V2M8 2l-5 5M8 2l5 5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>

              {/* Divider */}
              <div
                className="h-px my-4"
                style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
              />

              {/* Action row + provider label */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-5">
                  <button
                    type="button"
                    className="flex items-center gap-1.5 transition-colors hover:text-white/80"
                    style={{ color: 'rgba(255,255,255,0.5)', fontFamily: FONT_BODY }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M10.5 2.5L4.2 8.8a3 3 0 104.24 4.24l6.3-6.3a5 5 0 10-7.07-7.07L1.5 6.04"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Attach
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 transition-colors hover:text-white/80"
                    style={{ color: 'rgba(255,255,255,0.5)', fontFamily: FONT_BODY }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M8 1.5a2.5 2.5 0 00-2.5 2.5v4a2.5 2.5 0 005 0V4A2.5 2.5 0 008 1.5zM3 8a5 5 0 0010 0M8 13v2"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Voice
                  </button>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 transition-colors hover:text-white/80"
                    style={{ color: 'rgba(255,255,255,0.5)', fontFamily: FONT_BODY }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M2 4h12M2 8h12M2 12h8"
                        stroke="currentColor"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                      />
                    </svg>
                    Prompts
                  </button>
                </div>
                <span style={{ color: 'rgba(255,255,255,0.35)', fontFamily: FONT_BODY }}>
                  Powered by Claude
                </span>
              </div>
            </div>
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
          Sits between the cinematic and the UVPs. The paragraph
          replaces "hand", "pencil", "calculator", "laptop", "hashtag",
          "glasses" with their hand-drawn brand icons inline. Every
          word starts at a near-white tone and darkens to #1F1F1F as
          the user scrolls — staggered, so it reads like the user is
          following along with the scroll. */}
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
                  if (tok.icon) {
                    return (
                      <img
                        key={`p${pi}-i${ti}`}
                        src={`/illustrations/icon-${tok.icon}.png`}
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
          Asymmetric two-column bento on lg+: Syllabus is the tall hero
          on the left (spans 2 rows), Models + Research stack on the
          right. Each tile owns a product mockup that bleeds off one
          edge with a slight tilt. Hovering any tile bumps its zIndex
          above the page-wide blur overlay (z=45), so the hovered tile
          stays sharp while the nav, grid, and other tiles blur. */}
      <section
        id="features"
        className="relative px-6 lg:px-10 py-12 lg:py-16"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <div
          ref={featureGridRef}
          className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-6 lg:auto-rows-[300px]"
        >
          <BentoTile
            id="syllabus"
            index={0}
            uvp={UVPS[0]}
            visual={FEATURE_VISUALS['syllabus']}
            mockupSide="bottom"
            className="min-h-[520px] lg:row-span-2 lg:min-h-[624px]"
          >
            <SyllabusMockup />
          </BentoTile>

          <BentoTile
            id="models"
            index={1}
            uvp={UVPS[1]}
            visual={FEATURE_VISUALS['models']}
            mockupSide="right"
            className="min-h-[320px]"
          >
            <ModelsMockup />
          </BentoTile>

          <BentoTile
            id="research"
            index={2}
            uvp={UVPS[2]}
            visual={FEATURE_VISUALS['research']}
            mockupSide="right"
            className="min-h-[320px]"
          >
            <ResearchMockup />
          </BentoTile>
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
                    backdropFilter: 'blur(20px) saturate(160%)',
                    WebkitBackdropFilter: 'blur(20px) saturate(160%)',
                    border: '1px solid rgba(255,255,255,0.4)',
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
        @media (prefers-reduced-motion: reduce) {
          .landing-icon-float img { animation: none; }
          .landing-cta-pulse { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default LandingV2;
