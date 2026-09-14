// @language JavaScript (React / JSX)
// @updated   2026-09-13
// @changed   Fixed a text-overflow bug: the copy-link button and project title had no width bound,
//            so a long public URL or project name bled past the left panel's edges on a narrow
//            screen instead of wrapping or clipping. Both now get max-w-full truncate + a title
//            attribute for the full text on hover; the copy handler still copies the untruncated URL.
//            Prior: Four additions. (1) Live cross-filtering: clicking a bar in any `bar`-chart block
//            (Yes/No, Single Choice, Rating Scale, Semantic Differential — the block types whose
//            answer is a single scalar) sends filter_block_id/filter_value to the poll, which
//            re-aggregates every other block against just that respondent subset; clicking the same
//            bar again clears it. (2) Dashboard/Slide toggle: Slide shows one block at a time with
//            Prev/Next + arrow-key nav + dot indicators, sliding via AnimatePresence mode="wait".
//            (3) Milestone celebrations: a particle burst + toast the first time response_count
//            crosses 5/10/25/50/100/200/500 (firedMilestonesRef ensures each fires once ever, not
//            once per poll). (4) Snapshot export: html2canvas captures the results panel to a
//            downloadable PNG.
//            Prior: New file: the Present view — a Mentimeter-style QR + live-results screen meant for a
//            projector during class. Polls GET /studio/projects/:id/live-summary every 2.5s (no
//            Socket.IO — Studio has no realtime infra yet, and a couple seconds of lag is invisible
//            in a classroom setting); every number/bar animates to its new value via framer-motion
//            rather than snapping, per the "every touchpoint should feel alive" brief. Chart forms
//            follow the dataviz skill's job-based selection (bar for magnitude, diverging bar for
//            MaxDiff's above/below-zero score, stacked bar for Constant Sum's part-to-whole,
//            wordcloud for open text) using this app's existing validated categorical palette
//            (frontend/src/facilitator/widgets/chart/index.jsx's PALETTE) rather than inventing a
//            new one. See backend src/studio/summary.py for what's aggregated and why AI-native and
//            data-quality instruments never appear here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import html2canvas from 'html2canvas';
import { motion, AnimatePresence, useSpring, useTransform } from 'framer-motion';
import {
  FaArrowLeft, FaUsers, FaSpinner, FaChevronLeft, FaChevronRight,
  FaCamera, FaTimes, FaThLarge, FaPlay,
} from 'react-icons/fa';
import apiClient from '../api/apiClient';

const FONT_BODY = "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";
const POLL_MS = 2500;
const ORANGE = '#FA6C43';
const DARK = '#1F1F1F';
const PALETTE = ['#FA6C43', '#2563EB', '#16A34A', '#9333EA', '#D97706'];
const DIVERGING_POS = '#FA6C43';
const DIVERGING_NEG = '#2563EB';
const SPRING = { type: 'spring', stiffness: 90, damping: 18 };
const MILESTONES = [5, 10, 25, 50, 100, 200, 500];

// Pre-extracted so JSX tags are plain identifiers (<MotionDiv>) rather than
// member expressions (<motion.div>) — this project's eslint config has no
// react/JSX-aware no-unused-vars handling, which otherwise flags `motion`
// as unused despite being referenced only via JSX tag names.
const MotionDiv = motion.div;
const MotionSpan = motion.span;
const MotionP = motion.p;

// Ticks a displayed number/decimal smoothly toward `value` on every change,
// via framer-motion's MotionValue-as-children recipe — no per-tick re-render.
const AnimatedNumber = ({ value, decimals = 0, className, style }) => {
  const spring = useSpring(0, { stiffness: 120, damping: 22 });
  const display = useTransform(spring, (v) => v.toFixed(decimals));
  useEffect(() => { spring.set(value ?? 0); }, [value, spring]);
  return <MotionSpan className={className} style={style}>{display}</MotionSpan>;
};

