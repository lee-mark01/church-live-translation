import type { OutputLanguage } from '../../lib/languages';

/**
 * Re-translate a corrected Korean sentence to all target languages
 * using the Chat Completions API (gpt-4o-mini).
 */
export async function retranslateKorean(
  apiKey: string,
  correctedKorean: string,
  languages: readonly OutputLanguage[],
): Promise<Record<OutputLanguage, string>> {
  const langList = languages.join(', ');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            `You are a church sermon translator. Translate the Korean sentence into these languages: ${langList}. ` +
            `Return JSON only with language codes as keys. Example: {"en":"...","zh":"..."}. ` +
            `Keep the religious tone appropriate for a church sermon.`,
        },
        { role: 'user', content: correctedKorean },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${text}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}
