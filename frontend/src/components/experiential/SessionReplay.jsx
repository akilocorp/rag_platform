import React from 'react';
import { FiHelpCircle, FiAward } from 'react-icons/fi';
import { renderMarkdown } from '../../utils/markdown';
import { enforceChartAccuracy } from '../../configs/experiential/chartGuard';
import IrfChart from './IrfChart';
import ComparisonTable from './ComparisonTable';

// Read-only replay of a saved experiential run. Mirrors the live player's
// renderBlock (ExperientialPage.jsx) without any interactive controls — it
// replays the persisted `feed` against the lab config so a reviewer sees every
// card and back-and-forth exactly as the student did.

const ARROWS = { '-3': '↓↓↓', '-2': '↓↓', '-1': '↓', '0': '—', '1': '↑', '2': '↑↑', '3': '↑↑↑' };
const arrow = (v) => ARROWS[String(v)] || '—';
const UNIT_BY_KEY = { gdp: '%', investment: '%', inflation: 'pp', rate: 'pp' };
const LABEL_BY_KEY = { gdp: 'Real GDP', investment: 'Investment', inflation: 'Inflation', rate: 'Policy Rate' };
const EP_LABEL = { more: 'falls more', same: 'about the same', less: 'falls less' };

function Card({ children, accent = false, className = '' }) {
  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${accent ? 'border-[#FA6C43]/40' : 'border-gray-200'} ${className}`}>
      {children}
    </div>
  );
}

function SpeakerLabel({ name }) {
  return <div className="text-[11px] font-semibold uppercase tracking-wide text-[#FA6C43] mb-1.5">{name}</div>;
}

// Everything the student typed or chose renders in this orange box so a reviewing
// professor can tell the student's own words apart from the analyst's replies.
function StudentSays({ label = 'Student', children }) {
  return (
    <div className="rounded-xl border border-[#FA6C43]/40 bg-[#FA6C43]/[0.07] px-3.5 py-2.5 mb-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43] mb-1">{label}</div>
      <div className="text-sm text-gray-800 leading-relaxed">{children}</div>
    </div>
  );
}

// Same series math as ExperientialPage.chartFor, but parameterized (no live state).
function buildChart(layerById, snapshotIds, withGuess, chartVar, dials) {
  const series = (snapshotIds || [])
    .filter((id) => layerById[id]?.reveal?.chartSeries?.[chartVar])
    .map((id) => ({
      key: id,
      label: layerById[id].short || layerById[id].name.match(/\(([^)]+)\)/)?.[1] || layerById[id].name,
      values: layerById[id].reveal.chartSeries[chartVar],
    }));
  let guess = null;
  if (withGuess) {
    const dv = dials?.[chartVar];
    if (dv !== undefined) {
      const ref = Math.max(...series.flatMap((s) => s.values.map(Math.abs)), 1);
      const end = (dv / 3) * ref;
      const n = series[0]?.values.length || 8;
      guess = { label: `Your call (${arrow(dv)})`, values: Array.from({ length: n }, (_, i) => (end * (i + 1)) / n) };
    }
  }
  return { series, guess, unit: UNIT_BY_KEY[chartVar] || '' };
}

export default function SessionReplay({ config: rawConfig, transcript }) {
  if (!rawConfig || !transcript || !Array.isArray(transcript.feed)) {
    return <p className="text-sm text-gray-500">No transcript was recorded for this session.</p>;
  }

  // Same accumulating-level guarantee as the live player, so replays of older
  // runs also render an accurate chart.
  const config = enforceChartAccuracy(rawConfig);
  const { meta = {}, layers = [], probes = [], analyst = {}, coach = {} } = config;
  const layerById = Object.fromEntries(layers.map((l) => [l.id, l]));
  const probeById = Object.fromEntries(probes.map((p) => [p.id, p]));
  const { feed, dials = {}, layerPredictions = {}, layerReasons = {} } = transcript;
  const chartVar = transcript.chartVar || Object.keys(layers[0]?.reveal?.chartSeries || {})[0];
  const varLabel = (k) => LABEL_BY_KEY[k] || k;

  const renderBlock = (b, i) => {
    const key = b._k || `${b.type}-${i}`;
    switch (b.type) {
      case 'reveal':
      case 'comparison': {
        const lyr = layerById[b.layerId];
        if (!lyr) return null;
        const { series, guess, unit } = buildChart(layerById, b.snapshot, b.withGuess, chartVar, dials);
        const snapshotLayers = (b.snapshot || []).map((id) => layerById[id]).filter(Boolean);
        return (
          <Card key={key} accent={b.type === 'reveal'} className="p-5">
            <SpeakerLabel name={analyst.persona ? meta.title : 'Analyst'} />
            <h3 className="font-bold text-[#222] mb-2">{b.type === 'reveal' ? lyr.name : `Comparison · ${lyr.name}`}</h3>
            <p className="text-xs text-gray-500 mb-1.5">
              {varLabel(chartVar)} — {config.chartCaption || 'trajectory across the series. Each line is a model.'}
            </p>
            <IrfChart series={series} guess={guess} unit={unit} />
            {b.type === 'reveal' && (
              <p className="text-sm text-gray-700 mt-3 leading-relaxed">{lyr.reveal.narrative}</p>
            )}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <ComparisonTable layers={snapshotLayers} />
            </div>
          </Card>
        );
      }
      case 'answer': {
        const p = probeById[b.probeId];
        if (!p) return null;
        return (
          <Card key={key} className="p-5">
            <div className="text-sm font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
              <FiHelpCircle className="text-gray-400" /> {p.text}
            </div>
            <SpeakerLabel name={meta.title} />
            <p className="text-sm text-gray-800 leading-relaxed">{p.answer}</p>
            {p.deadEnd && (
              <p className="text-[11px] text-amber-600 mt-2 italic">Trust unchanged — more decimals isn’t more provenance.</p>
            )}
          </Card>
        );
      }
      case 'layer-predict': {
        const lyr = layerById[b.layerId];
        if (!lyr) return null;
        const ep = lyr.extensionPredict;
        const choice = layerPredictions[b.layerId];
        const reason = layerReasons[b.layerId];
        return (
          <Card key={key} className="p-5">
            <SpeakerLabel name={`Predict · ${lyr.short || lyr.name}`} />
            <p className="text-sm text-gray-700 mb-2">{ep ? ep.prompt : lyr.predictPrompt}</p>
            {choice && (
              <StudentSays label="Student · prediction">
                <span className="font-semibold">{ep?.focus} {EP_LABEL[choice] || choice}</span>
                {reason ? <> — “{reason}”</> : null}
              </StudentSays>
            )}
          </Card>
        );
      }
      case 'coach':
        return (
          <div key={key} className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
            <FiAward className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 mb-0.5">Coach{coach.tone ? ` · ${coach.tone}` : ''}</div>
              <p className="text-sm text-amber-900">{b.text}</p>
              {b.suggestProbe && <p className="text-xs text-amber-700 mt-1">Try asking: “{b.suggestProbe}”</p>}
            </div>
          </div>
        );
      case 'explain': {
        const lyr = layerById[b.layerId];
        const pick = layerPredictions[b.layerId];
        const reason = layerReasons[b.layerId];
        const focus = lyr?.extensionPredict?.focus;
        return (
          <Card key={key} className="p-5">
            {pick && (
              <StudentSays label="Student · prediction">
                <span className="font-semibold">{focus} {EP_LABEL[pick] || pick}</span>
                {reason ? <> — “{reason}”</> : null}
              </StudentSays>
            )}
            <SpeakerLabel name={`${meta.title} · why`} />
            <div className="text-sm leading-relaxed prose-experiential text-gray-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.reply || '') }} />
          </Card>
        );
      }
      case 'freeform':
        return (
          <Card key={key} className="p-5">
            <StudentSays label="Student · asked">{b.question}</StudentSays>
            <SpeakerLabel name={meta.title} />
            <div className={`text-sm leading-relaxed prose-experiential ${b.error ? 'text-amber-700' : 'text-gray-800'}`} dangerouslySetInnerHTML={{ __html: renderMarkdown(b.reply || '') }} />
          </Card>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-4">
      {/* Scenario + the student's opening prediction */}
      {meta.title && (
        <Card accent className="p-5">
          <SpeakerLabel name="Scenario" />
          <p className="text-[15px] text-gray-800 leading-relaxed">{config.scenario?.brief}</p>
        </Card>
      )}
      {Array.isArray(transcript.choiceValues) && transcript.choiceValues.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Customized</span>
          {transcript.choiceValues.map((c) => (
            <span key={c.id} className="text-[11px] px-2 py-0.5 rounded bg-white border border-gray-200 text-gray-600">
              {c.label}: <span className="font-semibold text-[#222]">{c.value}</span>
            </span>
          ))}
        </div>
      )}
      {transcript.dialsCommitted && Array.isArray(config.predictionVariables) && (
        <Card className="px-4 py-2.5 border-[#FA6C43]/40 bg-[#FA6C43]/[0.07]">
          <span className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43] mr-2">Student · opening call</span>
          {config.predictionVariables.map((v) => (
            <span key={v.id} className="text-sm text-gray-700 mr-3">
              {v.label} <span className="font-bold text-[#222]">{arrow(dials[v.id])}</span>
            </span>
          ))}
        </Card>
      )}
      {feed.map(renderBlock)}
      {transcript.synthesisText && (
        <Card className="p-5 border-[#FA6C43]/40 bg-[#FA6C43]/[0.07]">
          <div className="text-[10px] font-bold uppercase tracking-wide text-[#FA6C43] mb-1.5">Student · synthesis</div>
          <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">{transcript.synthesisText}</p>
        </Card>
      )}
    </div>
  );
}
