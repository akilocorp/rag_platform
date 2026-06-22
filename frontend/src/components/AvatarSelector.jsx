import React from 'react';
import {
  RiRobot2Line,
  RiChatSmile3Line,
  RiUserSmileLine,
  RiCustomerService2Line,
  RiSparklingLine,
  RiMagicLine,
  RiBrain2Line,
  RiLightbulbLine,
  RiRocketLine,
  RiStarSmileLine,
  RiChatHeartLine,
  RiShieldCheckLine,
  RiCloseLine
} from 'react-icons/ri';

export const AVATAR_OPTIONS = [
  { id: 'none', icon: RiCloseLine, name: 'None' },
  { id: 'robot', icon: RiRobot2Line, name: 'Robot' },
  { id: 'smile', icon: RiChatSmile3Line, name: 'Friendly' },
  { id: 'user', icon: RiUserSmileLine, name: 'Personal' },
  { id: 'support', icon: RiCustomerService2Line, name: 'Support' },
  { id: 'sparkle', icon: RiSparklingLine, name: 'Sparkle' },
  { id: 'magic', icon: RiMagicLine, name: 'Magic' },
  { id: 'brain', icon: RiBrain2Line, name: 'Smart' },
  { id: 'lightbulb', icon: RiLightbulbLine, name: 'Bright' },
  { id: 'rocket', icon: RiRocketLine, name: 'Fast' },
  { id: 'star', icon: RiStarSmileLine, name: 'Star' },
  { id: 'heart', icon: RiChatHeartLine, name: 'Care' },
  { id: 'shield', icon: RiShieldCheckLine, name: 'Secure' },
];

/** Icon component for chat / list UI; null when user chose "None", "", or null */
export function getBotAvatarIconComponent(botAvatarId) {
  if (!botAvatarId || botAvatarId === 'none' || botAvatarId === '') {
    return null;
  }
  const entry = AVATAR_OPTIONS.find((a) => a.id === botAvatarId);
  return entry ? entry.icon : RiRobot2Line;
}

const AvatarSelector = ({
  selectedAvatar,
  onSelect,
  /** Default "Bot Avatar"; pass null or "" to hide the title row (e.g. when parent provides a label) */
  label = 'Bot Avatar',
  hint = "Pick an icon that fits this bot",
}) => {
  const currentSelection = (!selectedAvatar || selectedAvatar === '' || selectedAvatar === 'none')
    ? 'none'
    : selectedAvatar;

  return (
    <div>
      {label != null && label !== '' && (
        <label className="block text-[13px] font-semibold text-gray-700 mb-2">
          {label}
        </label>
      )}
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3 p-1 -m-1">
        {AVATAR_OPTIONS.map((avatar, i) => {
          const Icon = avatar.icon;
          const isSelected = currentSelection === avatar.id;

          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onSelect(avatar.id)}
              style={{
                color: '#1F1F1F',
                animation: `chip-in 0.22s cubic-bezier(0.32, 0.72, 0, 1) ${i * 22}ms both`,
              }}
              className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all ${
                isSelected
                  ? 'bg-gray-100 ring-2 ring-[#FA6C43] scale-105'
                  : 'bg-gray-100 hover:bg-gray-200 hover:scale-105 active:scale-95'
              }`}
              title={avatar.name}
            >
              <Icon className="text-2xl mb-1" />
              <span className="text-xs font-medium">{avatar.name}</span>
            </button>
          );
        })}
      </div>
      {hint != null && hint !== '' && (
        <p className="mt-2 text-xs text-gray-400 font-medium">{hint}</p>
      )}
    </div>
  );
};

export default AvatarSelector;
