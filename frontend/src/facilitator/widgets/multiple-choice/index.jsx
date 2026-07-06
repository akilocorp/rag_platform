import React from 'react';

// multiple_choice — renders a single-select question as clickable option pills.
// data shape (from the backend widget contract): { question, options: [str], explanation? }
// Clicking an option calls onSubmit(optionText); it becomes the user's next message.
function Renderer({ data, onSubmit, disabled }) {
  const options = Array.isArray(data?.options) ? data.options : [];
  if (!data?.question || options.length === 0) return null;

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-[#F0F6FB] p-3">
      {data.explanation && (
        <p className="text-xs text-gray-500 mb-1.5">{data.explanation}</p>
      )}
      <p className="text-sm font-semibold text-[#222] mb-2">{data.question}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt, i) => (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => onSubmit?.(opt)}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
              disabled
                ? 'bg-white text-gray-400 border-gray-200 cursor-not-allowed'
                : 'bg-white text-gray-700 border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43]'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default {
  id: 'multiple_choice',
  label: 'Multiple choice',
  interactive: true,
  Renderer,
};
