// @language  JavaScript (React / JSX)
// @updated   2026-08-10
// @changed   New file: the illustrated full-screen loader, lifted out of PageTransition so
//            route guards and pages can show the same thing instead of a bare spinner.
import React, { useMemo } from 'react';

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

export const pickLoadingAsset = () => ASSETS[Math.floor(Math.random() * ASSETS.length)];

export const LOADING_FADE_MS = 260;

/**
 * Full-screen loader: illustration, a line of text, spinner.
 *
 * `asset` lets a caller hold one steady across re-renders (PageTransition picks its own
 * when a navigation starts); omit it and one is chosen once per mount. `message` replaces
 * the asset's quote — use it when the wait has a specific cause worth naming.
 */
export default function LoadingScreen({ asset, message, opacity = 1, fixed = true }) {
  const chosen = useMemo(() => asset || pickLoadingAsset(), [asset]);

  return (
    <>
      <div
        className={fixed ? 'app-loader app-loader--fixed' : 'app-loader'}
        style={{ opacity }}
        aria-busy="true"
      >
        <div className="app-loader__icon-wrap">
          <img src={chosen.icon} alt="" className="app-loader__icon" />
        </div>
        <p className="app-loader__quote">{message || chosen.quote}</p>
        <div className="app-loader__spinner" />
      </div>
      <style>{`
        @keyframes app-loader-wobble {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        @keyframes app-loader-fade-up {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes app-loader-spin {
          to { transform: rotate(360deg); }
        }
        .app-loader {
          position: absolute;
          inset: 0;
          background-color: #F0F6FB;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 28px;
          transition: opacity ${LOADING_FADE_MS}ms ease-out;
        }
        .app-loader--fixed {
          position: fixed;
          z-index: 9999;
        }
        .app-loader__icon-wrap {
          width: 84px;
          height: 84px;
          animation: app-loader-fade-up 320ms ease-out both;
        }
        .app-loader__icon {
          width: 100%;
          height: 100%;
          object-fit: contain;
          animation: app-loader-wobble 3.2s ease-in-out infinite;
          will-change: transform;
        }
        .app-loader__quote {
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
          animation: app-loader-fade-up 360ms ease-out 90ms both;
        }
        .app-loader__spinner {
          width: 26px;
          height: 26px;
          border: 2.5px solid rgba(31, 31, 31, 0.14);
          border-top-color: #FA6C43;
          border-radius: 50%;
          animation: app-loader-spin 0.85s linear infinite,
                     app-loader-fade-up 360ms ease-out 160ms both;
        }
        @media (prefers-reduced-motion: reduce) {
          .app-loader { transition: none; }
          .app-loader__icon { animation: none; }
          .app-loader__spinner { animation: app-loader-spin 0.85s linear infinite; }
          .app-loader__icon-wrap,
          .app-loader__quote { animation: none; }
        }
      `}</style>
    </>
  );
}
