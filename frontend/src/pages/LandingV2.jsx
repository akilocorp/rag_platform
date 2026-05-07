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

const TESTIMONIALS = [
  {
    quote:
      "My students stopped fishing on the open web for half-baked answers. They go to our class bot, get an answer grounded in my notes, and bring sharper questions to office hours.",
    author: "Dr. Reema Patel",
    role: "Lecturer in Mechanical Engineering",
  },
  {
    quote:
      "Setting up A/B variants in five minutes is what sold me. We're running a real cohort study without writing a single line of infrastructure code.",
    author: "Prof. Marcus Chen",
    role: "Education Researcher",
  },
  {
    quote:
      "It feels like the bot was built for our class, because in a sense it was. The Qualtrics integration captured every transcript I needed for my IRB submission.",
    author: "Dr. Sara Lindqvist",
    role: "Cognitive Science",
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

  // Testimonial carousel state
  const [activeTestimonial, setActiveTestimonial] = useState(0);
  const [testimonialPaused, setTestimonialPaused] = useState(false);
  useEffect(() => {
    if (testimonialPaused) return;
    const id = setInterval(() => {
      setActiveTestimonial((i) => (i + 1) % TESTIMONIALS.length);
    }, 6000);
    return () => clearInterval(id);
  }, [testimonialPaused]);

  useLayoutEffect(() => {
    if (reducedMotion()) return;

    const ctx = gsap.context(() => {
      // ---- HERO TRANSITION ----------------------------------------------
      // Smoother dot-shrink + logo-grow + bg-ease + nav-migrate.
      // expo.inOut on the dot for premium feel; staggered timeline so
      // each phase has breathing room.
      const heroTl = gsap.timeline({
        scrollTrigger: {
          trigger: heroRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 0.8,
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
        .to(dotTextRef.current, { opacity: 0, duration: 0.1, ease: 'power2.out' }, 0)
        .to(
          dotRef.current,
          { scale: 0.04, opacity: 0, duration: 0.55, ease: 'expo.inOut' },
          0.05
        )
        .fromTo(
          logoRef.current,
          { opacity: 0, scale: 0.6 },
          { opacity: 1, scale: 1, duration: 0.5, ease: 'expo.out' },
          0.3
        )
        .to(rootRef.current, { backgroundColor: '#FAFAF7', duration: 0.45, ease: 'sine.inOut' }, 0.5)
        .to(
          logoRef.current,
          {
            top: 22,
            left: 28,
            xPercent: 0,
            yPercent: 0,
            scale: 0.16,
            duration: 0.55,
            ease: 'power3.inOut',
          },
          0.62
        );

      // ---- ORBIT REVEAL --------------------------------------------------
      // Continuous rotation; appears once the wordmark settles into nav.
      // Bigger, slower, more confident.
      gsap.set(orbitWrapRef.current, { opacity: 0, scale: 0.7 });
      ScrollTrigger.create({
        trigger: heroRef.current,
        start: 'bottom 75%',
        onEnter: () => {
          gsap.to(orbitWrapRef.current, {
            opacity: 1,
            scale: 1,
            duration: 0.8,
            ease: 'expo.out',
          });
          gsap.to(orbitRef.current, {
            rotation: 360,
            duration: 30,
            repeat: -1,
            ease: 'none',
          });
        },
      });

      // ---- FEATURE ENTER PULSE ------------------------------------------
      // No more bezier peel-off. Instead, when a feature section enters,
      // the matching orbit icon does a subtle scale-up pulse + glow as a
      // "this section corresponds to this icon" cue.
      featureRefs.current.forEach((section, i) => {
        if (!section) return;
        ScrollTrigger.create({
          trigger: section,
          start: 'top 65%',
          onEnter: () => {
            const icon = iconRefs.current[i];
            if (!icon) return;
            gsap.fromTo(
              icon,
              { scale: 1, filter: 'drop-shadow(0 0 0 rgba(250,108,67,0))' },
              {
                scale: 1.45,
                filter: 'drop-shadow(0 0 18px rgba(250,108,67,0.55))',
                duration: 0.45,
                ease: 'power3.out',
                yoyo: true,
                repeat: 1,
              }
            );
          },
        });

        // Smooth fade-up for the feature copy as it enters viewport.
        const copy = section.querySelector('[data-feature-copy]');
        if (copy) {
          gsap.fromTo(
            copy,
            { opacity: 0, y: 36 },
            {
              opacity: 1,
              y: 0,
              duration: 0.9,
              ease: 'power3.out',
              scrollTrigger: { trigger: section, start: 'top 75%' },
            }
          );
        }
      });

      // ---- CLOSER STAGGER -----------------------------------------------
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
          const btn = ctaRef.current?.querySelector('[data-cta]');
          if (btn) {
            gsap.fromTo(
              btn,
              { boxShadow: '0 0 0 0 rgba(250,108,67,0.55)' },
              {
                boxShadow: '0 0 0 22px rgba(250,108,67,0)',
                duration: 1.4,
                delay: 0.95,
                ease: 'expo.out',
              }
            );
          }
        },
        once: true,
      });
    }, rootRef);

    return () => ctx.revert();
  }, []);

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
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-end gap-3 px-6 lg:px-12 py-4"
        style={{ '--nav-fg': '#FFFFFF', '--nav-fg-soft': 'rgba(255,255,255,0.85)' }}
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

      {/* === LOGO LAYER === */}
      <img
        ref={logoRef}
        src="/logo-A.svg"
        alt="ACTRLabs"
        className="fixed pointer-events-none select-none z-40"
        style={{
          top: '50%',
          left: '50%',
          width: '240px',
          height: 'auto',
          transform: 'translate(-50%, -50%)',
          opacity: 0,
        }}
      />

      {/* === HERO === */}
      <section
        ref={heroRef}
        className="relative h-screen flex items-center justify-center"
      >
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
            boxShadow: '0 30px 80px rgba(250,108,67,0.3)',
          }}
        >
          <div
            ref={dotTextRef}
            className="absolute inset-0 flex items-center justify-center text-center px-8"
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 800,
              color: '#FFFFFF',
              fontSize: 'clamp(22px, 2.6vw, 34px)',
              lineHeight: 1.2,
              letterSpacing: '-0.01em',
            }}
          >
            Are you ready to redefine learning?
          </div>
        </div>

        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none z-20">
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
          onClick={() => document.getElementById('cta')?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-10 right-6 lg:right-12 text-xs font-medium hover:opacity-90 transition-opacity z-20"
          style={{ color: 'rgba(255,255,255,0.55)', fontFamily: FONT_BODY }}
        >
          Skip intro →
        </button>
      </section>

      {/* === ORBIT (fixed, sticks while you scroll) === */}
      <div
        ref={orbitWrapRef}
        className="fixed pointer-events-none z-30"
        style={{
          top: '120px',
          left: '110px',
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
            const r = 138;
            const cx = 160 + Math.cos((angle * Math.PI) / 180) * r;
            const cy = 160 + Math.sin((angle * Math.PI) / 180) * r;
            return (
              <button
                key={i}
                ref={(el) => (iconRefs.current[i] = el)}
                onClick={() => jumpTo(UVPS[i].id)}
                className="absolute pointer-events-auto bg-transparent border-0 cursor-pointer hover:scale-110 transition-transform"
                style={{
                  top: cy,
                  left: cx,
                  width: 60,
                  height: 60,
                  transform: 'translate(-50%, -50%)',
                  transformOrigin: 'center center',
                }}
                title={UVPS[i].headline}
              >
                <img
                  src={UVPS[i].icon}
                  alt={UVPS[i].iconAlt}
                  className="w-full h-full object-contain"
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
          className="relative min-h-screen flex items-center px-6 lg:px-24 py-24 z-10"
          style={{ backgroundColor: '#FAFAF7' }}
        >
          <div
            data-feature-copy
            className={`max-w-3xl w-full ${
              uvp.side === 'right' ? 'ml-auto text-right' : 'mr-auto text-left'
            }`}
          >
            <span
              className="inline-block text-xs font-bold uppercase tracking-[0.22em] mb-4"
              style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
            >
              {`0${i + 1} / 03`}
            </span>
            <h2
              className="text-4xl lg:text-6xl tracking-tight leading-[1.05] mb-6"
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
              className="h-px w-20 mb-6"
              style={{
                backgroundColor: 'rgba(250,108,67,0.5)',
                marginLeft: uvp.side === 'right' ? 'auto' : 0,
              }}
            />
            <p
              className="text-lg lg:text-xl leading-relaxed text-gray-700 max-w-2xl"
              style={{
                fontFamily: FONT_BODY,
                marginLeft: uvp.side === 'right' ? 'auto' : 0,
              }}
            >
              {uvp.body}
            </p>
          </div>
        </section>
      ))}

      {/* === TESTIMONIALS === */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center px-6 py-24 z-10"
        style={{ backgroundColor: '#FAFAF7' }}
      >
        <span
          className="text-xs font-bold uppercase tracking-[0.22em] mb-12"
          style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
        >
          What educators say
        </span>

        <div
          className="relative w-full max-w-xl aspect-square flex items-center justify-center"
          onMouseEnter={() => setTestimonialPaused(true)}
          onMouseLeave={() => setTestimonialPaused(false)}
        >
          <div
            className="absolute inset-0 bg-white shadow-xl border border-gray-100"
            style={{ borderRadius: '24px' }}
          />
          {TESTIMONIALS.map((t, i) => (
            <div
              key={i}
              className="absolute inset-0 flex flex-col items-center justify-center px-10 lg:px-16 text-center transition-opacity duration-700"
              style={{
                opacity: i === activeTestimonial ? 1 : 0,
                pointerEvents: i === activeTestimonial ? 'auto' : 'none',
              }}
            >
              <span
                className="text-5xl mb-2 leading-none"
                style={{ color: 'rgba(250,108,67,0.4)', fontFamily: FONT_DISPLAY }}
                aria-hidden
              >
                &ldquo;
              </span>
              <p
                className="text-lg lg:text-xl leading-relaxed mb-8"
                style={{ color: '#1F1F1F', fontFamily: FONT_BODY }}
              >
                {t.quote}
              </p>
              <p
                className="text-sm font-bold mb-1"
                style={{ color: '#FA6C43', fontFamily: FONT_BODY }}
              >
                {t.author}
              </p>
              <p
                className="text-xs uppercase tracking-[0.18em] text-gray-500"
                style={{ fontFamily: FONT_BODY }}
              >
                {t.role}
              </p>
            </div>
          ))}
        </div>

        {/* Animated dots indicator */}
        <div className="flex items-center justify-center gap-2.5 mt-10">
          {TESTIMONIALS.map((_, i) => (
            <button
              key={i}
              onClick={() => setActiveTestimonial(i)}
              aria-label={`Go to testimonial ${i + 1}`}
              className="h-2.5 rounded-full transition-all duration-500 ease-out"
              style={{
                width: i === activeTestimonial ? 32 : 10,
                backgroundColor: i === activeTestimonial ? '#FA6C43' : 'rgba(31,31,31,0.18)',
              }}
            />
          ))}
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
          className="px-10 py-4 text-lg font-bold text-white shadow-lg active:scale-95 transition-all hover:opacity-95"
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

      {/* Closer-icon idle float + reduced-motion fallback */}
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
