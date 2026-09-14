// @language JavaScript (React / JSX)
// @updated   2026-09-14
// @changed   New file: ported from a hero-section template the team supplied for the LandingV2
//            splash redesign (converted from TSX to JSX, dropped type annotations — logic
//            unchanged). Word-by-word fade/slide-up entrance, once, on scroll into view. Much
//            lighter than the GSAP ScrollTrigger + WebGL setup it replaces in the hero: one
//            useInView check per mount, no per-frame work, no continuous animation once played.
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

// Plain identifier so the JSX tag below isn't a member expression
// (<motion.span>) — this project's eslint config has no react/JSX-aware
// no-unused-vars handling, which otherwise flags `motion` as unused despite
// being referenced only via the tag name.
const MotionSpan = motion.span;

export const WordsPullUp = ({ text, className = '', showAsterisk = false, style }) => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const words = text.split(' ');

  return (
    <div ref={ref} className={`inline-flex flex-wrap ${className}`} style={style}>
      {words.map((word, i) => {
        const isLast = i === words.length - 1;
        return (
          <MotionSpan
            key={i}
            initial={{ y: 20, opacity: 0 }}
            animate={isInView ? { y: 0, opacity: 1 } : {}}
            transition={{ duration: 0.6, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="inline-block relative"
            style={{ marginRight: isLast ? 0 : '0.25em' }}
          >
            {word}
            {showAsterisk && isLast && (
              <span className="absolute top-[0.65em] -right-[0.3em] text-[0.31em]">*</span>
            )}
          </MotionSpan>
        );
      })}
    </div>
  );
};

export default WordsPullUp;