const BarRow = ({ label, pct, sublabel, color = ORANGE, onClick, active, dimmed }) => (
  <div
    className={`flex items-center gap-3 ${onClick ? 'cursor-pointer' : ''} ${dimmed ? 'opacity-40' : ''}`}
    style={{ transition: 'opacity 200ms ease' }}
    onClick={onClick}
  >
    <span
      className="w-28 shrink-0 text-sm truncate text-right"
      style={{ fontFamily: FONT_BODY, color: DARK, fontWeight: active ? 700 : 400 }}
      title={label}
    >
      {label}
    </span>
    <div
      className="flex-1 h-6 rounded-full overflow-hidden"
      style={{ backgroundColor: 'rgba(31,31,31,0.06)', boxShadow: active ? `0 0 0 2px ${color}` : 'none' }}
    >
      <MotionDiv
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
        initial={false}
        animate={{ width: `${Math.max(pct, 0)}%` }}
        transition={SPRING}
      />
    </div>
    <span
      className="w-20 shrink-0 text-xs font-semibold tabular-nums"
      style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.6)' }}
    >
      {sublabel}
    </span>
  </div>
);

const BarChart = ({ block, activeFilter, onSelect }) => (
  <div className="flex flex-col gap-2">
    {block.type === 'semantic_differential' && (
      <div
        className="flex justify-between text-[11px] font-semibold mb-1"
        style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.45)' }}
      >
        <span>{block.left_label}</span>
        <span>{block.right_label}</span>
      </div>
    )}
    {block.data.map((d) => {
      const isActive = activeFilter?.blockId === block.block_id && activeFilter?.value === d.value;
      const someActiveElsewhere = activeFilter && activeFilter.blockId === block.block_id && !isActive;
      return (
        <BarRow
          key={d.label}
          label={d.label}
          pct={d.pct}
          sublabel={`${d.count} · ${d.pct}%`}
          active={isActive}
          dimmed={someActiveElsewhere}
          onClick={onSelect ? () => onSelect(block.block_id, d.value, `${block.question}: ${d.label}`) : undefined}
        />
      );
    })}
  </div>
);

