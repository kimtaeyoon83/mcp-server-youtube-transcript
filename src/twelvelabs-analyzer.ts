import { TwelveLabs } from 'twelvelabs-js';

/**
 * Pegasus is TwelveLabs' video-understanding model. Unlike a transcript, which
 * only captures spoken words, Pegasus reasons over what is actually shown on
 * screen, so it can summarize or answer questions about videos that have little
 * or no speech (demos, gameplay, b-roll, music videos, etc.).
 *
 * This module is an optional, self-contained adapter: it is only imported when
 * the `analyze_video` tool is invoked, so the core transcript functionality
 * keeps working with zero TwelveLabs configuration.
 */

export type PegasusModel = 'pegasus1.2' | 'pegasus1.5';

export interface AnalyzeOptions {
  /**
   * A publicly reachable, direct video URL (e.g. an .mp4/.mov/.webm link or a
   * pre-signed URL). TwelveLabs fetches the file server-side, so it must be a
   * media file the platform can download — not a YouTube watch page, which
   * serves HTML rather than a raw video stream.
   */
  url: string;
  /** Natural-language instruction or question for the model. */
  prompt: string;
  /** Pegasus model to use. Defaults to `pegasus1.2`. */
  model?: PegasusModel;
  /** Maximum response length in tokens (2-4096 for pegasus1.2). Defaults to 2048. */
  maxTokens?: number;
}

export interface AnalyzeResult {
  text: string;
  model: PegasusModel;
  /** Why the model stopped, e.g. "stop" or "length". Present when returned by the API. */
  finishReason?: string;
}

const DEFAULT_MODEL: PegasusModel = 'pegasus1.2';
const DEFAULT_MAX_TOKENS = 2048;

/**
 * Reads the API key from the environment. Kept separate so callers can give a
 * clear, actionable error before any network work happens.
 */
function getApiKey(): string {
  const apiKey = process.env.TWELVELABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      'TWELVELABS_API_KEY environment variable is not set. ' +
        'Get a free key at https://twelvelabs.io and add it to your MCP server configuration.'
    );
  }
  return apiKey;
}

/**
 * Runs prompt-based video analysis with TwelveLabs Pegasus and returns the
 * generated text. The client is created per-call so the module stays free of
 * top-level side effects (the SDK throws if no key is present at construction).
 */
export async function analyzeVideo(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const { url, prompt } = options;
  const model = options.model ?? DEFAULT_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (!url) {
    throw new Error('A video URL is required for analysis.');
  }
  if (!prompt) {
    throw new Error('A prompt is required for analysis.');
  }

  const client = new TwelveLabs({ apiKey: getApiKey() });

  const response = await client.analyze({
    modelName: model,
    video: { type: 'url', url },
    prompt,
    maxTokens,
  });

  const text = response.data;
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('TwelveLabs returned an empty analysis response.');
  }

  return {
    text,
    model,
    finishReason: response.finishReason,
  };
}
