// @language  JavaScript (React / JSX)
// @updated   2026-07-20
// @changed   Manager Exercise upload (mirror ConfigPage): restrict to Word (.docx) + PDF only and make each
//            manager card a drag-and-drop target (drop bypasses `accept`, so validate on drop).
//            Prior: blocked Next scrolls to + pulses the first empty seat card; "done/total uploaded" chip.
import React, { useEffect, useRef, useState } from 'react';
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
    // controlled inputs below never read undefined. managers[] length is snapped
    // to num_managers so the seat cards stay in sync even if the stored doc drifted.
    let resolvedManagerExercise = null;
    if (configFromState.bot_type === 'manager_exercise') {
        let me = configFromState.manager_exercise;
        if (typeof me === 'string') {
            try { me = JSON.parse(me); } catch (e) { me = null; }
        }
        me = (me && typeof me === 'object') ? me : {};
        const num = Math.max(2, Math.min(10, parseInt(me.num_managers, 10) || 3));
        const managers = Array.isArray(me.managers) ? me.managers.map(m => ({
            role_name: m?.role_name || '',
            doc_file_id: m?.doc_file_id || '',
            doc_text: m?.doc_text || ''
        })) : [];
        while (managers.length < num) managers.push({ role_name: '', doc_file_id: '', doc_text: '' });
        managers.length = num;
        const gw = (me.grading_weights && typeof me.grading_weights === 'object') ? me.grading_weights : {};
        resolvedManagerExercise = {
            num_managers: num,
            memorize_minutes: typeof me.memorize_minutes === 'number' ? me.memorize_minutes : 5,
            discuss_minutes: typeof me.discuss_minutes === 'number' ? me.discuss_minutes : 15,
            correct_candidate: me.correct_candidate || '',
            candidates: Array.isArray(me.candidates)
                ? me.candidates.map(c => ({ name: c?.name || '', blurb: c?.blurb || '' }))
                : [],
            managers,
            ai_personality: ['friend', 'foe', 'confused'].includes(me.ai_personality) ? me.ai_personality : 'friend',
            grading_weights: {
                communication: typeof gw.communication === 'number' ? gw.communication : 0.34,
                individual: typeof gw.individual === 'number' ? gw.individual : 0.33,
                collective: typeof gw.collective === 'number' ? gw.collective : 0.33
            },
            no_show_timeout_seconds: typeof me.no_show_timeout_seconds === 'number' ? me.no_show_timeout_seconds : 300
        };
    }

    setConfig({
        ...configFromState,
        instructions: resolvedInstructions,
        bots: parsedBots,
        ...(resolvedManagerExercise ? { manager_exercise: resolvedManagerExercise } : {}),
        // Keep the matcher invariant (group_size == num_managers) even before save.
        group_size: resolvedManagerExercise ? resolvedManagerExercise.num_managers : (configFromState.group_size || 2),
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
  // Mirrors ConfigPage. `mgrUploading` guards the active per-seat POST so faculty
  // can't double-submit a doc; `mgrUploadError` surfaces a per-step failure inline.
  // One shared hidden file input drives the picker for whichever seat was clicked.
  const [mgrUploading, setMgrUploading] = useState(false);
  const [mgrUploadError, setMgrUploadError] = useState('');
  const mgrFileInputRef = useRef(null);
  // Blocked Next → scroll to + pulse the first seat still missing a doc (the `n`
  // bump re-fires the effect on repeat clicks). Mirrors ConfigPage.
  const [mgrHighlight, setMgrHighlight] = useState({ idx: null, n: 0 });
  // Which manager seat is currently being dragged over, so only that card lights up.
  const [mgrDragIdx, setMgrDragIdx] = useState(null);
  useEffect(() => {
    if (mgrHighlight.idx == null) return;
    document.getElementById(`mgr-card-${mgrHighlight.idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setMgrHighlight((h) => ({ ...h, idx: null })), 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgrHighlight.n]);

  // Patch a single field on the manager_exercise sub-object.
  const setMgr = (field, value) => {
    setConfig(prev => ({ ...prev, manager_exercise: { ...(prev.manager_exercise || {}), [field]: value } }));
  };

  // Resize managers[] to match num_managers. Growing appends empty seats (filled
  // by the wizard); shrinking trims from the tail. group_size tracks num_managers
  // so the matcher invariant holds even before save.
  const handleNumManagersChange = (n) => {
    const count = Math.max(1, Math.min(10, parseInt(n, 10) || 1));
    setConfig(prev => {
      const managers = [...(prev.manager_exercise?.managers || [])];
      while (managers.length < count) managers.push({ role_name: '', doc_file_id: '', doc_text: '' });
      managers.length = count;
      return {
        ...prev,
        group_size: count,
        manager_exercise: { ...prev.manager_exercise, num_managers: count, managers }
      };
    });
  };

  // Upload + parse ONE manager's private document via the faculty-only
  // /api/files/manager-doc endpoint, which extracts plaintext and best-effort
  // parses the role name from the doc header. Also serves the "Replace" action
  // for an already-filled seat (same endpoint, overwrites the seat in place).
  const handleManagerDocUpload = async (index, file) => {
    if (!file) return;
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
      const { role_name = '', doc_text = '', file_id = '' } = res.data || {};
      setConfig(prev => {
        const managers = [...(prev.manager_exercise?.managers || [])];
        managers[index] = { role_name, doc_file_id: file_id, doc_text };
        return { ...prev, manager_exercise: { ...prev.manager_exercise, managers } };
      });
    } catch (err) {
      const d = err.response?.data;
      setMgrUploadError((d && (d.error || d.message)) || err.message || 'Upload failed');
    } finally {
      setMgrUploading(false);
    }
  };

  // Manager briefs are restricted to Word (.docx) and PDF. The picker enforces this
  // via `accept`, but drag-and-drop bypasses that filter, so validate by extension.
  const isAllowedManagerDoc = (file) =>
    !!file && ['pdf', 'docx'].includes((file.name.split('.').pop() || '').toLowerCase());

  // Drop a file onto an empty manager card → type-check, then route through the same
  // upload/parse path as the picker. Rejects bad types inline via `mgrUploadError`.
  const handleManagerDocDrop = (index, e) => {
    e.preventDefault();
    setMgrDragIdx(null);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isAllowedManagerDoc(file)) {
      setMgrUploadError('Only Word (.docx) and PDF files are allowed.');
      return;
    }
    setMgrUploadError('');
    handleManagerDocUpload(index, file);
  };

  // Edit the faculty-confirmable role name on an already-uploaded manager seat.
  const setManagerRoleName = (index, roleName) => {
    setConfig(prev => {
      const managers = [...(prev.manager_exercise?.managers || [])];
      managers[index] = { ...managers[index], role_name: roleName };
      return { ...prev, manager_exercise: { ...prev.manager_exercise, managers } };
    });
  };

  // Add / edit / remove a candidate on the shared roster (used for voting). If
  // the removed candidate was the marked ground truth, clear the marking too.
  const addCandidate = () => setMgr('candidates', [...(config.manager_exercise?.candidates || []), { name: '', blurb: '' }]);
  const setCandidate = (index, field, value) => {
    const candidates = [...(config.manager_exercise?.candidates || [])];
    candidates[index] = { ...candidates[index], [field]: value };
    setMgr('candidates', candidates);
  };
  const removeCandidate = (index) => {
    const removed = config.manager_exercise?.candidates?.[index];
    const candidates = (config.manager_exercise?.candidates || []).filter((_, i) => i !== index);
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates,
        correct_candidate: removed?.name === prev.manager_exercise?.correct_candidate ? '' : prev.manager_exercise?.correct_candidate
      }
    }));
  };

  // Auto-seed candidate names mentioned across every uploaded manager doc.
  // Heuristic: prefer an explicit "Candidates:"/"Applicants:" block, else scan
  // for capitalized two/three-word proper-name lines; dedupe against the roster.
  // Convenience only — faculty still edit the result.
  const autoExtractCandidates = () => {
    const roster = config.manager_exercise?.candidates || [];
    const found = new Set(roster.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
    const additions = [];
    (config.manager_exercise?.managers || []).forEach(m => {
      const text = m.doc_text || '';
      const listMatch = text.match(/(?:candidates?|applicants?)\s*:\s*([\s\S]{0,400})/i);
      const scope = listMatch ? listMatch[1] : text;
      const nameRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
      let hit;
      while ((hit = nameRe.exec(scope)) !== null) {
        const name = hit[1].trim();
        const key = name.toLowerCase();
        if (!found.has(key)) { found.add(key); additions.push({ name, blurb: '' }); }
        if (additions.length >= 12) break; // cap the seed so we don't flood the roster
      }
    });
    if (additions.length) setMgr('candidates', [...roster, ...additions]);
  };

  // Normalize the three grading weights so they sum to 1.0 after a slider moves.
  // Keeps the just-moved key at its chosen value and rescales the other two by
  // their prior ratio (equal split if the remainder was zero).
  const setGradingWeight = (key, value) => {
    const v = Math.max(0, Math.min(1, parseFloat(value)));
    const w = { ...(config.manager_exercise?.grading_weights || {}) };
    const others = Object.keys(w).filter(k => k !== key);
    const remainder = 1 - v;
    const otherSum = others.reduce((s, k) => s + (w[k] || 0), 0);
    const next = { ...w, [key]: v };
    others.forEach(k => {
      next[k] = otherSum > 0 ? remainder * ((w[k] || 0) / otherSum) : remainder / others.length;
    });
    setMgr('grading_weights', next);
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
        // Every seat needs an uploaded doc; the roster needs >=2 candidates; and
        // the ground-truth best-fit pick must be a marked, real candidate.
        const me = config.manager_exercise || {};
        const managers = me.managers || [];
        const candidates = me.candidates || [];
        const filled = managers.filter(m => (m.doc_text || '').trim()).length;
        if (filled < (me.num_managers || 0)) {
          newErrors.form = `Upload a document for all ${me.num_managers} managers (${filled}/${me.num_managers} done).`;
          const firstEmpty = managers.findIndex(m => !(m.doc_text || '').trim());
          if (firstEmpty >= 0) setMgrHighlight(h => ({ idx: firstEmpty, n: h.n + 1 }));
        }
        else if (candidates.filter(c => (c.name || '').trim()).length < 2) newErrors.form = 'Add at least two candidates to vote on.';
        else if (!me.correct_candidate) newErrors.form = 'Mark the correct best-fit candidate.';
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
          // manager_exercise sub-object. Pin the Claude reasoning model and enforce
          // the matcher invariant group_size == num_managers (backend re-enforces).
          configToSubmit.instructions = 'Manager Exercise: hidden-profile decision game.';
          configToSubmit.prompt_template = '';
          configToSubmit.model_name = 'claude-sonnet-4-6';
          configToSubmit.group_size = configToSubmit.manager_exercise?.num_managers || configToSubmit.group_size;
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
              // MANAGER EXERCISE — hidden-profile authoring (mirrors ConfigPage)
              // ==============================
              // `me` is the guaranteed-present sub-object (the init effect backfills
              // every field for this bot_type). Aliased so the JSX reads cleanly and
              // stays null-safe even if a partial doc slipped through.
              (() => {
                const me = config.manager_exercise || {};
                const managers = me.managers || [];
                const candidates = me.candidates || [];
                const gradingWeights = me.grading_weights || {};
                return (
                  <div className="border-t border-gray-100 pt-8 mt-8">
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase flex items-center mb-1"><FaUserTie className="mr-2 text-[#FA6C43]"/> Manager Exercise</h3>
                    <p className="text-[11px] text-gray-400 mb-6">Hidden-profile decision game. Edit the roster, per-manager briefs, and grading below.</p>

                    {/* Group + timing rules: N managers (== student seats) plus the two
                        phase durations. num_managers drives group_size (matcher invariant). */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaUserTie className="mr-2 text-[#FA6C43]"/> Roles &amp; Timing</h3>
                      <div className="mb-5">
                        <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                          <span className="inline-flex items-center gap-1">Total Manager Seats<InfoTip text="Total named managerial roles in the room. One seat is ALWAYS a hidden AI manager, so N seats = (N−1) students + 1 AI. Each seat gets its own private document. If students no-show, their seats also fill with AI after the timeout." /></span>
                          <span className="text-[#FA6C43] font-bold">{me.num_managers} seats</span>
                        </label>
                        <input type="range" min="2" max="10" step="1" value={me.num_managers || 2} onChange={(e) => handleNumManagersChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        {/* Explicit student/AI split so faculty aren't surprised that N ≠ student count. */}
                        <p className="mt-2 text-[11px] font-semibold text-gray-500">
                          = <span className="text-[#222]">{Math.max(1, (me.num_managers || 2) - 1)} student{(me.num_managers || 2) - 1 === 1 ? '' : 's'}</span> + <span className="text-[#222]">1 AI manager</span> <span className="text-gray-400">(the AI is hidden from students)</span>
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-2">Memorize (minutes)</label>
                          <input type="number" min="0" step="any" value={me.memorize_minutes} onChange={(e) => setMgr('memorize_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                          <p className="text-[10px] text-gray-400 mt-1">Chat locked; doc visible.</p>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-2">Discuss (minutes)</label>
                          <input type="number" min="0" step="any" value={me.discuss_minutes} onChange={(e) => setMgr('discuss_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                          <p className="text-[10px] text-gray-400 mt-1">Chat open; AI nudges.</p>
                        </div>
                      </div>
                    </div>

                    {/* Sequential per-manager document wizard. Renders Manager 1..N as
                        cards; each card either shows an Upload button (empty) or, once
                        parsed, the auto-detected role_name in an EDITABLE field plus a
                        collapsible plaintext preview. "Replace" re-runs the upload for a
                        filled seat, so faculty can swap a brief while editing. */}
                    {(() => {
                      const done = managers.filter(m => (m.doc_text || '').trim()).length;
                      const total = me.num_managers || managers.length;
                      return (
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> Manager Documents</h3>
                          {/* In-place progress so the upload state is obvious without scrolling up to the error. */}
                          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${done >= total ? 'bg-[#FA6C43]/10 text-[#FA6C43]' : 'bg-gray-100 text-gray-500'}`}>
                            {done}/{total} uploaded
                          </span>
                        </div>
                      );
                    })()}
                    <p className="text-[11px] text-gray-400 mb-3">One private brief per manager, in order — Word (.docx) or PDF only. Drag a file onto a card or click to browse. The role name is read from the doc header ("To: Marketing Manager") for you to confirm.</p>
                    <div className="space-y-3 mb-6">
                      {managers.map((mgr, idx) => {
                        const uploaded = !!(mgr.doc_text || '').trim();
                        return (
                          <div key={idx} id={`mgr-card-${idx}`} className={`bg-white p-4 rounded-2xl border-2 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-1 duration-300 ${mgrHighlight.idx === idx ? 'border-[#FA6C43] ring-2 ring-[#FA6C43]/50 ring-offset-2 animate-pulse' : uploaded ? 'border-[#FA6C43]/40' : 'border-gray-100'}`}>
                            <div className="flex items-center justify-between mb-3">
                              <span className="inline-flex items-center gap-2 text-[13px] font-bold text-gray-700">
                                {uploaded ? <FaCheckCircle className="text-[#FA6C43]" /> : <span className="w-4 h-4 rounded-full border-2 border-gray-300 inline-block" />}
                                Manager {idx + 1}
                              </span>
                              {uploaded && (
                                <button type="button" onClick={() => { mgrFileInputRef.current.dataset.index = String(idx); mgrFileInputRef.current.click(); }} className="text-[11px] font-semibold text-gray-400 hover:text-[#FA6C43] transition-colors active:scale-95">Replace</button>
                              )}
                            </div>

                            {uploaded ? (
                              <div className="space-y-3 animate-in fade-in duration-300">
                                {/* Editable auto-detected role — faculty confirms/overrides. */}
                                <div>
                                  <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Role Name <span className="normal-case font-normal text-gray-400">(auto-detected, editable)</span></label>
                                  <input type="text" value={mgr.role_name} onChange={(e) => setManagerRoleName(idx, e.target.value)} placeholder="e.g. Marketing Manager" className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                                </div>
                                {/* Collapsible parsed-doc preview for a sanity check. */}
                                <details className="group">
                                  <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 hover:text-[#FA6C43] transition-colors select-none">Preview parsed document</summary>
                                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-lg p-3 custom-scrollbar">{mgr.doc_text}</pre>
                                </details>
                              </div>
                            ) : (
                              // Empty seat = click-to-browse button that doubles as a drop
                              // zone. Dragging over lifts + tints the card; the drop is
                              // type-validated in handleManagerDocDrop before uploading.
                              <button
                                type="button"
                                disabled={mgrUploading}
                                onClick={() => { mgrFileInputRef.current.dataset.index = String(idx); mgrFileInputRef.current.click(); }}
                                onDragEnter={(e) => { e.preventDefault(); setMgrDragIdx(idx); }}
                                onDragOver={(e) => e.preventDefault()}
                                onDragLeave={(e) => { e.preventDefault(); setMgrDragIdx(null); }}
                                onDrop={(e) => handleManagerDocDrop(idx, e)}
                                className={`w-full py-4 border-2 border-dashed rounded-xl transition-all font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed ${mgrDragIdx === idx ? 'border-[#FA6C43] bg-[#F9D0C4]/20 text-[#FA6C43] scale-[1.01]' : 'border-gray-300 text-gray-500 hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50'}`}
                              >
                                {mgrUploading ? <FaSpinner className="animate-spin" /> : <FaUpload />}
                                {mgrUploading ? 'Uploading & parsing…' : mgrDragIdx === idx ? 'Drop to upload' : `Upload Manager ${idx + 1}'s document — or drop it here`}
                              </button>
                            )}
                          </div>
                        );
                      })}
                      {/* One shared hidden input; the target seat index is stashed on its
                          dataset by whichever card triggered the picker. */}
                      <input
                        type="file"
                        ref={mgrFileInputRef}
                        className="hidden"
                        accept=".pdf,.docx"
                        onChange={(e) => {
                          const idx = parseInt(e.target.dataset.index || '0', 10);
                          const file = e.target.files?.[0];
                          e.target.value = ''; // allow re-picking the same file
                          if (file && !isAllowedManagerDoc(file)) {
                            setMgrUploadError('Only Word (.docx) and PDF files are allowed.');
                            return;
                          }
                          if (file) { setMgrUploadError(''); handleManagerDocUpload(idx, file); }
                        }}
                      />
                      {mgrUploadError && <p className="text-xs font-medium text-red-500">{mgrUploadError}</p>}
                    </div>

                    {/* Candidate roster + ground-truth marking. Candidates may be
                        auto-seeded from the uploaded docs or entered by hand; the correct
                        best-FIT pick is chosen from this list. */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Candidates</h3>
                      <button type="button" onClick={autoExtractCandidates} className="text-[11px] font-semibold text-gray-400 hover:text-[#FA6C43] transition-colors active:scale-95">Auto-extract from docs</button>
                    </div>
                    <div className="space-y-2 mb-3">
                      {candidates.map((cand, idx) => (
                        <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-1 duration-200">
                          <input type="text" value={cand.name} onChange={(e) => setCandidate(idx, 'name', e.target.value)} placeholder="Candidate name" className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                          <input type="text" value={cand.blurb} onChange={(e) => setCandidate(idx, 'blurb', e.target.value)} placeholder="One-line blurb (optional)" className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                          <button type="button" onClick={() => removeCandidate(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"><FaTrash className="text-sm" /></button>
                        </div>
                      ))}
                    </div>
                    <button type="button" onClick={addCandidate} className="w-full py-3 mb-6 border-2 border-dashed border-gray-300 text-gray-500 rounded-xl hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50 transition-all font-bold text-sm flex items-center justify-center active:scale-[0.99]">
                      <FaPlus className="mr-2" /> Add Candidate
                    </button>

                    {/* Ground-truth: which candidate is the best FIT (not necessarily the
                        most-qualified). Drives individual/collective grade correctness. */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-2">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Correct best-fit candidate<InfoTip text="The ground-truth answer used for grading. Best FIT for the role — which is not always the most-qualified applicant." /></label>
                      <select
                        value={me.correct_candidate || ''}
                        onChange={(e) => setMgr('correct_candidate', e.target.value)}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all"
                      >
                        <option value="">— select a candidate —</option>
                        {candidates.filter(c => (c.name || '').trim()).map((c, i) => (
                          <option key={i} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Advanced authoring — AI personality + grading weights. */}
                    <AdvancedReveal show={advanced}>
                    <div className="pt-4 mt-2 border-t border-gray-100">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-3">AI Manager personality<InfoTip text="How the AI Manager behaves during discussion. Friend = supportive facilitator; Foe = contrarian/adversarial; Confused = muddled, misremembers facts." /></label>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          { id: 'friend', label: 'Friend', desc: 'Supportive' },
                          { id: 'foe', label: 'Foe', desc: 'Contrarian' },
                          { id: 'confused', label: 'Confused', desc: 'Muddled' }
                        ].map(p => (
                          <label key={p.id} className={`cursor-pointer p-3 border-2 rounded-xl text-center transition-all active:scale-[0.97] ${me.ai_personality === p.id ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:-translate-y-0.5 bg-white'}`}>
                            <input type="radio" name="ai_personality" value={p.id} checked={me.ai_personality === p.id} onChange={() => setMgr('ai_personality', p.id)} className="hidden" />
                            <p className="font-bold text-[#222] text-sm">{p.label}</p>
                            <p className="text-[10px] text-gray-500 font-medium mt-0.5">{p.desc}</p>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="pt-4 mt-4 border-t border-gray-100">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-1">Grading weights<InfoTip text="How the three grade components combine. Sliders auto-normalize so the three weights always sum to 100%." /></label>
                      <p className="text-[11px] text-gray-400 mb-4">Auto-normalized to 100%.</p>
                      {[
                        { key: 'communication', label: 'Communication quality' },
                        { key: 'individual', label: 'Individual decision' },
                        { key: 'collective', label: 'Collective decision' }
                      ].map(gw => (
                        <div key={gw.key} className="mb-4">
                          <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                            <span>{gw.label}</span>
                            <span className="text-[#FA6C43] font-bold">{Math.round((gradingWeights[gw.key] || 0) * 100)}%</span>
                          </label>
                          <input type="range" min="0" max="1" step="0.01" value={gradingWeights[gw.key] || 0} onChange={(e) => setGradingWeight(gw.key, e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                      ))}
                    </div>
                    </AdvancedReveal>
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