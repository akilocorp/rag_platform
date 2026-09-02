// @language  JavaScript (React / JSX)
// @updated   2026-09-02
// @changed   Un-commented the Audio Call bot-type card. The whole voice path (validation, audio_enabled,
//            the Claude-model pin) was already wired — only the card was hidden, so the mode could not
//            be created at all.
// @changed   Prior: Publishing a new config returns to the config list instead of opening the config itself,
//            matching the edit page. Video rubric boxes are edited on /video-boxes/:configId afterwards.
// @changed   Prior: Case Materials upload boxes now accept drag-and-drop (General Info, Candidate Summary,
//            candidate-outcome and role-packet adders) with an orange drop-target highlight.
//            Prior: New Claude bots default the facilitator toggle ON (opt-out): initial state enabled, the model
//            picker syncs enabled=isClaude until the professor touches the toggle.
//            Prior: Added Claude Opus 5 to the model picker.
//            Prior: "Counted as one item" merges group into Strengths / Concerns sections (section header
//            carries the category, per-row field tag dropped).
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/apiClient';
import { FaRobot, FaUpload, FaTrash, FaInfoCircle, FaFile, FaVideo, FaComments, FaTimes, FaUsers, FaPlus, FaPhoneAlt, FaFilm, FaFlask, FaUserTie, FaCheckCircle, FaSpinner, FaFileAlt, FaShareAlt } from 'react-icons/fa';
import AvatarSelector from '../components/AvatarSelector';

