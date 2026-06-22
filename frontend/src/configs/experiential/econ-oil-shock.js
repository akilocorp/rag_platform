// "Oil Shock Macro Lab" — structured experiential lab (generative helper + grader).
//
// Teaching arc: start from the baseline model the student already knows, then
// add one real-world complication at a time and SEE how the picture changes.
// The advanced move is predicting how each extension changes the baseline —
// not the trivial "does GDP go up or down". Numbers are illustrative Q1
// deviations; the non-baseline 8-quarter paths are the baseline path scaled to
// each layer's Q1 anchor.

// Baseline 8-quarter deviation paths (Q1..Q8) — the two variables that carry
// the teaching point (overall output and the investment channel).
const RANK = {
  gdp:        [-0.6, -1.2, -1.6, -1.8, -1.4, -0.9, -0.5, -0.2],
  investment: [-1.5, -3.0, -3.8, -4.0, -3.0, -2.0, -1.0, -0.3],
};

// Scale a baseline path so its Q1 value equals `q1`, preserving shape.
const scaleTo = (base, q1) => {
  const f = q1 / base[0];
  return base.map((v) => Math.round(v * f * 100) / 100);
};

const BGG = { gdp: scaleTo(RANK.gdp, -1.0), investment: scaleTo(RANK.investment, -3.2) };
const HANK = { gdp: scaleTo(RANK.gdp, -0.9), investment: scaleTo(RANK.investment, -1.8) };

const econOilShock = {
  meta: {
    id: 'econ-oil-shock',
    title: 'Oil Shock Macro Lab',
    discipline: 'Macroeconomics',
    level: 'MBA / Graduate',
    estMinutes: 20,
  },

  scenario: {
    brief:
      'The Strait of Hormuz closes; oil spikes to $150/barrel. Start from the baseline model you already know, then add real-world complications and watch how the picture changes.',
  },

  analyst: {
    persona:
      'You are a macro teaching analyst helping an MBA student extend the baseline (representative-agent) model they already know to richer models — financial frictions and household heterogeneity. When the student asks a free-form question, explain the relevant mechanism clearly and briefly, always connecting the advanced model back to the baseline intuition. Nudge, do not lecture.',
    stayInCharacter: true,
    // 'generative' → free-form follow-ups + synthesis grading call Claude Sonnet
    // via the backend; the structured reveals/numbers stay deterministic.
    mode: 'generative',
    scriptedFallback:
      'Good question — start from the baseline model: one household, firms borrowing at the risk-free rate. Then ask what changes when you add financial frictions or hand-to-mouth households.',
  },

  // Baseline prediction: the three variables that carry the teaching point.
  predictionVariables: [
    { id: 'gdp', label: 'Real GDP', type: 'direction', expected: 'down', intuition: 'A supply shock contracts output.' },
    { id: 'investment', label: 'Investment', type: 'direction', expected: 'down', intuition: 'Higher cost of capital and weaker demand cut capex.' },
    { id: 'consumption', label: 'Consumption', type: 'direction', expected: 'down', intuition: 'Real incomes fall as energy acts like a tax.' },
  ],

  layers: [
    {
      id: 'rank',
      short: 'Baseline',
      name: 'Baseline model (RANK)',
      predictPrompt: 'Set your call for the baseline model, then reveal its path.',
      changes:
        'The standard model you already know: one representative household and firms that borrow at the risk-free rate — no financial frictions, no inequality.',
      reveal: {
        chartSeries: RANK,
        tableRow: { GDP: '-0.6%', Investment: '-1.5%', Consumption: '-0.7%' },
        narrative:
          'Baseline: output and investment fall, consumption dips as real income drops. This is the picture from the model you already know — now let’s complicate it.',
      },
    },
    {
      id: 'bgg',
      short: '+ Frictions',
      name: '+ Financial frictions (BGG)',
      unlockedByProbeId: 'frictions',
      // The advanced prediction: how does the extension change the baseline?
      extensionPredict: {
        focus: 'Investment',
        prompt: 'Before we reveal it: once firms face borrowing frictions, does INVESTMENT fall more, about the same, or less than in the baseline?',
        expected: 'more',
      },
      changes:
        'Adds financial frictions (the BGG accelerator): when firms’ net worth falls, credit spreads widen and borrowing gets dearer — amplifying the investment drop.',
      reveal: {
        chartSeries: BGG,
        tableRow: { GDP: '-1.0%', Investment: '-3.2%', Consumption: '-1.0%' },
        narrative:
          'With financial frictions, investment falls roughly twice as far (−1.5% → −3.2%): falling net worth widens spreads and raises the cost of capital. GDP deepens; consumption barely moves.',
      },
    },
    {
      id: 'hank',
      short: '+ Unequal HH',
      name: '+ Unequal households (HANK)',
      unlockedByProbeId: 'hetero',
      extensionPredict: {
        focus: 'Consumption',
        prompt: 'Before we reveal it: once some households live hand-to-mouth, does CONSUMPTION fall more, about the same, or less than in the baseline?',
        expected: 'more',
      },
      changes:
        'Adds household inequality (HANK): some households live hand-to-mouth (high marginal propensity to consume), so an income hit cuts their spending sharply.',
      reveal: {
        chartSeries: HANK,
        tableRow: { GDP: '-0.9%', Investment: '-1.8%', Consumption: '-1.3%' },
        narrative:
          'With hand-to-mouth households, consumption falls much further (−0.7% → −1.3%): high-MPC households cut spending the moment income drops. The contraction runs through consumption, not investment.',
      },
    },
  ],

  // Two ways to add a complication. The free-form helper box handles everything else.
  probes: [
    {
      id: 'frictions',
      text: 'What if firms can’t borrow freely?',
      unlocksLayerId: 'bgg',
      answer:
        'In the baseline, firms borrow at the risk-free rate. In reality, when their net worth falls, lenders charge more — the financial accelerator. Want me to add that complication?',
    },
    {
      id: 'hetero',
      text: 'What if households aren’t all the same?',
      unlocksLayerId: 'hank',
      answer:
        'The baseline has one representative household that smooths consumption. In reality, many households live paycheck-to-paycheck (high MPC) and cut spending immediately. Want me to add that complication?',
    },
  ],

  // Provenance scaffolding removed — keep the focus on the model extensions.
  provenanceGates: [],

  coach: {
    hintAfterIdleSec: 60,
    hintAfterUnproductiveProbes: 2,
    maxHints: 3,
    tone: 'Socratic, one nudge at a time',
  },

  synthesis: {
    task:
      'In ≤120 words, explain to a classmate how each complication changes the baseline result: which mechanism amplifies investment, which amplifies consumption, and the intuition behind each.',
    wordLimit: 120,
    rubric: [
      'states the baseline result',
      'financial frictions amplify investment (net worth → spreads → cost of capital)',
      'hand-to-mouth households amplify consumption (high MPC)',
      'connects each advanced model back to the baseline intuition',
    ],
  },

  // Two graded dimensions: your predictions, and your written synthesis.
  scoring: {
    predictionWeight: 50,
    probeEfficiencyWeight: 0,
    provenanceWeight: 0,
    synthesisWeight: 50,
  },
};

export default econOilShock;
