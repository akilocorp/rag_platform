import React from 'react';
import { FaMicrophone, FaMicrophoneSlash, FaSpinner } from 'react-icons/fa';

/**
 * MicButton — sits next to the chat send button.
 *
 * Props:
 *   isConnected  — EVI WS connected
 *   status       — 'disconnected' | 'connecting' | 'connected' | 'error'
 *   onConnect    — start voice session
 *   onDisconnect — end voice session
 *   muted, onMute, onUnmute
 *   disabled
 */
const MicButton = ({
  isConnected,
  status,
  onConnect,
  onDisconnect,
  muted,
  onMute,
  onUnmute,
  disabled,
}) => {
  const isConnecting = status === 'connecting';

  const handleClick = () => {
    if (isConnecting) return;
    if (!isConnected) {
      onConnect?.();
      return;
    }
    if (muted) onUnmute?.();
    else onMute?.();
  };

  const handleStop = (e) => {
    e.stopPropagation();
    onDisconnect?.();
  };

  let label;
  let bg;
  let icon;

  if (isConnecting) {
    label = 'Connecting…';
    bg = 'bg-gray-200 text-gray-500';
    icon = <FaSpinner className="text-lg animate-spin" />;
  } else if (!isConnected) {
    label = 'Start voice';
    bg = 'bg-white border border-gray-200 hover:bg-[#FFF5F2] text-gray-600 hover:text-[#FA6C43]';
    icon = <FaMicrophone className="text-lg" />;
  } else if (muted) {
    label = 'Unmute';
    bg = 'bg-white border border-[#FA6C43] text-[#FA6C43]';
    icon = <FaMicrophoneSlash className="text-lg" />;
  } else {
    label = 'Listening';
    bg = 'bg-[#FA6C43] hover:bg-[#E55B34] text-white animate-pulse';
    icon = <FaMicrophone className="text-lg" />;
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isConnecting}
        title={label}
        className={`min-h-[52px] px-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-50 ${bg}`}
      >
        {icon}
      </button>
      {isConnected && (
        <button
          type="button"
          onClick={handleStop}
          title="End voice session"
          className="min-h-[52px] px-3 rounded-2xl border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 text-xs font-semibold shrink-0"
        >
          End
        </button>
      )}
    </div>
  );
};

export default MicButton;
