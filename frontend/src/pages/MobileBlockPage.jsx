import React from 'react';

const FONT_DISPLAY = "'Wix Madefor Display', system-ui, sans-serif";
const FONT_BODY = "'Wix Madefor Text', system-ui, sans-serif";

const MobileBlockPage = () => {
  return (
    <div
      className="relative min-h-screen w-full overflow-hidden"
      style={{
        background:
          'linear-gradient(180deg, #FFFFFF 0%, #F1F6FB 70%, #E8F0F8 100%)',
        fontFamily: FONT_BODY,
      }}
    >
      <div
        className="absolute z-20"
        style={{ top: '28px', left: '24px' }}
      >
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: '1.25rem',
            color: '#1F1F1F',
            letterSpacing: '-0.02em',
          }}
        >
          actrLabs
        </span>
      </div>

      <main className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <div className="mobile-block-fade" style={{ marginBottom: '28px' }}>
          <div style={{ transform: 'translateX(-10%)' }}>
            <img
              src="/email-forgot.jpg"
              alt=""
              aria-hidden
              draggable={false}
              className="select-none"
              style={{
                width: '200px',
                height: 'auto',
                maxWidth: '55vw',
                mixBlendMode: 'multiply',
              }}
            />
          </div>
        </div>

        <h1
          className="mobile-block-fade"
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 800,
            fontSize: 'clamp(1.6rem, 6vw, 2.25rem)',
            letterSpacing: '-0.02em',
            color: '#1F1F1F',
            lineHeight: 1.1,
            marginBottom: '14px',
            animationDelay: '0.1s',
          }}
        >
          Mobile isn&rsquo;t ready yet
        </h1>

        <p
          className="mobile-block-fade"
          style={{
            fontFamily: FONT_BODY,
            fontSize: '1rem',
            color: 'rgba(31,31,31,0.6)',
            maxWidth: '420px',
            lineHeight: 1.55,
            marginBottom: '24px',
            animationDelay: '0.2s',
          }}
        >
          Sorry, we haven&rsquo;t released ACTRLabs for mobile browsers yet.
          Please open this link on a laptop or desktop browser.
        </p>

        <div
          className="mobile-block-fade"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            backgroundColor: '#FDE3D8',
            color: '#1F1F1F',
            fontFamily: FONT_BODY,
            fontWeight: 600,
            fontSize: '0.95rem',
            padding: '10px 20px',
            borderRadius: '999px',
            border: '1px solid rgba(250,108,67,0.18)',
            boxShadow: '0 8px 24px rgba(250,108,67,0.18)',
            animationDelay: '0.3s',
          }}
        >
          Laptop browser required
        </div>
      </main>

      <style>{`
        @keyframes mobileBlockFade {
          0%   { opacity: 0; transform: translateY(8px); }
          100% { opacity: 1; transform: translateY(0); }
        }
        .mobile-block-fade {
          animation: mobileBlockFade 0.6s ease-out both;
        }
        @media (prefers-reduced-motion: reduce) {
          .mobile-block-fade { animation: none; }
        }
      `}</style>
    </div>
  );
};

export default MobileBlockPage;
