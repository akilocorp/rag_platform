// "Oil Shock Macro Lab" — fully worked SCRIPTED experiential template.
//
// The professor loads this and plays it end-to-end with no live LLM calls.
// Numbers are illustrative Q1 deviations from baseline. For the non-baseline
// layers (BGG, HANK) we only have Q1 anchors, so the 8-quarter chart paths are
// the RANK baseline path scaled to hit each layer's Q1 value (per the brief).

// RANK baseline 8-quarter deviation paths (Q1..Q8).
const RANK = {
  gdp:        [-0.6, -1.2, -1.6, -1.8, -1.4, -0.9, -0.5, -0.2],
  inflation:  [1.5, 2.2, 2.5, 2.0, 1.2, 0.7, 0.3, 0],
  rate:       [0.5, 1.0, 1.25, 1.0, 0.5, 0, -0.5, -0.75],
  investment: [-1.5, -3.0, -3.8, -4.0, -3.0, -2.0, -1.0, -0.3],
};

// Scale a baseline path so its Q1 value equals `q1Anchor`, preserving shape.
// (Round to 2dp to keep the stored config readable.)
const scaleTo = (basePath, q1Anchor) => {
  const factor = q1Anchor / basePath[0];
  return basePath.map((v) => Math.round(v * factor * 100) / 100);
};

const BGG = {
  gdp:        scaleTo(RANK.gdp, -1.0),
  inflation:  scaleTo(RANK.inflation, 1.6),
  rate:       scaleTo(RANK.rate, 0.65),
  investment: scaleTo(RANK.investment, -3.2),
};

const HANK = {
  gdp:        scaleTo(RANK.gdp, -0.9),
  inflation:  scaleTo(RANK.inflation, 1.5),
  rate:       scaleTo(RANK.rate, 0.55),
  investment: scaleTo(RANK.investment, -1.8),
};