const DivergingBarChart = ({ data }) => {
  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.score)));
  return (
    <div className="flex flex-col gap-2">
      {data.map((d) => {
        const pct = (Math.abs(d.score) / maxAbs) * 50;
        const positive = d.score >= 0;
        return (
          <div key={d.label} className="flex items-center gap-3">
            <span
              className="w-28 shrink-0 text-sm truncate text-right"
              style={{ fontFamily: FONT_BODY, color: DARK }}
              title={d.label}
            >
              {d.label}
            </span>
            <div
              className="flex-1 h-6 relative rounded-full overflow-hidden"
              style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}
            >
              <div
                className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2"
                style={{ backgroundColor: 'rgba(31,31,31,0.2)' }}
              />
              <MotionDiv
                className="absolute top-0 bottom-0 rounded-full"
                style={{
                  backgroundColor: positive ? DIVERGING_POS : DIVERGING_NEG,
                  left: positive ? '50%' : undefined,
                  right: positive ? undefined : '50%',
                }}
                initial={false}
                animate={{ width: `${pct}%` }}
                transition={SPRING}
              />
            </div>
            <span
              className="w-14 shrink-0 text-xs font-semibold tabular-nums text-right"
              style={{ fontFamily: FONT_BODY, color: positive ? DIVERGING_POS : DIVERGING_NEG }}
            >
              {d.score > 0 ? `+${d.score}` : d.score}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const StackedBarChart = ({ data }) => (
  <div>
    <div className="flex h-7 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(31,31,31,0.06)' }}>
      {data.map((d, i) => (
        <MotionDiv
          key={d.label}
          initial={false}
          animate={{ width: `${d.pct}%` }}
          transition={SPRING}
          style={{ backgroundColor: PALETTE[i % PALETTE.length], marginRight: i < data.length - 1 ? 2 : 0 }}
        />
      ))}
    </div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5">
      {data.map((d, i) => (
        <span
          key={d.label}
          className="flex items-center gap-1.5 text-xs"
          style={{ fontFamily: FONT_BODY, color: DARK }}
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
          {d.label}
          <span style={{ color: 'rgba(31,31,31,0.5)' }}>({d.avg_allocation})</span>
        </span>
      ))}
    </div>
  </div>
);

const RankChart = ({ data }) => {
  const n = data.length;
  return (
    <div className="flex flex-col gap-2">
      {data.map((d, idx) => {
        const pct = d.avg_rank == null ? 0 : ((n - d.avg_rank) / Math.max(n - 1, 1)) * 100;
        return (
          <BarRow
            key={d.label}
            label={`${idx + 1}. ${d.label}`}
            pct={pct}
            sublabel={d.avg_rank != null ? `avg #${d.avg_rank}` : '—'}
          />
        );
      })}
    </div>
  );
};

const CardSortList = ({ data }) => (
  <div className="flex flex-col gap-1.5">
    {data.map((d) => (
      <MotionDiv
        key={d.item}
        layout
        className="flex items-center justify-between px-3 py-2 rounded-lg"
        style={{ backgroundColor: 'rgba(31,31,31,0.04)', fontFamily: FONT_BODY }}
      >
        <span className="text-sm truncate" style={{ color: DARK }}>{d.item}</span>
        <span className="text-xs font-semibold shrink-0 ml-2" style={{ color: ORANGE }}>
          {d.top_category ? `${d.top_category} · ${d.pct}%` : 'No answers yet'}
        </span>
      </MotionDiv>
    ))}
  </div>
);

const WordCloud = ({ data }) => {
  const words = data.words || [];
  const max = Math.max(1, ...words.map((w) => w.count));
  return (
    <div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 items-baseline mb-3 min-h-[2rem]">
        <AnimatePresence>
          {words.map((w) => (
            <MotionSpan
              key={w.word}
              layout
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.35 + 0.65 * (w.count / max), scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              style={{ fontFamily: FONT_BODY, fontSize: `${12 + (w.count / max) * 16}px`, color: ORANGE, fontWeight: 700 }}
            >
              {w.word}
            </MotionSpan>
          ))}
        </AnimatePresence>
        {words.length === 0 && (
          <span className="text-xs" style={{ color: 'rgba(31,31,31,0.4)', fontFamily: FONT_BODY }}>No answers yet</span>
        )}
      </div>
      {data.recent?.length > 0 && (
        <div className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'rgba(31,31,31,0.08)' }}>
          <AnimatePresence initial={false}>
            {data.recent.slice(-4).map((r, i) => (
              <MotionP
                key={`${i}-${r.slice(0, 24)}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-xs italic truncate"
                style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.55)' }}
              >
                &ldquo;{r}&rdquo;
              </MotionP>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

const InstrumentBadges = ({ instruments }) => {
  const entries = [];
  if (instruments?.confidence_slider) {
    entries.push({ label: 'Avg confidence', value: `${instruments.confidence_slider.avg}/100` });
  }
  if (instruments?.reaction_timer) {
    entries.push({ label: 'Avg response time', value: `${(instruments.reaction_timer.avg_ms / 1000).toFixed(1)}s` });
  }
  if (!entries.length) return null;
  return (
    <div className="flex gap-4 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(31,31,31,0.08)' }}>
      {entries.map((e) => (
        <div key={e.label} className="text-xs" style={{ fontFamily: FONT_BODY, color: 'rgba(31,31,31,0.5)' }}>
          {e.label}: <span className="font-bold" style={{ color: DARK }}>{e.value}</span>
        </div>
      ))}
    </div>
  );
};

const CHART_COMPONENTS = {
  bar: (block, activeFilter, onSelect) => <BarChart block={block} activeFilter={activeFilter} onSelect={onSelect} />,
  diverging_bar: (block) => <DivergingBarChart data={block.data} />,
  stacked_bar: (block) => <StackedBarChart data={block.data} />,
  rank: (block) => <RankChart data={block.data} />,
  list: (block) => <CardSortList data={block.data} />,
  wordcloud: (block) => <WordCloud data={block.data} />,
};

const BlockCard = ({ block, activeFilter, onSelect }) => (
  <MotionDiv
    layout
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.3 }}
    className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5"
    style={{ fontFamily: FONT_BODY }}
  >
    <div className="flex items-start justify-between gap-3 mb-3">
      <p className="text-base font-bold" style={{ color: DARK }}>{block.question}</p>
      <span
        className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full tabular-nums"
        style={{ backgroundColor: 'rgba(31,31,31,0.06)', color: 'rgba(31,31,31,0.55)' }}
      >
        n=<AnimatedNumber value={block.n} />
      </span>
    </div>
    {block.avg != null && (
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-3xl font-extrabold" style={{ color: ORANGE }}>
          <AnimatedNumber value={block.avg} decimals={1} />
        </span>
        <span className="text-xs font-medium" style={{ color: 'rgba(31,31,31,0.5)' }}>average</span>
      </div>
    )}
    {(CHART_COMPONENTS[block.chart] || (() => null))(block, activeFilter, onSelect)}
    <InstrumentBadges instruments={block.instruments} />
  </MotionDiv>
);

// Fired once per newly-crossed milestone (see the response_count watcher in
// the main component) — a brief toast + a burst of small particles flung
// outward from screen center, then it unmounts itself.
const MilestoneCelebration = ({ milestone, onDone }) => {
  const particles = useMemo(() => (
    Array.from({ length: 14 }, (_, i) => {
      const angle = (i / 14) * Math.PI * 2;
      const dist = 120 + Math.random() * 100;
      return { id: i, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, color: PALETTE[i % PALETTE.length] };
    })
  ), []);

  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="relative">
        {particles.map((p) => (
          <MotionDiv
            key={p.id}
            className="absolute top-1/2 left-1/2 w-2.5 h-2.5 rounded-full"
            style={{ backgroundColor: p.color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: p.dx, y: p.dy, opacity: 0, scale: 0.4 }}
            transition={{ duration: 1.1, ease: 'easeOut' }}
          />
        ))}
        <MotionDiv
          initial={{ opacity: 0, scale: 0.7, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', stiffness: 200, damping: 16 }}
          className="px-6 py-3 rounded-2xl shadow-2xl text-lg font-extrabold"
          style={{ backgroundColor: ORANGE, color: '#FFFFFF', fontFamily: FONT_BODY }}
        >
          🎉 {milestone} responses!
        </MotionDiv>
      </div>
    </div>
  );
};

const FilterChip = ({ label, onClear }) => (
  <MotionDiv
    initial={{ opacity: 0, y: -6 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -6 }}
    className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-4 self-start"
    style={{ backgroundColor: '#FFF1EA', color: ORANGE, fontFamily: FONT_BODY }}
  >
    Filtered: {label}
    <button onClick={onClear} className="hover:opacity-70 transition-opacity" aria-label="Clear filter">
      <FaTimes size={10} />
    </button>
  </MotionDiv>
);

const StudioPresentPage = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [copied, setCopied] = useState(false);
  const [activeFilter, setActiveFilter] = useState(null); // {blockId, value, label} | null
  const [viewMode, setViewMode] = useState('dashboard'); // 'dashboard' | 'slide'
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState(1);
  const [milestone, setMilestone] = useState(null);
  const [exporting, setExporting] = useState(false);
  const pollRef = useRef(null);
  const resultsRef = useRef(null);
  const firedMilestonesRef = useRef(new Set());

  const publicLink = `${window.location.origin}/s/${projectId}`;

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(publicLink, {
      width: 340,
      margin: 1,
      color: { dark: '#1F1F1F', light: '#FAFAF7' },
    }).then((url) => { if (!cancelled) setQrDataUrl(url); });
    return () => { cancelled = true; };
  }, [publicLink]);

  // Re-polls from scratch whenever the cross-filter changes (immediate fetch
  // + a fresh interval), so switching/clearing a filter never waits out the
  // remainder of the previous interval.
  useEffect(() => {
    let cancelled = false;
    const params = activeFilter
      ? { filter_block_id: activeFilter.blockId, filter_value: JSON.stringify(activeFilter.value) }
      : {};
    const poll = async () => {
      try {
        const { data } = await apiClient.get(`/studio/projects/${projectId}/live-summary`, { params });
        if (!cancelled) { setSummary(data); setLoading(false); }
      } catch {
        if (!cancelled) setLoading(false);
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(pollRef.current); };
  }, [projectId, activeFilter]);

  // Milestone celebration — only watches response_count, so it fires
  // regardless of which filter is active, but only once ever per count.
  useEffect(() => {
    const count = summary?.response_count;
    if (!count) return;
    const hit = MILESTONES.find((m) => count >= m && !firedMilestonesRef.current.has(m));
    if (hit) {
      firedMilestonesRef.current.add(hit);
      setMilestone(hit);
    }
  }, [summary?.response_count]);

  // Slide-mode keyboard nav.
  const blocks = summary?.blocks || [];
  const goSlide = useCallback((delta) => {
    setSlideDirection(delta);
    setSlideIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(blocks.length - 1, 0)));
  }, [blocks.length]);

  useEffect(() => {
    if (viewMode !== 'slide') return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight') goSlide(1);
      if (e.key === 'ArrowLeft') goSlide(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode, goSlide]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the link is still visible on screen to read off.
    }
  };

  const handleSelectFilter = (blockId, value, label) => {
    setActiveFilter((prev) => (
      prev?.blockId === blockId && prev?.value === value ? null : { blockId, value, label }
    ));
  };

  const handleExport = async () => {
    if (!resultsRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(resultsRef.current, { backgroundColor: '#FAFAF7', scale: 2 });
      const link = document.createElement('a');
      link.download = `${(summary?.title || 'studio-results').replace(/\s+/g, '_')}_snapshot.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch {
      // Best-effort — nothing on screen depends on the export succeeding.
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: DARK }}>
        <FaSpinner className="animate-spin text-3xl" style={{ color: ORANGE }} />
      </div>
    );
  }

  const slideBlock = blocks[Math.min(slideIndex, blocks.length - 1)];

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: DARK, fontFamily: FONT_BODY }}>
      <AnimatePresence>
        {milestone && <MilestoneCelebration milestone={milestone} onDone={() => setMilestone(null)} />}
      </AnimatePresence>

      <div className="flex items-center justify-between px-6 py-4">
        <button
          onClick={() => navigate(`/studio/${projectId}`)}
          className="flex items-center gap-2 text-sm font-semibold transition-all active:scale-95"
          style={{ color: 'rgba(255,255,255,0.6)' }}
        >
          <FaArrowLeft /> Back to builder
        </button>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-0.5 p-0.5 rounded-full" style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setViewMode('dashboard')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={viewMode === 'dashboard' ? { backgroundColor: ORANGE, color: '#FFFFFF' } : { color: 'rgba(255,255,255,0.5)' }}
            >
              <FaThLarge size={10} /> Dashboard
            </button>
            <button
              onClick={() => setViewMode('slide')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
              style={viewMode === 'slide' ? { backgroundColor: ORANGE, color: '#FFFFFF' } : { color: 'rgba(255,255,255,0.5)' }}
            >
              <FaPlay size={9} /> Slide
            </button>
          </div>

          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 text-xs font-semibold transition-all active:scale-95 disabled:opacity-50"
            style={{ color: 'rgba(255,255,255,0.55)' }}
            title="Export a snapshot of the current results"
          >
            {exporting ? <FaSpinner className="animate-spin" size={12} /> : <FaCamera size={12} />}
            Snapshot
          </button>

          <div className="flex items-center gap-2">
            <MotionSpan
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: '#22C55E' }}
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Live
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 px-6 pb-6 overflow-hidden">
        <div className="lg:w-[360px] shrink-0 flex flex-col items-center text-center gap-3">
          <h1 className="max-w-full text-xl font-bold text-white truncate" title={summary?.title}>{summary?.title}</h1>
          <p className="text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>Scan to join</p>
          <MotionDiv
            className="bg-white rounded-3xl p-4 shadow-2xl"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 120, damping: 16 }}
          >
            {qrDataUrl && <img src={qrDataUrl} alt="QR code to join this survey" width={260} height={260} />}
          </MotionDiv>
          <button
            onClick={handleCopyLink}
            title={publicLink}
            className="max-w-full text-sm font-mono px-3 py-1.5 rounded-lg transition-all active:scale-95 truncate"
            style={{ backgroundColor: 'rgba(255,255,255,0.08)', color: ORANGE }}
          >
            {copied ? 'Copied!' : publicLink.replace(/^https?:\/\//, '')}
          </button>

          <div className="mt-4 flex flex-col items-center">
            <div className="flex items-center gap-2 text-5xl font-extrabold text-white">
              <FaUsers size={28} style={{ color: ORANGE }} />
              <AnimatedNumber value={summary?.response_count} />
            </div>
            <p className="text-xs mt-1" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {summary?.response_count === 1 ? 'response' : 'responses'} so far
              {activeFilter && ' (of the unfiltered total)'}
            </p>
          </div>
        </div>

        <div ref={resultsRef} className="flex-1 overflow-y-auto rounded-3xl p-6 flex flex-col" style={{ backgroundColor: '#FAFAF7' }}>
          <AnimatePresence>
            {activeFilter && <FilterChip label={activeFilter.label} onClear={() => setActiveFilter(null)} />}
          </AnimatePresence>

          {blocks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm" style={{ color: 'rgba(31,31,31,0.4)' }}>
              This project has no results-eligible blocks yet.
            </div>
          ) : viewMode === 'dashboard' ? (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <AnimatePresence>
                {blocks.map((block) => (
                  <BlockCard key={block.block_id} block={block} activeFilter={activeFilter} onSelect={handleSelectFilter} />
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex-1 flex flex-col">
              <div className="flex-1 flex items-center justify-center overflow-hidden">
                <AnimatePresence mode="wait" custom={slideDirection}>
                  <MotionDiv
                    key={slideBlock?.block_id}
                    custom={slideDirection}
                    initial={{ opacity: 0, x: 60 * slideDirection }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -60 * slideDirection }}
                    transition={{ duration: 0.25 }}
                    className="w-full max-w-2xl"
                  >
                    {slideBlock && <BlockCard block={slideBlock} activeFilter={activeFilter} onSelect={handleSelectFilter} />}
                  </MotionDiv>
                </AnimatePresence>
              </div>
              <div className="flex items-center justify-center gap-4 pt-4">
                <button
                  onClick={() => goSlide(-1)}
                  disabled={slideIndex === 0}
                  className="p-2 rounded-full transition-all active:scale-90 disabled:opacity-30"
                  style={{ backgroundColor: 'rgba(31,31,31,0.06)', color: DARK }}
                >
                  <FaChevronLeft size={14} />
                </button>
                <div className="flex items-center gap-1.5">
                  {blocks.map((b, i) => (
                    <span
                      key={b.block_id}
                      className="rounded-full transition-all"
                      style={{
                        width: i === slideIndex ? 18 : 6, height: 6,
                        backgroundColor: i === slideIndex ? ORANGE : 'rgba(31,31,31,0.15)',
                      }}
                    />
                  ))}
                </div>
                <button
                  onClick={() => goSlide(1)}
                  disabled={slideIndex >= blocks.length - 1}
                  className="p-2 rounded-full transition-all active:scale-90 disabled:opacity-30"
                  style={{ backgroundColor: 'rgba(31,31,31,0.06)', color: DARK }}
                >
                  <FaChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudioPresentPage;
