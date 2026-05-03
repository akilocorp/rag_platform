import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

const SKIP_FLAG = 'actr_landing_v2_seen';

const UVPS = [
  {
    id: 'syllabus',
    icon: '/illustrations/icon-question.jpg',
    iconAlt: 'Question mark',
    headline: 'Trained on your syllabus, not the internet.',
    body:
      'Upload your slides, readings, and PDFs. Your bot answers from your files — not from generic training data. Students stop getting Wikipedia-grade replies and start getting answers grounded in what you actually teach.',
    side: 'left',
  },
  {
    id: 'models',
    icon: '/illustrations/icon-pencil.jpg',
    iconAlt: 'Pencil',
    headline: 'Pick the AI for the lesson, not the lesson for the AI.',
    body:
      'Claude for long-form analysis. GPT for code. Gemini for math. Haiku for quick tutoring. One platform, six models, swap any time. No lock-in to a single vendor.',
    side: 'right',
  },
  {
    id: 'research',
    icon: '/illustrations/icon-glasses.jpg',
    iconAlt: 'Glasses',
    headline: 'Built for research, not just for class.',
    body:
      'Embed in Qualtrics surveys. Capture full transcripts. Run A/B variants on the same bot. Group-chat matching for cohort studies. ACTR Lab is a research instrument, not just a tutoring tool.',
    side: 'left',
  },
];

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const LandingV2 = () => {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const heroRef = useRef(null);
  const dotRef = useRef(null);
  const dotTextRef = useRef(null);
  const aLinesRef = useRef(null);
  const wordmarkRef = useRef(null);
  const orbitRef = useRef(null);
  const iconRefs = useRef([]);
  const ctaIconRefs = useRef([]);
  const ctaRef = useRef(null);
  const featureRefs = useRef([]);
  const navRef = useRef(null);

  // Theme state — drives contrast of the persistent top nav.
  const [theme, setTheme] = useState('dark'); // 'dark' = on #1F1F1F hero, 'light' = on white sections
  const [skipMode, setSkipMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(SKIP_FLAG) === '1';
  });

  // First-time visitors get the cinematic. Returning visitors land in the
  // quieter static version.
  useLayoutEffect(() => {
    if (skipMode || reducedMotion()) return;

    const ctx = gsap.context(() => {
      // ---- HERO TRANSITION ----------------------------------------------
      // Scroll-tied. Question text inside dot fades, dot shrinks, A lines
      // fade in around it, bg eases dark → white, wordmark migrates into
      // the top-left nav slot. Once that's done, the orbit fades in.
      const heroTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
          onUpdate: (self) => {
            // Flip the nav contrast roughly halfway through.
            setTheme(self.progress > 0.55 ? 'light' : 'dark');
          },
        },
      });

      heroTl
        .to(dotTextRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' }, 0)
        .to(dotRef.current, { scale: 0.18, duration: 0.7, ease: 'power3.inOut' }, 0.1)
        .to(aLinesRef.current, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.45)
        .to(rootRef.current, { backgroundColor: '#FAFAF7', duration: 0.45 }, 0.55)
        .to(
          wordmarkRef.current,
          {
            top: '12px',
            left: '24px',
            xPercent: 0,
            yPercent: 0,
            scale: 0.45,
            duration: 0.5,
            ease: 'power3.inOut',
          },
          0.6
        );

      // ---- ORBIT REVEAL --------------------------------------------------
      // After the hero finishes scrolling out, fade the icons in around the
      // wordmark and start the slow rotation.
      gsap.set(orbitRef.current, { opacity: 0, scale: 0.6 });
      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'bottom 80%',
        onEnter: () => {
          gsap.to(orbitRef.current, { opacity: 1, scale: 1, duration: 0.7, ease: 'power2.out' });
          // Continuous slow orbit
          gsap.to(orbitRef.current, {
            rotation: 360,
            duration: 25,
            repeat: -1,
            ease: 'none',
          });
        },
      });

      // ---- FEATURE PEEL-OFFS --------------------------------------------
      // Each feature section pulls one icon from the orbit along a bezier
      // path to its landing position beside the section's copy block.
      featureRefs.current.forEach((section, i) => {
        if (!section) return;
        const icon = iconRefs.current[i];
        if (!icon) return;

        // Different bezier curve per icon for visual variety.
        const curves = [
          // Right-down arc (lands left of center column)
          [
            { x: 0, y: 0 },
            { x: 200, y: 200 },
            { x: -120, y: 480 },
          ],
          // Left-down arc (lands right of center)
          [
            { x: 0, y: 0 },
            { x: -200, y: 220 },
            { x: 160, y: 500 },
          ],
          // Down-right arc (lands lower-left)
          [
            { x: 0, y: 0 },
            { x: 100, y: 300 },
            { x: -180, y: 560 },
          ],
        ];

        ScrollTrigger.create({
          trigger: section,
          start: 'top 70%',
          onEnter: () => {
            // Counter-rotate the icon so it doesn't keep spinning with the orbit.
            gsap.set(icon, { rotation: 0 });
            gsap.to(icon, {
              motionPath: {
                path: curves[i],
                curviness: 1.5,
              },
              duration: 1.4,
              ease: 'power2.inOut',
            });
          },
          once: true,
        });
      });

      // ---- CLOSER STAGGER -----------------------------------------------
      // The 3 orbit icons re-converge around the CTA, then the hand arrives
      // last as punctuation. CTA button gets one soft glow pulse.
      ScrollTrigger.create({
        trigger: ctaRef.current,
        start: 'top 75%',
        onEnter: () => {
          ctaIconRefs.current.forEach((el, i) => {
            if (!el) return;
            gsap.fromTo(
              el,
              { opacity: 0, y: 20 },
              { opacity: 1, y: 0, duration: 0.5, delay: i * 0.18, ease: 'power2.out' }
            );
          });
          // CTA glow pulse once everything has settled
          const btn = ctaRef.current?.querySelector('[data-cta]');
          if (btn) {
            gsap.fromTo(
              btn,
              { boxShadow: '0 0 0 0 rgba(250,108,67,0)' },
              {
                boxShadow: '0 0 0 16px rgba(250,108,67,0)',
                duration: 1.2,
                delay: 1.0,
                ease: 'power2.out',
              }
            );
          }
        },
        once: true,
      });

      // Mark this visitor as having seen the cinematic so future loads
      // skip straight to the static layout.
      ScrollTrigger.create({
        trigger: ctaRef.current,
        start: 'top 50%',
        onEnter: () => {
          try {
            localStorage.setItem(SKIP_FLAG, '1');
          } catch {
            /* ignore quota / private mode */
          }
        },
        once: true,
      });
    }, rootRef);

    return () => ctx.revert();
  }, [skipMode]);

  // Click-to-jump on orbit icons (TOC affordance)
  const jumpTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const navIsLight = theme === 'light' || skipMode;

  return (
    <div
      ref={rootRef}
      className="relative min-h-screen overflow-x-hidden"
      style={{
        backgroundColor: skipMode ? '#FAFAF7' : '#1F1F1F',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {/* PERSISTENT TOP NAV */}
      <nav
        ref={navRef}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12 py-4 transition-colors duration-300"
        style={{ backgroundColor: 'transparent' }}
      >
        <div className="flex items-center gap-3">
          <span
            className="font-bold tracking-tight transition-colors duration-300"
            style={{ color: navIsLight ? '#1F1F1F' : '#FFFFFF', fontSize: '20px' }}
          >
            ACTR Lab
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to="/login"
            className="text-sm font-medium transition-colors duration-300"
            style={{ color: navIsLight ? '#1F1F1F' : '#FFFFFF' }}
          >
            Sign in
          </Link>
          <Link
            to="/register"
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{
              backgroundColor: '#FA6C43',
              color: '#FFFFFF',
            }}
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* === SKIP MODE: returning visitors get the static layout === */}
      {skipMode ? (
        <StaticLayout uvps={UVPS} />
      ) : (
        <>
          {/* === HERO === */}
          <section
            ref={heroRef}
            className="relative h-screen flex items-center justify-center"
          >
            {/* The "wordmark" — a simplified A with a dot and the supporting label.
                As scroll progresses, the dot shrinks and the A lines fade in,
                revealing the wordmark, then the whole thing migrates into the nav. */}
            <div
              ref={wordmarkRef}
              className="absolute"
              style={{
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '320px',
                height: '320px',
              }}
            >
              {/* The angular A lines — invisible at start, fade in mid-scroll */}
              <svg
                ref={aLinesRef}
                viewBox="0 0 320 320"
                className="absolute inset-0 w-full h-full"
                style={{ opacity: 0 }}
                aria-hidden
              >
                <line
                  x1="80"
                  y1="280"
                  x2="160"
                  y2="40"
                  stroke="#FFFFFF"
                  strokeWidth="14"
                  strokeLinecap="round"
                />
                <line
                  x1="160"
                  y1="40"
                  x2="240"
                  y2="280"
                  stroke="#FFFFFF"
                  strokeWidth="14"
                  strokeLinecap="round"
                />
                {/* Wordmark text below the A — only visible once everything settles */}
                <text
                  x="160"
                  y="312"
                  fill="#FFFFFF"
                  textAnchor="middle"
                  fontSize="22"
                  fontWeight="700"
                  fontFamily="'Plus Jakarta Sans', sans-serif"
                  letterSpacing="0.05em"
                >
                  ACTR LAB
                </text>
              </svg>

              {/* The DOT — starts huge, shrinks back to natural size in the A */}
              <div
                ref={dotRef}
                className="absolute"
                style={{
                  top: '57%',
                  left: '50%',
                  width: '120px',
                  height: '120px',
                  transform: 'translate(-50%, -50%) scale(5)',
                  borderRadius: '50%',
                  backgroundColor: '#FA6C43',
                }}
              >
                {/* Question text — sits inside the dot at hero scale */}
                <div
                  ref={dotTextRef}
                  className="absolute inset-0 flex items-center justify-center text-center px-6"
                  style={{
                    fontFamily: "'Newsreader', Georgia, serif",
                    fontWeight: 400,
                    fontStyle: 'italic',
                    color: '#FFFFFF',
                    fontSize: '18px',
                    lineHeight: 1.35,
                  }}
                >
                  Are you ready to redefine learning?
                </div>
              </div>
            </div>

            {/* SCROLL CUE — bottom center */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
              <span
                className="text-[10px] uppercase tracking-[0.2em]"
                style={{ color: 'rgba(255,255,255,0.55)' }}
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

            {/* SKIP INTRO — bottom right */}
            <button
              onClick={() => {
                document.getElementById('cta')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="absolute bottom-10 right-6 lg:right-12 text-xs font-medium transition-opacity hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.6)' }}
            >
              Skip intro →
            </button>
          </section>

          {/* === ORBIT (sticky over the upcoming feature sections) === */}
          <div
            className="sticky top-0 left-0 w-full h-0 z-30 pointer-events-none"
            style={{ height: 0 }}
          >
            <div
              ref={orbitRef}
              className="absolute"
              style={{
                top: '60px',
                left: '120px',
                width: '480px',
                height: '480px',
                transformOrigin: 'center center',
              }}
            >
              {[0, 120, 240].map((angle, i) => {
                const r = 220;
                const cx = 240 + Math.cos((angle * Math.PI) / 180) * r;
                const cy = 240 + Math.sin((angle * Math.PI) / 180) * r;
                return (
                  <button
                    key={i}
                    ref={(el) => (iconRefs.current[i] = el)}
                    onClick={() => jumpTo(UVPS[i].id)}
                    className="absolute pointer-events-auto rounded-2xl overflow-hidden bg-transparent border-0 cursor-pointer hover:scale-105 transition-transform"
                    style={{
                      top: cy,
                      left: cx,
                      width: 64,
                      height: 64,
                      transform: 'translate(-50%, -50%)',
                    }}
                    title={UVPS[i].headline}
                  >
                    <img
                      src={UVPS[i].icon}
                      alt={UVPS[i].iconAlt}
                      className="w-full h-full object-contain"
                      style={{ mixBlendMode: 'multiply' }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* === FEATURE SECTIONS === */}
          {UVPS.map((uvp, i) => (
            <section
              key={uvp.id}
              id={uvp.id}
              ref={(el) => (featureRefs.current[i] = el)}
              className="relative min-h-screen flex items-center justify-center px-6 lg:px-24 py-24"
              style={{ backgroundColor: '#FAFAF7' }}
            >
              <div
                className={`max-w-4xl w-full ${
                  uvp.side === 'left' ? 'text-left' : 'text-right ml-auto'
                }`}
              >
                <h2
                  className="font-bold text-3xl lg:text-5xl tracking-tight leading-tight mb-6"
                  style={{ color: '#FA6C43' }}
                >
                  {uvp.headline}
                </h2>
                <div
                  className="h-px w-24 mb-6"
                  style={{
                    backgroundColor: 'rgba(250,108,67,0.3)',
                    marginLeft: uvp.side === 'right' ? 'auto' : 0,
                  }}
                />
                <p className="text-lg lg:text-xl leading-relaxed text-gray-700 max-w-2xl">
                  {uvp.body}
                </p>
              </div>
            </section>
          ))}

          {/* === CLOSER === */}
          <section
            id="cta"
            ref={ctaRef}
            className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24"
            style={{ backgroundColor: '#FAFAF7' }}
          >
            {/* Re-converged icons stagger in */}
            <div className="flex items-center justify-center gap-6 mb-12">
              {UVPS.map((uvp, i) => (
                <div
                  key={uvp.id}
                  ref={(el) => (ctaIconRefs.current[i] = el)}
                  className="w-14 h-14 rounded-2xl overflow-hidden"
                  style={{ opacity: 0 }}
                >
                  <img
                    src={uvp.icon}
                    alt=""
                    className="w-full h-full object-contain"
                    style={{ mixBlendMode: 'multiply' }}
                  />
                </div>
              ))}
              {/* Hover-wave hand — last in the stagger */}
              <div
                ref={(el) => (ctaIconRefs.current[3] = el)}
                className="w-14 h-14 rounded-2xl overflow-hidden landing-hand"
                style={{ opacity: 0, transformOrigin: '50% 90%' }}
              >
                <img
                  src="/illustrations/icon-hand.jpg"
                  alt="Wave hello"
                  className="w-full h-full object-contain"
                  style={{ mixBlendMode: 'multiply' }}
                />
              </div>
            </div>

            <h2
              className="text-4xl lg:text-6xl font-bold tracking-tight text-center mb-4"
              style={{ color: '#1F1F1F' }}
            >
              Don&rsquo;t miss out.
            </h2>
            <p className="text-lg text-gray-600 text-center mb-10 max-w-xl">
              Build a custom AI tutor for your class in minutes. No engineering, no lock-in.
            </p>

            <button
              data-cta
              onClick={() => navigate('/register')}
              className="px-10 py-4 rounded-2xl text-lg font-bold text-white shadow-lg active:scale-95 transition-all hover:opacity-95"
              style={{ backgroundColor: '#FA6C43' }}
            >
              Build your own bot
            </button>
          </section>
        </>
      )}

      {/* FOOTER */}
      <footer
        className="px-6 lg:px-12 py-8 text-center text-sm"
        style={{
          backgroundColor: skipMode || theme === 'light' ? '#FAFAF7' : '#1F1F1F',
          color: skipMode || theme === 'light' ? '#888888' : 'rgba(255,255,255,0.5)',
        }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-6xl mx-auto">
          <span>&copy; 2026 ACTR Lab</span>
          <div className="flex items-center gap-5">
            <Link to="/about" className="hover:opacity-80">
              About
            </Link>
            <a href="mailto:hello@actrlab.com" className="hover:opacity-80">
              Contact
            </a>
            <Link to="/login" className="hover:opacity-80">
              Sign in
            </Link>
          </div>
        </div>
      </footer>

      {/* Scoped CSS for the hover-wave keyframe and reduced-motion fallback */}
      <style>{`
        @keyframes landing-wave {
          0%, 100% { transform: rotate(-15deg); }
          50% { transform: rotate(15deg); }
        }
        .landing-hand:hover img {
          animation: landing-wave 1.2s ease-in-out infinite;
          transform-origin: 50% 90%;
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-hand:hover img { animation: none; }
        }
      `}</style>
    </div>
  );
};

// Static fallback for visitors who've already seen the cinematic
// (or who prefer reduced motion). Same content, no choreography.
const StaticLayout = ({ uvps }) => (
  <div className="min-h-screen pt-24 px-6 lg:px-12 pb-24" style={{ backgroundColor: '#FAFAF7' }}>
    <div className="max-w-5xl mx-auto">
      <div className="text-center mb-16">
        <h1 className="text-5xl lg:text-7xl font-bold tracking-tight mb-4" style={{ color: '#1F1F1F' }}>
          ACTR Lab
        </h1>
        <p className="text-xl text-gray-600">
          Custom AI tutors for your class. Pick your model, ground in your files, distribute with one link.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
        {uvps.map((uvp) => (
          <div key={uvp.id} className="bg-white rounded-2xl p-8 border border-gray-100">
            <img
              src={uvp.icon}
              alt={uvp.iconAlt}
              className="w-12 h-12 mb-6"
              style={{ mixBlendMode: 'multiply' }}
            />
            <h2 className="text-xl font-bold mb-3" style={{ color: '#FA6C43' }}>
              {uvp.headline}
            </h2>
            <p className="text-gray-600">{uvp.body}</p>
          </div>
        ))}
      </div>

      <div className="text-center">
        <Link
          to="/register"
          className="inline-block px-10 py-4 rounded-2xl text-lg font-bold text-white shadow-lg"
          style={{ backgroundColor: '#FA6C43' }}
        >
          Build your own bot
        </Link>
      </div>
    </div>
  </div>
);

export default LandingV2;
