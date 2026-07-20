import React from 'react';
import {
  RiRobot2Line,
  RiChatSmile3Line,
  RiUserSmileLine,
  RiMicroscopeLine,
  RiBookOpenLine,
  RiQuillPenLine,
  RiBrain2Line,
  RiLightbulbLine,
  RiFlaskLine,
  RiGraduationCapLine,
  RiCompasses2Line,
  RiGlobeLine,
  RiCloseLine
} from 'react-icons/ri';

// IDs are intentionally preserved from the pre-academic set so existing
// bot configs in MongoDB keep rendering an icon without a migration.
export const AVATAR_OPTIONS = [
  { id: 'none',      icon: RiCloseLine,         name: 'None' },
  { id: 'robot',     icon: RiRobot2Line,        name: 'Robot' },
  { id: 'smile',     icon: RiChatSmile3Line,    name: 'Discussion' },
  { id: 'user',      icon: RiUserSmileLine,     name: 'Mentor' },
  { id: 'support',   icon: RiMicroscopeLine,    name: 'Lab' },
  { id: 'sparkle',   icon: RiBookOpenLine,      name: 'Book' },
  { id: 'magic',     icon: RiQuillPenLine,      name: 'Writing' },
  { id: 'brain',     icon: RiBrain2Line,        name: 'Thinker' },
  { id: 'lightbulb', icon: RiLightbulbLine,     name: 'Insight' },
  { id: 'rocket',    icon: RiFlaskLine,         name: 'Research' },
  { id: 'star',      icon: RiGraduationCapLine, name: 'Scholar' },
  { id: 'heart',     icon: RiCompasses2Line,    name: 'Inquiry' },
  { id: 'shield',    icon: RiGlobeLine,         name: 'World' },
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
