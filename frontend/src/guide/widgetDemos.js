// @language  JavaScript
// @updated   2026-08-19
// @changed   New file: canned demo `data` payloads for the Widgets guide page, one per
//            facilitator widget id, matching each widget's real data contract.

// GuideMarkdown mounts the same FacilitatorBlock/Renderer the chat uses, fed one of these
// payloads, so a reader can play with the real widget with nothing behind it — no backend,
// no chat session, no onSubmit. Keys are the widget ids from the facilitator registry.
export const WIDGET_DEMOS = {
  multiple_choice: {
    question: 'In a negotiation, what does "anchoring" do?',
    options: [
      'Ends the conversation early',
      'Pulls the eventual settlement toward the opening number',
      'Guarantees a 50/50 split',
      'Signals you have no BATNA',
    ],
    answer: 'Pulls the eventual settlement toward the opening number',
    explanation: 'Try an answer — this is exactly what students see after a reply.',
  },
  chart: {
    title: 'Monthly active users',
    type: 'line',
    x_labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
    series: [
      { name: 'Free plan', points: [120, 145, 160, 210, 240, 300] },
      { name: 'Paid plan', points: [20, 28, 35, 52, 74, 95] },
    ],
    y_label: 'Users',
  },
  flashcard: {
    title: 'Negotiation terms',
    cards: [
      { front: 'BATNA', back: 'Best Alternative To a Negotiated Agreement — your fallback if talks fail.' },
      { front: 'ZOPA', back: "Zone Of Possible Agreement — the overlap between both sides' acceptable outcomes." },
      { front: 'Anchoring', back: 'Opening with a number that pulls the eventual settlement toward it.' },
    ],
  },
  timeline: {
    title: 'Product launch',
    steps: [
      { label: 'Discovery', detail: 'Interview 12 target customers' },
      { label: 'Prototype', detail: 'Build a clickable flow' },
      { label: 'Beta', detail: 'Ship to a 50-user waitlist' },
      { label: 'GA launch', detail: 'Public release + pricing page live' },
    ],
  },
  comparison_table: {
    title: 'Equity vs. debt financing',
    columns: ['Equity', 'Debt'],
    rows: [
      { label: 'Ownership', cells: ['Diluted', 'Retained'] },
      { label: 'Repayment', cells: ['None required', 'Fixed schedule'] },
      { label: 'Risk to founder', cells: ['Lower', 'Higher'] },
    ],
  },
  mind_map: {
    central: 'Photosynthesis',
    instructions: 'Connect each tile to where it belongs, then check your answer.',
    nodes: [
      { id: 'sunlight', label: 'Sunlight' },
      { id: 'co2', label: 'CO₂' },
      { id: 'water', label: 'Water' },
      { id: 'glucose', label: 'Glucose' },
      { id: 'oxygen', label: 'Oxygen' },
    ],
    correct_links: [
      { from: 'central', to: 'sunlight' },
      { from: 'central', to: 'co2' },
      { from: 'central', to: 'water' },
      { from: 'central', to: 'glucose' },
      { from: 'central', to: 'oxygen' },
    ],
    distractors: [{ id: 'nitrogen', label: 'Nitrogen fixation' }],
  },
  impact_map: {
    title: 'Scenario: a shipping strait closes',
    scenario: 'A major shipping strait closes to tanker traffic for six weeks.',
    regions: [
      { country: 'Iran', iso3: 'IRN', role: 'trigger', note: 'Closes the strait' },
      { country: 'Saudi Arabia', iso3: 'SAU', role: 'decrease', intensity: 0.8, note: 'Export routes blocked' },
      { country: 'United States', iso3: 'USA', role: 'increase', intensity: 0.4, note: 'Domestic shale output ramps up' },
      { country: 'China', iso3: 'CHN', role: 'decrease', intensity: 0.6, note: 'Oil imports disrupted' },
    ],
  },
};
