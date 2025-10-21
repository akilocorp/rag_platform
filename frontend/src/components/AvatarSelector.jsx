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

// Define available avatar options with their icons and colors
export const AVATAR_OPTIONS = [
  { id: 'none', icon: RiCloseLine, name: 'None', color: 'gray' },
  { id: 'robot', icon: RiRobot2Line, name: 'Robot', color: 'indigo' },
  { id: 'smile', icon: RiChatSmile3Line, name: 'Friendly', color: 'purple' },
  { id: 'user', icon: RiUserSmileLine, name: 'Personal', color: 'blue' },
  { id: 'support', icon: RiCustomerService2Line, name: 'Support', color: 'green' },
  { id: 'sparkle', icon: RiSparklingLine, name: 'Sparkle', color: 'yellow' },
  { id: 'magic', icon: RiMagicLine, name: 'Magic', color: 'pink' },
  { id: 'brain', icon: RiBrain2Line, name: 'Smart', color: 'cyan' },
  { id: 'lightbulb', icon: RiLightbulbLine, name: 'Bright', color: 'orange' },
  { id: 'rocket', icon: RiRocketLine, name: 'Fast', color: 'red' },
  { id: 'star', icon: RiStarSmileLine, name: 'Star', color: 'violet' },
  { id: 'heart', icon: RiChatHeartLine, name: 'Care', color: 'rose' },
  { id: 'shield', icon: RiShieldCheckLine, name: 'Secure', color: 'emerald' },
];

const colorClasses = {
  gray: 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/30 ring-gray-500',
  indigo: 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 ring-indigo-500',
  purple: 'bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 ring-purple-500',
  blue: 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 ring-blue-500',
  green: 'bg-green-500/20 text-green-400 hover:bg-green-500/30 ring-green-500',
  yellow: 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 ring-yellow-500',
  pink: 'bg-pink-500/20 text-pink-400 hover:bg-pink-500/30 ring-pink-500',
  cyan: 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 ring-cyan-500',
  orange: 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 ring-orange-500',
  red: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 ring-red-500',
  violet: 'bg-violet-500/20 text-violet-400 hover:bg-violet-500/30 ring-violet-500',
  rose: 'bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 ring-rose-500',
  emerald: 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 ring-emerald-500',
};

const AvatarSelector = ({ selectedAvatar = 'robot', onSelect }) => {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-3">
        Bot Avatar
      </label>
      <div className="grid grid-cols-4 sm:grid-cols-6 gap-3">
        {AVATAR_OPTIONS.map((avatar) => {
          const Icon = avatar.icon;
          const isSelected = selectedAvatar === avatar.id;
          const colorClass = colorClasses[avatar.color];
          
          return (
            <button
              key={avatar.id}
              type="button"
              onClick={() => onSelect(avatar.id)}
              className={`flex flex-col items-center justify-center p-3 rounded-xl transition-all ${colorClass} ${
                isSelected ? 'ring-2 scale-105' : 'hover:scale-105'
              }`}
              title={avatar.name}
            >
              <Icon className="text-2xl mb-1" />
              <span className="text-xs font-medium">{avatar.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-gray-400">
        Select an avatar that represents your bot's personality
      </p>
    </div>
  );
};

export default AvatarSelector;

