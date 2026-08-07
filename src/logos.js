/**
 * Map Cursor model ids / vendors to logo assets in media/.
 */
function resolveLogoKey(modelId = '', vendorName = '') {
  const id = String(modelId).toLowerCase();
  const vendor = String(vendorName).toLowerCase();

  if (id.startsWith('grok') || id.includes('grok') || vendor.includes('xai')) {
    return 'grok';
  }
  if (
    id.startsWith('claude') ||
    id.includes('opus') ||
    id.includes('sonnet') ||
    id.includes('haiku') ||
    id.includes('fable') ||
    vendor.includes('anthropic')
  ) {
    return 'claude';
  }
  if (id.startsWith('composer') || vendor.includes('cursor')) {
    return 'cursor';
  }
  if (id.startsWith('gemini') || vendor.includes('google')) {
    return 'gemini';
  }
  if (
    id.startsWith('kimi') ||
    id.includes('kimi') ||
    vendor.includes('moonshot') ||
    vendor.includes('kimi')
  ) {
    return 'kimi';
  }
  if (
    id.startsWith('gpt') ||
    id.includes('codex') ||
    id.includes('-sol') ||
    id.includes('-terra') ||
    id.includes('-luna') ||
    vendor.includes('openai')
  ) {
    return 'openai';
  }
  return 'generic';
}

const LOGO_COLOR = {
  openai: 'var(--fg)',
  claude: '#D97757',
  grok: 'var(--fg)',
  cursor: 'var(--fg)',
  gemini: '#8AB4F8',
  kimi: 'var(--fg)',
  generic: 'var(--muted)',
};

module.exports = {
  resolveLogoKey,
  LOGO_COLOR,
  LOGO_FILES: [
    'openai.svg',
    'claude.svg',
    'grok.svg',
    'cursor.svg',
    'gemini.svg',
    'kimi.svg',
    'generic.svg',
  ],
};
