/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-08-18
 * @changed   New — full-page notice shown when a chat turn can't finish. Mirrors NotFoundPage's layout so a
 *            broken stream lands somewhere that looks deliberate instead of leaving a half-written bubble.
 */
import React from 'react';
import { Link } from 'react-router-dom';

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

// Same drifting brand icons as the 404 page — this screen is its sibling, and a
// reader who has seen one should recognise the other as part of the product
// rather than as something that went wrong.
const FLOATING_ICONS = [
  { src: '/illustrations/icon-calculator.png', top: '14%',  left: '14%',  size: 116, rotate: -18 },
  { src: '/illustrations/icon-laptop.png',     top: '12%',  right: '12%', size: 132, rotate: 16 },
  { src: '/illustrations/icon-pencil.png',     top: '46%',  right: '10%', size: 108, rotate: 22 },
  { src: '/illustrations/icon-glasses.png',    bottom: '14%', right: '16%', size: 130, rotate: -14 },
  { src: '/illustrations/icon-hashtag.png',    bottom: '18%', left: '12%',  size: 112, rotate: 12 },
];

/**
 * Shown in place of the chat when a turn dies mid-stream.
 *
 * Says nothing about what broke — the cause is already logged server-side, and
 * naming it here would only worry a student who can't act on it. Reloading is
 * the whole remedy: prior turns are persisted, so a refresh restores the
 * conversation minus the one exchange that failed.
 */
const StreamInterruptedPage = () => (
  <div
    className="relative min-h-screen w-full overflow-hidden"
    style={{
      background: 'linear-gradient(180deg, #FFFFFF 0%, #F1F6FB 70%, #E8F0F8 100%)',
      fontFamily: FONT_BODY,
    }}
  >
    <Link to="/home" className="absolute z-20" style={{ top: '32px', left: '36px' }}>
      <span
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: '1.35rem',
          color: '#1F1F1F',
          letterSpacing: '-0.02em',
        }}
      >
        actrLabs
      </span>
    </Link>

    {/* Decorative only — pointer-events-none keeps clicks reaching the CTA. */}
    {FLOATING_ICONS.map((icon, i) => (
      <img
        key={i}
        src={icon.src}
        alt=""
        aria-hidden
        draggable={false}
        className="absolute pointer-events-none select-none stream-interrupted-float"
        style={{
          top: icon.top,
          left: icon.left,
          right: icon.right,
          bottom: icon.bottom,
          width: `${icon.size}px`,
          height: 'auto',
          transform: `rotate(${icon.rotate}deg)`,
          animationDelay: `${i * 0.6}s`,
        }}
      />
    ))}

    <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <img
        src="/email-forgot.jpg"
        alt=""
        aria-hidden
        draggable={false}
        className="select-none"
        style={{
          width: '220px',
          height: 'auto',
          maxWidth: '60vw',
          marginBottom: '28px',
          filter: 'drop-shadow(0 8px 24px rgba(31,31,31,0.08))',
        }}
      />

      <h1
        style={{
          fontFamily: FONT_DISPLAY,
          fontWeight: 800,
          fontSize: 'clamp(2rem, 4.5vw, 3rem)',
          letterSpacing: '-0.02em',
          color: '#1F1F1F',
          lineHeight: 1.05,
          marginBottom: '12px',
        }}
      >
        Please refresh the page
      </h1>

      <p
        style={{
          fontFamily: FONT_BODY,
          fontSize: '1.05rem',
          color: 'rgba(31,31,31,0.55)',
          maxWidth: '480px',
          lineHeight: 1.5,
          marginBottom: '32px',
        }}
      >
        Give it a refresh to pick up where you left off, or come back in a little while.
      </p>

      <button
        type="button"
        onClick={() => window.location.reload()}
        className="transition-all active:scale-95 hover:brightness-95"
        style={{
          backgroundColor: '#FDE3D8',
          color: '#1F1F1F',
          fontFamily: FONT_BODY,
          fontWeight: 600,
          fontSize: '1rem',
          padding: '12px 32px',
          borderRadius: '10px',
          border: '1px solid rgba(250,108,67,0.18)',
          boxShadow: '0 8px 24px rgba(250,108,67,0.18)',
        }}
      >
        Refresh
      </button>
    </main>

    <style>{`
      @keyframes streamInterruptedFloat {
        0%, 100% { translate: 0 0; }
        50%      { translate: 0 -10px; }
      }
      .stream-interrupted-float {
        animation: streamInterruptedFloat 6s ease-in-out infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .stream-interrupted-float { animation: none; }
      }
    `}</style>
  </div>
);

export default StreamInterruptedPage;
