import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiClock, FiPlay } from 'react-icons/fi';
import { listExperientialConfigs } from '../configs/experiential';

// Simple author/test launcher: lists every validated experiential template and
// starts one in a single click. Also reachable directly at /experiential/:id.
export default function ExperientialIndex() {
  const navigate = useNavigate();
  const labs = listExperientialConfigs();

  return (
    <div className="min-h-[100dvh] bg-[#F0F6FB] text-[#222]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
      <header className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-gray-200 bg-white/95 backdrop-blur">
        <button onClick={() => navigate(-1)} className="p-2 -ml-1 rounded-lg text-gray-500 hover:bg-[#F0F6FB] hover:text-[#FA6C43] transition-colors" aria-label="Back">
          <FiArrowLeft />
        </button>
        <h1 className="font-bold">Experiential Simulation Labs</h1>
      </header>

      <main className="px-4 sm:px-6 lg:px-12 py-8">
        <div className="max-w-3xl mx-auto">
          <p className="text-sm text-gray-500 mb-5">
            Structured, scripted decision labs. Pick one to play it end-to-end — no live LLM calls.
          </p>
          {labs.length === 0 && (
            <p className="text-gray-500">No experiential templates registered.</p>
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            {labs.map((lab) => (
              <button
                key={lab.id}
                onClick={() => navigate(`/experiential/${lab.id}`)}
                className="text-left rounded-2xl border border-gray-200 bg-white p-5 hover:border-[#FA6C43]/50 hover:shadow-md transition-all group"
              >
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#FA6C43] mb-2">
                  {lab.discipline}
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400 inline-flex items-center gap-1"><FiClock size={11} /> ~{lab.estMinutes} min</span>
                </div>
                <h2 className="font-bold text-[#222] mb-1">{lab.title}</h2>
                <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">{lab.brief}</p>
                <div className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-[#FA6C43] group-hover:gap-2.5 transition-all">
                  <FiPlay size={13} /> Launch lab
                </div>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
