import React, { useLayoutEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

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
  const navRef = useRef(null);
  const heroRef = useRef(null);
  const dotRef = useRef(null);
  const dotTextRef = useRef(null);
  const logoRef = useRef(null);
  const orbitRef = useRef(null);
  const orbitWrapRef = useRef(null);
  const iconRefs = useRef([]);
  const ctaIconRefs = useRef([]);
  const ctaRef = useRef(null);
  const featureRefs = useRef([]);

  useLayoutEffect(() => {
    if (reducedMotion()) return;

    const ctx = gsap.context(() => {
      // ---- HERO TRANSITION ----------------------------------------------
      // Scroll-tied. Giant orange dot (with question inside) shrinks to
      // nothing while the real logo fades in behind it. Bg eases dark →
      // off-white. Logo then migrates to the top-left nav slot. Nav
      // contrast flips simultaneously via CSS variables.
      const heroTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.6,
          onUpdate: (self) => {
            const isLight = self.progress > 0.55;
            navRef.current?.style.setProperty('--nav-fg', isLight ? '#1F1F1F' : '#FFFFFF');
            navRef.current?.style.setProperty(
              '--nav-fg-soft',
              isLight ? '#1F1F1F' : 'rgba(255,255,255,0.85)'
            );
          },
        },
      });

      heroTl
        // 1. Question text fades fast
        .to(dotTextRef.current, { opacity: 0, duration: 0.12, ease: 'power2.out' }, 0)
        // 2. Giant dot shrinks + fades
        .to(
          dotRef.current,
          { scale: 0.04, opacity: 0, duration: 0.55, ease: 'power3.inOut' },
          0.05
        )
        // 3. Logo fades in + grows from small to natural
        .fromTo(
          logoRef.current,
          { opacity: 0, scale: 0.55 },
          { opacity: 1, scale: 1, duration: 0.45, ease: 'power3.out' },
          0.25
        )
        // 4. Bg eases dark → warm off-white
        .to(rootRef.current, { backgroundColor: '#FAFAF7', duration: 0.4 }, 0.5)
        // 5. Logo migrates into the top-left nav slot
        .to(
          logoRef.current,
          {
            top: 18,
            left: 24,
            xPercent: 0,
            yPercent: 0,
            scale: 0.18,
            duration: 0.5,
            ease: 'power3.inOut',
          },
          0.6
        );

      // ---- ORBIT REVEAL --------------------------------------------------
      // After the hero finishes, fade the icons in as a cluster around the
      // logo's nav position and start a slow rotation.
      gsap.set(orbitWrapRef.current, { opacity: 0, scale: 0.7 });
      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'bottom 80%',
        onEnter: () => {
          gsap.to(orbitWrapRef.current, {
            opacity: 1,
            scale: 1,
            duration: 0.7,
            ease: 'power2.out',
          });
          gsap.to(orbitRef.current, {
            rotation: 360,
            duration: 25,
            repeat: -1,
            ease: 'none',
          });
        },
      });

      // ---- FEATURE PEEL-OFFS --------------------------------------------
      // Each feature section pulls its icon along a unique bezier curve
      // from the orbit to a fixed landing zone in that section.
      featureRefs.current.forEach((section, i) => {
        if (!section) return;
        const icon = iconRefs.current[i];
        if (!icon) return;

        // Each curve has 3 control points relative to the icon's start
        // (i.e. its position in the orbit). Different shapes = each
        // peel-off feels choreographed, not on rails.
        const curves = [
          // UVP 1: right-down arc, lands left of section center
          [
            { x: 0, y: 0 },
            { x: 240, y: 280 },
            { x: -260, y: 540 },
          ],
          // UVP 2: left-down arc, lands right of section center
          [
            { x: 0, y: 0 },
            { x: -260, y: 320 },
            { x: 280, y: 580 },
          ],
          // UVP 3: down-right arc, lands lower-left
          [
            { x: 0, y: 0 },
            { x: 180, y: 360 },
            { x: -240, y: 620 },
          ],
        ];

        ScrollTrigger.create({
          trigger: section,
          start: 'top 65%',
          onEnter: () => {
            gsap.set(icon, { rotation: 0 });
            gsap.to(icon, {
              motionPath: { path: curves[i], curviness: 1.5 },
              duration: 1.4,
              ease: 'power2.inOut',
            });
          },
          once: true,
        });
      });

      // ---- CLOSER STAGGER -----------------------------------------------
      // The 3 orbit icons + the hand stagger in around the CTA. The CTA
      // button gets one soft glow pulse the moment everything settles.
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
          const btn = ctaRef.current?.querySelector('[data-cta]');
          if (btn) {
            gsap.fromTo(
              btn,
              { boxShadow: '0 0 0 0 rgba(250,108,67,0.55)' },
              {
                boxShadow: '0 0 0 18px rgba(250,108,67,0)',
                duration: 1.4,
                delay: 1.0,
                ease: 'power2.out',
              }
            );
          }
        },
        once: true,
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

  // Click-to-jump from the orbit (TOC affordance)
  const jumpTo = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      ref={rootRef}
      className="relative min-h-screen overflow-x-hidden"
      style={{
        backgroundColor: '#1F1F1F',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      }}
    >
      {/* === PERSISTENT TOP NAV === */}
      <nav
        ref={navRef}
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-end gap-3 px-6 lg:px-12 py-4"
        style={{ '--nav-fg': '#FFFFFF', '--nav-fg-soft': 'rgba(255,255,255,0.85)' }}
      >
        <Link
          to="/login"
          className="text-sm font-medium transition-opacity hover:opacity-80"
          style={{ color: 'var(--nav-fg-soft)' }}
        >
          Sign in
        </Link>
        <Link
          to="/register"
          className="px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ backgroundColor: '#FA6C43', color: '#FFFFFF' }}
        >
          Get started
        </Link>
      </nav>

      {/* === LOGO LAYER ===
          Lives outside the hero so it can survive the migration to the nav.
          Starts centered + faded, fades in as the giant dot shrinks. */}
      <img
        ref={logoRef}
        src="/logo-A-color.jpg"
        alt="ACTR Lab"
        className="fixed pointer-events-none select-none"
        style={{
          top: '50%',
          left: '50%',
          width: '180px',
          height: 'auto',
          transform: 'translate(-50%, -50%)',
          opacity: 0,
          zIndex: 40,
          mixBlendMode: 'multiply',
        }}
      />

      {/* === HERO === */}
      <section
        ref={heroRef}
        className="relative h-screen flex items-center justify-center"
      >
        {/* Giant orange dot — the seed of the idea, with the whispered
            question inside. Shrinks on scroll, ceding the spotlight to
            the real logo behind it. */}
        <div
          ref={dotRef}
          className="absolute"
          style={{
            top: '50%',
            left: '50%',
            width: '46vh',
            height: '46vh',
            maxWidth: '520px',
            maxHeight: '520px',
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            backgroundColor: '#FA6C43',
            zIndex: 30,
            boxShadow: '0 30px 80px rgba(250,108,67,0.25)',
          }}
        >
          <div
            ref={dotTextRef}
            className="absolute inset-0 flex items-center justify-center text-center px-8"
            style={{
              fontFamily: "'Newsreader', Georgia, serif",
              fontWeight: 400,
              fontStyle: 'italic',
              color: '#FFFFFF',
              fontSize: 'clamp(20px, 2.4vw, 30px)',
              lineHeight: 1.3,
              letterSpacing: '0.005em',
            }}
          >
            Are you ready to redefine learning?
          </div>
        </div>

        {/* SCROLL CUE */}
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
          <span
            className="text-[10px] uppercase tracking-[0.22em]"
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

        {/* SKIP INTRO */}
        <button
          onClick={() => document.getElementById('cta')?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-10 right-6 lg:right-12 text-xs font-medium hover:opacity-90 transition-opacity"
          style={{ color: 'rgba(255,255,255,0.55)' }}
        >
          Skip intro →
        </button>
      </section>

      {/* === ORBIT (sticky) ===
          Sits in the upper-left, anchored slightly to the right of where
          the logo lands in the nav. Each icon fans out to its UVP. */}
      <div
        ref={orbitWrapRef}
        className="fixed pointer-events-none z-30"
        style={{
          top: '110px',
          left: '90px',
          width: '320px',
          height: '320px',
          opacity: 0,
        }}
      >
        <div
          ref={orbitRef}
          className="relative w-full h-full"
          style={{ transformOrigin: 'center center' }}
        >
          {[0, 120, 240].map((angle, i) => {
            const r = 130;
            const cx = 160 + Math.cos((angle * Math.PI) / 180) * r;
            const cy = 160 + Math.sin((angle * Math.PI) / 180) * r;
            return (
              <button
                key={i}
                ref={(el) => (iconRefs.current[i] = el)}
                onClick={() => jumpTo(UVPS[i].id)}
                className="absolute pointer-events-auto rounded-2xl overflow-hidden bg-transparent border-0 cursor-pointer hover:scale-110 transition-transform"
                style={{
                  top: cy,
                  left: cx,
                  width: 56,
                  height: 56,
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
          className="relative min-h-screen flex items-center px-6 lg:px-24 py-24"
          style={{ backgroundColor: '#FAFAF7' }}
        >
          <div
            className={`max-w-3xl w-full ${
              uvp.side === 'right' ? 'ml-auto text-right' : 'mr-auto text-left'
            }`}
          >
            <span
              className="inline-block text-xs font-semibold uppercase tracking-[0.2em] mb-4"
              style={{ color: '#FA6C43' }}
            >
              {`0${i + 1} / 03`}
            </span>
            <h2
              className="font-bold text-3xl lg:text-5xl tracking-tight leading-[1.1] mb-6"
              style={{ color: '#1F1F1F' }}
            >
              {uvp.headline}
            </h2>
            <div
              className="h-px w-20 mb-6"
              style={{
                backgroundColor: 'rgba(250,108,67,0.4)',
                marginLeft: uvp.side === 'right' ? 'auto' : 0,
              }}
            />
            <p className="text-lg lg:text-xl leading-relaxed text-gray-700 max-w-2xl ml-auto mr-auto">
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
                style={{ mixBlendMode: 'multiply', animationDelay: `${i * 0.4}s` }}
              />
            </div>
          ))}
          <div
            ref={(el) => (ctaIconRefs.current[3] = el)}
            className="w-14 h-14 rounded-2xl overflow-hidden landing-icon-float"
            style={{ opacity: 0 }}
          >
            <img
              src="/illustrations/icon-hand.jpg"
              alt=""
              className="w-full h-full object-contain"
              style={{ mixBlendMode: 'multiply', animationDelay: '1.2s' }}
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

      {/* === FOOTER === */}
      <footer
        className="px-6 lg:px-12 py-8 text-sm"
        style={{ backgroundColor: '#FAFAF7', color: '#888' }}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 max-w-6xl mx-auto">
          <span>&copy; 2026 ACTR Lab</span>
          <div className="flex items-center gap-5">
            <Link to="/about" className="hover:opacity-80">About</Link>
            <a href="mailto:hello@actrlab.com" className="hover:opacity-80">Contact</a>
            <Link to="/login" className="hover:opacity-80">Sign in</Link>
          </div>
        </div>
      </footer>

      {/* Scoped CSS — gentle in-place float on the closer icons */}
      <style>{`
        @keyframes landing-icon-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        .landing-icon-float img {
          animation: landing-icon-float 3.2s ease-in-out infinite;
          will-change: transform;
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-icon-float img { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default LandingV2;