// The bot avatar and the introduction message dress a 1:1 conversation: an icon that
// sits beside the bot's replies and a line it opens with. Nothing else has either of
// those surfaces — a group chat, a video assignment, a lab and the manager exercise
// each open on their own framing — so both fields are chat-only.
const isChatLike = (t) => t === 'chat' || t === 'avatar';
import { SIMULATION_TEMPLATES } from '../data/simulationTemplates';
import LabGenerator from '../components/experiential/LabGenerator';
import VideoScoringEditor from '../components/VideoScoringEditor';
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
    { id: 'claude-opus-5', name: 'Claude Opus 5', desc: 'Deepest reasoning, best for hard tasks' },
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
    public_purpose: 'learning',
    web_access: true,
    audio_enabled: false,
    hume_config_id: '',
    // Default ON: the initial model is Claude, and new Claude bots default the
    // facilitator on (opt-out). Kept in sync with the model until the professor
    // touches the toggle (facilitatorTouchedRef).
    facilitator: { enabled: true, instruction: '', allowedWidgets: null, presets: [] },
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
    // Manager Exercise Specifics — the facilitated hidden-profile debrief. The
    // decision itself happens offline on printed packets; everything here is what
    // ACTR needs afterwards. Serialized as a nested JSON sub-object on submit
    // (mirrors bots/scoring_spec). num_students drives group_size (invariant,
    // enforced again server-side).
    manager_exercise: {
      num_students: 3,                                // capacity of one breakout room
      num_rooms: 5,                                   // how many groups the class splits into
      discuss_minutes: 20,                            // round 1: the group's own deliberation
      debrief_minutes: 20,                            // round 2: the facilitated debrief
      class_preset: '',
      learning_outcome: '',
      general_info: { file_id: '', text: '' },        // AI-only, optional; what the ROLE requires
      candidate_summary: { file_id: '', text: '' },   // AI-only; the tally derives from this
      candidates: [],                                 // { name, forecast_text, forecast_file_id }
      template: 'hiring',                             // exercise template: 'hiring' | 'investigation'
      student_view: 'cards',                          // how round 0 reads: 'cards' | 'case'
      role_packets: [],                               // { role, text, file_id } — one per role, 'case' mode
      case_pack: null                                 // derived + reviewed in step 4
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

  // Set once the professor touches the facilitator toggle, which stops the
  // model→facilitator default from overriding their explicit choice.
  const facilitatorTouchedRef = useRef(false);

  // Picking a model defaults the facilitator on for Claude / off otherwise, unless
  // the professor has already set the toggle themselves.
  const applyModel = (prev, modelId) => {
    const next = { ...prev, model_name: modelId };
    if (!facilitatorTouchedRef.current) {
      const isClaude = (modelId || '').toLowerCase().startsWith('claude');
      next.facilitator = { ...(prev.facilitator || {}), enabled: isClaude };
    }
    return next;
  };

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
      // The facilitator runs on Claude; pin the model + sync group_size to
      // num_students so the invariant holds even before submit.
      if (name === 'bot_type' && val === 'manager_exercise') {
        next.model_name = 'claude-sonnet-4-6';
        next.group_size = next.manager_exercise.num_students;
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
  // `mgrUploading` guards the active POST so faculty can't double-submit a
  // document; `mgrUploadError` surfaces a failure inline next to the upload.
  const [mgrUploading, setMgrUploading] = useState(false);
  const [mgrUploadError, setMgrUploadError] = useState('');
  // Tracks which Case Materials drop target is being hovered with a file, so
  // only that box lights up orange (keyed by slot: 'general_info', 'outcome', …).
  const [mgrDragTarget, setMgrDragTarget] = useState(null);
  // Case-pack analysis state for the step-4 review.
  const [packLoading, setPackLoading] = useState(false);
  const [packError, setPackError] = useState('');

  // Saved cases. Authoring a case (upload, analyse, review the answer key) is the
  // expensive part and none of it changes between cohorts, so a preset carries it
  // all and a second class only has to set group size, rooms, and a code.
  const [casePresets, setCasePresets] = useState([]);
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetMsg, setPresetMsg] = useState('');
  // Public by default — a case is teaching material and sharing it is the point.
  const [presetVisibility, setPresetVisibility] = useState('public');

  const loadCasePresets = useCallback(() => {
    apiClient.get('/case-presets')
      .then(res => setCasePresets(res.data?.presets || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (config.bot_type === 'manager_exercise') loadCasePresets();
  }, [config.bot_type, loadCasePresets]);

  // Load a saved case wholesale — documents AND the reviewed analysis. The pack is
  // reused rather than re-derived on purpose: re-analysing would regenerate the
  // answer key the professor already checked.
  const applyCasePreset = async (presetId) => {
    setPresetBusy(true);
    setPresetMsg('');
    try {
      const res = await apiClient.get(`/case-presets/${presetId}`);
      const p = res.data?.preset;
      if (!p) return;
      setConfig(prev => ({
        ...prev,
        manager_exercise: {
          ...prev.manager_exercise,
          candidate_summary: p.candidate_summary || { file_id: '', text: '' },
          candidates: p.candidates || [],
          case_pack: p.case_pack || null,
          class_preset: p.class_preset || prev.manager_exercise.class_preset,
          learning_outcome: p.learning_outcome || prev.manager_exercise.learning_outcome,
        },
      }));
      setPresetName(p.name || '');
      if (p.visibility) setPresetVisibility(p.visibility);
      setPresetMsg(`Loaded "${p.name}". Set the group size and rooms below, then skip ahead.`);
    } catch {
      setPresetMsg('Could not load that case.');
    } finally {
      setPresetBusy(false);
    }
  };

  // Save the current case + its reviewed analysis for reuse. Same name overwrites.
  const saveCasePreset = async () => {
    const name = presetName.trim();
    if (!name || !mePack) return;
    setPresetBusy(true);
    setPresetMsg('');
    try {
      const me = config.manager_exercise;
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
      loadCasePresets();
    } catch (err) {
      const d = err.response?.data;
      setPresetMsg((d && (d.error || d.message)) || 'Could not save the case.');
    } finally {
      setPresetBusy(false);
    }
  };

  const deleteCasePreset = async (presetId) => {
    try {
      await apiClient.delete(`/case-presets/${presetId}`);
      loadCasePresets();
    } catch { /* the list simply stays as it was */ }
  };

  // Share one of your saved cases with everyone, or take it back private.
  const toggleCaseVisibility = async (presetId, next) => {
    try {
      await apiClient.patch(`/case-presets/${presetId}/visibility`, { visibility: next });
      loadCasePresets();
    } catch { /* the list simply stays as it was */ }
  };

  // The derived case pack, once analysed. Read throughout the review step.
  const mePack = config.manager_exercise?.case_pack || null;

  // Patch a single field on the manager_exercise sub-object.
  const setMgr = (field, value) => {
    setConfig(prev => ({ ...prev, manager_exercise: { ...prev.manager_exercise, [field]: value } }));
  };

  // Group size drives the top-level group_size invariant, so the two are moved
  // together and can never drift before submit.
  const handleNumStudentsChange = (n) => {
    const count = Math.max(2, Math.min(10, parseInt(n, 10) || 2));
    setConfig(prev => ({
      ...prev,
      group_size: count,
      manager_exercise: { ...prev.manager_exercise, num_students: count },
    }));
  };

  // Case documents are restricted to Word (.docx) and PDF. The picker enforces
  // this via `accept`, but drag-and-drop bypasses that filter, so validate by
  // extension too.
  const isAllowedManagerDoc = (file) =>
    !!file && ['pdf', 'docx'].includes((file.name.split('.').pop() || '').toLowerCase());

  // POST one document to the faculty-only /api/files/manager-doc endpoint, which
  // extracts plaintext and best-effort parses a name from the header. Returns
  // null (and surfaces the error inline) on failure.
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

  // Upload one of the two AI-only reference documents. Any change here clears the
  // derived pack: approving a tally built from documents that are no longer
  // loaded is exactly the failure the review step exists to prevent.
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

  // Upload one candidate's OUTCOME document. The candidate name is parsed from
  // the doc header and stays editable, so uploading is very nearly the whole
  // authoring step for a candidate.
  const handleOutcomeUpload = async (file) => {
    if (!file) return;
    const data = await uploadCaseDoc(file);
    if (!data) return;
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates: [
          ...prev.manager_exercise.candidates,
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

  // M10: upload one ROLE's confidential packet — the case document a student holding
  // that role reads when the exercise is set to "case" mode. The role name is parsed
  // from the doc header (same helper as the outcome upload) and stays editable,
  // because it has to match the role the case pack assigns or the student's screen
  // falls back to cards.
  const handleRolePacketUpload = async (file) => {
    if (!file) return;
    const data = await uploadCaseDoc(file);
    if (!data) return;
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        role_packets: [
          ...(prev.manager_exercise.role_packets || []),
          { role: data.role_name || '', text: data.doc_text || '', file_id: data.file_id || '' },
        ],
      },
    }));
  };

  // Drag-and-drop plumbing for the Case Materials upload boxes. `key` names the
  // box (so only the hovered one highlights); `onFile` receives the dropped file
  // and routes it to the right upload handler. Reuses the same handlers as the
  // click-to-browse inputs, so a drop and a click do exactly the same thing.
  const caseDropProps = (key, onFile) => ({
    onDragOver: (e) => { e.preventDefault(); setMgrDragTarget(key); },
    onDragLeave: (e) => { e.preventDefault(); setMgrDragTarget((cur) => (cur === key ? null : cur)); },
    onDrop: (e) => {
      e.preventDefault();
      setMgrDragTarget(null);
      const file = e.dataTransfer?.files?.[0];
      if (file) onFile(file);
    },
  });

  const setRolePacketRole = (index, role) => {
    const role_packets = [...(config.manager_exercise.role_packets || [])];
    role_packets[index] = { ...role_packets[index], role };
    setMgr('role_packets', role_packets);
  };

  const removeRolePacket = (index) => {
    setMgr('role_packets', (config.manager_exercise.role_packets || []).filter((_, i) => i !== index));
  };

  const setCandidateName = (index, name) => {
    const candidates = [...config.manager_exercise.candidates];
    candidates[index] = { ...candidates[index], name };
    setMgr('candidates', candidates);
  };

  const removeCandidate = (index) => {
    setConfig(prev => ({
      ...prev,
      manager_exercise: {
        ...prev.manager_exercise,
        candidates: prev.manager_exercise.candidates.filter((_, i) => i !== index),
        case_pack: null,
      },
    }));
  };

  // Ask the backend to extract the case pack from the uploaded documents. Runs the
  // same code path as save, so what the professor approves here is byte-for-byte
  // what the facilitator will steer by.
  const analyzeCase = async () => {
    setPackLoading(true);
    setPackError('');
    try {
      const me = config.manager_exercise;
      const res = await apiClient.post('/config/case-pack/preview', {
        general_info_text: me.general_info?.text || '',
        candidate_summary_text: me.candidate_summary?.text || '',
        candidates: me.candidates,
      });
      setMgr('case_pack', res.data?.case_pack || null);
    } catch (err) {
      const d = err.response?.data;
      setPackError((d && (d.error || d.message)) || err.message || 'Analysis failed');
    } finally {
      setPackLoading(false);
    }
  };

  // Correct a misread outcome verdict. It picks the facilitator's branch entry, so
  // a wrong one sends ACTR into the wrong opening.
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

  // Override the derived answer key. `best_option_locked` tells the server-side
  // recompute to stop deriving it from the tally on subsequent saves.
  const setBestOption = (name) => {
    setMgr('case_pack', {
      ...mePack,
      answer_key: { ...(mePack.answer_key || {}), best_option: name, best_option_locked: true },
    });
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
    // Manager Exercise step 3 = case materials: the candidate summary is what the
    // tally derives from, and each candidate needs the outcome revealed on pick.
    if (step === 3 && config.bot_type === 'manager_exercise') {
      const me = config.manager_exercise;
      const usable = me.candidates.filter(c => (c.name || '').trim() && (c.forecast_text || '').trim());
      if (!(me.general_info?.text || '').trim()) {
        newErrors.form = 'Upload the General Information document — ACTR needs it to ask what the role requires.';
      } else if (!(me.candidate_summary?.text || '').trim()) {
        newErrors.form = 'Upload the Candidate Summary document.';
      } else if (usable.length < 2) {
        newErrors.form = 'Upload a named outcome document for at least two candidates.';
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
        // Step 4 = review. The pack carries the answer key ACTR steers by, so the
        // exercise cannot be saved until a human has actually looked at it.
        if (!config.manager_exercise.case_pack) {
          newErrors.form = 'Analyse the case and review the result before saving.';
        }
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
    // Manager exercise (fixed Claude, decision made offline) reuses the slots:
    //   1 name → 2 Setup → 3 Case Materials → 4 Review the case → 5 polish.
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
      // Facilitated hidden-profile debrief. Serialize the sub-object as JSON (like
      // bots / scoring_spec) and force group_size == num_students (the matcher
      // invariant; backend re-enforces it). Document plaintext and the reviewed
      // case pack travel inside manager_exercise — no rag_files round-trip. The
      // dummy instruction satisfies the backend's required-field check.
      configToSend.group_size = configToSend.manager_exercise.num_students;
      configToSend.manager_exercise = JSON.stringify(configToSend.manager_exercise);
      configToSend.bots = [];
      configToSend.instructions = 'Manager Exercise: facilitated hidden-profile debrief.';
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
      
      // Back to the list rather than into the new config: the professor has just
      // finished a setup task and the list is where the next one starts. It also
      // matches what Save Changes on the edit page now does.
      navigate('/config_list');
      
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

                    <label className={`cursor-pointer p-4 border-2 rounded-xl flex flex-col items-center text-center transition-all ${config.bot_type === 'audio_call' ? 'border-[#FA6C43] bg-[#F9D0C4]/20 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <input type="radio" name="bot_type" value="audio_call" checked={config.bot_type === 'audio_call'} onChange={handleChange} className="hidden" />
                      <FaPhoneAlt className={`text-2xl mb-2 ${config.bot_type === 'audio_call' ? 'text-[#FA6C43]' : 'text-gray-400'}`} />
                      <p className="font-bold text-[#222] text-sm">Audio Call</p>
                      <p className="text-[10px] text-gray-500 font-medium mt-1">Voice + Transcript</p>
                    </label>

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

              </div>
            )}

            {/* STEP 2: Base Model — OR, for the Manager Exercise, Roles & Timing
                (the exercise pins Claude, so it reuses this slot for seats + timers). */}
            {step === 2 && (
                config.bot_type === 'manager_exercise' ? (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-6">Setup</h2>

                  {/* Start from a case already uploaded, analysed and reviewed. Loads
                      the documents and the approved answer key, so the remaining
                      steps are just confirmation. */}
                  {casePresets.length > 0 && (
                    <div className="bg-white p-5 rounded-2xl border-2 border-[#FA6C43]/30 animate-in fade-in slide-in-from-bottom-2 duration-300">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-1 flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> Start from a saved case</h3>
                      <p className="text-[11px] text-gray-400 mb-3">Shared cases plus your own. Reuses the documents and the approved analysis — no re-upload, no re-analysis.</p>
                      <div className="space-y-2">
                        {casePresets.map(p => (
                          <div key={p.preset_id} className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={presetBusy}
                              onClick={() => applyCasePreset(p.preset_id)}
                              className="flex-1 text-left rounded-xl border-2 border-gray-200 bg-white px-4 py-3 hover:border-[#FA6C43] hover:-translate-y-0.5 transition-all disabled:opacity-50 active:scale-[0.99]"
                            >
                              <div className="font-bold text-sm text-[#222] flex items-center gap-2 flex-wrap">
                                {p.name}
                                {p.owned && <span className="text-[9px] font-bold uppercase tracking-wider text-[#C2410C] bg-[#F9D0C4]/60 px-1.5 py-0.5 rounded-full">Yours</span>}
                                {p.visibility === 'private' && <span className="text-[9px] font-bold uppercase tracking-wider text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded-full">Private</span>}
                              </div>
                              <div className="text-[11px] text-gray-500">
                                {p.tally.map(t => `${t.name} ${t.strengths}/${t.concerns}`).join('  ·  ') || p.candidates.join(', ')}
                              </div>
                            </button>
                            {/* Anyone may build from a case; only its author may
                                share it, un-share it, or remove it. */}
                            {p.owned && (
                              <>
                                <button
                                  type="button"
                                  title={p.visibility === 'public' ? 'Shared with everyone — click to make private' : 'Private — click to share'}
                                  onClick={() => toggleCaseVisibility(p.preset_id, p.visibility === 'public' ? 'private' : 'public')}
                                  className={`p-2 rounded-lg transition-colors ${p.visibility === 'public' ? 'text-[#FA6C43] hover:bg-[#F9D0C4]/30' : 'text-gray-400 hover:text-[#FA6C43] hover:bg-[#F9D0C4]/20'}`}
                                >
                                  <FaShareAlt className="text-sm" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteCasePreset(p.preset_id)}
                                  className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"
                                >
                                  <FaTrash className="text-sm" />
                                </button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      {presetMsg && <p className="text-[11px] font-semibold text-[#C2410C] mt-3">{presetMsg}</p>}
                    </div>
                  )}

                  {/* Group size + the one timed phase. num_students drives group_size. */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaUserTie className="mr-2 text-[#FA6C43]"/> Group &amp; Timing</h3>
                    <div className="mb-5">
                      <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                        <span className="inline-flex items-center gap-1">Students per group<InfoTip text="Capacity of one breakout room, not a requirement. Every participant is a real student — there are no AI players. A group can start short-handed, and the facilitator is told how many actually turned up." /></span>
                        <span className="text-[#FA6C43] font-bold">{config.manager_exercise.num_students} students</span>
                      </label>
                      <input type="range" min="2" max="10" step="1" value={config.manager_exercise.num_students} onChange={(e) => handleNumStudentsChange(e.target.value)} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                    </div>
                    <div className="mb-5">
                      <label className="flex justify-between text-xs font-semibold text-gray-700 mb-2">
                        <span className="inline-flex items-center gap-1">Breakout groups<InfoTip text="How many groups the class splits into. Students see them as Group 1, Group 2… with live occupancy, and pick one — there is no queue." /></span>
                        <span className="text-[#FA6C43] font-bold">{config.manager_exercise.num_rooms} groups</span>
                      </label>
                      <input type="range" min="1" max="20" step="1" value={config.manager_exercise.num_rooms} onChange={(e) => setMgr('num_rooms', Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))} className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#FA6C43]" />
                      <p className="mt-2 text-[11px] font-semibold text-gray-500">
                        Room for up to {config.manager_exercise.num_rooms * config.manager_exercise.num_students} students.
                      </p>
                    </div>
                    {/* Two windows, one per conversation. Round 0 (the private
                        decision) is untimed — it ends when everyone has submitted. */}
                    <div className="mb-5">
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Round 1 &mdash; team discussion (minutes)<InfoTip text="How long the group has to talk it through before the ballot opens. The facilitator is not present for this round: it is the students' own decision. The clock starts on their first message, so reading time is free." /></label>
                      <input type="number" min="0" step="any" value={config.manager_exercise.discuss_minutes} onChange={(e) => setMgr('discuss_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                    </div>
                    <div>
                      <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Round 2 &mdash; debrief (minutes)<InfoTip text="How long the facilitated debrief may run after the outcome is revealed. This is a backstop: the facilitator normally closes the session itself once the group has worked out what they missed." /></label>
                      <input type="number" min="0" step="any" value={config.manager_exercise.debrief_minutes} onChange={(e) => setMgr('debrief_minutes', parseFloat(e.target.value) || 0)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all" />
                    </div>
                  </div>

                  {/* What ACTR steers toward. Only the preset KEY is sent; the full
                      learning-point text is stamped in server-side. */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-4 flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> Learning</h3>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 mb-2">Class preset<InfoTip text="Pre-written learning points the facilitator steers toward. Leave blank to rely on your own stated outcome alone." /></label>
                    <select value={config.manager_exercise.class_preset} onChange={(e) => setMgr('class_preset', e.target.value)} className="w-full p-2.5 mb-4 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                      <option value="">— none —</option>
                      {ME_CLASS_PRESETS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                    </select>
                    <label className="block text-xs font-semibold text-gray-700 mb-2">What should they take away?</label>
                    <textarea rows="3" value={config.manager_exercise.learning_outcome} onChange={(e) => setMgr('learning_outcome', e.target.value)} placeholder="e.g. Groups under-share unique information and over-weight a concern everyone happens to hold." className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                  </div>

                  {/* Class code — how students reach the exercise at all, so it sits
                      in the main flow rather than behind the Advanced toggle. */}
                  <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
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
                  </div>
                </div>
              ) : (
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-6">{config.bot_type === 'group_chat' ? 'Select Default Lobby AI' : 'Pick the Base AI Model'}</h2>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                    {aiModels.map(model => (
                      <div key={model.id} onClick={() => setConfig(prev => applyModel(prev, model.id))} className={`cursor-pointer p-4 border-2 rounded-xl transition-all ${config.model_name === model.id ? 'border-[#FA6C43] bg-[#F9D0C4]/10 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
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

                  {/* Facilitator — interactive UI (e.g. charts) layered over the lab's replies */}
                  <div className="pt-4 mt-2 border-t border-gray-100 text-left">
                    <label className="flex items-center justify-between cursor-pointer gap-4">
                      <div>
                        <p className="text-[13px] font-semibold text-gray-700">Facilitator (interactive UI)</p>
                        <p className="text-xs text-gray-500 mt-0.5">After each reply, offer structured UI — e.g. a chart or multiple-choice — instead of only text.</p>
                      </div>
                      <span className="relative inline-flex items-center cursor-pointer shrink-0">
                        <input
                          type="checkbox"
                          className="sr-only peer"
                          checked={!!config.facilitator?.enabled}
                          onChange={(e) => { facilitatorTouchedRef.current = true; setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), enabled: e.target.checked } })); }}
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
                          placeholder="e.g. When the reply describes a quantity changing across periods, show it as a chart of that trajectory."
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F9D0C4] focus:border-[#FA6C43] transition-all"
                        />
                        <p className="text-[11px] text-gray-400 mt-1.5">Available widgets: multiple choice, chart. More coming soon.</p>
                      </div>
                    )}
                  </div>
                </div>
              ) : config.bot_type === 'manager_exercise' ? (
                // Manager Exercise: ACTR's reference documents. Students never see
                // these — they read their confidential packets on paper, in the room.
                <div className="space-y-4 animate-in fade-in slide-in-from-right-4">
                  <h2 className="text-2xl font-bold text-center text-[#222] mb-2">Case Materials</h2>
                  <p className="text-center text-sm text-gray-500 mb-4">These go to ACTR only and are never shown to a student — the candidate summary states every role's private view.</p>

                  {/* Both required, and they do different jobs. The summary is what
                      the tally comes from; general information is what a pooled
                      picture gets tested against — without it the session
                      collapses into counting items. */}
                  {[
                    { field: 'general_info', label: 'General Information', required: true,
                      hint: 'What the role requires. ACTR uses it to ask what outcome each candidate would produce, and whether that is what the job needed.' },
                    { field: 'candidate_summary', label: 'Candidate Summary', required: true,
                      hint: "Every role's private view, side by side. The pooled tally is derived from this." },
                  ].map(slot => {
                    const doc = config.manager_exercise[slot.field] || {};
                    const filled = (doc.text || '').trim().length > 0;
                    const dragging = mgrDragTarget === slot.field;
                    return (
                      <div
                        key={slot.field}
                        {...caseDropProps(slot.field, (file) => handleCaseDocUpload(slot.field, file))}
                        className={`p-4 rounded-2xl border-2 transition-all ${
                          dragging
                            ? 'border-[#FA6C43] bg-[#F9D0C4]/20 border-solid'
                            : filled
                              ? 'border-[#FA6C43]/40 bg-[#F9D0C4]/10'
                              : 'border-dashed border-gray-300 bg-white'
                        }`}
                      >
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

                  {/* One outcome document per candidate. The name is parsed from the
                      doc header, so uploading is very nearly the whole authoring step. */}
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider flex items-center"><FaUsers className="mr-2 text-[#FA6C43]"/> Candidate Outcomes</h3>
                      <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">{config.manager_exercise.candidates.length} uploaded</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mb-3">One document per candidate describing how they actually performed. Revealed to the group the moment they enter their pick — Word (.docx) or PDF.</p>
                    <div className="space-y-2 mb-3">
                      {config.manager_exercise.candidates.map((cand, idx) => (
                        <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-1 duration-200">
                          <input type="text" value={cand.name} onChange={(e) => setCandidateName(idx, e.target.value)} placeholder="Candidate name" className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                          <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">{(cand.forecast_text || '').trim().length.toLocaleString()} chars</span>
                          <button type="button" onClick={() => removeCandidate(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"><FaTrash className="text-sm" /></button>
                        </div>
                      ))}
                    </div>
                    <label
                      {...caseDropProps('outcome', (file) => handleOutcomeUpload(file))}
                      className={`w-full py-3 border-2 rounded-xl transition-all font-bold text-sm flex items-center justify-center cursor-pointer active:scale-[0.99] ${
                        mgrDragTarget === 'outcome'
                          ? 'border-solid border-[#FA6C43] bg-[#F9D0C4]/20 text-[#FA6C43]'
                          : 'border-dashed border-gray-300 text-gray-500 hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50'
                      }`}
                    >
                      <FaPlus className="mr-2" /> Add a candidate outcome
                      <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleOutcomeUpload(e.target.files?.[0])} />
                    </label>
                  </div>

                  {/* M10: how a student reads their own confidential material, and the
                      per-role packets that make the `case` option possible. */}
                  <div className="pt-2 border-t border-gray-100">
                    {/* Which exercise this is. Mirrors the server registry in
                        backend/src/managers/exercise_templates.py — an unknown value there
                        falls back to `hiring`, so the two can drift without breaking a class. */}
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-2 flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> How the exercise runs</h3>
                    <div className="grid sm:grid-cols-2 gap-2 mb-6">
                      {[
                        { key: 'hiring', title: 'Hiring committee', hint: 'The group picks a candidate, reads how the hire turned out six months later, then ACTR debriefs them.' },
                        { key: 'investigation', title: 'Investigation', hint: "The group names one person and stops — no outcome shown, no debrief. You read every group's answer on the results page." },
                      ].map((opt) => {
                        const active = (config.manager_exercise.template || 'hiring') === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setMgr('template', opt.key)}
                            className={`text-left rounded-xl border-2 p-3 transition-all active:scale-[0.99] ${
                              active ? 'border-[#FA6C43] bg-[#FA6C43]/5' : 'border-gray-200 bg-white hover:border-[#FA6C43]/50'
                            }`}
                          >
                            <span className="block text-sm font-bold text-[#222] mb-1">{opt.title}</span>
                            <span className="block text-[11px] leading-snug text-gray-500">{opt.hint}</span>
                          </button>
                        );
                      })}
                    </div>
                    <h3 className="text-[13px] font-bold text-gray-800 uppercase tracking-wider mb-2 flex items-center"><FaFileAlt className="mr-2 text-[#FA6C43]"/> What each student reads</h3>
                    <div className="grid sm:grid-cols-2 gap-2 mb-3">
                      {[
                        { key: 'cards', title: 'Filtered cards', hint: "A card per candidate showing that role's strengths and concerns, pulled out of the Candidate Summary. Nothing extra to upload." },
                        { key: 'case', title: 'Their own case', hint: 'Each role reads the full packet you upload below, as a case document. Closer to running it on paper.' },
                      ].map((opt) => {
                        const active = (config.manager_exercise.student_view || 'cards') === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => setMgr('student_view', opt.key)}
                            className={`text-left rounded-xl border-2 p-3 transition-all active:scale-[0.99] ${
                              active ? 'border-[#FA6C43] bg-[#FA6C43]/5' : 'border-gray-200 bg-white hover:border-[#FA6C43]/50'
                            }`}
                          >
                            <span className="block text-sm font-bold text-[#222] mb-1">{opt.title}</span>
                            <span className="block text-[11px] leading-snug text-gray-500">{opt.hint}</span>
                          </button>
                        );
                      })}
                    </div>

                    {(config.manager_exercise.student_view || 'cards') === 'case' && (
                      <div className="animate-in fade-in slide-in-from-top-1 duration-200">
                        <p className="text-[11px] text-gray-400 mb-3">
                          One packet per confidential role. The role name is read from the document header —
                          it must match the role in the case pack, or that student falls back to cards.
                        </p>
                        <div className="space-y-2 mb-3">
                          {(config.manager_exercise.role_packets || []).map((p, idx) => (
                            <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-1 duration-200">
                              <input type="text" value={p.role} onChange={(e) => setRolePacketRole(idx, e.target.value)} placeholder="Role (e.g. Logistics)" className="flex-1 p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all" />
                              <span className="text-[11px] font-semibold text-gray-400 whitespace-nowrap">{(p.text || '').trim().length.toLocaleString()} chars</span>
                              <button type="button" onClick={() => removeRolePacket(idx)} className="text-gray-400 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-red-50"><FaTrash className="text-sm" /></button>
                            </div>
                          ))}
                        </div>
                        <label
                          {...caseDropProps('role_packet', (file) => handleRolePacketUpload(file))}
                          className={`w-full py-3 border-2 rounded-xl transition-all font-bold text-sm flex items-center justify-center cursor-pointer active:scale-[0.99] ${
                            mgrDragTarget === 'role_packet'
                              ? 'border-solid border-[#FA6C43] bg-[#F9D0C4]/20 text-[#FA6C43]'
                              : 'border-dashed border-gray-300 text-gray-500 hover:bg-[#F9D0C4]/10 hover:text-[#FA6C43] hover:border-[#FA6C43]/50'
                          }`}
                        >
                          <FaPlus className="mr-2" /> Add a role packet
                          <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => handleRolePacketUpload(e.target.files?.[0])} />
                        </label>
                      </div>
                    )}
                  </div>

                  {mgrUploading && <p className="text-xs font-medium text-gray-500">Uploading…</p>}
                  {mgrUploadError && <p className="text-xs font-medium text-red-500">{mgrUploadError}</p>}
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
                      // Rubric-doc import: adopt the AI-suggested name/intro only
                      // where the prof hasn't already typed their own.
                      onMeta={({ bot_name, introduction }) =>
                        setConfig(prev => ({
                          ...prev,
                          bot_name: prev.bot_name?.trim() ? prev.bot_name : (bot_name || prev.bot_name),
                          introduction: prev.introduction?.trim() ? prev.introduction : (introduction || prev.introduction),
                        }))}
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
                  // MANAGER EXERCISE — review the derived case pack
                  // ==============================
                  <>
                    <h2 className="text-2xl font-bold text-center text-[#222] mb-2">Review the case</h2>
                    <p className="text-center text-sm text-gray-500 mb-6">ACTR works out who holds what, what pools together, and which candidate the pooled evidence favours. Check it now — a wrong answer key is invisible once the exercise is running.</p>

                    {!mePack ? (
                      <div className="bg-gray-50 p-8 rounded-2xl border border-gray-100 text-center">
                        <p className="text-sm text-gray-500 mb-4">The uploaded documents haven't been analysed yet.</p>
                        <button type="button" onClick={analyzeCase} disabled={packLoading} className="inline-flex items-center gap-2 rounded-xl bg-[#FA6C43] hover:bg-[#E55B34] text-white font-bold px-5 py-3 text-sm shadow-sm disabled:opacity-50 transition-all active:scale-95">
                          {packLoading ? 'Analysing…' : 'Analyse the case'}
                        </button>
                        {packError && <p className="text-xs font-medium text-red-500 mt-3">{packError}</p>}
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {/* Cross-check against totals the document states for itself.
                            A tally that disagrees is invisible once the exercise is
                            running, so it gets said loudly here. */}
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

                        {/* Pooled tally, counted server-side from the extracted items —
                            exactly the numbers the facilitator will steer by. */}
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

                        {/* The answer key. Overridable because extraction can miss an
                            item and the professor has actually read the case. */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Strongest candidate<InfoTip text="Derived from the pooled tally: most distinct strengths, fewest distinct concerns. ACTR never states this — it steers students until they count it themselves. Override only if the analysis got it wrong." /></label>
                          <select value={mePack.answer_key?.best_option || ''} onChange={(e) => setBestOption(e.target.value)} className="w-full p-2.5 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-[#FA6C43] transition-all">
                            {(mePack.options || []).map((o, i) => <option key={i} value={o.name}>{o.name}</option>)}
                          </select>
                          {mePack.answer_key?.best_option_locked && <p className="text-[11px] font-semibold text-[#C2410C] mt-2">Set manually — the tally no longer decides this.</p>}
                          {mePack.answer_key?.mechanism && <p className="text-[11px] text-gray-500 mt-3 leading-relaxed"><span className="font-bold uppercase tracking-wider text-gray-400">The trap: </span>{mePack.answer_key.mechanism}</p>}
                        </div>

                        {/* Every pair of wordings judged to be the same fact, and so
                            counted once. This is the only place the tally loses items,
                            so it is the only place worth auditing. Untick to split. */}
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
                                      <label key={m.id} className="flex items-start gap-3 py-2 border-t border-gray-100 cursor-pointer group">
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

                        {(mePack.answer_key?.tension_pairs || []).length > 0 && (
                          <div className="bg-white p-5 rounded-2xl border border-gray-200">
                            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">Strength or concern? (left unresolved on purpose)</h4>
                            {mePack.answer_key.tension_pairs.map((t, i) => (
                              <div key={i} className="mb-2 last:mb-0">
                                <p className="text-xs font-bold text-[#222]">{t.option}</p>
                                <p className="text-[11px] text-gray-500">"{t.strength}" vs "{t.concern}" — {t.note}</p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Keep this case for the next cohort. Everything above is
                            cohort-independent, so only group size, rooms and the
                            class code will need setting next time. */}
                        <div className="bg-gray-50 p-5 rounded-2xl border border-gray-100">
                          <label className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700 mb-2">Save this case for reuse<InfoTip text="Stores the documents and this approved analysis under a name. Next time, pick it in Setup and you only need to set the group size, breakout rooms and class code. Reusing one of your own names replaces that case; you can never overwrite someone else's." /></label>
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
                              picker in Setup — this is only the starting choice. */}
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
                            onChange={(e) => { facilitatorTouchedRef.current = true; setConfig(prev => ({ ...prev, facilitator: { ...(prev.facilitator || {}), enabled: e.target.checked } })); }}
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
                
                {isChatLike(config.bot_type) && (
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

                {isChatLike(config.bot_type) && (
                  <div>
                    <label className="block text-[13px] font-semibold text-gray-700 mb-1.5">Introduction Message</label>
                    <textarea name="introduction" value={config.introduction} onChange={handleChange} rows="2" className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-[#FA6C43]" placeholder="e.g., Welcome to the class!" />
                  </div>
                )}

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
                  {config.is_public && (
                    <div className="mt-3">
                      <label className="block text-[13px] font-semibold text-gray-700 mb-2">What is this link for?</label>
                      <div className="flex border border-gray-200 rounded-xl overflow-hidden bg-white">
                        {[
                          { id: 'learning', title: 'Learning', hint: 'Asks for name & email' },
                          { id: 'research', title: 'Research', hint: 'No sign-up, no branding, no cap' },
                        ].map(o => (
                          <label key={o.id} className={`flex-1 flex items-center justify-center p-3 cursor-pointer transition-all ${config.public_purpose === o.id ? 'bg-[#F9D0C4]/20' : 'hover:bg-gray-50'}`}>
                            <input type="radio" name="public_purpose" checked={config.public_purpose === o.id} onChange={() => setConfig(prev => ({ ...prev, public_purpose: o.id }))} className="mr-2 text-[#FA6C43] focus:ring-[#FA6C43]" />
                            <div className="text-sm"><span className="block font-bold text-[#222]">{o.title}</span><span className="text-xs text-gray-500 font-medium">{o.hint}</span></div>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
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
