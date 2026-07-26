export interface TranslationResult {
  sourceText: string;
  en: string;
  zhHans: string;
  zhHant: string;
}

interface OpenAIResponseOutput {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

function extractOutputText(data: OpenAIResponseOutput): string {
  if (typeof data.output_text === 'string') return data.output_text;

  for (const item of data.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }

  return '';
}

export async function translateTranscript(koreanText: string): Promise<TranslationResult> {
  const text = koreanText.trim();

  if (!text) {
    return { sourceText: koreanText, en: '', zhHans: '', zhHant: '' };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'system',
          content:
            'You are a professional live church sermon subtitle translator. Translate Korean sermon text naturally and faithfully. Preserve Bible references, names, tone, and meaning. Return only valid JSON.',
        },
        {
          role: 'user',
          content: `Translate this Korean text into English, Simplified Chinese, and Traditional Chinese.

Korean:
${text}

Return JSON exactly in this shape:
{
  "en": "...",
  "zhHans": "...",
  "zhHant": "..."
}`,
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'translation_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              en: { type: 'string' },
              zhHans: { type: 'string' },
              zhHant: { type: 'string' },
            },
            required: ['en', 'zhHans', 'zhHant'],
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Translation API failed: ${res.status} ${errorText}`);
  }

  const data = (await res.json()) as OpenAIResponseOutput;
  const outputText = extractOutputText(data);

  const parsed = JSON.parse(outputText) as {
    en: string;
    zhHans: string;
    zhHant: string;
  };

  return {
    sourceText: text,
    en: parsed.en,
    zhHans: parsed.zhHans,
    zhHant: parsed.zhHant,
  };
}
