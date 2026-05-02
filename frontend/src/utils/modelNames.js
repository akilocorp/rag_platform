const MODEL_DISPLAY_NAMES = {
  'deepseek-chat': 'Deepseek Chat',
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-2.5-pro': 'Gemini 2.5 Pro',
  'gpt-3.5-turbo': 'GPT-3.5 Turbo',
  'gpt-4': 'GPT-4',
  'gpt-4-turbo': 'GPT-4 Turbo',
  'gpt-4.1': 'GPT-4.1',
  'gpt-4o-mini': 'GPT-4o Mini',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
};

export const getModelDisplayName = (modelId) => {
  if (!modelId) return '';
  return MODEL_DISPLAY_NAMES[modelId] || modelId;
};
