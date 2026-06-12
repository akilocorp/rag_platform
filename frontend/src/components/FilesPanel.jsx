import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FiUpload,
  FiChevronRight,
  FiTrash2,
  FiPlus,
  FiLoader,
  FiLink,
  FiFolder,
  FiX,
} from 'react-icons/fi';
import {
  FaFolder,
  FaFilePdf,
  FaFilePowerpoint,
  FaFileWord,
  FaFileAlt,
  FaFileCode,
  FaLink,
} from 'react-icons/fa';

const BRAND_ORANGE = '#FA6C43';
const BRAND_ORANGE_DEEP = '#E55B34';
const BRAND_BLUE = '#2D6CDF';
const BRAND_BLUE_SOFT = '#5B7CAF';
const SOFT_BG = '#F0F6FB';

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const extOf = (filename = '') => {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : '';
};

const TYPE_ICON = {
  pdf:  { Icon: FaFilePdf,        color: BRAND_BLUE },
  pptx: { Icon: FaFilePowerpoint, color: BRAND_ORANGE },
  ppt:  { Icon: FaFilePowerpoint, color: BRAND_ORANGE },
  docx: { Icon: FaFileWord,       color: BRAND_BLUE },
  doc:  { Icon: FaFileWord,       color: BRAND_BLUE },
  txt:  { Icon: FaFileAlt,        color: BRAND_BLUE_SOFT },
  md:   { Icon: FaFileCode,       color: BRAND_BLUE_SOFT },
};

const TypeIcon = ({ ext }) => {
  const meta = TYPE_ICON[ext] || { Icon: FaFileAlt, color: BRAND_BLUE_SOFT };
  const Icon = meta.Icon;
  return (
    <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
      <Icon className="w-7 h-7" style={{ color: meta.color }} />
    </div>
  );
};

const FolderBadge = () => (
  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
    <FaFolder className="w-7 h-7" style={{ color: BRAND_BLUE }} />
  </div>
);

const UrlBadge = () => (
  <div className="w-8 h-8 flex items-center justify-center flex-shrink-0">
    <FaLink className="w-6 h-6" style={{ color: BRAND_ORANGE }} />
  </div>
);

// Direct children of `parent` among the full folder-paths list.
const childrenOf = (allFolders, parent) => {
  const prefix = parent ? `${parent}/` : '';
  const parentDepth = parent ? parent.split('/').length : 0;
  return allFolders
    .filter((p) => (parent ? p.startsWith(prefix) : true))
    .filter((p) => p.split('/').length === parentDepth + 1);
};

const folderLeaf = (path) => (path.includes('/') ? path.split('/').pop() : path);

// Resolve currentPath → view descriptor.
// currentPath is "" (personal library root) | "<sub>/<path>" (personal subfolder)
// | "bots" | "bots/<id>(/sub/path)".
// The "bots" segment is a reserved namespace; everything else is the user's
// personal library at the root level (Bot Files appears as a sibling virtual
// folder at root only).
const resolveView = (currentPath, accessibleConfigs) => {
  const parts = currentPath ? currentPath.split('/') : [];
  const head = parts[0];

  if (head === 'bots') {
    if (parts.length === 1) {
      return {
        kind: 'bots-list',
        breadcrumbs: [
          { label: 'Files', path: '' },
          { label: 'Bot Files', path: 'bots' },
        ],
        virtualRows: (accessibleConfigs || []).map((c) => ({
          key: `bots/${c._id}`,
          label: c.bot_name,
          icon: 'folder',
          meta: c.can_upload ? 'Owner' : 'Read-only',
        })),
        canUpload: false,
      };
    }
    const cid = parts[1];
    const cfg = (accessibleConfigs || []).find((c) => c._id === cid);
    const subParts = parts.slice(2);
    const crumbs = [
      { label: 'Files', path: '' },
      { label: 'Bot Files', path: 'bots' },
      { label: cfg?.bot_name || 'Bot', path: `bots/${cid}` },
    ];
    let acc = `bots/${cid}`;
    subParts.forEach((seg) => {
      acc += `/${seg}`;
      crumbs.push({ label: seg, path: acc });
    });
    return {
      kind: 'bot',
      breadcrumbs: crumbs,
      configId: cid,
      folderPath: subParts.join('/'),
      botName: cfg?.bot_name || 'Bot',
      canUpload: !!cfg?.can_upload,
    };
  }

  // Personal library — root or subfolder. Bot Files virtual row only appears
  // at the root, so it's always present in every user's Files tab without
  // adding a circular "My Files" breadcrumb segment.
  const crumbs = [{ label: 'Files', path: '' }];
  let acc = '';
  parts.forEach((seg) => {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ label: seg, path: acc });
  });
  return {
    kind: 'me',
    breadcrumbs: crumbs,
    configId: null,
    folderPath: parts.join('/'),
    canUpload: true,
    virtualRows: currentPath === ''
      ? [{ key: 'bots', label: 'Bot Files', icon: 'folder', meta: '' }]
      : [],
  };
};

