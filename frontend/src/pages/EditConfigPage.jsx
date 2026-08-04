// @language  JavaScript (React / JSX)
// @updated   2026-07-31
// @changed   "Counted as one item" merges now group into Strengths / Concerns sections (section header
//            carries the category, per-row field tag dropped). Prior: M8 grading-rubric field + round-trip.
import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import AvatarSelector from '../components/AvatarSelector';
import { FaInfoCircle, FaTrash, FaPlus, FaUsers, FaRobot, FaListAlt, FaCode, FaCopy, FaCheck, FaSpinner, FaUserTie, FaFileAlt, FaCheckCircle, FaUpload } from 'react-icons/fa';
import { SIMULATION_TEMPLATES } from '../data/simulationTemplates';
import VideoScoringEditor from '../components/VideoScoringEditor';
import LabGenerator from '../components/experiential/LabGenerator';
import InfoTip from '../components/InfoTip';
import InstructionsInfoTip from '../components/InstructionsInfoTip';
import ConfigModeToggle from '../components/ConfigModeToggle';
import AdvancedReveal from '../components/AdvancedReveal';
import useConfigMode from '../hooks/useConfigMode';

// Learning-point presets offered for the manager exercise. Only the KEY is sent —
// the full text lives in backend/src/managers/class_presets.py and is stamped into
// the config server-side, so every config on a preset gets identical wording.
const ME_CLASS_PRESETS = [
  { key: 'creative', label: 'Creative Class' },
];

const EditConfigPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // Simple vs Advanced faculty mode — gates the extra config fields below.
  const { advanced } = useConfigMode();

  const [config, setConfig] = useState({});
  const [initialDocuments, setInitialDocuments] = useState([]);
  const [newFiles, setNewFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errors, setErrors] = useState({});
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');

  // Qualtrics embed code generator
  const [showQualtricsModal, setShowQualtricsModal] = useState(false);
  const [qualtricsHtml, setQualtricsHtml] = useState('');
  const [qualtricsLoading, setQualtricsLoading] = useState(false);
  const [qualtricsError, setQualtricsError] = useState('');
  const [qualtricsCopied, setQualtricsCopied] = useState(false);
  
  // HeyGen State
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);

  // Facilitator prompt editor (manager_exercise, advanced only). The stock prompt
  // is ~12 KB of pedagogy, so it is fetched on demand rather than bundled — and
  // only written onto the config once the professor deliberately loads it.
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptErr, setPromptErr] = useState('');

  // Class rollout usage tiers
  const [usageTiers, setUsageTiers] = useState([]);
  useEffect(() => {
    apiClient.get('/usage/tiers').then(res => setUsageTiers(res.data.tiers || [])).catch(() => {});
  }, []);

  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro' },
    // { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    // { id: 'gpt-4', name: 'GPT-4' },
    // { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    // { id: 'gpt-4.1', name: 'GPT-4.1' },
    // { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' }
  ];

  // Ensures the <select> always contains the currently-saved id, even if it
  // predates the canonical list (e.g. legacy "gpt-4o"). Without this, the
  // browser silently falls back to the first option and onChange stops firing
  // when the user tries to pick that option.
  const withCurrent = (currentId) => {
    if (!currentId || aiModels.some(m => m.id === currentId)) return aiModels;
    return [{ id: currentId, name: `${currentId} (current)` }, ...aiModels];
  };

  // Initialize Data
  useEffect(() => {
    const configFromState = location.state?.config;
    if (!configFromState) {
      console.error('No config received in state');
      navigate('/config_list', { state: { error: 'No configuration selected to edit.' } });
      return;
    }

    // Safely parse bots if it's a group chat and came as a string
    let parsedBots = [];
    if (configFromState.bot_type === 'group_chat') {
        try {
            parsedBots = typeof configFromState.bots === 'string' ? JSON.parse(configFromState.bots) : (configFromState.bots || []);
        } catch(e) {
            parsedBots = [];
        }
        if (parsedBots.length === 0) {
             parsedBots = [{ name: 'Assistant', prompt: '', model_name: 'claude-sonnet-4-6', temperature: 0.7 }];
        }
    }

    // Unified instructions panel: legacy bots created with "Advanced Template"
    // stored their raw system prompt in prompt_template with instructions empty.
    // Pull that text into the single instructions field so editing doesn't
    // silently drop their prompt. Strip the standard scaffold marker if present
    // (mirrors backend agent_runner scrubbing).
    let resolvedInstructions = configFromState.instructions || '';
    if (!resolvedInstructions.trim() && configFromState.prompt_template) {
        const tmpl = configFromState.prompt_template;
        const marker = 'Follow these specific instructions:';
        const idx = tmpl.indexOf(marker);
        resolvedInstructions = idx !== -1 ? tmpl.slice(idx + marker.length).trim() : tmpl.trim();
    }

    // Manager exercise: the sub-object may arrive as a nested dict or a JSON
    // string (like bots/scoring_spec). Parse defensively and backfill every field
    // with a default so a partially-authored config still round-trips and the
    // controlled inputs below never read undefined.
    let resolvedManagerExercise = null;
    if (configFromState.bot_type === 'manager_exercise') {
        let me = configFromState.manager_exercise;
        if (typeof me === 'string') {
            try { me = JSON.parse(me); } catch (e) { me = null; }
        }
        me = (me && typeof me === 'object') ? me : {};
        const docRef = (v) => ({ file_id: v?.file_id || '', text: v?.text || '' });
        resolvedManagerExercise = {
            num_students: Math.max(2, Math.min(10, parseInt(me.num_students, 10) || 3)),
            num_rooms: Math.max(1, Math.min(20, parseInt(me.num_rooms, 10) || 5)),
            discuss_minutes: typeof me.discuss_minutes === 'number' ? me.discuss_minutes : 20,
            // Falls back to the round-1 window for configs saved before round 2 had
            // its own. NOTE: this literal is a whitelist rebuild, not a spread — a
            // manager_exercise key missing from it is dropped on every save.
            debrief_minutes: typeof me.debrief_minutes === 'number'
                ? me.debrief_minutes
                : (typeof me.discuss_minutes === 'number' ? me.discuss_minutes : 20),
            class_preset: me.class_preset || '',
            learning_outcome: me.learning_outcome || '',
            // Blank = run the stock facilitator prompt. Only set once a professor
            // has actually loaded and edited it in the advanced block below.
            facilitator_prompt_override: me.facilitator_prompt_override || '',
            general_info: docRef(me.general_info),
            candidate_summary: docRef(me.candidate_summary),
            candidates: Array.isArray(me.candidates)
                ? me.candidates.map(c => ({
                    name: c?.name || '',
                    forecast_text: c?.forecast_text || '',
                    forecast_file_id: c?.forecast_file_id || '',
                }))
                : [],
            // Kept as saved. Re-analysis is explicit in the review step, so an edit
            // that doesn't touch the documents can't silently re-derive the answer
            // key (and quietly discard a professor's manual override).
            case_pack: (me.case_pack && typeof me.case_pack === 'object') ? me.case_pack : null,
        };
    }

    setConfig({
        ...configFromState,
        instructions: resolvedInstructions,
        bots: parsedBots,
        ...(resolvedManagerExercise ? { manager_exercise: resolvedManagerExercise } : {}),
        // Keep the matcher invariant (group_size == num_students) even before save.
        group_size: resolvedManagerExercise ? resolvedManagerExercise.num_students : (configFromState.group_size || 2),
        group_duration: configFromState.group_duration || 10,
        web_access: configFromState.web_access !== undefined ? configFromState.web_access : true,
        qualtrics_enabled: !!configFromState.qualtrics_enabled,
        audio_enabled: !!configFromState.audio_enabled,
        hume_config_id: configFromState.hume_config_id || '',
        facilitator: (configFromState.facilitator && typeof configFromState.facilitator === 'object')
            ? { enabled: false, instruction: '', allowedWidgets: null, presets: [], ...configFromState.facilitator }
            : { enabled: false, instruction: '', allowedWidgets: null, presets: [] }
    });
    
    setInitialDocuments(configFromState.documents || []);
  }, [location.state, navigate]);

  // Fetch HeyGen Avatars if needed
  useEffect(() => {
    if (config.bot_type === 'avatar' && heygenAvatars.length === 0) {
      const fetchAvatars = async () => {
        setIsFetchingAvatars(true);
        try {
          const response = await apiClient.get('/heygen/avatars'); 
          setHeygenAvatars(response.data.avatars || []);
        } catch (err) {
          console.error("Failed to fetch HeyGen avatars", err);
        } finally {
          setIsFetchingAvatars(false);
        }
      };
      fetchAvatars();
    }
  }, [config.bot_type]);

  const showNotificationMessage = (message) => {
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
      setNotificationMessage('');
    }, 3000);
  };

  const navigateToThisAgentChat = () => {
    const id = config.config_id || config._id;
    if (id) {
      if (config.bot_type === 'group_chat') navigate(`/group-chat/${id}`);
      else if (config.bot_type === 'video_analysis') navigate(`/video-dashboard/${id}`);
      else navigate(`/chat/${id}`, { state: { fromEdit: true } });
    } else {
      navigate('/config_list');
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => ({ ...prev, [name]: val }));
  };

  // Builds the ready-to-paste Qualtrics HTML block: the parent snippet
  // (fetched from /qualtrics-parent-snippet.js, config baked in) inlined
  // above a single <iframe>. Paste the whole thing into a Text/Graphic
  // question's HTML view — no separate "Add JavaScript" step needed.
  const openQualtricsModal = async () => {
    const id = config.config_id || config._id;
    if (!id) return;
    setShowQualtricsModal(true);
    setQualtricsLoading(true);
    setQualtricsError('');
    setQualtricsCopied(false);
    try {
      const res = await fetch('/qualtrics-parent-snippet.js');
      if (!res.ok) throw new Error('Could not load snippet template');
      const origin = window.location.origin;
      const snippet = (await res.text())
        .replaceAll('__CONFIG_ID__', id)
        .replaceAll('__EMBED_ORIGIN__', origin);

      const html = [
        '<script>',
        snippet,
        '</script>',
        '<iframe',
        `  src="${origin}/chat/${id}?qualtricsId=\${e://Field/ResponseID}"`,
        '  width="100%" height="650" style="border:none" frameborder="0"',
        '  allow="clipboard-read; clipboard-write; microphone">',
        '</iframe>'
      ].join('\n');

      setQualtricsHtml(html);
    } catch (err) {
      setQualtricsError('Failed to generate embed code. Please try again.');
    } finally {
      setQualtricsLoading(false);
    }
  };

  const copyQualtricsHtml = async () => {
    try {
      await navigator.clipboard.writeText(qualtricsHtml);
      setQualtricsCopied(true);
      setTimeout(() => setQualtricsCopied(false), 2000);
    } catch (err) {
      setQualtricsError('Copy failed — select the text and copy manually.');
    }
  };

  // --- Group Chat Bot Handlers ---
  const handleBotChange = (index, field, value) => {
    const updatedBots = [...config.bots];
    updatedBots[index][field] = value;
    setConfig(prev => ({ ...prev, bots: updatedBots }));
  };

  const addBot = () => {
    setConfig(prev => ({
      ...prev,
      bots: [...prev.bots, { name: `Bot ${prev.bots.length + 1}`, prompt: '', model_name: 'claude-sonnet-4-6', temperature: 0.7 }]
    }));
  };

  const removeBot = (index) => {
    if (config.bots.length > 1) {
      setConfig(prev => ({ ...prev, bots: prev.bots.filter((_, i) => i !== index) }));
    }
  };

  // ---- Manager Exercise authoring state + helpers -----------------------------
  // Mirrors ConfigPage. `mgrUploading` guards the active POST so faculty can't
  // double-submit a document; `mgrUploadError` surfaces a failure inline.
  const [mgrUploading, setMgrUploading] = useState(false);
  const [mgrUploadError, setMgrUploadError] = useState('');
  // Case-pack analysis state for the review block.
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState('');
  // Saving this class's case for reuse. No picker here — an existing class keeps
  // the case it was built on; only new classes choose one.
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetMsg, setPresetMsg] = useState('');
  // Public by default — a case is teaching material and sharing it is the point.
  const [presetVisibility, setPresetVisibility] = useState('public');

  const saveCasePreset = async () => {
    const name = presetName.trim();
    const me = config.manager_exercise || {};
    if (!name || !me.case_pack) return;
    setPresetBusy(true);
    setPresetMsg('');
    try {
      await apiClient.post('/case-presets', {
        name,
        visibility: presetVisibility,
        candidate_summary: me.candidate_summary,
        candidates: me.candidates,
        case_pack: me.case_pack,
        class_preset: me.class_preset,
        learning_outcome: me.learning_outcome,
      });
      setPresetMsg(presetVisibility === 'public'
        ? `Saved "${name}" — anyone building a class can now start from it.`
        : `Saved "${name}" — only you can see it.`);
    } catch (err) {
      const d = err.response?.data;
      setPresetMsg((d && (d.error || d.message)) || 'Could not save the case.');
    } finally {
      setPresetBusy(false);
    }
  };

  // Pull the stock facilitator prompt into the editor. Overwrites whatever is in
  // the box, so it doubles as "revert to default" — the professor then saves it
  // as their own copy, or clears the box to go back to tracking the stock text.
  const loadStockPrompt = async () => {
    setPromptBusy(true);
    setPromptErr('');
    try {
      const res = await apiClient.get('/config/facilitator-prompt/default');
      setMgr('facilitator_prompt_override', res.data.prompt || '');
    } catch (err) {
      const d = err.response?.data;
      setPromptErr((d && (d.error || d.message)) || 'Could not load the stock prompt.');
    } finally {
      setPromptBusy(false);
    }
  };

  // The derived case pack, if this config has one. Read throughout the review block.
  const mePack = config.manager_exercise?.case_pack || null;

  // Patch a single field on the manager_exercise sub-object.
  const setMgr = (field, value) => {
    setConfig(prev => ({ ...prev, manager_exercise: { ...(prev.manager_exercise || {}), [field]: value } }));
  };

  // Group size drives the top-level group_size invariant, so the two move together
  // and can never drift before save.
  const handleNumStudentsChange = (n) => {
    const count = Math.max(2, Math.min(10, parseInt(n, 10) || 2));
    setConfig(prev => ({
      ...prev,
      group_size: count,
      manager_exercise: { ...prev.manager_exercise, num_students: count },
    }));
  };

  // Case documents are restricted to Word (.docx) and PDF.
  const isAllowedManagerDoc = (file) =>
    !!file && ['pdf', 'docx'].includes((file.name.split('.').pop() || '').toLowerCase());

  // POST one document to the faculty-only /api/files/manager-doc endpoint, which
  // extracts plaintext and best-effort parses a name from the header. Returns null
  // (and surfaces the error inline) on failure.
  const uploadCaseDoc = async (file) => {
    if (!isAllowedManagerDoc(file)) {
      setMgrUploadError('Only Word (.docx) and PDF files are allowed.');
      return null;
    }
    setMgrUploading(true);
    setMgrUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (config.config_id) fd.append('config_id', config.config_id);
      const token = localStorage.getItem('jwtToken');
      const res = await apiClient.post('/files/manager-doc', fd, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      return res.data || {};
    } catch (err) {
      const d = err.response?.data;
      setMgrUploadError((d && (d.error || d.message)) || err.message || 'Upload failed');
      return null;
    } finally {
      setMgrUploading(false);
    }
  };

  // Replace one of the AI-only reference documents. Clears the derived pack: a
  // tally computed from documents that are no longer loaded is exactly what the
  // review step exists to catch.
  const handleCaseDocUpload = async (field, file) => {
    if (!file) return;
    const data = await uploadCaseDoc(file);
    if (!data) return;
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        [field]: { file_id: data.file_id || '', text: data.doc_text || '' },
        case_pack: null,
      },
    }));
  };

  // Add one candidate's OUTCOME document. The name is parsed from the doc header
  // and stays editable.
  const handleOutcomeUpload = async (file) => {
    if (!file) return;
    const data = await uploadCaseDoc(file);
    if (!data) return;
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates: [
          ...(prev.manager_exercise?.candidates || []),
          {
            name: data.role_name || '',
            forecast_text: data.doc_text || '',
            forecast_file_id: data.file_id || '',
          },
        ],
        case_pack: null,
      },
    }));
  };

  const setCandidateName = (index, name) => {
    const candidates = [...(config.manager_exercise?.candidates || [])];
    candidates[index] = { ...candidates[index], name };
    setMgr('candidates', candidates);
  };

  const removeCandidate = (index) => {
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates: (prev.manager_exercise?.candidates || []).filter((_, i) => i !== index),
        case_pack: null,
      },
    }));
  };

  // Re-derive the case pack from the currently loaded documents. Same code path as
  // save, so what is approved here is what the facilitator will steer by.
  const analyzeCase = async () => {
    setPackLoading(true);
    setPackError('');
    try {
      const me = config.manager_exercise || {};
      const res = await apiClient.post('/config/case-pack/preview', {
        general_info_text: me.general_info?.text || '',
        candidate_summary_text: me.candidate_summary?.text || '',
        candidates: me.candidates || [],
      });
      setMgr('case_pack', res.data?.case_pack || null);
    } catch (err) {
      const d = err.response?.data;
      setPackError((d && (d.error || d.message)) || err.message || 'Analysis failed');
    } finally {
      setPackLoading(false);
    }
  };

  // Correct a misread outcome verdict — it selects the facilitator's branch entry,
  // so a wrong one sends ACTR into the wrong opening.
  const setOutcomeVerdict = (index, verdict) => {
    const options = [...(mePack.options || [])];
    options[index] = { ...options[index], outcome_verdict: verdict };
    setMgr('case_pack', { ...mePack, options });
  };

  // Push an edited pack through the server's counting code so the tally on screen
  // matches what will be saved. Falls back to the local pack if the call fails —
  // the edit is never lost, only its recount is deferred to save.
  const recomputePack = async (next) => {
    setMgr('case_pack', next);
    try {
      const res = await apiClient.post('/config/case-pack/recompute', { case_pack: next });
      if (res.data?.case_pack) setMgr('case_pack', res.data.case_pack);
    } catch { /* keep the local edit; save recomputes anyway */ }
  };

  // Accept or reject one proposed merge. Rejecting splits the two wordings back
  // into separate items, which raises that candidate's count by one.
  const setMergeConfirmed = (optionIndex, mergeId, confirmed) => {
    const options = [...(mePack.options || [])];
    const merges = (options[optionIndex].merges || []).map(m => (
      m.id === mergeId ? { ...m, confirmed } : m
    ));
    options[optionIndex] = { ...options[optionIndex], merges };
    recomputePack({ ...mePack, options });
  };

  // Override the derived answer key. `best_option_locked` stops the server-side
  // recompute from re-deriving it from the tally on subsequent saves.
  const setBestOption = (name) => {
    setMgr('case_pack', {
      ...mePack,
      answer_key: { ...(mePack.answer_key || {}), best_option: name, best_option_locked: true },
    });
  };
  // ---------------------------------------------------------------------------

  // --- File Handlers ---
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setNewFiles(prev => [...prev, ...files]);
  };

  const handleRemoveDocument = (fileName) => {
    setConfig(prev => ({
      ...prev,
      documents: prev.documents.filter(doc => doc !== fileName)
    }));
  };

  const handleViewDocument = (fileName) => {
    const fileUrl = `/file/${fileName}`;
    window.open(fileUrl, '_blank', 'noopener,noreferrer');
  };

  const handleRemoveNewFile = (fileName) => {
    setNewFiles(prev => prev.filter(file => file.name !== fileName));
  };

  // --- Submit Handler ---
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const newErrors = {};
    if (!config.bot_name?.trim()) newErrors.bot_name = 'Name is required';
    
    if (config.bot_type === 'group_chat') {
        config.bots.forEach((b, i) => {
            if (!b.name.trim()) newErrors[`bot_${i}_name`] = 'Required';
            if (!b.prompt.trim()) newErrors[`bot_${i}_prompt`] = 'Required';
        });
    } else if (config.bot_type === 'video_analysis') {
        if (!config.assignment_type) newErrors.form = 'Please choose an assignment type.';
    } else if (config.bot_type === 'experiential') {
        if (!(config.experiential_config && config.experiential_config.method)) newErrors.form = 'Generate the lab from your prompt before saving.';
    } else if (config.bot_type === 'manager_exercise') {
        // ACTR needs the candidate summary (the tally derives from it), an outcome
        // document per candidate, and a reviewed case pack carrying the answer key.
        const me = config.manager_exercise || {};
        const usable = (me.candidates || []).filter(c => (c.name || '').trim() && (c.forecast_text || '').trim());
        if (!(me.general_info?.text || '').trim()) newErrors.form = 'Upload the General Information document — ACTR needs it to ask what the role requires.';
        else if (!(me.candidate_summary?.text || '').trim()) newErrors.form = 'Upload the Candidate Summary document.';
        else if (usable.length < 2) newErrors.form = 'Upload a named outcome document for at least two candidates.';
        else if (!me.case_pack) newErrors.form = 'Analyse the case and review the result before saving.';
    } else {
        if (!config.instructions?.trim()) newErrors.instructions = 'Required';
    }

    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
        newErrors.form = 'Please select a video avatar.';
    }

    if (config.bot_type === 'audio_call') {
        if (!(config.model_name || '').toLowerCase().startsWith('claude')) {
            newErrors.form = 'Audio Call mode requires a Claude model.';
        }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setIsLoading(true);
    setErrors({});

    try {
      const formData = new FormData();
      const configToSubmit = { ...config };
      
      // Satisfy backend validation
      if (configToSubmit.bot_type === 'group_chat') {
          configToSubmit.instructions = "Group Space: Managing multiple AI agents.";
          configToSubmit.prompt_template = "";
      } else if (configToSubmit.bot_type === 'video_analysis') {
          configToSubmit.instructions = `Video analysis assignment: ${configToSubmit.assignment_type}`;
          configToSubmit.prompt_template = "";
      } else if (configToSubmit.bot_type === 'experiential') {
          configToSubmit.instructions = `Experiential lab: ${configToSubmit.experiential_config?.meta?.title || 'custom'}`;
          configToSubmit.prompt_template = "";
      } else if (configToSubmit.bot_type === 'manager_exercise') {
          // Satisfy backend instructions validation; the real spec lives in the
          // manager_exercise sub-object. Pin the Claude facilitator model and
          // enforce group_size == num_students (backend re-enforces).
          configToSubmit.instructions = 'Manager Exercise: facilitated hidden-profile debrief.';
          configToSubmit.prompt_template = '';
          configToSubmit.model_name = 'claude-sonnet-4-6';
          configToSubmit.group_size = configToSubmit.manager_exercise?.num_students || configToSubmit.group_size;
      } else {
          // Unified instructions panel — always send instructions; backend wraps it.
          configToSubmit.prompt_template = '';
      }

      // scoring_spec / experiential_config are objects — serialize them
      // (the generic loop would coerce to "[object Object]").
      const scoringSpec = configToSubmit.scoring_spec;
      const experientialConfig = configToSubmit.experiential_config;
      const facilitator = configToSubmit.facilitator;
      const managerExercise = configToSubmit.manager_exercise;

      Object.entries(configToSubmit).forEach(([key, value]) => {
        if (key !== 'documents' && key !== 'files' && key !== 'bots' && key !== 'scoring_spec' && key !== 'experiential_config' && key !== 'facilitator' && key !== 'manager_exercise') {
          formData.append(key, value);
        }
      });
      if (scoringSpec && typeof scoringSpec === 'object') {
        formData.append('scoring_spec', JSON.stringify(scoringSpec));
      }
      if (experientialConfig && typeof experientialConfig === 'object') {
        formData.append('experiential_config', JSON.stringify(experientialConfig));
      }
      if (facilitator && typeof facilitator === 'object') {
        formData.append('facilitator', JSON.stringify(facilitator));
      }
      // manager_exercise is a nested object — serialize like scoring_spec so the
      // backend gets JSON (not "[object Object]"). Only for this bot_type.
      if (configToSubmit.bot_type === 'manager_exercise' && managerExercise && typeof managerExercise === 'object') {
        formData.append('manager_exercise', JSON.stringify(managerExercise));
      }
      
      // Append bots safely
      if (configToSubmit.bot_type === 'group_chat') {
        formData.append('bots', JSON.stringify(configToSubmit.bots));
      } else {
        formData.append('bots', '[]');
      }

      newFiles.forEach(file => formData.append('files', file));
      const filesToDelete = initialDocuments.filter(doc => !configToSubmit.documents.includes(doc));
      formData.append('files_to_delete', JSON.stringify(filesToDelete));

      await apiClient.put(`/config/${config.config_id}`, formData);

      if (config.bot_type === 'group_chat') navigate(`/group-chat/${config.config_id}`);
      else if (config.bot_type === 'video_analysis') navigate(`/video-dashboard/${config.config_id}`);
      else if (config.bot_type === 'experiential') navigate(`/experiential/c/${config.config_id}`);
      else if (config.bot_type === 'manager_exercise') navigate(`/manager-exercise/${config.config_id}`);
      else navigate(`/chat/${config.config_id}`, { state: { fromEdit: true, message: 'Updated successfully.' } });
      
    } catch (error) {
      console.error('Error updating config:', error);
      setErrors({ form: error.response?.data?.error || 'Failed to update.' });
    } finally {
      setIsLoading(false);
    }
  };

  // --- NEW: Handle opening the delete confirmation modal ---
  const handleDelete = () => {
    setShowConfirmModal(true);
  };

  const confirmDelete = async () => {
    setShowConfirmModal(false);
    setIsDeleting(true);
    try {
      await apiClient.delete(`/config/${config.config_id}`);
      navigate('/config_list', { state: { refresh: true, message: 'Deleted successfully.' } });
    } catch (error) {
      setErrors({ form: error.response?.data?.error || 'Failed to delete.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const _selectedTier = usageTiers.find(t => t.id === config.usage_tier);
  const _computedPool = _selectedTier && config.student_count
    ? _selectedTier.messages_per_student * Number(config.student_count) : null;
  const classUsageFields = config.class_code ? (
    <div className="grid grid-cols-2 gap-4 mt-3">
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Usage tier</label>
        <select
          value={config.usage_tier || ''}
          onChange={e => setConfig(prev => ({ ...prev, usage_tier: e.target.value }))}
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
        >
          <option value="">Select a tier…</option>
          {usageTiers.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.messages_per_student}/student)</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Number of students</label>
        <input
          type="number" min="1"
          value={config.student_count || ''}
          onChange={e => setConfig(prev => ({ ...prev, student_count: e.target.value }))}
          placeholder="e.g. 40"
          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43]"
        />
      </div>
      {_computedPool != null && (
        <p className="col-span-2 text-[12px] text-gray-500">
          Shared class pool: <span className="font-bold text-[#FA6C43]">{_computedPool.toLocaleString()}</span> messages
        </p>
      )}
    </div>
  ) : null;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="min-h-screen bg-[#F0F6FB] text-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto">

        {/* Faculty mode switch, top-right — mirrors the dashboard toggle. */}
        <div className="flex justify-end mb-4">
          <ConfigModeToggle />
        </div>

        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-[#222] tracking-tight">
            Edit {config.bot_type === 'group_chat' ? 'Group Space' : config.bot_type === 'avatar' ? 'Avatar Assistant' : config.bot_type === 'audio_call' ? 'Audio Call' : config.bot_type === 'video_analysis' ? 'Video Assignment' : config.bot_type === 'manager_exercise' ? 'Manager Exercise' : 'AI Assistant'}
          </h1>
        </div>

        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-8 sm:p-10">
          {errors.form && (
            <div className="mb-8 p-4 bg-red-50 border border-red-200 rounded-xl text-sm flex items-start space-x-3">
              <FaInfoCircle className="text-red-500 mt-0.5 flex-shrink-0 text-lg" />
              <span className="text-red-700 font-medium">{errors.form}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">{config.bot_type === 'group_chat' ? 'Group Lobby Name' : 'Assistant Name'}</label>
                <input
                  type="text"
                  name="bot_name"
                  value={config.bot_name || ''}
                  onChange={handleChange}
                  className={`w-full px-4 py-3 bg-white border ${errors.bot_name ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all`}
                />
                {errors.bot_name && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.bot_name}</p>}
              </div>

              {advanced && config.bot_type !== 'group_chat' && config.bot_type !== 'video_analysis' && (
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Model Name</label>
                  <select
                    name="model_name"
                    value={config.model_name || ''}
                    onChange={handleChange}
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
                  >
                    {withCurrent(config.model_name).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Avatar Selection Based on Type */}
            <div className={`pt-2 ${(config.bot_type === 'audio_call' || config.bot_type === 'video_analysis') ? 'hidden' : ''}`}>
                {config.bot_type === 'avatar' ? (
                    <>
                      <label className="block text-[13px] font-semibold text-gray-700 mb-2">Video Avatar</label>
                      <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {isFetchingAvatars ? (
                           <p className="text-sm text-gray-400">Loading avatars...</p>
                        ) : (
                           heygenAvatars.map((avatar) => (
                             <div key={avatar.avatar_id} onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))} className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${config.heygen_avatar_id === avatar.avatar_id ? 'border-[#FA6C43] shadow-md scale-95' : 'border-transparent hover:border-gray-300'}`}>
                                 <img src={avatar.normal_preview} alt="Avatar" className="w-full h-16 object-cover bg-gray-100" />
                             </div>
                           ))
                        )}
                      </div>
                    </>
                ) : (
                    <AvatarSelector
                        selectedAvatar={config.bot_avatar}
                        onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                        label={config.bot_type === 'group_chat' ? 'Lobby / Space Icon' : 'Bot Avatar'}
                        hint={
                          config.bot_type === 'group_chat'
                            ? 'Shown in your list and at the top of this group space.'
                            : undefined
                        }
                    />
                )}
            </div>

            {/* Introduction */}
            <div>
              <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Introduction <span className="text-gray-400 font-normal ml-1">(Optional)</span></label>
              <textarea
                name="introduction"
                value={config.introduction || ''}
                onChange={handleChange}
                rows="2"
                className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]"
              />
            </div>

            {/* Public Access Toggle */}
            <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Public Access</label>
                  <p className="text-xs text-gray-500 font-medium">Allow anyone with the link to access this space</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" name="is_public" className="sr-only peer" checked={!!config.is_public} onChange={handleChange} />
                  <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                </label>
              </div>
            </div>

            {/* CONDITIONAL LOGIC: Video Analysis vs Group Chat vs Standard */}
            {config.bot_type === 'experiential' ? (
              <div className="border-t border-gray-100 pt-8 mt-8">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-5"><FaListAlt className="mr-2 text-[#FA6C43]"/> Simulation Lab</h3>
                <LabGenerator
                  advanced={advanced}
                  prompt={config.experiential_prompt}
                  onPromptChange={(v) => setConfig(prev => ({ ...prev, experiential_prompt: v }))}
                  generated={config.experiential_config}
                  onGenerated={(cfg) => setConfig(prev => ({ ...prev, experiential_config: cfg }))}
                  configId={config.config_id}
                />

                {/* Facilitator — interactive UI (e.g. charts) layered over the lab's replies */}
                <div className="mt-6 p-5 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Facilitator (interactive UI)</label>
                      <p className="text-xs text-gray-500 font-medium">After each reply, offer structured UI — e.g. a chart or multiple-choice — instead of only text.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!config.facilitator?.enabled}
                        onChange={(e) => setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), enabled: e.target.checked } }))}
                      />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                    </label>
                  </div>
                  {config.facilitator?.enabled && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">What should the facilitator do?</label>
                      <textarea
                        rows={3}
                        value={config.facilitator?.instruction || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), instruction: e.target.value } }))}
                        placeholder="e.g. When the reply describes a quantity changing across periods, show it as a chart of that trajectory."
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                      />
                      <p className="text-[11px] text-gray-400 mt-1.5">Available widgets: multiple choice, chart. More coming soon.</p>
                    </div>
                  )}
                </div>

                <AdvancedReveal show={advanced}>
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional - generates a student invite link)</span>
                  </label>
                  <input
                    type="text"
                    value={(config.class_code || '').toUpperCase()}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. MACRO101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  {classUsageFields}
                </div>
                </AdvancedReveal>
              </div>
            ) : config.bot_type === 'video_analysis' ? (
              <div className="border-t border-gray-100 pt-8 mt-8">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-5"><FaListAlt className="mr-2 text-[#FA6C43]"/> Rubric & Scoring</h3>
                <VideoScoringEditor
                  advanced={advanced}
                  assignmentType={config.assignment_type}
                  scoringSpec={config.scoring_spec}
                  onChange={({ assignment_type, scoring_spec }) =>
                    setConfig(prev => ({ ...prev, assignment_type, scoring_spec }))}
                />
                <AdvancedReveal show={advanced}>
                <div className="mt-4">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional - generates a student invite link)</span>
                  </label>
                  <input
                    type="text"
                    value={(config.class_code || '').toUpperCase()}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. ACTR101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">3-20 characters, letters, numbers, hyphens. Must be unique.</p>
                  {classUsageFields}
                </div>
                <p className="text-xs text-gray-400 mt-4">Editing weights or prompts applies to new submissions. Use "Rescore" on the dashboard to re-grade existing ones.</p>
                </AdvancedReveal>
              </div>
            ) : config.bot_type === 'group_chat' ? (
              <div className="border-t border-gray-100 pt-8 mt-8 space-y-6">
                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Matchmaking Rules</h3>
                <div className="grid grid-cols-2 gap-8 bg-gray-50 p-6 rounded-2xl border border-gray-100">
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span>Target Size</span><span className="text-[#FA6C43] font-bold">{Number(config.group_size) === 1 ? 'Solo (1 user + AIs)' : config.group_size}</span></label>
                    <input type="range" name="group_size" min="1" max="10" value={config.group_size} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                  {advanced && (
                  <div>
                    <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2"><span className="inline-flex items-center gap-1">Duration<InfoTip text="How long the group chat stays open before it automatically ends. Adjustable from 5 to 60 minutes." /></span><span className="text-[#FA6C43] font-bold">{config.group_duration} Mins</span></label>
                    <input type="range" name="group_duration" min="5" max="60" step="5" value={config.group_duration} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  </div>
                  )}
                </div>

                <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mt-6"><FaRobot className="mr-2 text-[#FA6C43]"/> AI Agents</h3>
                {config.bots.map((bot, index) => {
                   const noTemp = bot.model_name?.includes('gpt-5') || bot.model_name?.includes('gemini');
                   return (
                    <div key={index} className="bg-white p-5 rounded-2xl border-2 border-gray-100 shadow-sm relative">
                        {config.bots.length > 1 && (
                            <button type="button" onClick={() => removeBot(index)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg"><FaTrash/></button>
                        )}
                        <div className="grid grid-cols-2 gap-4 mb-4 pr-8">
                            <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Agent Name</label>
                                <input type="text" value={bot.name} onChange={(e) => handleBotChange(index, 'name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43]" />
                            </div>
                            {advanced && (
                            <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Model</label>
                                <select value={bot.model_name} onChange={(e) => handleBotChange(index, 'model_name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43]">
                                    {withCurrent(bot.model_name).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                            </div>
                            )}
                        </div>
                        <div className="mb-4">
                            <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">System Prompt</label>
                            <textarea value={bot.prompt} onChange={(e) => handleBotChange(index, 'prompt', e.target.value)} rows="2" className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm outline-none focus:border-[#FA6C43] resize-none" />
                        </div>
                        <AdvancedReveal show={advanced}>
                        <div>
                            <label className="flex justify-between text-[11px] font-bold text-gray-500 uppercase mb-2">
                                <span className="inline-flex items-center gap-1">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></span>
                                {noTemp && <span className="text-gray-400 font-normal normal-case">Auto-managed</span>}
                            </label>
                            {!noTemp && (
                              <>
                                <input type="range" min="0" max="1" step="0.1" value={bot.temperature} onChange={(e) => handleBotChange(index, 'temperature', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                                <div className="flex justify-between text-[10px] font-medium text-gray-400 mt-1.5 normal-case tracking-normal">
                                  <span>Precise</span>
                                  <span>Balanced</span>
                                  <span>Conversational</span>
                                  <span>Creative</span>
                                </div>
                              </>
                            )}
                        </div>
                        </AdvancedReveal>
                    </div>
                   )
                })}
                {advanced && (
                <button type="button" onClick={addBot} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-500 rounded-2xl hover:text-[#FA6C43] hover:border-[#FA6C43] font-bold text-sm flex justify-center"><FaPlus className="mr-2 mt-0.5"/> Add Agent</button>
                )}
              </div>
            ) : config.bot_type === 'manager_exercise' ? (
              // ==============================
              // MANAGER EXERCISE — facilitated debrief authoring (mirrors ConfigPage)
              // ==============================
              // `me` is the guaranteed-present sub-object (the init effect backfills
              // every field for this bot_type). Aliased so the JSX reads cleanly and
              // stays null-safe even if a partial doc slipped through.
              (() => {
                const me = config.manager_exercise || {};
                const candidates = me.candidates || [];
                return (
                  <div className="border-t border-gray-100 pt-8 mt-8">
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-1"><FaUserTie className="mr-2 text-[#FA6C43]"/> Manager Exercise</h3>
                    <p className="text-[11px] text-gray-400 mb-6">The decision itself happens offline on printed packets. Everything below is what ACTR needs for the debrief afterwards.</p>

                    {/* Group size + the one timed phase. num_students drives group_size. */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-4">
                      <div className="mb-5">
                        <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                          <span className="inline-flex items-center gap-1">Students per group<InfoTip text="Capacity of one breakout room, not a requirement. A group can start short-handed, and the facilitator is told how many actually turned up." /></span>
                          <span className="text-[#FA6C43] font-bold">{me.num_students} students</span>
                        </label>
                        <input type="range" min="2" max="10" step="1" value={me.num_students || 2} onChange={(e) => handleNumStudentsChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                      </div>
                      <div className="mb-5">
                        <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                          <span className="inline-flex items-center gap-1">Breakout groups<InfoTip text="How many groups the class splits into. Students see them as Group 1, Group 2… with live occupancy, and pick one — there is no queue." /></span>
                          <span className="text-[#FA6C43] font-bold">{me.num_rooms} groups</span>
                        </label>
                        <input type="range" min="1" max="20" step="1" value={me.num_rooms || 1} onChange={(e) => setMgr('num_rooms', Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        <p className="mt-2 text-[11px] font-semibold text-gray-500">Room for up to {(me.num_rooms || 1) * (me.num_students || 1)} students.</p>
                      </div>
                      {/* Two windows, one per conversation. Round 0 (the private
                          decision) is untimed — it ends when everyone has submitted. */}
                      <div className="mb-5">
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Round 1 &mdash; team discussion (minutes)<InfoTip text="How long the group has to talk it through before the ballot opens. The facilitator is not present for this round: it is the students' own decision. The clock starts on their first message, so reading time is free." /></label>
                        <input type="number" min="0" step="any" value={me.discuss_minutes} onChange={(e) => setMgr('discuss_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                      </div>
                      <div>
                        <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Round 2 &mdash; debrief (minutes)<InfoTip text="How long the facilitated debrief may run after the outcome is revealed. This is a backstop: the facilitator normally closes the session itself once the group has worked out what they missed." /></label>
                        <input type="number" min="0" step="any" value={me.debrief_minutes} onChange={(e) => setMgr('debrief_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                      </div>
                    </div>

                    {/* What ACTR steers toward. Only the preset KEY is sent; the full
                        learning-point text is stamped in server-side. */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Class preset<InfoTip text="Pre-written learning points the facilitator steers toward. Leave blank to rely on your own stated outcome alone." /></label>
                      <select value={me.class_preset || ''} onChange={(e) => setMgr('class_preset', e.target.value)} className="w-full p-2.5 mb-4 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                        <option value="">— none —</option>
                        {ME_CLASS_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                      <label className="block text-xs font-semibold text-gray-700 mb-2">What should they take away?</label>
                      <textarea rows="3" value={me.learning_outcome || ''} onChange={(e) => setMgr('learning_outcome', e.target.value)} placeholder="e.g. Groups under-share unique information and over-weight a concern everyone happens to hold." className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                    </div>

                    {/* The facilitator's own system prompt, editable in place. Empty means
                        the stock prompt is used and keeps tracking future revisions; any
                        text here replaces it wholesale for this config only. */}
                    <AdvancedReveal show={advanced}>
                      <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6">
                        <button type="button" onClick={() => setPromptOpen(v => !v)} className="flex items-center gap-2 text-xs font-bold text-gray-700 uppercase tracking-wider">
                          {promptOpen ? '▾' : '▸'} Facilitator instructions
                          <span className={`normal-case tracking-normal font-semibold ${(me.facilitator_prompt_override || '').trim() ? 'text-[#C2410C]' : 'text-gray-400'}`}>
                            {(me.facilitator_prompt_override || '').trim() ? '· edited' : '· default'}
                          </span>
                        </button>
                        {promptOpen && (
                          <div className="mt-3">
                            <p className="text-[11px] text-gray-500 mb-3">
                              Everything ACTR is told before a session — the sequence, the constraints, how it takes turns.
                              Leave this empty to run the standard prompt and pick up future improvements automatically.
                              Load it to make your own copy, which then stays frozen as you edited it.
                              Keep the <code className="bg-white px-1 rounded border border-gray-200">&lt;&lt;CASE_PACK&gt;&gt;</code> marker —
                              it is where your case is injected. <code className="bg-white px-1 rounded border border-gray-200">&lt;&lt;ROSTER&gt;&gt;</code>,
                              <code className="bg-white px-1 rounded border border-gray-200">&lt;&lt;LEARNING_OBJECTIVES&gt;&gt;</code> and
                              <code className="bg-white px-1 rounded border border-gray-200">&lt;&lt;GROUP_SIZE&gt;&gt;</code> are optional.
                            </p>
                            <div className="flex gap-2 mb-2">
                              <button type="button" onClick={loadStockPrompt} disabled={promptBusy} className="rounded-lg bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-3 py-1.5 text-xs shadow-sm disabled:opacity-50 transition-all active:scale-95">
                                {promptBusy ? 'Loading…' : ((me.facilitator_prompt_override || '').trim() ? 'Reset to standard' : 'Load standard prompt')}
                              </button>
                              {(me.facilitator_prompt_override || '').trim() && (
                                <button type="button" onClick={() => setMgr('facilitator_prompt_override', '')} className="rounded-lg border border-gray-200 bg-white hover:border-gray-300 text-gray-600 font-bold px-3 py-1.5 text-xs transition-all active:scale-95">
                                  Clear &amp; follow the standard
                                </button>
                              )}
                            </div>
                            {promptErr && <p className="text-[11px] font-semibold text-red-500 mb-2">{promptErr}</p>}
                            <textarea
                              rows="18"
                              value={me.facilitator_prompt_override || ''}
                              onChange={(e) => setMgr('facilitator_prompt_override', e.target.value)}
                              placeholder="Empty — the standard facilitator prompt is in use. Load it above to edit your own copy."
                              spellCheck={false}
                              className="w-full p-3 bg-white border border-gray-200 rounded-lg font-mono text-[11px] leading-relaxed focus:outline-none focus:border-[#FA6C43] transition-all"
                            />
                          </div>
                        )}
                      </div>

                    </AdvancedReveal>

                    {/* Class code — how students reach the exercise at all, so it sits
                        in the main flow rather than behind the Advanced toggle. */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Class code<InfoTip text="Students open /join/CODE, sign in, and land straight in the breakout lobby. Leave blank to share the direct link instead." /></label>
                      <input
                        type="text"
                        value={(config.class_code || '').toUpperCase()}
                        onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))}
                        maxLength={20}
                        placeholder="e.g. MGMT5110"
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all"
                      />
                      <p className="text-[10px] text-gray-400 mt-1">3–20 characters, letters, numbers, hyphens. Must be unique.</p>
                      {config.class_code && (
                        <p className="mt-2 text-[11px] font-semibold text-[#C2410C] break-all">
                          Share: {window.location.origin}/join/{config.class_code.toUpperCase()}
                        </p>
                      )}
                      {classUsageFields}
                    </div>

                    {/* AI-only reference documents. Never shown to a student — the
                        candidate summary states every role's private view. */}
                    <h4 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-1 flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> Case Materials</h4>
                    <p className="text-[11px] text-gray-400 mb-3">ACTR-only. Replacing any document clears the analysis below, so the tally can never describe files that are no longer loaded.</p>
                    {[
                      { field: 'general_info', label: 'General Information', required: true,
                        hint: 'What the role requires. ACTR uses it to ask what outcome each candidate would produce, and whether that is what the job needed.' },
                      { field: 'candidate_summary', label: 'Candidate Summary', required: true,
                        hint: "Every role's private view, side by side. The pooled tally derives from this." },
                    ].map(slot => {
                      const doc = me[slot.field] || {};
                      const filled = (doc.text || '').trim().length > 0;
                      return (
                        <div key={slot.field} className={`p-4 mb-3 rounded-2xl border-2 transition-all ${filled ? 'border-[#FA6C43]/40 bg-[#F9D0C4]/10' : 'border-dashed border-gray-300 bg-white'}`}>
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-bold text-sm text-[#222]">
                                {slot.label}
                                {!slot.required && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">optional</span>}
                              </p>
                              <p className="text-[11px] text-gray-400">{filled ? `${doc.text.trim().length.toLocaleString()} characters extracted` : slot.hint}</p>
                            </div>
                            <label className="flex-shrink-0 cursor-pointer text-xs font-bold px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-[#FA6C43] hover:text-[#FA6C43] transition-all active:scale-95">
                              {filled ? 'Replace' : 'Upload'}
                              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleCaseDocUpload(slot.field, e.target.files?.[0])} />
                            </label>
                          </div>
                        </div>
                      );
                    })}

                    {/* One outcome document per candidate, revealed on pick. */}
                    <div className="flex items-center justify-between mb-2 mt-5">
                      <h4 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Candidate Outcomes</h4>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">{candidates.length} uploaded</span>
                    </div>
                    <div className="space-y-2 mb-3">
                      {candidates.map((cand, idx) => (
                        <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-1 duration-200">
                          <input type="text" value={cand.name} onChange={(e) => setCandidateName(idx, e.target.value)} placeholder="Candidate name" className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                          <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">{(cand.forecast_text || '').trim().length.toLocaleString()} chars</span>
                          <button type="button" onClick={() => removeCandidate(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"><FaTrash className="text-sm" /></button>
                        </div>
                      ))}
                    </div>
                    <label className="w-full py-3 mb-6 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50 transition-all font-bold text-sm flex items-center justify-center cursor-pointer active:scale-[0.99]">
                      <FaPlus className="mr-2" /> Add a candidate outcome
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleOutcomeUpload(e.target.files?.[0])} />
                    </label>
                    {mgrUploading && <p className="text-xs font-medium text-gray-500 mb-3">Uploading…</p>}
                    {mgrUploadError && <p className="text-xs font-medium text-red-500 mb-3">{mgrUploadError}</p>}

                    {/* The derived answer key. A wrong one is invisible once the
                        exercise is running, so saving is gated on it existing. */}
                    <h4 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-1 flex items-center"><FaCheckCircle className="mr-2 text-[#FA6C43]"/> The Analysis</h4>
                    <p className="text-[11px] text-gray-400 mb-3">Who holds what, what pools together, and which candidate the pooled evidence favours.</p>

                    {!mePack ? (
                      <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100 text-center">
                        <p className="text-sm text-gray-500 mb-4">Not analysed yet.</p>
                        <button type="button" onClick={analyzeCase} disabled={packLoading} className="inline-flex items-center gap-2 rounded-xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-5 py-3 text-sm shadow-sm disabled:opacity-50 transition-all active:scale-95">
                          {packLoading ? 'Analysing…' : 'Analyse the case'}
                        </button>
                        {packError && <p className="text-xs font-medium text-red-500 mt-3">{packError}</p>}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {/* Cross-check against totals the document states for itself. */}
                        {(mePack.warnings || []).length > 0 && (
                          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
                            <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700 mb-2">
                              Doesn't match the document
                            </p>
                            <ul className="space-y-1">
                              {mePack.warnings.map((w, i) => (
                                <li key={i} className="text-xs text-amber-900">• {w}</li>
                              ))}
                            </ul>
                            <p className="text-[11px] text-amber-700 mt-2">
                              Check the merges below — an incorrect merge removes an item from the count.
                            </p>
                          </div>
                        )}

                        <div className="rounded-2xl border border-gray-200 overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500">
                              <tr>
                                <th className="text-left font-bold px-4 py-2.5">Candidate</th>
                                <th className="text-center font-bold px-3 py-2.5">Strengths</th>
                                <th className="text-center font-bold px-3 py-2.5">Concerns</th>
                                <th className="text-left font-bold px-3 py-2.5">Outcome</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(mePack.options || []).map((o, i) => (
                                <tr key={i} className={`border-t border-gray-100 ${o.name === mePack.answer_key?.best_option ? 'bg-[#F9D0C4]/20' : ''}`}>
                                  <td className="px-4 py-3 font-semibold text-[#222]">{o.name}</td>
                                  <td className="px-3 py-3 text-center font-bold text-[#222] tabular-nums">{o.distinct_strengths}</td>
                                  <td className="px-3 py-3 text-center font-bold text-[#222] tabular-nums">{o.distinct_concerns}</td>
                                  <td className="px-3 py-3">
                                    <select value={o.outcome_verdict || 'failure'} onChange={(e) => setOutcomeVerdict(i, e.target.value)} className="text-xs font-semibold bg-white border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-[#FA6C43]">
                                      <option value="success">succeeded</option>
                                      <option value="failure">failed</option>
                                    </select>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Every pair of wordings judged to be the same fact, and so
                            counted once. The only place the tally loses items, so the
                            only place worth auditing. Untick to split them back apart. */}
                        {(mePack.options || []).some(o => (o.merges || []).length > 0) && (
                          <div className="bg-white p-5 rounded-2xl border border-gray-200">
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">Counted as one item</h4>
                            <p className="text-[11px] text-gray-400 mb-3">Untick anything that is really two separate facts — the count updates as you go.</p>
                            {/* Grouped by field so Strengths and Concerns read as
                                separate sections instead of one bundled list. Flatten
                                first, keeping each merge's option + index (the index
                                drives setMergeConfirmed); the section header carries the
                                category, so the per-row field tag is dropped. */}
                            {(() => {
                              const rows = [];
                              (mePack.options || []).forEach((o, i) =>
                                (o.merges || []).forEach(m => rows.push({ o, i, m }))
                              );
                              return [
                                { field: 'strengths', label: 'Strengths' },
                                { field: 'concerns', label: 'Concerns' },
                              ].map(g => {
                                const items = rows.filter(r => r.m.field === g.field);
                                if (!items.length) return null;
                                return (
                                  <div key={g.field} className="mt-4">
                                    <h5 className="text-[10px] font-bold uppercase tracking-wider text-[#C2410C] mb-1">{g.label}</h5>
                                    {items.map(({ o, i, m }) => (
                                      <label key={m.id} className="flex items-start gap-3 py-2 border-t border-gray-100 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={!!m.confirmed}
                                          onChange={(e) => setMergeConfirmed(i, m.id, e.target.checked)}
                                          className="mt-0.5 h-4 w-4 flex-shrink-0 accent-[#FA6C43] cursor-pointer"
                                        />
                                        <span className="min-w-0">
                                          <span className="text-[11px] font-bold text-[#222]">{o.name}</span>
                                          <span className="block text-[11px] text-gray-500">• {m.a}</span>
                                          <span className="block text-[11px] text-gray-500">• {m.b}</span>
                                          {m.note && <span className="block text-[10px] text-gray-400 italic mt-0.5">{m.note}</span>}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        )}

                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Strongest candidate<InfoTip text="Derived from the pooled tally: most distinct strengths, fewest distinct concerns. ACTR never states this — it steers students until they count it themselves. Override only if the analysis got it wrong." /></label>
                          <select value={mePack.answer_key?.best_option || ''} onChange={(e) => setBestOption(e.target.value)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                            {(mePack.options || []).map((o, i) => <option key={i} value={o.name}>{o.name}</option>)}
                          </select>
                          {mePack.answer_key?.best_option_locked && <p className="text-[11px] font-semibold text-[#C2410C] mt-2">Set manually — the tally no longer decides this.</p>}
                          {mePack.answer_key?.mechanism && <p className="text-[11px] text-gray-500 mt-3 leading-relaxed"><span className="font-bold uppercase tracking-wider text-gray-400">The trap: </span>{mePack.answer_key.mechanism}</p>}
                        </div>

                        {/* Keep this case for the next cohort — everything above is
                            cohort-independent. */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Save this case for reuse<InfoTip text="Stores the documents and this approved analysis under a name. A new class can start from it and only needs a group size, breakout rooms and a class code. Saving under an existing name replaces it." /></label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={presetName}
                              onChange={(e) => setPresetName(e.target.value)}
                              placeholder="e.g. HKL Solutions COO"
                              className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all"
                            />
                            <button
                              type="button"
                              onClick={saveCasePreset}
                              disabled={presetBusy || !presetName.trim()}
                              className="flex-shrink-0 rounded-lg bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-4 text-sm shadow-sm disabled:opacity-50 transition-all active:scale-95"
                            >
                              {presetBusy ? 'Saving…' : 'Save case'}
                            </button>
                          </div>

                          {/* Who else can build from it. Changeable later from the
                              case picker when creating a class. */}
                          <div className="mt-3 flex gap-2">
                            {[
                              { key: 'public', label: 'Shared', hint: 'Anyone building a class can use it' },
                              { key: 'private', label: 'Private', hint: 'Only you can see it' },
                            ].map(v => (
                              <button
                                key={v.key}
                                type="button"
                                onClick={() => setPresetVisibility(v.key)}
                                className={`flex-1 rounded-lg border-2 px-3 py-2 text-left transition-all active:scale-[0.98] ${
                                  presetVisibility === v.key
                                    ? 'border-[#FA6C43] bg-[#FA6C43]/5'
                                    : 'border-gray-200 bg-white hover:border-gray-300'
                                }`}
                              >
                                <div className="text-xs font-bold text-[#222]">{v.label}</div>
                                <div className="text-[10px] text-gray-500">{v.hint}</div>
                              </button>
                            ))}
                          </div>
                          {presetMsg && <p className="text-[11px] font-semibold text-[#C2410C] mt-2">{presetMsg}</p>}
                        </div>

                        <button type="button" onClick={analyzeCase} disabled={packLoading} className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50 transition-all font-bold text-sm disabled:opacity-50 active:scale-[0.99]">
                          {packLoading ? 'Analysing…' : 'Re-analyse from the documents'}
                        </button>
                        {packError && <p className="text-xs font-medium text-red-500">{packError}</p>}
                      </div>
                    )}
                  </div>
                );
              })()
            ) : (
              // Standard AI Settings
              <>
                <div className="space-y-4 border-t border-gray-100 pt-8 mt-8">
                  {/* Template Gallery (collapsible) */}
                  <div className="mb-2">
                    <button type="button" onClick={() => setShowTemplates(v => !v)} className="flex items-center gap-2 text-sm font-semibold text-[#FA6C43] hover:underline">
                      {showTemplates ? '▾' : '▸'} Apply a simulation template
                    </button>
                    {showTemplates && (
                      <div className="grid grid-cols-2 gap-3 mt-3">
                        {SIMULATION_TEMPLATES.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => {
                              setConfig(prev => ({ ...prev, instructions: t.instructions, temperature: t.temperature }));
                              setShowTemplates(false);
                            }}
                            className="text-left p-3 rounded-xl border-2 border-gray-200 hover:border-[#FA6C43] hover:bg-[#F9D0C4]/20 bg-white transition-all"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">{t.icon}</span>
                              <span className="text-sm font-bold text-[#222]">{t.title}</span>
                            </div>
                            <p className="text-[11px] text-gray-500 leading-snug">{t.description}</p>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700">
                    Instructions
                    <InstructionsInfoTip />
                  </label>
                  <textarea name="instructions" value={config.instructions || ''} onChange={handleChange} rows="5" className={`w-full px-4 py-3 bg-white border ${errors.instructions ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm outline-none focus:border-[#FA6C43]`} placeholder="Describe how the bot should behave. You can also request JSON / structured output — see the ⓘ tip." />
                  {errors.instructions && <p className="mt-1.5 text-xs font-medium text-red-500">{errors.instructions}</p>}
                </div>

                {/* Advanced-only controls — hidden in Simple mode, animated in on Advanced. */}
                <AdvancedReveal show={advanced}>
                <div className="space-y-8">

                <div>
                  <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-3">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></label>
                  <input type="range" name="temperature" min="0" max="1" step="0.1" value={config.temperature || 0.7} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                  <div className="flex justify-between text-xs font-medium text-gray-400 mt-2">
                    <span>Precise</span>
                    <span>Balanced</span>
                    <span>Conversational</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Allow web search & URL access</label>
                      <p className="text-xs text-gray-500 font-medium">When off, the bot only uses your uploaded files.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" name="web_access" className="sr-only peer" checked={!!config.web_access} onChange={handleChange} />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                    </label>
                  </div>
                </div>

                {/* Facilitator — pluggable structured-UI layer over the bot's replies */}
                <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Facilitator (interactive UI)</label>
                      <p className="text-xs text-gray-500 font-medium">After each reply, offer the user structured UI — e.g. multiple-choice options — instead of only text.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={!!config.facilitator?.enabled}
                        onChange={(e) => setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), enabled: e.target.checked } }))}
                      />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                    </label>
                  </div>
                  {config.facilitator?.enabled && (
                    <div className="mt-4">
                      <label className="block text-xs font-semibold text-gray-600 mb-1.5">What should the facilitator do?</label>
                      <textarea
                        rows={3}
                        value={config.facilitator?.instruction || ''}
                        onChange={(e) => setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), instruction: e.target.value } }))}
                        placeholder="e.g. Whenever the reply asks the user to choose between options or a next step, present it as multiple choice. Keep options short (2–4)."
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                      />
                      <p className="text-[11px] text-gray-400 mt-1.5">Available widgets: multiple choice, chart, flashcards, timeline, comparison table, mind map, impact map. More coming soon.</p>
                    </div>
                  )}
                </div>

                {/* Qualtrics embedding */}
                <div className="p-5 bg-gray-50 border border-gray-100 rounded-xl">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <label className="block text-[13px] font-bold text-gray-800 mb-0.5">Qualtrics embedding</label>
                      <p className="text-xs text-gray-500 font-medium">Turn on to embed this assistant in a Qualtrics survey via iframe.</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input type="checkbox" name="qualtrics_enabled" className="sr-only peer" checked={!!config.qualtrics_enabled} onChange={handleChange} />
                      <div className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></div>
                    </label>
                  </div>
                  {config.qualtrics_enabled && (
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={openQualtricsModal}
                        className="inline-flex items-center gap-2 py-2.5 px-4 rounded-xl font-bold text-sm text-white bg-gray-900 hover:bg-gray-700 transition-colors"
                      >
                        <FaCode className="text-xs" /> Create Session — Get Embed HTML
                      </button>
                      <p className="text-[11px] text-gray-400 mt-2">
                        Generates one script+iframe HTML block. Paste it into a Qualtrics Text/Graphic question's HTML view — no separate JavaScript step needed.
                      </p>
                    </div>
                  )}
                </div>

                {/* Class rollout — optional class code + shared message pool */}
                <div className="border-t border-gray-100 pt-8 mt-8">
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">
                    Class Code <span className="font-normal text-gray-400">(optional — roll this bot out to a class with a shared message pool)</span>
                  </label>
                  <input
                    type="text"
                    value={(config.class_code || '').toUpperCase()}
                    onChange={e => setConfig(prev => ({ ...prev, class_code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') }))}
                    maxLength={20}
                    placeholder="e.g. ACTR101"
                    className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">3-20 characters, letters, numbers, hyphens. Must be unique.</p>
                  {classUsageFields}
                </div>

                </div>
                </AdvancedReveal>
              </>
            )}

            <div className={`border-t border-gray-100 pt-8 mt-8 ${config.bot_type === 'video_analysis' ? 'hidden' : ''}`}>
              <label className="block text-[13px] font-semibold text-gray-700 mb-2">Knowledge Base Files</label>

              {config.documents && config.documents.length > 0 && (
                <div className="mt-3 space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">Currently Uploaded</h4>
                  <ul className="space-y-2">
                    {config.documents.map((fileName) => (
                      <li key={fileName} className="flex items-center justify-between bg-white border border-gray-100 p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700 flex items-center"><div className="p-2 bg-[#F0F6FB] rounded-lg text-blue-500 mr-3"><FaInfoCircle/></div>{fileName}</span>
                        <div className="flex space-x-2">
                          <button type="button" onClick={() => handleViewDocument(fileName)} className="text-blue-500 p-2"><FaInfoCircle/></button>
                          <button type="button" onClick={() => handleRemoveDocument(fileName)} className="text-gray-400 hover:text-red-500 p-2"><FaTrash/></button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {newFiles.length > 0 && (
                <div className="mt-6 space-y-2">
                  <h4 className="text-xs font-bold text-[#FA6C43] uppercase tracking-wider mb-3">Pending Upload</h4>
                  <ul className="space-y-2">
                    {newFiles.map((file) => (
                      <li key={file.name} className="flex items-center justify-between bg-white border border-[#FA6C43]/30 p-3 rounded-xl">
                        <span className="text-sm font-medium text-gray-700">{file.name}</span>
                        <button type="button" onClick={() => handleRemoveNewFile(file.name)} className="text-gray-400 hover:text-red-500 p-2"><FaTrash/></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <label className="mt-6 flex flex-col items-center justify-center px-6 py-8 border-2 border-dashed border-gray-300 rounded-xl cursor-pointer hover:border-[#FA6C43]/50 bg-gray-50">
                <span className="text-sm font-medium text-gray-600">Drag & drop files or click to browse</span>
                <input type="file" multiple onChange={handleFileChange} className="hidden" accept=".txt,.pdf,.md,.docx,.pptx" />
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-between items-center gap-4 pt-8 border-t border-gray-100">
              <button type="button" onClick={handleDelete} disabled={isDeleting || isLoading} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold text-red-600 bg-red-50 border border-red-200">
                {isDeleting ? 'Deleting...' : 'Delete Space'}
              </button>
              <div className="flex gap-3 w-full sm:w-auto flex-wrap justify-end">
                <button type="button" onClick={() => navigate(config.bot_type === 'video_analysis' ? `/video-dashboard/${config.config_id}` : `/responses/${config.config_id}`)} className="w-full sm:w-auto py-3.5 px-5 rounded-xl font-bold border-2 border-gray-200 bg-white flex items-center gap-2">
                  <FaListAlt className="text-sm text-gray-500" /><span>{config.bot_type === 'video_analysis' ? 'Dashboard' : 'View Responses'}</span>
                </button>
                <button type="button" onClick={navigateToThisAgentChat} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold border-2 border-gray-200 bg-white">Cancel</button>
                <button type="submit" disabled={isLoading || isDeleting} className="w-full sm:w-auto py-3.5 px-6 rounded-xl font-bold text-white bg-[#FA6C43]">
                  {isLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>

          </form>
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2rem] p-8 max-w-sm w-full mx-4">
            <h3 className="text-xl font-bold mb-3">Confirm Deletion</h3>
            <p className="text-gray-600 mb-8">Are you sure you want to permanently delete {config.bot_name}? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowConfirmModal(false)} className="py-3 px-5 rounded-xl font-bold border-2 border-gray-200">Cancel</button>
              <button type="button" onClick={confirmDelete} className="py-3 px-5 rounded-xl font-bold text-white bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {showQualtricsModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2rem] p-8 max-w-2xl w-full mx-4 max-h-[85vh] flex flex-col">
            <h3 className="text-xl font-bold mb-1">Qualtrics Embed Code</h3>
            <p className="text-gray-500 text-sm mb-5">
              In Survey Flow → Embedded Data, add fields <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">transcript</code>,{' '}
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">chat_status</code>
              {' '}(and <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">condition</code> if you use conditions). Then add a Text/Graphic question and paste this HTML into its HTML view.
            </p>

            {qualtricsLoading ? (
              <div className="flex items-center justify-center py-16 text-gray-400">
                <FaSpinner className="animate-spin" />
                <span className="ml-2 text-sm font-medium">Generating…</span>
              </div>
            ) : qualtricsError ? (
              <p className="text-sm text-red-600 mb-4">{qualtricsError}</p>
            ) : (
              <textarea
                readOnly
                value={qualtricsHtml}
                onClick={(e) => e.target.select()}
                className="flex-1 min-h-[260px] w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono text-gray-700 resize-none focus:outline-none"
              />
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button type="button" onClick={() => setShowQualtricsModal(false)} className="py-3 px-5 rounded-xl font-bold border-2 border-gray-200">Close</button>
              <button
                type="button"
                onClick={copyQualtricsHtml}
                disabled={qualtricsLoading || !!qualtricsError}
                className="py-3 px-5 rounded-xl font-bold text-white bg-[#FA6C43] disabled:opacity-60 flex items-center gap-2"
              >
                {qualtricsCopied ? <><FaCheck className="text-xs" /> Copied</> : <><FaCopy className="text-xs" /> Copy HTML</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNotification && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white font-medium px-6 py-3 rounded-xl shadow-xl z-50">
          {notificationMessage}
        </div>
      )}
    </div>
  );
};

export default EditConfigPage;
