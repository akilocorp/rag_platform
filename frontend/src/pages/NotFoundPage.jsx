import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

const FLOATING_ICONS = [
  { src: '/illustrations/icon-calculator.png', top: '14%',  left: '14%',  size: 116, rotate: -18 },
  { src: '/illustrations/icon-laptop.png',     top: '12%',  right: '12%', size: 132, rotate: 16 },
  { src: '/illustrations/icon-pencil.png',     top: '46%',  right: '10%', size: 108, rotate: 22 },
  { src: '/illustrations/icon-glasses.png',    bottom: '14%', right: '16%', size: 130, rotate: -14 },
  { src: '/illustrations/icon-hashtag.png',    bottom: '18%', left: '12%',  size: 112, rotate: 12 },
];

const NotFoundPage = () => {
  const navigate = useNavigate();

  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, #FFFFFF 0%, #F1F6FB 70%, #E8F0F8 100%)',
        fontFamily: FONT_BODY,
      }}
    >
      {/* Wordmark — top-left */}
      <Link
        to="/home"
        className="absolute z-20"
        style={{ top: '32px', left: '36px' }}
      >
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

      {/* Floating brand icons. Pointer-events-none so clicks pass through
          to the centerpiece + button. Each icon has a slight rotation +
          gentle drift loop. */}
      {FLOATING_ICONS.map((icon, i) => (
        <img
          key={i}
          src={icon.src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute pointer-events-none select-none not-found-float"
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

      {/* Centerpiece — question-mark man, headline, subhead, CTA */}
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
          Error 404
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
          Oops. I couldn&rsquo;t find what you were looking for&hellip;
        </p>

        <button
          type="button"
          onClick={() => navigate('/home')}
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
          Back Home
        </button>
      </main>

      <style>{`
        @keyframes notFoundFloat {
          0%, 100% { translate: 0 0; }
          50%      { translate: 0 -10px; }
        }
        .not-found-float {
          animation: notFoundFloat 6s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .not-found-float { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default NotFoundPage;
