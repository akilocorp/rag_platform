// @language  JavaScript (React / JSX)
// @updated   2026-07-20
// @changed   Manager Exercise doc upload: restrict to Word (.docx) + PDF only and make each
//            manager card a drag-and-drop target (drop bypasses `accept`, so validate on drop).
//            Prior: wizard split into 5 steps so uploads get their own step; N seats = (N−1) students + 1 AI.
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaVideo, FaComments, FaTimes, FaUsers, FaPlus, FaPhoneAlt, FaFilm, FaFlask, FaUserTie, FaCheckCircle, FaSpinner, FaFileAlt } from 'react-icons/fa';
import AvatarSelector from '../components/AvatarSelector';
import { SIMULATION_TEMPLATES } from '../data/simulationTemplates';
import LabGenerator from '../components/experiential/LabGenerator';
import VideoScoringEditor from '../components/VideoScoringEditor';
import InfoTip from '../components/InfoTip';
import InstructionsInfoTip from '../components/InstructionsInfoTip';
import ConfigModeToggle from '../components/ConfigModeToggle';
import AdvancedReveal from '../components/AdvancedReveal';
import useConfigMode from '../hooks/useConfigMode';

const FileUpload = ({ onFileChange, initialFiles }) => {
  const [files, setFiles] = useState(initialFiles || []);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    setFiles(initialFiles || []);
  }, [initialFiles]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const newFiles = Array.from(e.dataTransfer.files);
    const updatedFiles = [...files, ...newFiles];
    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  const handleFileChange = (e) => {
    const newFiles = Array.from(e.target.files);
    const maxFileSize = 500 * 1024 * 1024; // 500MB
    const updatedFiles = [...files];

    newFiles.forEach(file => {
      if (file.size > maxFileSize) {
        alert(`File ${file.name} is too large. Maximum size is 500MB.`);
        return;
      }
      updatedFiles.push(file);
    });

    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  const handleRemoveFile = (fileName) => {
    const updatedFiles = files.filter(file => file.name !== fileName);
    setFiles(updatedFiles);
    onFileChange(updatedFiles);
  };

  return (
    <div className="w-full">
      <div
        className={`mt-1 flex flex-col items-center justify-center px-6 py-12 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
          isDragging 
            ? 'border-[#FA6C43] bg-[#F9D0C4]/20' 
            : 'border-gray-300 hover:border-[#FA6C43]/50 bg-gray-50'
        }`}
        onClick={() => fileInputRef.current.click()}
        onDragEnter={handleDragEnter}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <FaUpload className={`mx-auto text-3xl mb-3 transition-colors ${isDragging ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
          <p className={`text-sm font-medium ${isDragging ? 'text-[#FA6C43]' : 'text-gray-600'}`}>
            {isDragging ? 'Drop files here' : 'Drag & drop files or click to browse'}
          </p>
          <p className="text-xs text-gray-400 mt-1.5">Supports: TXT, DOCX, MD, PDF, PPTX (Max 500MB each)</p>
        </div>
      </div>
      <p className="text-xs text-center text-gray-400 mt-4">More files can be uploaded after publishing</p>
      
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        multiple
        className="hidden"
        accept=".txt,.pdf,.md,.docx,.pptx"
      />
      {files.length > 0 && (
        <div className="mt-4 max-h-40 overflow-y-auto">
          <h4 className="text-[13px] font-semibold text-gray-700 mb-2">Selected files:</h4>
          <ul className="space-y-2">
            {files.map((file, index) => (
              <li key={index} className="flex items-center justify-between p-3 bg-white border border-gray-100 shadow-sm rounded-xl">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-[#F0F6FB] rounded-lg text-[#FA6C43]">
                    <FaFile className="text-sm" />
                  </div>
                  <span className="text-sm font-medium text-gray-700 truncate max-w-xs">{file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(file.name)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                >
                  <FaTrash className="text-sm" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const ConfigModal = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  // Simple vs Advanced faculty mode — gates the extra config fields below.
  const { advanced } = useConfigMode();

  const aiModels = [
    { id: 'deepseek-chat', name: 'Deepseek Chat' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 flash', desc: 'Fast and accurate' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 pro', desc: 'Advanced reasoning' },
    // { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
    // { id: 'gpt-4', name: 'GPT-4' },
    // { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    // { id: 'gpt-4.1', name: 'GPT-4.1', desc: 'Fastest, great for TAs' },
    // { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', desc: 'Balanced Claude model' },
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', desc: 'Fast, lightweight Claude' }
  ];

  const [config, setConfig] = useState({
    bot_name: '',
    associated_course: '',
    bot_type: 'chat',
    experiential_template_id: '',
    experiential_prompt: '',
    experiential_config: null,
    heygen_avatar_id: '',
    model_name: 'claude-sonnet-4-6',
    instructions: '',
    prompt_template: '',
    temperature: 0.7,
    response_timeout: 3,
    rag_files: [],
    is_public: false,
    web_access: true,
    audio_enabled: false,
    hume_config_id: '',
    facilitator: { enabled: false, instruction: '', allowedWidgets: null, presets: [] },
    bot_avatar: 'robot',
    introduction: '',
    // Video Analysis Specifics
    assignment_type: '',
    scoring_spec: null,
    class_code: '',
    // Class rollout usage tier (per-student message allowance) + roster size
    usage_tier: '',
    student_count: '',
    // Group Chat Specifics
    group_size: 3,
    group_duration: 15,
    bots: [
      { name: 'Assistant', prompt: '', model_name: 'claude-sonnet-4-6', temperature: 0.7 }
    ],
    // Manager Exercise Specifics — hidden-profile decision game. Serialized as a
    // nested JSON sub-object on submit (mirrors bots/scoring_spec). num_managers
    // drives group_size (invariant, enforced again server-side). managers[] is
    // filled in one at a time via the sequential upload wizard in step 4.
    manager_exercise: {
      num_managers: 3,
      memorize_minutes: 5,
      discuss_minutes: 15,
      correct_candidate: '',
      candidates: [],                 // { name, blurb } roster shared across all managers
      managers: Array.from({ length: 3 }, () => ({ role_name: '', doc_file_id: '', doc_text: '' })), // length must == num_managers; seeded so cards render before the slider is touched
      ai_personality: 'friend',       // friend (default) | foe | confused
      grading_weights: { communication: 0.34, individual: 0.33, collective: 0.33 },
      no_show_timeout_seconds: 300
    }
  });
  
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [usageTiers, setUsageTiers] = useState([]);
  const [fileUploadKey, setFileUploadKey] = useState(Date.now());

  useEffect(() => {
    apiClient.get('/usage/tiers')
      .then(res => setUsageTiers(res.data.tiers || []))
      .catch(() => {});
  }, []);
  const [heygenAvatars, setHeygenAvatars] = useState([]);
  const [isFetchingAvatars, setIsFetchingAvatars] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState(null);

  const applyTemplate = (template) => {
    setConfig(prev => ({
      ...prev,
      bot_name: prev.bot_name.trim() ? prev.bot_name : template.bot_name,
      instructions: template.instructions,
      temperature: template.temperature,
      introduction: prev.introduction.trim() ? prev.introduction : template.introduction,
    }));
    setSelectedTemplateId(template.id);
  };

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

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    const val = type === 'checkbox' ? checked : value;
    setConfig(prev => {
      const next = { ...prev, [name]: val };
      if (name === 'bot_type' && val === 'audio_call') {
        next.audio_enabled = true;
        if (!(next.model_name || '').toLowerCase().startsWith('claude')) {
          next.model_name = 'claude-sonnet-4-6';
        }
      }
      // Manager exercise reasons/grades on Claude; pin the model + sync group_size
      // to num_managers so the invariant holds even before submit.
      if (name === 'bot_type' && val === 'manager_exercise') {
        next.model_name = 'claude-sonnet-4-6';
        next.group_size = next.manager_exercise.num_managers;
      }
      return next;
    });
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: null }));
  };

  const handleBotChange = (index, field, value) => {
    const updatedBots = [...config.bots];
    updatedBots[index][field] = value;
    setConfig(prev => ({ ...prev, bots: updatedBots }));
  };

  const addBot = () => {
    setConfig(prev => ({
      ...prev,
      bots: [...prev.bots, { name: `Bot ${prev.bots.length + 1}`, prompt: '', model_name: config.model_name, temperature: 0.7 }]
    }));
  };

  const removeBot = (index) => {
    if (config.bots.length > 1) {
      setConfig(prev => ({
        ...prev,
        bots: prev.bots.filter((_, i) => i !== index)
      }));
    }
  };

  // ---- Manager Exercise authoring state + helpers -----------------------------
  // The sequential upload wizard walks Manager 1..N. `mgrUploading` guards the
  // active POST so faculty can't double-submit a doc; `mgrUploadError` surfaces a
  // per-step failure inline. A hidden file input drives the picker per seat.
  const [mgrUploading, setMgrUploading] = useState(false);
  const [mgrUploadError, setMgrUploadError] = useState('');
  const mgrFileInputRef = useRef(null);
  // When Next is blocked on a missing manager doc, we scroll the first empty seat
  // card into view + pulse it (the `n` bump re-fires the effect on repeat clicks).
  const [mgrHighlight, setMgrHighlight] = useState({ idx: null, n: 0 });
  // Which manager seat is currently being dragged over, so only that card lights up.
  const [mgrDragIdx, setMgrDragIdx] = useState(null);

  // Patch a single field on the manager_exercise sub-object.
  const setMgr = (field, value) => {
    setConfig(prev => ({ ...prev, manager_exercise: { ...prev.manager_exercise, [field]: value } }));
  };

  // Resize the managers[] array to match num_managers. Growing appends empty
  // seats (to be filled by the wizard); shrinking trims from the tail. group_size
  // tracks num_managers so the two never drift before submit.
  const handleNumManagersChange = (n) => {
    const count = Math.max(1, Math.min(10, parseInt(n, 10) || 1));
    setConfig(prev => {
      const managers = [...prev.manager_exercise.managers];
      while (managers.length < count) managers.push({ role_name: '', doc_file_id: '', doc_text: '' });
      managers.length = count;
      return {
        ...prev,
        group_size: count,
        manager_exercise: { ...prev.manager_exercise, num_managers: count, managers }
      };
    });
  };

  // Upload + parse ONE manager's private document. Calls the faculty-only
  // /api/files/manager-doc endpoint, which extracts plaintext and best-effort
  // parses the role name from the doc header ("To:" / "Role:" / "Position:").
  // The parsed role_name lands in an editable field for faculty confirmation.
  const handleManagerDocUpload = async (index, file) => {
    if (!file) return;
    setMgrUploading(true);
    setMgrUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('jwtToken');
      const res = await apiClient.post('/files/manager-doc', fd, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' }
      });
      const { role_name = '', doc_text = '', file_id = '' } = res.data || {};
      setConfig(prev => {
        const managers = [...prev.manager_exercise.managers];
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
      const managers = [...prev.manager_exercise.managers];
      managers[index] = { ...managers[index], role_name: roleName };
      return { ...prev, manager_exercise: { ...prev.manager_exercise, managers } };
    });
  };

  // Add / edit / remove a candidate on the shared roster (used for voting). If
  // the removed candidate was marked correct, clear the ground-truth marking too.
  const addCandidate = () => setMgr('candidates', [...config.manager_exercise.candidates, { name: '', blurb: '' }]);
  const setCandidate = (index, field, value) => {
    const candidates = [...config.manager_exercise.candidates];
    candidates[index] = { ...candidates[index], [field]: value };
    setMgr('candidates', candidates);
  };
  const removeCandidate = (index) => {
    const removed = config.manager_exercise.candidates[index];
    const candidates = config.manager_exercise.candidates.filter((_, i) => i !== index);
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates,
        correct_candidate: removed?.name === prev.manager_exercise.correct_candidate ? '' : prev.manager_exercise.correct_candidate
      }
    }));
  };

  // Auto-extract candidate names mentioned across every uploaded manager doc.
  // Heuristic: scan doc_text for a "Candidates:" block or capitalized two-word
  // proper-name lines, dedupe, and merge into the roster (skips names already
  // present). Purely a convenience seed — faculty still edit the result.
  const autoExtractCandidates = () => {
    const found = new Set(config.manager_exercise.candidates.map(c => (c.name || '').trim().toLowerCase()).filter(Boolean));
    const additions = [];
    config.manager_exercise.managers.forEach(m => {
      const text = m.doc_text || '';
      // Prefer an explicit "Candidates:" / "Applicants:" list if the doc has one.
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
    if (additions.length) setMgr('candidates', [...config.manager_exercise.candidates, ...additions]);
  };

  // Normalize the three grading weights so they sum to 1.0 after a slider moves.
  // Keeps the just-moved key at its chosen value and rescales the other two by
  // their prior ratio (falls back to equal split if the remainder was zero).
  const setGradingWeight = (key, value) => {
    const v = Math.max(0, Math.min(1, parseFloat(value)));
    const w = { ...config.manager_exercise.grading_weights };
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

  const handleFileChange = (files) => {
    setConfig(prev => ({ ...prev, rag_files: files }));
    setFileUploadKey(Date.now());
  };

  const validateStep = () => {
    const newErrors = {};
    if (step === 1 && (!config.bot_name || !config.bot_name.trim())) {
      newErrors.bot_name = 'Name is required';
    }
    if (step === 3 && config.bot_type === 'experiential' && !(config.experiential_config && config.experiential_config.method)) {
      newErrors.experiential_config = 'Generate the lab before saving';
    }
    // Manager Exercise step 3 = documents: every seat needs an uploaded brief.
    if (step === 3 && config.bot_type === 'manager_exercise') {
      const me = config.manager_exercise;
      const filled = me.managers.filter(m => (m.doc_text || '').trim()).length;
      if (filled < me.num_managers) {
        newErrors.form = `Upload a document for all ${me.num_managers} managers (${filled}/${me.num_managers} done).`;
        const firstEmpty = me.managers.findIndex(m => !(m.doc_text || '').trim());
        if (firstEmpty >= 0) setMgrHighlight(h => ({ idx: firstEmpty, n: h.n + 1 }));
      }
    }
    if (step === 4) {
      if (config.bot_type === 'video_analysis') {
        if (!config.assignment_type) newErrors.form = 'Please choose an assignment type.';
      } else if (config.bot_type === 'group_chat') {
        config.bots.forEach((bot, idx) => {
          if (!bot.name.trim()) newErrors[`bot_${idx}_name`] = 'Required';
          if (!bot.prompt.trim()) newErrors[`bot_${idx}_prompt`] = 'Required';
        });
      } else if (config.bot_type === 'manager_exercise') {
        // Step 4 = candidates & grading: need a roster (>=2) + a marked correct pick.
        // (Documents are gated on step 3.)
        const me = config.manager_exercise;
        if (me.candidates.filter(c => (c.name || '').trim()).length < 2) newErrors.form = 'Add at least two candidates to vote on.';
        else if (!me.correct_candidate) newErrors.form = 'Mark the correct best-fit candidate.';
      } else {
        if (!config.instructions.trim()) {
          newErrors.instructions = 'Instructions are required';
        }
      }
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Visible wizard steps per bot_type. Group chat skips the model picker (lobby
  // AI is fixed); video analysis skips model + knowledge base (no chat model, no RAG).
  // In Simple mode a standard chat also skips the model picker (step 2) and just
  // uses the default model, so first-time faculty face fewer choices.
  const stepsFor = (botType) => {
    if (botType === 'group_chat') return [1, 3, 4, 5];
    if (botType === 'video_analysis') return [1, 4, 5];
    if (botType === 'experiential') return [1, 3]; // name + type + upload course files, then generate the lab (grounded in them)
    // Manager exercise (fixed Claude, per-manager private docs) reuses the slots:
    //   1 name → 2 Roles & Timing → 3 Manager Documents → 4 Candidates & Grading → 5 polish.
    if (botType === 'manager_exercise') return [1, 2, 3, 4, 5];
    return advanced ? [1, 2, 3, 4, 5] : [1, 3, 4, 5];
  };

  // Flipping Simple/Advanced can drop the step you're on (e.g. the model step 2
  // vanishes in Simple mode) — fall back to the nearest earlier valid step.
  useEffect(() => {
    const steps = stepsFor(config.bot_type);
    if (!steps.includes(step)) {
      setStep([...steps].reverse().find((s) => s < step) || steps[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanced]);

  // Scroll the flagged manager-document card into view + auto-clear the pulse.
  // Fires when a blocked Next points faculty at the first seat still missing a doc.
  useEffect(() => {
    if (mgrHighlight.idx == null) return;
    document.getElementById(`mgr-card-${mgrHighlight.idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setMgrHighlight((h) => ({ ...h, idx: null })), 1700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mgrHighlight.n]);

  const handleNext = () => {
    if (validateStep()) {
      const steps = stepsFor(config.bot_type);
      const idx = steps.indexOf(step);
      if (idx < steps.length - 1) {
        setStep(steps[idx + 1]);
      } else {
        handleSubmit();
      }
    }
  };

  const handleBack = () => {
    const steps = stepsFor(config.bot_type);
    const idx = steps.indexOf(step);
    if (idx > 0) {
      setStep(steps[idx - 1]);
    } else if (onClose) {
      onClose();
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setErrors({});
    
    if (config.bot_type === 'avatar' && !config.heygen_avatar_id) {
      setErrors({ form: 'Please select a video avatar on step 5.' });
      setIsLoading(false);
      return;
    }

    if (config.bot_type === 'audio_call') {
      if (!(config.model_name || '').toLowerCase().startsWith('claude')) {
        setErrors({ form: 'Audio Call mode requires a Claude model. Pick one on step 2.' });
        setIsLoading(false);
        return;
      }
    }

    const formData = new FormData();
    config.rag_files.forEach(file => {
      formData.append('files', file);
    });

    const configToSend = { ...config };
    delete configToSend.rag_files;
    if (configToSend.bot_type === 'group_chat') {
      // 1. Stringify the bots array for the backend
      configToSend.bots = JSON.stringify(configToSend.bots);

      // 2. Inject a dummy instruction to satisfy the backend's validation requirement
      configToSend.instructions = "Group Space: Managing multiple AI agents.";
      delete configToSend.prompt_template;

    } else if (configToSend.bot_type === 'video_analysis') {
      // No chat model / RAG; scoring_spec + assignment_type drive the feature.
      configToSend.bots = [];
      // Dummy instruction satisfies the backend's instructions-or-template check.
      configToSend.instructions = `Video analysis assignment: ${configToSend.assignment_type}`;
      delete configToSend.prompt_template;
    } else if (configToSend.bot_type === 'experiential') {
      // Lab driven by the prof's prompt + AI-generated config (grounded in the KB).
      configToSend.bots = [];
      configToSend.instructions = `Experiential lab: ${configToSend.experiential_config?.meta?.title || 'custom'}`;
      delete configToSend.prompt_template;
    } else if (configToSend.bot_type === 'manager_exercise') {
      // Hidden-profile group game. Serialize the sub-object as JSON (like bots /
      // scoring_spec) and force group_size == num_managers (the matcher invariant;
      // backend re-enforces it). Doc plaintext travels inside manager_exercise —
      // no rag_files round-trip. Dummy instruction satisfies the backend check.
      configToSend.group_size = configToSend.manager_exercise.num_managers;
      configToSend.manager_exercise = JSON.stringify(configToSend.manager_exercise);
      configToSend.bots = [];
      configToSend.instructions = 'Manager Exercise: hidden-profile candidate placement.';
      delete configToSend.prompt_template;
    } else {
      // Standard Chat / Avatar Chat — single unified instructions panel.
      // Always send `instructions`; the backend wraps it into the system prompt.
      configToSend.bots = [];
      delete configToSend.prompt_template;
    }
    // --------------------------------------------------------------

    formData.append('config', JSON.stringify(configToSend));
    

    try {
      const token = localStorage.getItem('jwtToken');
      if (!token) {
        navigate('/login');
        return;
      }
      
      const response = await apiClient.post('/config', formData, { 
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });
      const newConfigId = response.data.data._id;
      
      if (configToSend.bot_type === 'group_chat') {
        navigate(`/group-chat/${newConfigId}`);
      } else if (configToSend.bot_type === 'video_analysis') {
        navigate(`/video-dashboard/${newConfigId}`);
      } else if (configToSend.bot_type === 'experiential') {
        navigate(`/experiential/c/${newConfigId}`);
      } else if (configToSend.bot_type === 'manager_exercise') {
        navigate(`/manager-exercise/${newConfigId}`);
      } else {
        navigate(`/chat/${newConfigId}`);
      }
      
      if (onClose) onClose();

    } catch (error) {
      console.error('Config error:', error);
      const d = error.response?.data;
      const apiMsg = d && (d.error || d.message || d.msg);
      setErrors({ form: apiMsg || error.message || 'An unexpected error occurred' });
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  // Usage tier + roster size (the shared class pool) is an edit-only feature —
  // it lives in EditConfigPage, not in the create flow. Kept null here so the
  // {classUsageFields} render spots below show nothing while creating a bot.
  const classUsageFields = null;

  return (
    <div style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col relative min-h-[550px] max-h-[90vh]">
        <button onClick={onClose} className="absolute top-5 right-5 p-2.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-all z-10">
          <FaTimes className="text-xl" />
        </button>

        <div className="p-8 sm:p-10 flex-1 flex flex-col pt-16 min-h-0 min-w-0">
          {/* Progress Bar — group chat skips step 2 (model picker), so its
              progress bar has 4 segments instead of 5. A segment lights up
              when its step number is <= current step. */}
          <div className="flex justify-between space-x-2 mb-6 pl-4 pr-14 flex-shrink-0">
            {stepsFor(config.bot_type).map(i => (
              <div key={i} className={`h-2 flex-1 rounded-full transition-colors duration-300 ${i <= step ? 'bg-[#FA6C43]' : 'bg-gray-200'}`} />
            ))}
          </div>

          {errors.form && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-start space-x-3 flex-shrink-0">
              <FaInfoCircle className="mt-0.5 flex-shrink-0 text-lg" />
              <span className="font-medium">{errors.form}</span>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pl-2 pr-2 custom-scrollbar">
            
            {/* STEP 1: Basic Info */}
            {step === 1 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-8">What do we call your Space?</h2>
                
                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">{config.bot_type === 'group_chat' ? 'Group Lobby Name' : 'Custom AI Name'}</label>
                  <input type="text" name="bot_name" value={config.bot_name} onChange={handleChange} className="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" placeholder='e.g., "Physiology Study Group"' />
                  {errors.bot_name && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.bot_name}</p>}
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Space Type</label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'chat' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="chat" checked={config.bot_type === 'chat'} onChange={handleChange} className="hidden" />
                      <FaComments className={`text-2xl mb-2 ${config.bot_type === 'chat' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Chat Bot</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">1-on-1 Text</p>
                    </label>

                    {/* <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'avatar' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="avatar" checked={config.bot_type === 'avatar'} onChange={handleChange} className="hidden" />
                      <FaVideo className={`text-2xl mb-2 ${config.bot_type === 'avatar' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Avatar Bot</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">1-on-1 Video</p>
                    </label> */}

                    {/* <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'audio_call' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="audio_call" checked={config.bot_type === 'audio_call'} onChange={handleChange} className="hidden" />
                      <FaPhoneAlt className={`text-2xl mb-2 ${config.bot_type === 'audio_call' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Audio Call</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Voice + Transcript</p>
                    </label> */}

                    {/* <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'group_chat' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="group_chat" checked={config.bot_type === 'group_chat'} onChange={handleChange} className="hidden" />
                      <FaUsers className={`text-2xl mb-2 ${config.bot_type === 'group_chat' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Group Chat</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Multi-User & Multi-AI</p>
                    </label> */}

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'video_analysis' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="video_analysis" checked={config.bot_type === 'video_analysis'} onChange={handleChange} className="hidden" />
                      <FaFilm className={`text-2xl mb-2 ${config.bot_type === 'video_analysis' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Video Analysis</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Upload & Score</p>
                    </label>

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'experiential' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="experiential" checked={config.bot_type === 'experiential'} onChange={handleChange} className="hidden" />
                      <FaFlask className={`text-2xl mb-2 ${config.bot_type === 'experiential' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Experiential Lab</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Scripted Simulation</p>
                    </label>

                    {/* Manager Exercise — hidden-profile decision game (group bot_type). */}
                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all active:scale-[0.98] ${config.bot_type === 'manager_exercise' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:-translate-y-0.5 bg-white'}`}>
                      <input type="radio" name="bot_type" value="manager_exercise" checked={config.bot_type === 'manager_exercise'} onChange={handleChange} className="hidden" />
                      <FaUserTie className={`text-2xl mb-2 transition-colors ${config.bot_type === 'manager_exercise' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Manager Exercise</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Hidden-Profile Game</p>
                    </label>
                  </div>
                </div>

                {config.bot_type === 'experiential' && (
                  <div className="pt-2 border-t border-gray-100">
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Course materials</label>
                    <p className="text-[11px] text-gray-400 mb-3">Upload the lecture files the lab should be built from — the next step generates the lab <span className="font-medium">grounded in them</span>.</p>
                    <FileUpload key={fileUploadKey} onFileChange={handleFileChange} initialFiles={config.rag_files} />
                  </div>
                )}

                {config.bot_type === 'group_chat' && (
                  <div className="pt-2 border-t border-gray-100">
                    <AvatarSelector
                      selectedAvatar={config.bot_avatar}
                      onSelect={(avatarId) => setConfig((prev) => ({ ...prev, bot_avatar: avatarId }))}
                      label="Lobby / Space Icon"
                      hint="Shown in your agent list and at the top of this group space."
                    />
                  </div>
                )}
              </div>
            )}

            {/* STEP 2: Base Model — OR, for the Manager Exercise, Roles & Timing
                (the exercise pins Claude, so it reuses this slot for seats + timers). */}
            {step === 2 && (
              config.bot_type === 'manager_exercise' ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Roles &amp; Timing</h2>
                  {/* Total seats (N) + the two phase durations. num_managers drives group_size. */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaUserTie className="mr-2 text-[#FA6C43]"/> Roles &amp; Timing</h3>
                    <div className="mb-5">
                      <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                        <span className="inline-flex items-center gap-1">Total Manager Seats<InfoTip text="Total named managerial roles in the room. One seat is ALWAYS a hidden AI manager, so N seats = (N−1) students + 1 AI. Each seat gets its own private document. If students no-show, their seats also fill with AI after the timeout." /></span>
                        <span className="text-[#FA6C43] font-bold">{config.manager_exercise.num_managers} seats</span>
                      </label>
                      <input type="range" min="2" max="10" step="1" value={config.manager_exercise.num_managers} onChange={(e) => handleNumManagersChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                      {/* Explicit student/AI split so faculty aren't surprised that N ≠ student count. */}
                      <p className="mt-2 text-[11px] font-semibold text-gray-500">
                        = <span className="text-[#222]">{Math.max(1, config.manager_exercise.num_managers - 1)} student{config.manager_exercise.num_managers - 1 === 1 ? '' : 's'}</span> + <span className="text-[#222]">1 AI manager</span> <span className="text-gray-400">(the AI is hidden from students)</span>
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Memorize (minutes)</label>
                        <input type="number" min="0.5" step="0.5" value={config.manager_exercise.memorize_minutes} onChange={(e) => setMgr('memorize_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                        <p className="text-[10px] text-gray-400 mt-1">Chat locked; doc visible.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-2">Discuss (minutes)</label>
                        <input type="number" min="0.5" step="0.5" value={config.manager_exercise.discuss_minutes} onChange={(e) => setMgr('discuss_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                        <p className="text-[10px] text-gray-400 mt-1">Chat open; AI nudges.</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-6">{config.bot_type === 'group_chat' ? 'Select Default Lobby AI' : 'Pick the Base AI Model'}</h2>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                    {aiModels.map(model => (
                      <div key={model.id} onClick={() => setConfig(prev => ({...prev, model_name: model.id}))} className={`cursor-pointer p-4 border-2 rounded-xl transition-all ${config.model_name === model.id ? 'border-[#FA6C43] bg-[#F9D0C4]/10 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                        <h3 className="font-bold text-[#222]">{model.name}</h3>
                        {model.desc && <p className="text-sm text-gray-500 font-medium mt-1">{model.desc}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}

            {/* STEP 3: Knowledge Base — or, for experiential labs, generate the
                lab grounded in the files uploaded on the previous step. */}
            {step === 3 && (
              config.bot_type === 'experiential' ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-2">Generate the Lab</h2>
                  <p className="text-center text-sm text-gray-500 mb-4">
                    Claude builds the lab from your design prompt
                    {config.rag_files?.length ? `, grounded in the ${config.rag_files.length} file${config.rag_files.length > 1 ? 's' : ''} you uploaded` : ''}.
                  </p>
                  <LabGenerator
                    advanced={advanced}
                    prompt={config.experiential_prompt}
                    onPromptChange={(v) => setConfig((prev) => ({ ...prev, experiential_prompt: v }))}
                    generated={config.experiential_config}
                    onGenerated={(cfg) => setConfig((prev) => ({ ...prev, experiential_config: cfg }))}
                    files={config.rag_files}
                  />
                  {errors.experiential_config && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.experiential_config}</p>}
                </div>
              ) : config.bot_type === 'manager_exercise' ? (
                // Manager Exercise: the per-manager private-document upload, on its own step.
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-2">Manager Documents</h2>
                  <p className="text-center text-sm text-gray-500 mb-4">One private brief per manager — each seat sees a different slice of the candidates, which is the whole point of the exercise.</p>

                  {/* Sequential per-manager document wizard. Renders Manager 1..N as
                      cards; each card either shows an Upload button (empty) or, once
                      parsed, the auto-detected role_name in an EDITABLE field plus a
                      collapsible plaintext preview for confirmation. */}
                  {(() => {
                    const done = config.manager_exercise.managers.filter(m => (m.doc_text || '').trim()).length;
                    const total = config.manager_exercise.num_managers;
                    return (
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> Manager Documents</h3>
                        {/* In-place progress so the upload state is obvious at a glance. */}
                        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full transition-colors ${done >= total ? 'bg-[#FA6C43]/10 text-[#FA6C43]' : 'bg-gray-100 text-gray-500'}`}>
                          {done}/{total} uploaded
                        </span>
                      </div>
                    );
                  })()}
                  <p className="text-[11px] text-gray-400 mb-3">Upload in order — Word (.docx) or PDF only. Drag a file onto a card or click to browse. The role name is read from the doc header ("To: Marketing Manager") for you to confirm.</p>
                  <div className="space-y-3">
                    {config.manager_exercise.managers.map((mgr, idx) => {
                      const uploaded = !!(mgr.doc_text || '').trim();
                      return (
                        <div key={idx} id={`mgr-card-${idx}`} className={`bg-white p-4 rounded-2xl border-2 shadow-sm transition-all animate-in fade-in slide-in-from-bottom-1 duration-300 ${mgrHighlight.idx === idx ? 'border-[#FA6C43] ring-2 ring-[#FA6C43]/50 ring-offset-2 animate-pulse' : uploaded ? 'border-[#FA6C43]/40' : 'border-gray-100'}`}>
                          <div className="flex items-center justify-between mb-3">
                            <span className="inline-flex items-center gap-2 text-[13px] font-bold text-gray-700">
                              {uploaded ? <FaCheckCircle className="text-[#FA6C43]" /> : <span className="w-4 h-4 rounded-full border-2 border-gray-300 inline-block" />}
                              Manager {idx + 1}
                            </span>
                            {uploaded && (
                              <button type="button" onClick={() => { mgrFileInputRef.current.dataset.index = String(idx); mgrFileInputRef.current.click(); }} className="text-[11px] font-semibold text-gray-400 hover:text-[#FA6C43] transition-colors">Replace</button>
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
                    {/* One shared hidden input; the target seat index is stashed on
                        its dataset by whichever card triggered the picker. */}
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
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Upload Knowledge Base</h2>
                  <p className="text-center text-sm text-gray-500 mb-4">{config.bot_type === 'group_chat' ? 'These files will be shared across the entire group chat and all AI agents.' : 'Provide documents for the AI to study.'}</p>
                  <FileUpload key={fileUploadKey} onFileChange={handleFileChange} initialFiles={config.rag_files} />
                </div>
              )
            )}

            {/* STEP 4: AI Behavior OR Group Configuration */}
            {step === 4 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4 pb-4">
                {config.bot_type === 'video_analysis' ? (
                  // ==============================
                  // VIDEO ANALYSIS — assignment type + editable scoring spec
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Define the Rubric</h2>
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
                        Class Code <span className="font-normal text-gray-400">(optional - lets students join via invite link)</span>
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
                    </AdvancedReveal>
                  </>
                ) : config.bot_type === 'group_chat' ? (
                  // ==============================
                  // GROUP CHAT CONFIGURATION DASHBOARD
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Configure Group Settings</h2>
                    
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-6">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Matchmaking Rules</h3>
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                            <span>Target Group Size</span>
                            <span className="text-[#FA6C43] font-bold">{Number(config.group_size) === 1 ? 'Solo (1 user + AIs)' : `${config.group_size} Users`}</span>
                          </label>
                          <input type="range" name="group_size" min="1" max="10" step="1" value={config.group_size} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                        {advanced && (
                        <div>
                          <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                            <span className="inline-flex items-center gap-1">Chat Duration<InfoTip text="How long the group chat stays open before it automatically ends. Adjustable from 5 to 60 minutes." /></span>
                            <span className="text-[#FA6C43] font-bold">{config.group_duration} Mins</span>
                          </label>
                          <input type="range" name="group_duration" min="5" max="60" step="5" value={config.group_duration} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                        )}
                      </div>
                    </div>

                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-3 flex items-center"><FaRobot className="mr-2 text-[#FA6C43]"/> AI Agents in Lobby</h3>
                    
                    <div className="space-y-4">
                      {config.bots.map((bot, index) => {
                        const noTemp = bot.model_name.includes('gpt-5') || bot.model_name.includes('gemini');
                        return (
                          <div key={index} className="bg-white p-5 rounded-2xl border-2 border-gray-100 shadow-sm relative">
                            {config.bots.length > 1 && (
                              <button onClick={() => removeBot(index)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500 transition-colors bg-gray-50 hover:bg-red-50 p-1.5 rounded-lg">
                                <FaTrash className="text-sm"/>
                              </button>
                            )}
                            
                            <div className="grid grid-cols-2 gap-4 mb-4 pr-8">
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">Agent Name</label>
                                <input type="text" value={bot.name} onChange={(e) => handleBotChange(index, 'name', e.target.value)} className={`w-full p-2.5 bg-gray-50 border ${errors[`bot_${index}_name`] ? 'border-red-500' : 'border-gray-200'} rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all`} placeholder="e.g., Prof. Smith" />
                              </div>
                              {advanced && (
                              <div>
                                <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">AI Engine</label>
                                <select value={bot.model_name} onChange={(e) => handleBotChange(index, 'model_name', e.target.value)} className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                                  {aiModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                              </div>
                              )}
                            </div>

                            <div className="mb-4">
                              <label className="block text-[11px] font-bold text-gray-500 uppercase mb-1">System Prompt / Role</label>
                              <textarea value={bot.prompt} onChange={(e) => handleBotChange(index, 'prompt', e.target.value)} rows="2" className={`w-full p-2.5 bg-gray-50 border ${errors[`bot_${index}_prompt`] ? 'border-red-500' : 'border-gray-200'} rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all resize-none`} placeholder="You are a stern college professor..." />
                            </div>

                            <AdvancedReveal show={advanced}>
                            <div>
                              <label className="flex justify-between text-[11px] font-bold text-gray-500 uppercase mb-2">
                                <span className="inline-flex items-center gap-1">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></span>
                                {noTemp && <span className="text-gray-400 font-normal normal-case">Auto-managed</span>}
                              </label>
                              {noTemp ? (
                                <div className="w-full h-2 bg-gray-100 rounded-lg overflow-hidden"><div className="w-full h-full bg-gray-300 opacity-50" style={{background: 'repeating-linear-gradient(45deg, transparent, transparent 10px, #ccc 10px, #ccc 20px)'}}></div></div>
                              ) : (
                                <>
                                  <input type="range" min="0" max="1" step="0.1" value={bot.temperature} onChange={(e) => handleBotChange(index, 'temperature', parseFloat(e.target.value))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
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
                        );
                      })}

                      {advanced && (
                      <button onClick={addBot} className="w-full py-4 border-2 border-dashed border-gray-300 text-gray-500 rounded-2xl hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50 transition-all font-bold text-sm flex items-center justify-center">
                        <FaPlus className="mr-2"/> Add Another AI Agent
                      </button>
                      )}
                    </div>
                  </>
                ) : config.bot_type === 'manager_exercise' ? (
                  // ==============================
                  // MANAGER EXERCISE — hidden-profile authoring
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Candidates &amp; Grading</h2>

                    {/* Candidate roster + ground-truth marking. Candidates may be
                        auto-seeded from the uploaded docs or entered by hand; the
                        correct best-FIT pick is chosen from this list. */}
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Candidates</h3>
                      <button type="button" onClick={autoExtractCandidates} className="text-[11px] font-semibold text-gray-400 hover:text-[#FA6C43] transition-colors active:scale-95">Auto-extract from docs</button>
                    </div>
                    <div className="space-y-2 mb-3">
                      {config.manager_exercise.candidates.map((cand, idx) => (
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

                    {/* Ground-truth: which candidate is the best FIT (not necessarily
                        most-qualified). Drives individual/collective grade correctness. */}
                    <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 mb-2">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Correct best-fit candidate<InfoTip text="The ground-truth answer used for grading. Best FIT for the role — which is not always the most-qualified applicant." /></label>
                      <select
                        value={config.manager_exercise.correct_candidate}
                        onChange={(e) => setMgr('correct_candidate', e.target.value)}
                        className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all"
                      >
                        <option value="">— select a candidate —</option>
                        {config.manager_exercise.candidates.filter(c => (c.name || '').trim()).map((c, i) => (
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
                          <label key={p.id} className={`cursor-pointer p-3 border-2 rounded-xl text-center transition-all active:scale-[0.97] ${config.manager_exercise.ai_personality === p.id ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 hover:-translate-y-0.5 bg-white'}`}>
                            <input type="radio" name="ai_personality" value={p.id} checked={config.manager_exercise.ai_personality === p.id} onChange={() => setMgr('ai_personality', p.id)} className="hidden" />
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
                            <span className="text-[#FA6C43] font-bold">{Math.round((config.manager_exercise.grading_weights[gw.key] || 0) * 100)}%</span>
                          </label>
                          <input type="range" min="0" max="1" step="0.01" value={config.manager_exercise.grading_weights[gw.key] || 0} onChange={(e) => setGradingWeight(gw.key, e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                        </div>
                      ))}
                    </div>
                    </AdvancedReveal>
                  </>
                ) : (
                  // ==============================
                  // STANDARD 1-ON-1 CONFIGURATION
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Customize AI Behavior</h2>

                    {/* Template Gallery */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[13px] font-semibold text-gray-700">Start from a template <span className="font-normal text-gray-400">(optional)</span></p>
                        {selectedTemplateId && (
                          <button type="button" onClick={() => { setSelectedTemplateId(null); setConfig(prev => ({ ...prev, instructions: '' })); setErrors(prev => ({ ...prev, instructions: null })); }} className="text-xs text-gray-400 hover:text-gray-600 underline">Write from scratch</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        {SIMULATION_TEMPLATES.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => applyTemplate(t)}
                            className={`text-left p-3 rounded-xl border-2 transition-all ${selectedTemplateId === t.id ? 'border-[#FA6C43] bg-[#F9D0C4]/20' : 'border-gray-200 hover:border-gray-300 bg-white'}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-lg">{t.icon}</span>
                              <span className="text-sm font-bold text-[#222]">{t.title}</span>
                              {selectedTemplateId === t.id && <span className="ml-auto text-[10px] font-bold text-[#FA6C43] bg-[#F9D0C4]/50 px-1.5 py-0.5 rounded-full">Active</span>}
                            </div>
                            <p className="text-[11px] text-gray-500 leading-snug">{t.description}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">
                        Instructions
                        <InstructionsInfoTip />
                      </label>
                      <textarea name="instructions" value={config.instructions} onChange={handleChange} rows="5" className={`w-full p-3 border ${errors.instructions ? 'border-red-500' : 'border-gray-200'} rounded-xl text-sm focus:border-[#FA6C43] outline-none`} placeholder='Describe how the bot should behave. You can also request JSON / structured output — see the ⓘ tip.'/>
                      {errors.instructions && <p className="text-xs font-medium text-red-500 mt-1.5">{errors.instructions}</p>}
                    </div>

                    {/* Advanced-only controls — hidden in Simple mode, animated in on Advanced. */}
                    <AdvancedReveal show={advanced}>
                    <div className="pt-4">
                      <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-3">Response style<InfoTip text="Controls how much the bot varies its wording. Lower (Precise) = consistent, predictable answers; higher (Creative) = more varied phrasing. It affects tone and word choice, not the facts the bot knows. Default 0.7 — around 'Conversational.'" /></label>
                      <input type="range" name="temperature" min="0" max="1" step="0.1" value={config.temperature} onChange={handleChange} className="w-full h-2 bg-gray-200 rounded-lg appearance-none accent-[#FA6C43]" />
                      <div className="flex justify-between text-xs font-medium text-gray-400 mt-2">
                        <span>Precise</span>
                        <span>Balanced</span>
                        <span>Conversational</span>
                        <span>Creative</span>
                      </div>
                    </div>

                    <div className="pt-4 mt-2 border-t border-gray-100">
                      <label className="flex items-center justify-between cursor-pointer gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-gray-700">Allow web search & URL access</p>
                          <p className="text-xs text-gray-500 mt-0.5">When off, the bot only uses your uploaded files.</p>
                        </div>
                        <span className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            name="web_access"
                            className="sr-only peer"
                            checked={!!config.web_access}
                            onChange={handleChange}
                          />
                          <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></span>
                        </span>
                      </label>
                    </div>

                    {/* Facilitator — pluggable structured-UI layer over the bot's replies */}
                    <div className="pt-4 mt-2 border-t border-gray-100">
                      <label className="flex items-center justify-between cursor-pointer gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-gray-700">Facilitator (interactive UI)</p>
                          <p className="text-xs text-gray-500 mt-0.5">After each reply, offer the user structured UI — e.g. multiple-choice options — instead of only text.</p>
                        </div>
                        <span className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            className="sr-only peer"
                            checked={!!config.facilitator?.enabled}
                            onChange={(e) => setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), enabled: e.target.checked } }))}
                          />
                          <span className="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#FA6C43]"></span>
                        </span>
                      </label>
                      {config.facilitator?.enabled && (
                        <div className="mt-3">
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

                    {/* Class rollout — optional class code + shared message pool */}
                    <div className="pt-4 mt-2 border-t border-gray-100">
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
                    </AdvancedReveal>

                  </>
                )}
              </div>
            )}

            {/* STEP 5: Fine Tune */}
            {step === 5 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
                <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Final Polish</h2>
                
                {config.bot_type !== 'group_chat' && config.bot_type !== 'audio_call' && config.bot_type !== 'video_analysis' && (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-2">
                      {config.bot_type === 'avatar' ? 'Video Avatar' : 'Bot Avatar'}
                    </label>
                    {config.bot_type === 'avatar' ? (
                      <div className="grid grid-cols-4 gap-3 max-h-40 overflow-y-auto custom-scrollbar">
                        {heygenAvatars.map((avatar) => (
                          <div key={avatar.avatar_id} onClick={() => setConfig(prev => ({ ...prev, heygen_avatar_id: avatar.avatar_id }))} className={`cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${config.heygen_avatar_id === avatar.avatar_id ? 'border-[#FA6C43] shadow-md scale-95' : 'border-transparent hover:border-gray-300'}`}><img src={avatar.normal_preview} alt="Avatar" className="w-full h-16 object-cover bg-gray-100" /></div>
                        ))}
                      </div>
                    ) : (
                      <AvatarSelector
                        selectedAvatar={config.bot_avatar}
                        onSelect={(avatarId) => setConfig(prev => ({ ...prev, bot_avatar: avatarId }))}
                        label={null}
                      />
                    )}
                  </div>
                )}

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Introduction Message</label>
                  <textarea name="introduction" value={config.introduction} onChange={handleChange} rows="2" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]" placeholder="e.g., Welcome to the class!" />
                </div>

                <div>
                  <label className="block text-[13px] font-semibold text-gray-700 mb-2">Access Permissions</label>
                  <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input type="radio" name="is_public" checked={config.is_public === true} onChange={() => setConfig(prev => ({...prev, is_public: true}))} className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"/>
                      <div className="text-sm"><span className="block font-bold text-[#222]">Public</span><span className="text-xs text-gray-500 font-medium">Link Access</span></div>
                    </label>
                    <div className="w-px bg-gray-200"></div>
                    <label className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${!config.is_public ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                      <input type="radio" name="is_public" checked={config.is_public === false} onChange={() => setConfig(prev => ({...prev, is_public: false}))} className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]"/>
                      <div className="text-sm"><span className="block font-bold text-[#222]">Private</span><span className="text-xs text-gray-500 font-medium">Login Required</span></div>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="relative flex justify-between items-center mt-8 pt-4 border-t border-gray-100 flex-shrink-0">
            {/* Faculty Simple/Advanced switch, centered at the modal's bottom
                edge. Overlay is click-through so it never blocks the Back/Next
                buttons sitting at the row's edges. */}
            <div className="absolute inset-0 flex items-center justify-center pt-4 pointer-events-none">
              <div className="pointer-events-auto">
                <ConfigModeToggle variant="compact" />
              </div>
            </div>
            <button onClick={handleBack} disabled={isLoading} className="px-8 py-3 rounded-xl font-bold text-gray-700 bg-white border-2 border-gray-200 hover:bg-gray-50 transition-all">{step === 1 ? 'Cancel' : 'Back'}</button>
            <button onClick={handleNext} disabled={isLoading} className="px-8 py-3 rounded-xl font-bold text-white bg-[#FA6C43] hover:bg-[#E55B34] transition-all shadow-sm active:scale-[0.98] min-w-[120px] flex justify-center">
              {isLoading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : (step === 5 ? 'Publish' : 'Next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigModal;