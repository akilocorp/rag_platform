import React, { useEffect, useState } from 'react';

const PHRASES = [
  'Thinking',
  'Reasoning',
  'Pondering',
  'Connecting the dots',
  'Composing the answer',
  'Almost there',
];

const ThinkingIndicator = () => {
  const [phraseIdx, setPhraseIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setPhraseIdx((i) => (i + 1) % PHRASES.length), 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        key={phraseIdx}
        className="thinking-shimmer text-sm font-semibold animate-in fade-in duration-500"
      >
        {PHRASES[phraseIdx]}
      </span>
      <span className="flex gap-1">
        <span
          className="w-1.5 h-1.5 rounded-full bg-[#FA6C43] animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-[#FA6C43] animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full bg-[#FA6C43] animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </span>
    </div>
  );
};

export default ThinkingIndicator;
