/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-10-04
 * @changed   Rework for phones + hierarchy: transparent illustration (no white box), real wordmark,
 *            "Page not found" copy, solid primary CTA (dashboard when signed in) + Go back, decorative
 *            icons only from lg and static (no drift loop / press-shrink, per the quiet-motion rule).
 * @changed   Prior: Home links go to '/' instead of the old /home splash.
 */
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isLoggedIn, dashboardPath } from '../utils/auth';

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

// Decorative brand icons. Only rendered from lg, where the margins are wide enough that they
// frame the message instead of landing on it (on a phone they covered the copy and the button).
const FLOATING_ICONS = [
  { src: '/illustrations/icon-calculator.png', top: '16%',    left: '7%',   size: 104, rotate: -18 },
  { src: '/illustrations/icon-laptop.png',     top: '14%',    right: '7%',  size: 120, rotate: 16 },
  { src: '/illustrations/icon-pencil.png',     top: '46%',    right: '5%',  size: 96,  rotate: 22 },
  { src: '/illustrations/icon-glasses.png',    bottom: '12%', right: '10%', size: 116, rotate: -14 },
  { src: '/illustrations/icon-hashtag.png',    bottom: '16%', left: '8%',   size: 100, rotate: 12 },
];

const NotFoundPage = () => {
  const navigate = useNavigate();
  const loggedIn = isLoggedIn();

  // Go back only when there's an in-app page to return to; a direct hit on a dead link
  // has no history, so fall back to the same place as the primary button.
  const goBack = () => {
    if (window.history.state && window.history.state.idx > 0) navigate(-1);
    else navigate(loggedIn ? dashboardPath() : '/');
  };

  return (
    <div
      className="relative min-h-[100dvh] w-full overflow-hidden flex flex-col"
      style={{
        background: 'linear-gradient(180deg, #FFFFFF 0%, #F1F6FB 70%, #E8F0F8 100%)',
        fontFamily: FONT_BODY,
      }}
    >
      <header className="relative z-20 px-6 lg:px-12 pt-6">
        <Link to="/" className="inline-flex items-center transition-opacity hover:opacity-80">
          <img
            src="/actrlabs-wordmark.png"
            alt="ACTRLabs: Redefining Learning"
            className="h-8 w-auto select-none"
            draggable={false}
          />
        </Link>
      </header>

      {FLOATING_ICONS.map((icon, i) => (
        <img
          key={i}
          src={icon.src}
          alt=""
          aria-hidden
          draggable={false}
          className="hidden lg:block absolute pointer-events-none select-none"
          style={{
            top: icon.top,
            left: icon.left,
            right: icon.right,
            bottom: icon.bottom,
            width: `${icon.size}px`,
            height: 'auto',
            transform: `rotate(${icon.rotate}deg)`,
          }}
        />
      ))}

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 pb-16 text-center">
        <img
          src="/email-forgot.png"
          alt=""
          aria-hidden
          draggable={false}
          className="w-40 sm:w-48 h-auto select-none mb-6"
        />

        <p
          className="text-xs font-bold uppercase tracking-[0.18em] text-[#FA6C43] mb-3"
          style={{ fontFamily: FONT_BODY }}
        >
          404
        </p>

        <h1
          className="text-3xl sm:text-4xl lg:text-5xl mb-3"
          style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, letterSpacing: '-0.02em', color: '#1F1F1F', lineHeight: 1.1 }}
        >
          Page not found
        </h1>

        <p
          className="text-[15px] lg:text-base max-w-sm mb-8"
          style={{ fontFamily: FONT_BODY, fontWeight: 500, color: '#1F1F1F', lineHeight: 1.55, textWrap: 'balance' }}
        >
          The link may be broken, or the page may have moved.
        </p>

        {/* Primary action first on phones (stacked, full width); side by side from sm. */}
        <div className="w-full max-w-xs sm:max-w-none sm:w-auto flex flex-col sm:flex-row-reverse items-stretch sm:items-center gap-3">
          <Link
            to={loggedIn ? dashboardPath() : '/'}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-transparent text-[15px] font-semibold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-colors"
          >
            {loggedIn ? 'Back to dashboard' : 'Go to homepage'}
          </Link>
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl text-[15px] font-semibold text-[#1F1F1F] bg-white border border-gray-200 hover:border-[#FA6C43]/40 hover:text-[#FA6C43] transition-colors"
          >
            Go back
          </button>
        </div>
      </main>
    </div>
  );
};

export default NotFoundPage;
