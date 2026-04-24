import React, { useRef, useState } from 'react';
import {
  FiUpload,
  FiChevronLeft,
  FiChevronRight,
  FiFile,
  FiFolder,
  FiTrash2,
  FiPlus,
  FiLoader,
} from 'react-icons/fi';

const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const childrenOf = (allFolders, parent) => {
  // Direct children only (depth = parent depth + 1).
  const prefix = parent ? `${parent}/` : '';
  const parentDepth = parent ? parent.split('/').length : 0;
  return allFolders
    .filter((p) => (parent ? p.startsWith(prefix) : true))
    .filter((p) => p.split('/').length === parentDepth + 1);
};

const folderDisplayName = (path) => (path.includes('/') ? path.split('/').pop() : path);

const FilesPanel = ({
  currentFolder,
  onSetFolder,
  files,
  folders,
  isLoading,
  isUploading,
  uploadError,
  onUpload,
  onDeleteFile,
  onCreateFolder,
  onDeleteFolder,
  // Variant A: selectable files
  selectable = false,
  selectedFileIds = [],
  onToggleFile,
  // Variant B: custom label
  libraryLabel = 'My Library',
}) => {
  const fileInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const visibleFiles = files.filter((f) => (f.folder_path || '') === currentFolder);
  const visibleFolders = childrenOf(folders, currentFolder);

  const handlePickClick = () => fileInputRef.current?.click();

  const handlePicked = (e) => {
    const picked = Array.from(e.target.files || []);
    if (picked.length) onUpload(picked, currentFolder);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) onUpload(dropped, currentFolder);
  };

  const submitNewFolder = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    const path = currentFolder ? `${currentFolder}/${trimmed}` : trimmed;
    onCreateFolder(path);
    setNewFolderName('');
    setShowNewFolder(false);
  };

  return (
    <div className="flex flex-col gap-3 pr-1">
      {/* Upload zone */}
      <div
        onClick={handlePickClick}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`cursor-pointer border-2 border-dashed rounded-2xl py-6 px-3 flex flex-col items-center justify-center transition-all text-center ${
          isDragOver
            ? 'border-[#FA6C43] bg-[#F9D0C4]/30'
            : 'border-gray-200 bg-[#F0F6FB]/60 hover:border-[#FA6C43]/50'
        }`}
      >
        {isUploading ? (
          <FiLoader className="w-5 h-5 text-[#FA6C43] animate-spin mb-2" />
        ) : (
          <FiUpload className="w-5 h-5 text-gray-500 mb-2" />
        )}
        <p className="text-xs text-gray-500 leading-snug">
          {isUploading ? 'Uploading…' : 'Drag & drop or click to upload'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handlePicked}
          accept=".pdf,.txt,.md,.docx"
        />
      </div>

      {uploadError && (
        <p className="text-xs text-red-500 px-1">{uploadError}</p>
      )}

      {/* Back / New Folder row */}
      <div className="flex items-center gap-2">
        {currentFolder ? (
          <button
            onClick={() => {
              const parent = currentFolder.includes('/')
                ? currentFolder.slice(0, currentFolder.lastIndexOf('/'))
                : '';
              onSetFolder(parent);
            }}
            className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-sm text-[#222] transition-all"
          >
            <FiChevronLeft className="w-4 h-4 text-gray-500" />
            Back
          </button>
        ) : (
          <div className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 px-2">
            {libraryLabel}
          </div>
        )}
        <button
          onClick={() => setShowNewFolder((v) => !v)}
          title="New folder"
          className="p-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-[#FA6C43] transition-colors"
        >
          <FiPlus className="w-4 h-4" />
        </button>
      </div>

      {/* New folder input */}
      {showNewFolder && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            autoFocus
            placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewFolder();
              if (e.key === 'Escape') {
                setShowNewFolder(false);
                setNewFolderName('');
              }
            }}
            className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-xl bg-white focus:outline-none focus:border-[#FA6C43]"
          />
          <button
            onClick={submitNewFolder}
            className="px-3 py-2 text-xs font-semibold bg-[#FA6C43] text-white rounded-xl hover:bg-[#E55B34] transition-colors"
          >
            Add
          </button>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <FiLoader className="w-5 h-5 text-[#FA6C43] animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {visibleFolders.map((path) => (
            <div key={path} className="group relative">
              <button
                onClick={() => onSetFolder(path)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white border border-gray-100 hover:border-gray-200 text-sm text-[#222] transition-all"
              >
                <FiFolder className="w-4 h-4 text-[#FA6C43] flex-shrink-0" />
                <span className="flex-1 text-left truncate">{folderDisplayName(path)}</span>
                <FiChevronRight className="w-4 h-4 text-gray-400" />
              </button>
            </div>
          ))}

          {visibleFiles.map((f) => {
            const isSelected = selectedFileIds.includes(f._id);
            return (
              <div
                key={f._id}
                onClick={selectable && onToggleFile ? () => onToggleFile(f._id) : undefined}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm text-[#222] transition-all ${
                  selectable ? 'cursor-pointer' : ''
                } ${
                  isSelected
                    ? 'bg-[#F9D0C4]/30 border-[#FA6C43]/40'
                    : 'bg-white border-gray-100 hover:border-gray-200'
                }`}
              >
                {selectable && (
                  <div className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                    isSelected ? 'bg-[#FA6C43] border-[#FA6C43]' : 'border-gray-300'
                  }`}>
                    {isSelected && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 10"><path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  </div>
                )}
                <FiFile className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-[13px]">{f.filename}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{formatSize(f.size_bytes)}</p>
                </div>
                {!selectable && (
                  <button
                    onClick={() => onDeleteFile(f._id)}
                    title="Delete file"
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50"
                  >
                    <FiTrash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}

          {visibleFiles.length === 0 && visibleFolders.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-6">
              {currentFolder ? 'This folder is empty.' : 'No files yet. Drop files above to get started.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FilesPanel;
