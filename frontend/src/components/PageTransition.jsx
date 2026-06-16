import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const ASSETS = [
  { icon: '/illustrations/icon-pencil.png',          quote: 'The pen is mightier than the sword.' },
  { icon: '/illustrations/book.svg',                 quote: 'A reader lives a thousand lives before he dies.' },
  { icon: '/illustrations/icon-glasses.png',         quote: 'The eye sees only what the mind is prepared to comprehend.' },
  { icon: '/illustrations/icon-question.png',        quote: 'The important thing is to not stop questioning.' },
  { icon: '/illustrations/icon-laptop.png',          quote: 'The computer was born to solve problems that did not exist before.' },
  { icon: '/illustrations/icon-hashtag.png',         quote: 'A small idea, well shared, becomes a movement.' },
  { icon: '/illustrations/icon-calculator.png',      quote: 'Pure mathematics is the poetry of logical ideas.' },
  { icon: '/illustrations/icon-hand.png',            quote: 'The hand is the cutting edge of the mind.' },
  { icon: '/illustrations/magnifying-glass.svg',     quote: 'Look closer; the answer is often hiding in plain sight.' },
  { icon: '/illustrations/stethoscope-medical.svg',  quote: 'Wherever the art of medicine is loved, there is also a love of humanity.' },
  { icon: '/illustrations/briefcase-business.svg',   quote: 'The only place where success comes before work is in the dictionary.' },
  { icon: '/illustrations/loudspeaker-humanities.svg', quote: 'Words have the power to both destroy and heal.' },
  { icon: '/illustrations/sprockets-engineering.svg', quote: 'Engineers turn dreams into reality, one gear at a time.' },
  { icon: '/illustrations/survey-clipboard-research.svg', quote: 'If we knew what we were doing, it would not be called research.' },
];

const MIN_DURATION_MS = 700;
const FADE_DURATION_MS = 240;

export default function PageTransition({ children }) {
  const location = useLocation();
  const firstRenderRef = useRef(true);
  const lastPathRef = useRef(location.pathname);
  const [overlay, setOverlay] = useState(null);

  useLayoutEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      lastPathRef.current = location.pathname;
      return;
    }
    if (lastPathRef.current === location.pathname) return;
    lastPathRef.current = location.pathname;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;

    const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];
    setOverlay({ asset, phase: 'in' });
  }, [location.pathname]);

  useEffect(() => {
    if (!overlay || overlay.phase !== 'in') return;
    const fadeTimer = setTimeout(() => {
      setOverlay((curr) => (curr ? { ...curr, phase: 'out' } : curr));
    }, MIN_DURATION_MS);
    return () => clearTimeout(fadeTimer);
  }, [overlay]);

  useEffect(() => {
    if (!overlay || overlay.phase !== 'out') return;
    const clearTimer = setTimeout(() => setOverlay(null), FADE_DURATION_MS);
    return () => clearTimeout(clearTimer);
  }, [overlay]);

  return (
    <>
      {children}
      {overlay && (
        <div
          className="page-transition-overlay"
          style={{ opacity: overlay.phase === 'in' ? 1 : 0 }}
          aria-hidden="true"
        >
          <div className="page-transition-icon-wrap">
            <img
              src={overlay.asset.icon}
              alt=""
              className="page-transition-icon"
            />
          </div>
          <p className="page-transition-quote">{overlay.asset.quote}</p>
          <div className="page-transition-spinner" />
        </div>
      )}
      <style>{`
        @keyframes page-transition-wobble {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        @keyframes page-transition-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes page-transition-spin {
          to { transform: rotate(360deg); }
        }
        .page-transition-overlay {
          position: fixed;
          inset: 0;
          z-index: 9999;
          background-color: #F0F6FB;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 28px;
          transition: opacity ${FADE_DURATION_MS}ms ease-out;
        }
        .page-transition-icon-wrap {
          width: 84px;
          height: 84px;
          animation: page-transition-fade-up 320ms ease-out both;
        }
        .page-transition-icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          animation: page-transition-wobble 3.2s ease-in-out infinite;
          will-change: transform;
        }
        .page-transition-quote {
          font-family: 'Plus Jakarta Sans', sans-serif;
          font-style: italic;
          font-weight: 500;
          font-size: 1.05rem;
          letter-spacing: -0.005em;
          color: #1F1F1F;
          max-width: 32rem;
          text-align: center;
          margin: 0;
          padding: 0 1.5rem;
          animation: page-transition-fade-up 360ms ease-out 90ms both;
        }
        .page-transition-spinner {
          width: 26px;
          height: 26px;
          border: 2.5px solid rgba(31, 31, 31, 0.14);
          border-top-color: #FA6C43;
          border-radius: 50%;
          animation: page-transition-spin 0.85s linear infinite,
                     page-transition-fade-up 360ms ease-out 160ms both;
        }
        @media (prefers-reduced-motion: reduce) {
          .page-transition-overlay { transition: none; }
          .page-transition-icon { animation: none; }
          .page-transition-spinner { animation: page-transition-spin 0.85s linear infinite; }
          .page-transition-icon-wrap,
          .page-transition-quote { animation: none; }
        }
      `}</style>
    </>
  );
}
