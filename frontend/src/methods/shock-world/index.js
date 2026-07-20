// @language JavaScript (React)
// @updated 2026-07-16
// @changed Export SettingsForm (post-generation grading panel) in the method descriptor.
// Shock World — Socratic shock-immersion pedagogy (self-contained method island).
// Auto-discovered by ../registry.js. The backend counterpart is
// backend/src/experiential/methods/shock_world.py (schema='shock-world').
import { validate } from './schema';
import Runner from './Player.jsx';
import ConfigForm from './ConfigForm.jsx';
import SettingsForm from './SettingsForm.jsx';
import Replay from './Replay.jsx';

export default {
  id: 'shock-world',
  label: 'Shock World',
  validate,
  Runner,
  ConfigForm,
  SettingsForm,
  Replay,
};
