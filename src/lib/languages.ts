/**
 * Supported output languages for gpt-realtime-translate.
 *
 * To add a language:
 *   1. Add an entry here
 *   2. Restart the WS server
 *   That's it — server, admin, and viewer all derive from this list.
 *
 * Available codes: en, es, fr, de, it, pt, ru, zh, ja, ko, hi, id, vi
 * Each additional language adds ~$2.04/hour (one extra translate session).
 */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  // { code: 'ja', label: '日本語' },
  // { code: 'id', label: 'Indonesia' },
] as const;

export type OutputLanguage = (typeof LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code);
export const LANGUAGE_LABELS: Record<OutputLanguage, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.label]),
) as Record<OutputLanguage, string>;
