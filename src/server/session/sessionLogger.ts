import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const LOGS_DIR = join(process.cwd(), 'logs');

/**
 * Accumulates transcript/translation text during a session,
 * then writes the full result to a JSON file on save.
 */
export class SessionLogger {
  private sessionCode: string;
  private startedAt: number;
  private inputText = '';
  private outputTexts: Record<string, string> = {};

  constructor(sessionCode: string) {
    mkdirSync(LOGS_DIR, { recursive: true });
    this.sessionCode = sessionCode;
    this.startedAt = Date.now();
  }

  /** Append Korean source transcript delta */
  appendInput(text: string): void {
    this.inputText += text;
  }

  /** Append translated output delta */
  appendOutput(language: string, text: string): void {
    if (!this.outputTexts[language]) {
      this.outputTexts[language] = '';
    }
    this.outputTexts[language] += text;
  }

  /** Write accumulated session data to file */
  save(): void {
    const data = {
      sessionCode: this.sessionCode,
      startedAt: this.startedAt,
      endedAt: Date.now(),
      korean: this.inputText,
      translations: this.outputTexts,
    };

    const filePath = join(LOGS_DIR, `${this.sessionCode}.json`);
    try {
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`[logger] saved session log: ${filePath}`);
    } catch (err) {
      console.error('[logger] write failed:', err);
    }
  }
}
