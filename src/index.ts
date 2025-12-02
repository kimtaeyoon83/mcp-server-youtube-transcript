#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
  Tool,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { getSubtitles } from './youtube-fetcher';

// Define tool configurations
const TOOLS: Tool[] = [
  {
    name: "get_transcript",
    description: "Extract transcript from a YouTube video URL or ID. Automatically falls back to available languages if requested language is not available.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube video URL or ID"
        },
        lang: {
          type: "string",
          description: "Language code for transcript (e.g., 'ko', 'en'). Will fall back to available language if not found.",
          default: "en"
        },
        include_timestamps: {
          type: "boolean",
          description: "Include timestamps in output (e.g., '[0:05] text'). Useful for referencing specific moments. Default: false",
          default: false
        }
      },
      required: ["url"]
    }
  }
];

interface TranscriptLine {
  text: string;
  start: number;
  dur: number;
}

class YouTubeTranscriptExtractor {
  /**
   * Extracts YouTube video ID from various URL formats or direct ID input
   */
  extractYoutubeId(input: string): string {
    if (!input) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'YouTube URL or ID is required'
      );
    }

    // Handle URL formats
    try {
      const url = new URL(input);
      if (url.hostname === 'youtu.be') {
        return url.pathname.slice(1);
      } else if (url.hostname.includes('youtube.com')) {
        const videoId = url.searchParams.get('v');
        if (!videoId) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid YouTube URL: ${input}`
          );
        }
        return videoId;
      }
    } catch (error) {
      // Not a URL, check if it's a direct video ID
      if (!/^[a-zA-Z0-9_-]{11}$/.test(input)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Invalid YouTube video ID: ${input}`
        );
      }
      return input;
    }

    throw new McpError(
      ErrorCode.InvalidParams,
      `Could not extract video ID from: ${input}`
    );
  }

  /**
   * Retrieves transcript for a given video ID and language
   */
  async getTranscript(videoId: string, lang: string, includeTimestamps: boolean): Promise<{
    text: string;
    actualLang: string;
    availableLanguages: string[];
  }> {
    try {
      const result = await getSubtitles({
        videoID: videoId,
        lang: lang,
        enableFallback: true,
      });

      return {
        text: this.formatTranscript(result.lines, includeTimestamps),
        actualLang: result.actualLang,
        availableLanguages: result.availableLanguages.map(t => t.languageCode),
      };
    } catch (error) {
      console.error('Failed to fetch transcript:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve transcript: ${(error as Error).message}`
      );
    }
  }

  /**
   * Formats transcript lines into readable text
   */
  private formatTranscript(transcript: TranscriptLine[], includeTimestamps: boolean): string {
    if (includeTimestamps) {
      return transcript
        .map(line => {
          const mins = Math.floor(line.start / 60);
          const secs = Math.floor(line.start % 60);
          const timestamp = `[${mins}:${secs.toString().padStart(2, '0')}]`;
          return `${timestamp} ${line.text.trim()}`;
        })
        .filter(text => text.length > 0)
        .join('\n');
    }
    return transcript
      .map(line => line.text.trim())
      .filter(text => text.length > 0)
      .join(' ');
  }
}

class TranscriptServer {
  private extractor: YouTubeTranscriptExtractor;
  private server: Server;

  constructor() {
    this.extractor = new YouTubeTranscriptExtractor();
    this.server = new Server(
      {
        name: "mcp-servers-youtube-transcript",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on('SIGINT', async () => {
      await this.stop();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => 
      this.handleToolCall(request.params.name, request.params.arguments ?? {})
    );
  }

  /**
   * Handles tool call requests
   */
  private async handleToolCall(name: string, args: any): Promise<{ toolResult: CallToolResult }> {
    switch (name) {
      case "get_transcript": {
        const { url: input, lang = "en", include_timestamps = false } = args;

        if (!input || typeof input !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'URL parameter is required and must be a string'
          );
        }

        if (lang && typeof lang !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'Language code must be a string'
          );
        }

        try {
          const videoId = this.extractor.extractYoutubeId(input);
          console.error(`Processing transcript for video: ${videoId}, lang: ${lang}, timestamps: ${include_timestamps}`);

          const result = await this.extractor.getTranscript(videoId, lang, include_timestamps);
          console.error(`Successfully extracted transcript (${result.text.length} chars, lang: ${result.actualLang})`);

          // Add language fallback notice if different from requested
          let transcript = result.text;
          if (result.actualLang !== lang) {
            transcript = `[Note: Requested language '${lang}' not available. Using '${result.actualLang}'. Available: ${result.availableLanguages.join(', ')}]\n\n${transcript}`;
          }

          return {
            toolResult: {
              content: [{
                type: "text",
                text: transcript,
                metadata: {
                  videoId,
                  requestedLanguage: lang,
                  actualLanguage: result.actualLang,
                  availableLanguages: result.availableLanguages,
                  includeTimestamps: include_timestamps,
                  timestamp: new Date().toISOString(),
                  charCount: transcript.length
                }
              }],
              isError: false
            }
          };
        } catch (error) {
          console.error('Transcript extraction failed:', error);

          if (error instanceof McpError) {
            throw error;
          }

          throw new McpError(
            ErrorCode.InternalError,
            `Failed to process transcript: ${(error as Error).message}`
          );
        }
      }

      default:
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${name}`
        );
    }
  }

  /**
   * Starts the server
   */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /**
   * Stops the server
   */
  async stop(): Promise<void> {
    try {
      await this.server.close();
    } catch (error) {
      console.error('Error while stopping server:', error);
    }
  }
}

// Main execution
async function main() {
  const server = new TranscriptServer();
  
  try {
    await server.start();
  } catch (error) {
    console.error("Server failed to start:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal server error:", error);
  process.exit(1);
});