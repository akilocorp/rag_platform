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
  const headlineRef = useRef(null);
  const logoRef = useRef(null);
  const philosophyRef = useRef(null);
  const philosophyTextRef = useRef(null);
  const wordRefs = useRef([]);
  const scrollCueRef = useRef(null);
  const skipIntroRef = useRef(null);
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
        .to(headlineRef.current, { opacity: 0, duration: 0.17, ease: 'power2.out' }, 0.05)
        // Scroll cue + skip-intro lose their reason to exist the moment
        // the user has scrolled. Fade them along with the headline.
        .to(scrollCueRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' }, 0.05)
        .to(skipIntroRef.current, { opacity: 0, duration: 0.15, ease: 'power2.out' }, 0.05)
        .fromTo(
          darkOverlayRef.current,
          { '--clip-radius': '2400px' },
          { '--clip-radius': '14px', duration: 0.55, ease: 'power2.inOut' },
          0
        )
        .to(darkOverlayRef.current, { opacity: 0, duration: 0.1, ease: 'sine.out' }, 0.55)
        .to(
          logoRef.current,
          {
            top: '30px',
            left: '48px',
            xPercent: -50,
            yPercent: -50,
            scale: 0.21,
            duration: 0.35,
            ease: 'power2.inOut',
          },
          0.65
        );

      // ---- PHILOSOPHY TEXT SCRUB (word-by-word) -------------------------
      // Each word is a separate <span> with its own initial near-white
      // color. As the user scrolls, the words darken to #1F1F1F in a
      // staggered wave — each word's color tween starts a beat after
      // the previous one, and the whole stagger maps to the section's
      // scroll progress. Reads like the user is "reading along" with
      // the scroll.
      const wordEls = wordRefs.current.filter(Boolean);
      if (wordEls.length > 0) {
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: philosophyRef.current,
            start: 'top 70%',
            end: 'bottom 55%',
            scrub: 0.6,
          },
        });
        wordEls.forEach((el, i) => {
          tl.to(el, { color: '#1F1F1F', duration: 0.4, ease: 'none' }, i * 0.12);
        });
      }

      // ---- FEATURE COPY FADE-UP ----------------------------------------
      // Each feature section fades its copy up smoothly on enter — no
      // orbit, no peel-offs; the copy itself is the moment.
      featureRefs.current.forEach((section) => {
        if (!section) return;
        const copy = section.querySelector('[data-feature-copy]');
        if (!copy) return;
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
      });

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
          '--nav-fg': '#FFFFFF',
          '--nav-fg-soft': 'rgba(255,255,255,0.85)',
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
        {/* Headline sits in front of the dark overlay (z=70) so it's
            readable while the dark mass covers the screen. White words +
            "Learning" in brand orange. Fades out before the overlay
            shrinks below the headline's bounds. */}
        <div
          ref={headlineRef}
          className="absolute inset-0 flex items-center justify-center text-center px-10"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            color: '#FFFFFF',
            fontSize: 'clamp(56px, 9vmin, 124px)',
            lineHeight: 0.98,
            letterSpacing: '-0.045em',
            zIndex: 70,
          }}
        >
          <span>
            Are you ready to redefine{' '}
            <span style={{ color: '#FA6C43' }}>Learning</span>?
          </span>
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
                      const idx = wordRefs.current.length;
                      return (
                        <span
                          key={`p${pi}-t${ti}-w${ppi}`}
                          ref={(el) => (wordRefs.current[idx] = el)}
                          style={{ color: '#E8E5DD' }}
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
          className="relative w-[70vw] max-w-[70vw] aspect-[5/3] flex items-center justify-center"
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
