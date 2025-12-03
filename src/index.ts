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
        },
        strip_ads: {
          type: "boolean",
          description: "Filter out sponsored segments from transcript based on chapter markers (e.g., chapters marked as 'Werbung', 'Ad', 'Sponsor'). Default: true",
          default: true
        }
      },
      required: ["url"]
    },
    // OutputSchema describes structuredContent format for Claude Code
    outputSchema: {
      type: "object",
      properties: {
        meta: { type: "string", description: "Title | Author | Subs | Views | Date" },
        content: { type: "string" }
      },
      required: ["content"]
    }
  } as Tool
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
        // Handle Shorts URLs: /shorts/{id}
        if (url.pathname.startsWith('/shorts/')) {
          const id = url.pathname.slice(8); // Remove '/shorts/'
          if (!id) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid YouTube Shorts URL: missing video ID`
            );
          }
          return id;
        }
        // Handle regular watch URLs: /watch?v={id}
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
      // Not a URL, check if it's a direct video ID (10-11 URL-safe Base64 chars, may start with -)
      if (!/^-?[a-zA-Z0-9_-]{10,11}$/.test(input)) {
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
  async getTranscript(videoId: string, lang: string, includeTimestamps: boolean, stripAds: boolean): Promise<{
    text: string;
    actualLang: string;
    availableLanguages: string[];
    adsStripped: number;
    adChaptersFound: number;
    metadata: {
      title: string;
      author: string;
      subscriberCount: string;
      viewCount: string;
      publishDate: string;
    };
  }> {
    try {
      const result = await getSubtitles({
        videoID: videoId,
        lang: lang,
        enableFallback: true,
      });

      let lines = result.lines;
      let adsStripped = 0;

      // Filter out lines that fall within ad chapters
      if (stripAds && result.adChapters.length > 0) {
        const originalCount = lines.length;
        lines = lines.filter(line => {
          const lineStartMs = line.start * 1000;
          // Check if this line falls within any ad chapter
          return !result.adChapters.some(ad =>
            lineStartMs >= ad.startMs && lineStartMs < ad.endMs
          );
        });
        adsStripped = originalCount - lines.length;
        if (adsStripped > 0) {
          console.log(`[youtube-transcript] Filtered ${adsStripped} lines from ${result.adChapters.length} ad chapter(s): ${result.adChapters.map(a => a.title).join(', ')}`);
        }
      }

      return {
        text: this.formatTranscript(lines, includeTimestamps),
        actualLang: result.actualLang,
        availableLanguages: result.availableLanguages.map(t => t.languageCode),
        adsStripped,
        adChaptersFound: result.adChapters.length,
        metadata: result.metadata
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
          const totalSeconds = Math.floor(line.start);
          const hours = Math.floor(totalSeconds / 3600);
          const mins = Math.floor((totalSeconds % 3600) / 60);
          const secs = totalSeconds % 60;
          // Use h:mm:ss for videos > 1 hour, mm:ss otherwise
          const timestamp = hours > 0
            ? `[${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}]`
            : `[${mins}:${secs.toString().padStart(2, '0')}]`;
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
  private async handleToolCall(name: string, args: any): Promise<CallToolResult> {
    switch (name) {
      case "get_transcript": {
        const { url: input, lang = "en", include_timestamps = false, strip_ads = true } = args;

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
          console.log(`Processing transcript for video: ${videoId}, lang: ${lang}, timestamps: ${include_timestamps}, strip_ads: ${strip_ads}`);

          const result = await this.extractor.getTranscript(videoId, lang, include_timestamps, strip_ads);
          console.log(`Successfully extracted transcript (${result.text.length} chars, lang: ${result.actualLang}, ads stripped: ${result.adsStripped})`);

          // Build transcript with notes
          let transcript = result.text;

          // Add language fallback notice if different from requested
          if (result.actualLang !== lang) {
            transcript = `[Note: Requested language '${lang}' not available. Using '${result.actualLang}'. Available: ${result.availableLanguages.join(', ')}]\n\n${transcript}`;
          }

          // Add ad filtering notice based on what happened
          if (result.adsStripped > 0) {
            // Ads were filtered by chapter markers
            transcript = `[Note: ${result.adsStripped} sponsored segment lines filtered out based on chapter markers]\n\n${transcript}`;
          } else if (strip_ads && result.adChaptersFound === 0) {
            // No chapter markers found - add prompt hint as fallback
            transcript += '\n\n[Note: No chapter markers found. If summarizing, please exclude any sponsored segments or ads from the summary.]';
          }

          // Claude Code v2.0.21+ needs structuredContent for proper display
          return {
            content: [{
              type: "text" as const,
              text: transcript
            }],
            structuredContent: {
              meta: `${result.metadata.title} | ${result.metadata.author} | ${result.metadata.subscriberCount} subs | ${result.metadata.viewCount} views | ${result.metadata.publishDate}`,
              content: transcript.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ')
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