const econOilShock = {
  meta: {
    id: 'econ-oil-shock',
    title: 'Oil Shock Macro Lab',
    discipline: 'Macroeconomics',
    level: 'Intermediate / Graduate',
    estMinutes: 25,
  },

  scenario: {
    brief:
      'The Strait of Hormuz closes; oil spikes to $150/barrel. Predict the US economy’s path over the next 8 quarters.',
  },

  analyst: {
    persona:
      'You are a confident macro forecasting analyst presenting impulse-response paths for an oil supply shock. You speak with the assurance of an expert who has run these models many times. You do not volunteer the limitations of your numbers — you treat the impulse responses as authoritative — unless a student directly probes the framework, in which case you answer honestly about provenance.',
    stayInCharacter: true,
    mode: 'scripted',
    // Used only in scripted mode for free-form "why?" follow-ups at the foot input.
    scriptedFallback:
      'Good question — but in this lab I respond to specific lines of inquiry. Use the probe chips above to interrogate the framework, the frictions, the policy rule, or household heterogeneity, and I’ll give you a precise answer.',
  },

  predictionVariables: [
    { id: 'gdp', label: 'Real GDP', type: 'direction', expected: 'down', intuition: 'A supply/cost-push shock contracts output.' },
    { id: 'inflation', label: 'Inflation', type: 'direction', expected: 'up', intuition: 'Energy costs pass through to headline prices.' },
    { id: 'rate', label: 'Policy Rate', type: 'direction', expected: 'up', intuition: 'A Taylor-rule central bank leans against inflation.' },
    { id: 'consumption', label: 'Consumption', type: 'direction', expected: 'down', intuition: 'Real incomes fall; precautionary saving rises.' },
    { id: 'investment', label: 'Investment', type: 'direction', expected: 'down', intuition: 'Higher cost of capital and weaker demand cut capex.' },
    { id: 'current_account', label: 'Current Account', type: 'direction', expected: 'down', intuition: 'A pricier oil import bill widens the deficit.' },
    { id: 'usd', label: 'USD (trade-weighted)', type: 'direction', expected: 'up', intuition: 'Safe-haven demand and rate differentials lift the dollar.' },
    { id: 'tsy10', label: '10y Treasury Yield', type: 'direction', expected: 'up', intuition: 'Higher near-term inflation and policy rates lift yields.' },
  ],

  layers: [
    {
      id: 'rank',
      name: 'Standard New Keynesian (RANK)',
      predictPrompt: 'Set your call for each variable before the baseline model reveals its path.',
      changes:
        'Representative-agent New Keynesian baseline: no financial frictions, a single optimizing household, Calvo prices, and a Taylor-rule central bank.',
      reveal: {
        chartSeries: RANK,
        tableRow: {
          'GDP': '-0.6%',
          'Inflation': '+1.5pp',
          'Policy Rate': '+0.50pp',
          'Consumption': '-0.7%',
          'Investment': '-1.5%',
          'Credit Spread': '0',
          'Current Account': '-0.3pp',
          'USD': '+2.0%',
          '10y Yield': '+0.30pp',
        },
        narrative:
          'The baseline RANK model contracts output and lifts inflation on impact, with the central bank raising rates to lean against the cost-push shock. Investment leads the decline as the cost of capital rises.',
      },
    },
    {
      id: 'bgg',
      name: '+ Financial Accelerator (BGG)',
      unlockedByProbeId: 'frictions',
      predictPrompt: 'Before the reveal: how much deeper does investment fall once a financial accelerator is switched on?',
      changes:
        'Adds a Bernanke-Gertler-Gilchrist financial accelerator: falling net worth widens credit spreads, which raises the external finance premium and the effective cost of capital — amplifying the investment response.',
      reveal: {
        chartSeries: BGG,
        tableRow: {
          'GDP': '-1.0%',
          'Inflation': '+1.6pp',
          'Policy Rate': '+0.65pp',
          'Consumption': '-1.0%',
          'Investment': '-3.2%',
          'Credit Spread': '+120bps',
          'Current Account': '-0.4pp',
          'USD': '+1.5%',
          '10y Yield': '+0.45pp',
        },
        narrative:
          'Investment amplifies roughly 2x via the net worth → credit spread → cost-of-capital channel. Headline inflation barely moves — the accelerator works through the demand/investment side, not the price-setting block.',
      },
    },
    {
      id: 'hank',
      name: '+ Hand-to-Mouth Households (HANK)',
      unlockedByProbeId: 'hetero',
      predictPrompt: 'Before the reveal: which variable does household heterogeneity move the most?',
      changes:
        'Replaces the representative agent with heterogeneous households, a share of whom are hand-to-mouth (high marginal propensity to consume). The consumption response to the income hit is amplified.',
      reveal: {
        chartSeries: HANK,
        tableRow: {
          'GDP': '-0.9%',
          'Inflation': '+1.5pp',
          'Policy Rate': '+0.55pp',
          'Consumption': '-1.3%',
          'Investment': '-1.8%',
          'Credit Spread': '0',
          'Current Account': '-0.35pp',
          'USD': '+1.8%',
          '10y Yield': '+0.35pp',
        },
        narrative:
          'The consumption channel dominates: high-MPC hand-to-mouth households cut spending sharply when real income falls, so the contraction runs through consumption rather than investment.',
      },
    },
  ],

  probes: [
    {
      id: 'framework',
      text: 'What modeling framework is this?',
      establishesGateId: 'numbers',
      answer:
        'Fair question to lead with. These impulse responses are calibrated and illustrative — they are not estimated from data (as in an SVAR) nor solved from a fully specified DSGE. Think of them as a structured, internally consistent narrative tuned to plausible magnitudes, not point estimates with standard errors.',
    },
    {
      id: 'frictions',
      text: 'Did you include financial frictions?',
      unlocksLayerId: 'bgg',
      answer:
        'No — the baseline has none; firms borrow at the risk-free rate. I can switch on a Bernanke-Gertler-Gilchrist financial accelerator so net worth and credit spreads feed back into the cost of capital. Want me to add that layer?',
    },
    {
      id: 'taylor',
      text: 'What’s your Taylor rule (φπ, φy, ρ)?',
      answer:
        'The central bank follows a standard Taylor rule with interest-rate smoothing: φπ = 1.5 on inflation, φy = 0.5 on the output gap, and ρ = 0.75 smoothing on the lagged rate.',
    },
    {
      id: 'principle',
      text: 'Does φπ=1.5 satisfy the Taylor principle?',
      answer:
        'Yes. φπ = 1.5 > 1, so the nominal rate rises more than one-for-one with inflation, the real rate increases when inflation rises, and the equilibrium is determinate — no sunspot/indeterminacy problems.',
    },
    {
      id: 'hetero',
      text: 'Are households heterogeneous?',
      unlocksLayerId: 'hank',
      answer:
        'The baseline is representative-agent — one household stands in for all. I can move to a HANK setup with a share of hand-to-mouth, high-MPC households so the consumption response is much stronger. Want me to add that layer?',
    },
    {
      id: 'smoothing',
      text: 'Where’s the consumption smoothing under BGG?',
      productiveAfter: ['bgg'],
      answer:
        'It’s still there — the Euler equation is intact. Consumption falls not because households stop smoothing but because permanent income falls: the shock lowers the expected path of output, so the optimal smoothed consumption level is simply lower.',
    },
    {
      id: 'precise',
      text: 'Can you make the numbers more precise?',
      deadEnd: true,
      answer:
        'Sure — GDP −0.6000%, inflation +1.5000pp, policy rate +0.5000pp. But more decimal places don’t make a calibrated path more trustworthy: precision is not accuracy. The provenance of the numbers is unchanged.',
    },
  ],

  provenanceGates: [
    {
      id: 'numbers',
      claim: 'the impulse-response numbers',
      untrustedUntilProbeId: 'framework',
    },
  ],

  coach: {
    hintAfterIdleSec: 60,
    hintAfterUnproductiveProbes: 2,
    maxHints: 3,
    tone: 'Socratic, one nudge at a time',
  },

  synthesis: {
    task:
      'In ≤150 words, trace the causal chain from the oil shock to the deepest contraction. Name which friction amplifies which variable, and explain why headline inflation barely moves across models.',
    wordLimit: 150,
    rubric: [
      'identifies supply/cost-push shock typology',
      'BGG → investment channel',
      'HANK → consumption channel',
      'explains inflation near-invariance',
      'demonstrates provenance awareness',
    ],
  },

  scoring: {
    predictionWeight: 30,
    probeEfficiencyWeight: 25,
    provenanceWeight: 25,
    synthesisWeight: 20,
  },
};

export default econOilShock;
