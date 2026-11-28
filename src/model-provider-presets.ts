export const providerDefaults = {
  openai: { label: 'OpenAI', endpoint: 'https://api.openai.com/v1', protocol: 'openai-responses' },
  deepseek: { label: 'DeepSeek', endpoint: 'https://api.deepseek.com', protocol: 'openai-chat' },
  anthropic: { label: 'Anthropic', endpoint: 'https://api.anthropic.com/v1', protocol: 'anthropic' },
  gemini: { label: 'Gemini', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', protocol: 'openai-chat' },
  kimi: { label: 'Kimi', endpoint: 'https://api.moonshot.cn/v1', protocol: 'openai-chat' },
  openrouter: { label: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', protocol: 'openai-chat' }
}
export const guideApiFormats = {
  'openai-responses': 'OpenAI Responses',
  'openai-chat': 'OpenAI Chat Completions',
  anthropic: 'Anthropic Messages'
}
