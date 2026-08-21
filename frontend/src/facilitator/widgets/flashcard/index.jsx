/*
 * @language JavaScript (React / JSX)
 * @updated 2026-08-16
 * @changed Add vertical padding around the flip-card row for more breathing room above/below the white card
 */
import React, { useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

// flashcard — a display-only deck of active-recall flip cards, shown ONE AT A
// TIME with prev/next arrows (not a grid).
// data shape (from the backend widget contract): { title?, cards: [{ front, back }] }
// Click the card to flip front↔back; the arrows step through the deck and reset
// the card to its Term side. Non-interactive (nothing is sent back).
function Renderer({ data }) {
  const cards = Array.isArray(data?.cards) ? data.cards : [];
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  if (cards.length === 0) return null;

  const clamped = Math.min(index, cards.length - 1);
  const card = cards[clamped];
  const atStart = clamped === 0;
  const atEnd = clamped === cards.length - 1;

  const go = (delta) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), cards.length - 1));
    setFlipped(false);
  };

  const arrowClass = (off) =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors ${
      off
        ? 'cursor-not-allowed border-gray-100 text-gray-300'
        : 'border-gray-200 bg-white text-gray-600 hover:border-[#FA6C43] hover:text-[#FA6C43]'
    }`;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.title && <p className="mb-2 text-sm font-semibold text-[#222]">{data.title}</p>}

      <div className="flex items-center gap-2 py-1.5">
        <button type="button" onClick={() => go(-1)} disabled={atStart} aria-label="Previous card" className={arrowClass(atStart)}>
          <FiChevronLeft />
        </button>

        {/* keyed wrapper → re-mounts on navigation so each card fades in */}
        <div key={clamped} className="fac-enter flex-1">
          <button
            type="button"
            onClick={() => setFlipped((f) => !f)}
            className="fac-flip group relative h-40 w-full text-left"
            aria-label={flipped ? 'Show term' : 'Show answer'}
          >
            <div className={`fac-flip-inner ${flipped ? 'is-flipped' : ''}`}>
              {/* front — the cue */}
              <div className="fac-flip-face flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-colors group-hover:border-[#FA6C43]">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Term</span>
                <p className="mt-1 flex-1 overflow-hidden text-sm font-semibold text-[#222] line-clamp-4">{card.front}</p>
                <span className="mt-2 text-[10px] font-medium text-gray-300 transition-colors group-hover:text-[#FA6C43]">Tap to flip</span>
              </div>
              {/* back — the recall target */}
              <div className="fac-flip-face fac-flip-back flex flex-col overflow-hidden rounded-xl border border-[#FA6C43]/40 bg-[#FFF3EF] p-4 shadow-sm">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[#FA6C43]">Answer</span>
                <p className="mt-1 flex-1 overflow-hidden text-sm font-medium text-[#7a2e18] line-clamp-4">{card.back}</p>
                <span className="mt-2 text-[10px] font-medium text-[#FA6C43]/50">Tap to flip back</span>
              </div>
            </div>
          </button>
        </div>

        <button type="button" onClick={() => go(1)} disabled={atEnd} aria-label="Next card" className={arrowClass(atEnd)}>
          <FiChevronRight />
        </button>
      </div>

      <div className="mt-2 text-center text-[11px] font-medium text-gray-400">
        {clamped + 1} / {cards.length}
      </div>
    </div>
  );
}

export default {
  id: 'flashcard',
  label: 'Flashcards',
  interactive: false,
  Renderer,
};
