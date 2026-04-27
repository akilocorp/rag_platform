import React, { useState } from 'react';
import {
  FiSearch,
  FiBookOpen,
  FiLink,
  FiAlertCircle,
  FiLoader,
  FiChevronDown,
  FiChevronUp,
} from 'react-icons/fi';

const TOOL_META = {
  search_knowledge_base: {
    Icon: FiBookOpen,
    doneVerb: 'Searched files',
    pendingVerb: 'Searching files',
    inputKey: 'query',
  },
  web_search: {
    Icon: FiSearch,
    doneVerb: 'Searched web',
    pendingVerb: 'Searching web',
    inputKey: 'query',
  },
  web_fetch: {
    Icon: FiLink,
    doneVerb: 'Read',
    pendingVerb: 'Reading',
    inputKey: 'url',
    formatLabel: (url) => {
      try {
        return new URL(url).hostname;
      } catch {
        return url;
      }
    },
  },
};

const FALLBACK_META = {
  Icon: FiSearch,
  doneVerb: 'Used tool',
  pendingVerb: 'Calling tool',
  inputKey: null,
};

const ToolStatusPill = ({ toolCall }) => {
  const [expanded, setExpanded] = useState(false);
  const meta = TOOL_META[toolCall.name] || FALLBACK_META;
  const isDone = toolCall.result !== undefined;
  const isError = !!toolCall.is_error;

  const Icon = isError ? FiAlertCircle : meta.Icon;
  const verb = isDone ? meta.doneVerb : meta.pendingVerb;
  const rawInput = meta.inputKey ? toolCall.input?.[meta.inputKey] : '';
  const label = rawInput && meta.formatLabel ? meta.formatLabel(rawInput) : rawInput;

  const colorClass = isError
    ? 'bg-red-50 text-red-700 border-red-200'
    : 'bg-[#F0F6FB] text-[#222] border-gray-200';
  const iconColor = isError ? 'text-red-500' : 'text-[#FA6C43]';

  return (
    <div className={`mb-2 rounded-xl border ${colorClass} overflow-hidden`}>
      <button
        type="button"
        onClick={() => isDone && setExpanded((v) => !v)}
        disabled={!isDone}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left ${
          isDone ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'
        }`}
      >
        {!isDone ? (
          <FiLoader className={`w-3.5 h-3.5 ${iconColor} animate-spin shrink-0`} />
        ) : (
          <Icon className={`w-3.5 h-3.5 ${iconColor} shrink-0`} />
        )}
        <span className="shrink-0">{verb}:</span>
        {label && <span className="italic truncate min-w-0 text-gray-600">{label}</span>}
        {isDone && (
          <span className="ml-auto shrink-0 text-gray-400">
            {expanded ? <FiChevronUp className="w-3 h-3" /> : <FiChevronDown className="w-3 h-3" />}
          </span>
        )}
      </button>
      {expanded && toolCall.result !== undefined && (
        <div className="px-3 py-2 border-t border-gray-200 bg-white max-h-56 overflow-y-auto">
          <pre className="text-[11px] text-gray-600 whitespace-pre-wrap break-words font-mono leading-relaxed">
            {toolCall.result && toolCall.result.length > 1500
              ? toolCall.result.slice(0, 1500) + '\n…[truncated]'
              : toolCall.result || '(no content)'}
          </pre>
        </div>
      )}
    </div>
  );
};

export default ToolStatusPill;