const FilesPanel = ({
  // Path model (replaces currentFolder)
  currentPath = '',
  onSetPath,
  // Data
  accessibleConfigs = [],
  files = [],
  folders = [],
  // State
  isLoading = false,
  isUploading = false,
  uploadError = null,
  // Write actions (parent routes them with the right config_id)
  onUpload,
  onDeleteFile,
  onCreateFolder,
  onDeleteFolder,
  onFetchUrl,
  isFetchingUrl = false,
  // Selection (only allowed when canSelect is true)
  canSelect = false,
  selectedFileIds = [],
  onToggleFile,
}) => {
  const view = useMemo(() => resolveView(currentPath, accessibleConfigs), [currentPath, accessibleConfigs]);

  const fileInputRef = useRef(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMode, setAddMode] = useState('file'); // 'file' | 'url' | 'folder'
  const [urlInput, setUrlInput] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [removingIds, setRemovingIds] = useState(() => new Set());
  const [removingFolderPaths, setRemovingFolderPaths] = useState(() => new Set());

  useEffect(() => {
    if (!addMenuOpen) return;
    const onClickOutside = () => setAddMenuOpen(false);
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, [addMenuOpen]);

  const openAddMode = (mode) => {
    setAddMode(mode);
    setAddPanelOpen(true);
    setAddMenuOpen(false);
  };

  const canUpload = view.canUpload;

  // ---- file/folder rows for non-virtual views ----
  const visibleFiles = view.kind === 'bot' || view.kind === 'me'
    ? files.filter((f) => (f.folder_path || '') === (view.folderPath || ''))
    : [];

  const visibleFolders = view.kind === 'bot' || view.kind === 'me'
    ? childrenOf(folders, view.folderPath || '')
    : [];

  // ---- handlers ----
  const handlePicked = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) onUpload?.(picked);
    e.target.value = '';
  };
  const submitNewFolder = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const base = view.folderPath || '';
    const path = base ? `${base}/${trimmed}` : trimmed;
    onCreateFolder?.(path);
    setNewFolderName('');
    setAddPanelOpen(false);
  };
  const handleUrlSubmit = () => {
    const trimmed = urlInput.trim();
    if (!trimmed || !onFetchUrl) return;
    onFetchUrl(trimmed);
    setUrlInput('');
    setAddPanelOpen(false);
  };

  const handleDeleteFile = (e, file) => {
    e.stopPropagation();
    if (removingIds.has(file._id)) return;
    setRemovingIds((prev) => new Set(prev).add(file._id));
    setTimeout(async () => {
      try { await onDeleteFile?.(file._id); }
      catch {
        setRemovingIds((prev) => { const n = new Set(prev); n.delete(file._id); return n; });
      }
    }, 220);
  };

  const handleDeleteFolder = (e, path) => {
    e.stopPropagation();
    if (removingFolderPaths.has(path)) return;
    setRemovingFolderPaths((prev) => new Set(prev).add(path));
    setTimeout(async () => {
      try { await onDeleteFolder?.(path); }
      catch (err) {
        if (err?.response?.status === 409) {
          alert('Folder is not empty — delete the files inside first.');
        }
        setRemovingFolderPaths((prev) => { const n = new Set(prev); n.delete(path); return n; });
      }
    }, 220);
  };

  const goToVirtual = (key) => onSetPath?.(key);

  // ---- render ----
  return (
    <div className="flex flex-col gap-3 pr-1">
      {/* Always-mounted hidden file input so the picker can be triggered without opening any panel */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handlePicked}
        accept=".pdf,.txt,.md,.docx,.pptx"
      />
      {/* Breadcrumb header + Add pill */}
      <div className={`flex items-center gap-2 ${view.breadcrumbs.length > 1 ? 'justify-between' : 'justify-end'}`}>
        {view.breadcrumbs.length > 1 && (
          <div className="flex items-center gap-1 flex-1 min-w-0 text-[12px] text-gray-500">
            {view.breadcrumbs.map((c, i) => {
              const isLast = i === view.breadcrumbs.length - 1;
              return (
                <React.Fragment key={`${c.path}-${i}`}>
                  {i > 0 && <FiChevronRight className="w-3 h-3 text-gray-300 flex-shrink-0" />}
                  <button
                    onClick={() => onSetPath?.(c.path)}
                    className={`truncate hover:text-[${BRAND_ORANGE}] transition-colors ${isLast ? 'text-[#222] font-semibold' : ''}`}
                    style={isLast ? {} : undefined}
                    title={c.label}
                  >
                    {c.label}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        )}
        {canUpload && (
          <div className="relative flex-shrink-0">
            <button
              onClick={(e) => { e.stopPropagation(); setAddMenuOpen((v) => !v); }}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white shadow-sm transition-colors"
              style={{ backgroundColor: addMenuOpen ? '#9CA3AF' : BRAND_ORANGE }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = addMenuOpen ? '#6B7280' : BRAND_ORANGE_DEEP)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = addMenuOpen ? '#9CA3AF' : BRAND_ORANGE)}
              title="Add files, folder, or link"
            >
              <FiPlus
                className={`w-3.5 h-3.5 transition-transform duration-200 ease-out ${addMenuOpen ? 'rotate-45' : ''}`}
              />
            </button>
            {addMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute right-0 top-full mt-1.5 w-40 bg-white border border-gray-200 rounded-xl shadow-xl py-1 z-50"
              >
                <button
                  onClick={() => {
                    setAddMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                  className="w-full px-3 py-2 text-left text-xs text-[#222] hover:bg-[#F0F6FB] flex items-center gap-2 transition-colors"
                >
                  <FiUpload className="w-3.5 h-3.5 text-gray-500" />
                  Add files
                </button>
                <button
                  onClick={() => openAddMode('folder')}
                  className="w-full px-3 py-2 text-left text-xs text-[#222] hover:bg-[#F0F6FB] flex items-center gap-2 transition-colors"
                >
                  <FiFolder className="w-3.5 h-3.5 text-gray-500" />
                  Add folder
                </button>
                <button
                  onClick={() => openAddMode('url')}
                  className="w-full px-3 py-2 text-left text-xs text-[#222] hover:bg-[#F0F6FB] flex items-center gap-2 transition-colors"
                >
                  <FiLink className="w-3.5 h-3.5 text-gray-500" />
                  Add link
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add panel */}
      {canUpload && addPanelOpen && (
        <div className="rounded-2xl border border-gray-200 bg-white p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold text-gray-500">
              {addMode === 'file' ? 'Add files' : addMode === 'folder' ? 'Add folder' : 'Add link'}
            </span>
            <button
              onClick={() => setAddPanelOpen(false)}
              className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title="Close"
            >
              <FiX className="w-3 h-3" />
            </button>
          </div>

          {addMode === 'url' && (
            <div className="flex flex-col gap-2">
              <input
                type="url"
                placeholder="https://example.com/article"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
                style={{ '--tw-ring-color': BRAND_ORANGE }}
              />
              <button
                onClick={handleUrlSubmit}
                disabled={!urlInput.trim() || isFetchingUrl}
                className="flex items-center justify-center gap-2 py-2 px-3 text-xs font-semibold text-white rounded-xl disabled:opacity-50 transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
              >
                {isFetchingUrl ? <FiLoader className="w-3.5 h-3.5 animate-spin" /> : <FiLink className="w-3.5 h-3.5" />}
                {isFetchingUrl ? 'Fetching…' : 'Fetch & Ingest'}
              </button>
            </div>
          )}

          {addMode === 'folder' && (
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitNewFolder();
                  if (e.key === 'Escape') { setNewFolderName(''); setAddPanelOpen(false); }
                }}
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none"
              />
              <button
                onClick={submitNewFolder}
                className="px-3 py-2 text-xs font-semibold text-white rounded-xl transition-colors"
                style={{ backgroundColor: BRAND_ORANGE }}
              >Add</button>
            </div>
          )}
        </div>
      )}

      {uploadError && <p className="text-xs text-red-500 px-1">{uploadError}</p>}

      {/* Body */}
      {isLoading && (view.kind === 'bot' || view.kind === 'me') ? (
        <div className="flex items-center justify-center py-8">
          <FiLoader className="w-5 h-5 animate-spin" style={{ color: BRAND_ORANGE }} />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {/* Virtual rows (Bot Files at personal root, or bots-list) */}
          {view.virtualRows && view.virtualRows.length > 0 &&
            view.virtualRows.map((row) => (
              <button
                key={row.key}
                onClick={() => goToVirtual(row.key)}
                className="group flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-gray-100 hover:border-gray-200 text-sm text-[#222] transition-all text-left w-full"
              >
                <FolderBadge />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px] font-medium">{row.label}</p>
                  {row.meta && (
                    <p className="truncate text-[10px] text-gray-500 mt-0.5">{row.meta}</p>
                  )}
                </div>
                <FiChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            ))}

          {view.kind === 'bots-list' && view.virtualRows.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">
              No bots yet. Start a chat with a bot to see its files here.
            </p>
          )}

          {/* Real folder rows */}
          {(view.kind === 'bot' || view.kind === 'me') && visibleFolders.map((path) => {
            const isRemoving = removingFolderPaths.has(path);
            const nextPath = view.kind === 'bot'
              ? `bots/${view.configId}/${path}`
              : path;
            return (
              <div
                key={path}
                className={`transition-all duration-200 ease-out ${
                  isRemoving ? 'opacity-0 max-h-0 -translate-x-2 overflow-hidden' : 'opacity-100 max-h-32'
                }`}
              >
                <div className="group relative flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-gray-100 hover:border-gray-200 text-sm text-[#222] transition-all">
                  <button
                    onClick={() => onSetPath?.(nextPath)}
                    disabled={isRemoving}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <FolderBadge />
                    <span className="flex-1 truncate text-[13px] font-medium">{folderLeaf(path)}</span>
                  </button>
                  <FiChevronRight className="w-4 h-4 text-gray-400 transition-opacity group-hover:opacity-0" />
                  {canUpload && (
                    <button
                      onClick={(e) => handleDeleteFolder(e, path)}
                      disabled={isRemoving}
                      title="Delete folder"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-opacity p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {/* File rows */}
          {(view.kind === 'bot' || view.kind === 'me') && visibleFiles.map((f) => {
            const isSelected = selectedFileIds.includes(f._id);
            const isPending = f.vector_ingested === false;
            const stage = f.progress?.stage;
            const isOcr = isPending && stage === 'ocr';
            const isBatchOcr = isOcr && f.progress?.batch;
            const isIngesting = isPending && stage === 'ingesting';
            const pendingLabel = isBatchOcr
              ? `Reading ${f.progress.pages} pages of images — this can take a few minutes`
              : isOcr
                ? 'Reading images in your PDF'
                : isIngesting
                  ? 'Indexing extracted text'
                  : 'Preparing your file';
            const isRemoving = removingIds.has(f._id);
            const ext = extOf(f.filename || '');
            const clickable = canSelect && onToggleFile && !isPending && !isRemoving;
            return (
              <div
                key={f._id}
                className={`transition-all duration-200 ease-out ${
                  isRemoving ? 'opacity-0 max-h-0 -translate-x-2 overflow-hidden' : 'opacity-100 max-h-32'
                }`}
              >
                <div
                  onClick={clickable ? () => onToggleFile(f._id) : undefined}
                  title={isPending ? pendingLabel : undefined}
                  className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm text-[#222] transition-all ${
                    clickable ? 'cursor-pointer' : ''
                  } ${isPending ? 'opacity-60' : ''} ${
                    isSelected
                      ? 'bg-[#F9D0C4]/30'
                      : 'bg-white border-gray-100 hover:border-gray-200'
                  }`}
                  style={isSelected ? { borderColor: `${BRAND_ORANGE}66` } : undefined}
                >
                  {isPending
                    ? <FiLoader className="w-8 h-8 p-2 animate-spin flex-shrink-0" style={{ color: BRAND_ORANGE }} />
                    : f.is_url
                      ? <UrlBadge />
                      : <TypeIcon ext={ext} />}

                  <div className="flex-1 min-w-0">
                    <p className={`truncate text-[13px] ${isPending ? 'animate-pulse' : ''}`}>{f.filename}</p>
                    {isPending ? (
                      <div className="mt-0.5" title={pendingLabel}>
                        <div className="flex items-center gap-1.5 text-[10px]" style={{ color: BRAND_ORANGE }}>
                          <span className="truncate">{pendingLabel}</span>
                          <span className="flex gap-0.5 flex-shrink-0">
                            <span className="w-1 h-1 rounded-full animate-bounce [animation-delay:-0.3s]" style={{ backgroundColor: BRAND_ORANGE }} />
                            <span className="w-1 h-1 rounded-full animate-bounce [animation-delay:-0.15s]" style={{ backgroundColor: BRAND_ORANGE }} />
                            <span className="w-1 h-1 rounded-full animate-bounce" style={{ backgroundColor: BRAND_ORANGE }} />
                          </span>
                        </div>
                        {(isOcr || isIngesting) && (
                          <div className="flex items-center gap-1 mt-1.5 max-w-[120px]">
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: BRAND_ORANGE, opacity: isOcr ? 1 : 1 }} />
                            <span className="flex-1 h-px" style={{ backgroundColor: isIngesting ? BRAND_ORANGE : '#D1D5DB' }} />
                            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: isIngesting ? BRAND_ORANGE : '#D1D5DB' }} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <p
                        className="truncate text-[10px] text-gray-500 mt-0.5"
                        title={f.is_url ? (f.source_url || '') : ''}
                      >
                        {f.is_url ? (f.source_url || 'URL') : formatSize(f.size_bytes)}
                      </p>
                    )}
                  </div>

                  {canUpload && (
                    <button
                      onClick={(e) => handleDeleteFile(e, f)}
                      disabled={isRemoving}
                      title="Delete file"
                      className="transition-opacity p-1.5 rounded-lg opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 hover:bg-red-50"
                    >
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {(view.kind === 'bot' || view.kind === 'me')
            && visibleFiles.length === 0
            && visibleFolders.length === 0
            && (!view.virtualRows || view.virtualRows.length === 0) && (
            <p className="text-xs text-gray-400 text-center py-6">
              {canUpload
                ? 'This folder is empty. Use “+ Add New” to upload.'
                : 'This folder is empty.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FilesPanel;
