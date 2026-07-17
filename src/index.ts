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
import {
  getSubtitles,
  getComments,
  Comment,
  getLiveChat,
  LiveChatMessage,
  checkIfLive,
  startLiveChatStream,
  getLiveChatBuffer,
  stopLiveChatStream,
  listActiveStreams,
  TranscriptLine,
  formatCount,
  TranscriptFetchError,
  stopAllStreams,
  Chapter
} from './youtube-fetcher.js';

interface TranscriptStructuredResult {
  [key: string]: unknown;
  meta: string;
  content: string;
  comments?: string;
}

/**
 * Formats seconds into h:mm:ss or m:ss timestamp string
 */
function formatTimestamp(totalSeconds: number): string {
  totalSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    : `${mins}:${secs.toString().padStart(2, '0')}`;
}

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
        },
        include_chapters: {
          type: "boolean",
          description: "Include video chapters in the response (timestamps with titles). Default: true",
          default: true
        },
        include_comments: {
          type: "number",
          description: "Number of top comments to fetch (0 = disabled, supports pagination). Default: 0",
          default: 0
        },
        comments_only: {
          type: "boolean",
          description: "Fetch ONLY comments (no transcript). Overrides all other flags and fetches all available comments. Default: false",
          default: false
        }
      },
      required: ["url"]
    },
    // OutputSchema describes structuredContent format for Claude Code
    outputSchema: {
      type: "object",
      properties: {
        meta: { type: "string", description: "Title | Author | Duration | Subs | Views | Date | Comments (X of Y)" },
        content: { type: "string" },
        chapters: { type: "string", description: "Video chapters (if include_chapters=true and chapters exist)" },
        comments: { type: "string", description: "Top comments (if include_comments > 0)" }
      },
      required: ["content"]
    },
    annotations: {
      title: "Get Transcript",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "get_live_chat",
    description: "Fetch live chat messages from a YouTube live stream. Returns current messages and a continuation token for polling. Call repeatedly with continuation token to get new messages.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube live stream URL or video ID"
        },
        continuation: {
          type: "string",
          description: "Continuation token from previous call (for polling new messages)"
        },
        stream: {
          type: "boolean",
          description: "Enable background streaming mode. When true, starts continuous polling and buffers messages. Subsequent calls return buffered messages. Default: false",
          default: false
        }
      },
      required: ["url"]
    },
    outputSchema: {
      type: "object",
      properties: {
        meta: { type: "string", description: "Stream title | Channel | message count | poll interval" },
        messages: { type: "string", description: "Formatted chat messages" },
        continuation: { type: "string", description: "Token to pass in next call for new messages" },
        pollIntervalMs: { type: "number", description: "Recommended polling interval in ms" },
        isLive: { type: "boolean", description: "Whether stream is still live" },
        streaming: { type: "boolean", description: "Whether background streaming is active" }
      }
    },
    annotations: {
      title: "Get Live Chat",
      readOnlyHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "stop_live_chat",
    description: "Stop background live chat streaming for a video. Returns final buffered messages and stats.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "YouTube live stream URL or video ID to stop streaming"
        }
      },
      required: ["url"]
    },
    annotations: {
      title: "Stop Live Chat",
      readOnlyHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "list_live_streams",
    description: "List all active background live chat streams with their stats. Use this to see what streams are being monitored.",
    inputSchema: {
      type: "object",
      properties: {}
    },
    annotations: {
      title: "List Live Streams",
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];

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
          const id = url.pathname.slice(8).split('/')[0]; // Remove '/shorts/' and any trailing segments
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
      // Re-throw McpError (thrown for valid URLs with missing IDs)
      if (error instanceof McpError) throw error;
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
  async getTranscript(videoId: string, lang: string, includeTimestamps: boolean, stripAds: boolean, includeChapters: boolean = true): Promise<{
    text: string;
    actualLang: string;
    availableLanguages: string[];
    adsStripped: number;
    adChaptersFound: number;
    chapters: { title: string; startMs: number; isAd: boolean }[];
    metadata: {
      title: string;
      author: string;
      subscriberCount: string;
      viewCount: string;
      commentCount: string;
      publishDate: string;
      duration: string;
    };
    isLive: boolean;
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
        text: this.formatTranscript(lines, includeTimestamps, includeChapters ? result.chapters : []),
        actualLang: result.actualLang,
        availableLanguages: result.availableLanguages.map(t => t.languageCode),
        adsStripped,
        adChaptersFound: result.adChapters.length,
        chapters: result.chapters,
        metadata: result.metadata,
        isLive: result.isLive
      };
    } catch (error) {
      console.error('Failed to fetch transcript:', error);
      // Propagate TranscriptFetchError so caller can check isLive and redirect
      if (error instanceof TranscriptFetchError) throw error;
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to retrieve transcript: ${(error as Error).message}`
      );
    }
  }

  /**
   * Formats transcript lines with optional inline chapter markers and TOC
   */
  private formatTranscript(transcript: TranscriptLine[], includeTimestamps: boolean, chapters: Chapter[] = []): string {
    const nonAdChapters = chapters.filter(c => !c.isAd);
    const hasChapters = nonAdChapters.length > 0;

    // When chapters exist: chapter markers provide timestamps, no per-line timestamps needed
    // When no chapters: use per-line timestamps if requested
    const usePerLineTimestamps = includeTimestamps && !hasChapters;

    const textParts: string[] = [];
    let currentChunk: string[] = [];
    let chapterIdx = 0;

    for (const line of transcript) {
      const trimmed = line.text.replace(/\n/g, ' ').trim();
      if (!trimmed) continue;

      // Insert chapter markers at their start positions
      while (chapterIdx < nonAdChapters.length &&
             nonAdChapters[chapterIdx].startMs / 1000 <= line.start) {
        const ch = nonAdChapters[chapterIdx];
        if (currentChunk.length > 0) {
          textParts.push(currentChunk.join(usePerLineTimestamps ? '\n' : ' '));
          currentChunk = [];
        }
        textParts.push(`\n--- [${formatTimestamp(ch.startMs / 1000)}] ${ch.title} ---\n`);
        chapterIdx++;
      }

      if (usePerLineTimestamps) {
        currentChunk.push(`[${formatTimestamp(line.start)}] ${trimmed}`);
      } else {
        currentChunk.push(trimmed);
      }
    }

    if (currentChunk.length > 0) {
      textParts.push(currentChunk.join(usePerLineTimestamps ? '\n' : ' '));
    }
    while (chapterIdx < nonAdChapters.length) {
      const ch = nonAdChapters[chapterIdx];
      textParts.push(`\n--- [${formatTimestamp(ch.startMs / 1000)}] ${ch.title} ---\n`);
      chapterIdx++;
    }
    return textParts.join('\n');
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
        version: "0.1.1",
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

    process.on('SIGTERM', async () => {
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
   * Formats a live chat auto-detection response for structuredContent
   */
  private formatLiveChatResponse(
    liveResult: { messages: LiveChatMessage[]; continuation?: string; isLive: boolean; pollIntervalMs: number },
    metadata: { title: string; author: string }
  ): CallToolResult {
    const messagesFormatted = liveResult.messages.map((m: LiveChatMessage) => {
      const prefix = m.isPaid ? `[${m.paidAmount}] ` : '';
      return `${prefix}${m.author}: ${m.text}`;
    }).join('\n');

    return {
      content: [{
        type: "text" as const,
        text: `[LIVE STREAM DETECTED - Auto-switched to live chat with background streaming]\n\nStream: ${metadata.title || 'Unknown'}\nChannel: ${metadata.author || 'Unknown'}\n\nRecent chat:\n${messagesFormatted || '[No messages yet]'}\n\n[Use get_live_chat with stream:true to check for new messages, or stop_live_chat to stop]`
      }],
      structuredContent: {
        meta: `🔴 LIVE | ${metadata.title || 'Live Stream'} | ${metadata.author || 'Unknown'} | ${liveResult.messages.length} messages | STREAMING STARTED`,
        messages: messagesFormatted.replace(/\n/g, ' | '),
        isLive: true,
        streaming: true,
        note: 'Auto-detected live stream. Background streaming started. Use get_live_chat(stream:true) for updates.'
      }
    };
  }

  /**
   * Handles tool call requests
   */
  private async handleToolCall(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    switch (name) {
      case "get_transcript": {
        const {
          url: input,
          lang = "en",
          include_timestamps = false,
          strip_ads = true,
          include_chapters = true,
          include_comments = 0,
          comments_only = false
        } = args as {
          url: string; lang?: string; include_timestamps?: boolean;
          strip_ads?: boolean; include_chapters?: boolean;
          include_comments?: number; comments_only?: boolean;
        };

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

        const videoId = this.extractor.extractYoutubeId(input);

        try {
          // comments_only mode: skip transcript, fetch comments
          // Default 500 cap; user can override via include_comments (0 = unlimited)
          if (comments_only) {
            const DEFAULT_COMMENTS_LIMIT = 500;
            const commentsLimit = include_comments > 0 ? include_comments : DEFAULT_COMMENTS_LIMIT;
            console.log(`Fetching comments ONLY for video: ${videoId} (limit: ${commentsLimit})`);
            const commentsResult = await getComments({ videoID: videoId, limit: commentsLimit });
            console.log(`Fetched ${commentsResult.comments.length} comments (total: ${commentsResult.totalCount})`);

            // Format comments with full detail
            const commentsFormatted = commentsResult.comments.map((c: Comment) => {
              const badges = [
                c.isPinned ? '📌' : '',
                c.isHearted ? '❤' : '',
                c.likes ? `${c.likes}♥` : ''
              ].filter(Boolean).join('');
              const prefix = c.isReply ? '  ↳ ' : '';
              return `${prefix}[${badges || '0♥'}] ${c.author}: ${c.text}`;
            }).join('\n');

            return {
              content: [{
                type: "text" as const,
                text: commentsFormatted
              }],
              structuredContent: {
                meta: `Comments: ${commentsResult.comments.length} fetched of ${formatCount(commentsResult.totalCount) || commentsResult.totalCount} total`,
                comments: commentsFormatted
              }
            };
          }

          console.log(`Processing transcript for video: ${videoId}, lang: ${lang}, timestamps: ${include_timestamps}, strip_ads: ${strip_ads}, comments: ${include_comments}`);

          const result = await this.extractor.getTranscript(videoId, lang as string, include_timestamps as boolean, strip_ads as boolean, include_chapters as boolean);

          // Auto-detect live streams: only redirect to live chat if no transcript was fetched
          if (result.isLive && !result.text.trim()) {
            console.log(`[auto-detect] Video ${videoId} is LIVE with no transcript - attempting live chat`);
            try {
              const liveResult = await startLiveChatStream(videoId);
              return this.formatLiveChatResponse(liveResult, result.metadata);
            } catch (liveErr) {
              console.log(`[auto-detect] Live chat failed, falling back to transcript: ${(liveErr as Error).message}`);
            }
          }

          console.log(`Successfully extracted transcript (${result.text.length} chars, lang: ${result.actualLang}, ads stripped: ${result.adsStripped})`);

          // Fetch comments if requested (include_comments > 0)
          let commentsText = '';
          let commentsFetched = 0;
          let commentsTotal = 0;
          const commentLimit = include_comments as number;
          if (commentLimit > 0) {
            try {
              const commentsResult = await getComments({ videoID: videoId, limit: commentLimit });
              commentsFetched = commentsResult.comments.length;
              commentsTotal = commentsResult.totalCount;
              console.log(`Fetched ${commentsFetched} comments (total: ${commentsTotal})`);

              // Format comments as compact text (replies indented with ↳)
              commentsText = commentsResult.comments.map((c: Comment) =>
                `${c.isReply ? '↳ ' : ''}[${c.likes}♥${c.isHearted ? '❤' : ''}${c.isPinned ? '📌' : ''}] ${c.author}: ${c.text.replace(/\n/g, ' ')}`
              ).join(' | ');
            } catch (err) {
              console.error('Failed to fetch comments:', err);
              commentsText = '[Comments unavailable]';
            }
          }

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
          } else if (strip_ads && result.adChaptersFound === 0 && result.chapters.length === 0) {
            // No chapter markers found - add prompt hint as fallback
            transcript += '\n\n[Note: No chapter markers found. If summarizing, please exclude any sponsored segments or ads from the summary.]';
          }

          // Claude Code v2.0.21+ needs structuredContent for proper display
          // Format comment count if fetched: "42 of 1.2k comments" or "42 of 1.2M comments"
          let commentCountStr = '';
          if (commentsFetched > 0) {
            commentCountStr = ` | ${commentsFetched} of ${formatCount(commentsTotal) || commentsTotal} comments`;
          } else if (result.metadata.commentCount) {
            commentCountStr = ` | ${result.metadata.commentCount} comments`;
          }

          const structuredResult: TranscriptStructuredResult = {
            meta: `${result.metadata.title} | ${result.metadata.author} | ${result.metadata.duration} | ${result.metadata.subscriberCount} subs | ${result.metadata.viewCount} views | ${result.metadata.publishDate}${commentCountStr}`,
            // Preserve line-delimited format for easy chunking (head/tail/Select-Object work)
            content: transcript
          };

          // Add comments to response if fetched
          if (commentsText) {
            structuredResult.comments = commentsText;
          }

          return {
            content: [{
              type: "text" as const,
              text: transcript
            }],
            structuredContent: structuredResult
          };
        } catch (error) {
          // If transcript failed but video is live, redirect to live chat
          if (error instanceof TranscriptFetchError && error.isLive) {
            console.log(`[auto-detect] Transcript failed for live stream, redirecting to live chat`);
            try {
              const liveResult = await startLiveChatStream(videoId);
              return this.formatLiveChatResponse(liveResult, error.metadata);
            } catch (liveErr) {
              console.error('Live chat fallback also failed:', liveErr);
            }
          }

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

      case "get_live_chat": {
        const { url: input, continuation, stream = false } = args as {
          url: string; continuation?: string; stream?: boolean;
        };

        if (!input || typeof input !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'URL parameter is required and must be a string'
          );
        }

        try {
          const videoId = this.extractor.extractYoutubeId(input);

          // Streaming mode: start/continue background polling
          if (stream) {
            console.log(`[live-chat] Streaming mode for video: ${videoId}`);

            // Check if we have a buffer (already streaming)
            const buffer = getLiveChatBuffer(videoId);
            if (buffer) {
              console.log(`[live-chat] Returning ${buffer.messages.length} buffered messages`);
              const messagesFormatted = buffer.messages.map((m: LiveChatMessage) => {
                const prefix = m.isPaid ? `[${m.paidAmount}] ` : '';
                return `${prefix}${m.author}: ${m.text}`;
              }).join('\n');

              const durationSec = Math.floor(buffer.stats.streamDurationMs / 1000);
              const durationMin = Math.floor(durationSec / 60);
              const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec % 60}s` : `${durationSec}s`;

              return {
                content: [{
                  type: "text" as const,
                  text: messagesFormatted || '[No new messages since last check]'
                }],
                structuredContent: {
                  meta: `${buffer.videoTitle || 'Live Stream'} | ${buffer.channelName || 'Unknown'} | ${buffer.messages.length} new msgs | total: ${buffer.stats.totalFetched} | streaming: ${durationStr}`,
                  messages: messagesFormatted.replace(/\n/g, ' | '),
                  streaming: buffer.isStreaming,
                  stats: buffer.stats
                }
              };
            }

            // Start new stream
            console.log(`[live-chat] Starting background stream for: ${videoId}`);
            const result = await startLiveChatStream(videoId);

            const messagesFormatted = result.messages.map((m: LiveChatMessage) => {
              const prefix = m.isPaid ? `[${m.paidAmount}] ` : '';
              return `${prefix}${m.author}: ${m.text}`;
            }).join('\n');

            return {
              content: [{
                type: "text" as const,
                text: `[Background streaming started]\n\n${messagesFormatted}`
              }],
              structuredContent: {
                meta: `${result.videoTitle || 'Live Stream'} | ${result.channelName || 'Unknown'} | ${result.messages.length} messages | poll: ${result.pollIntervalMs}ms | STREAMING STARTED`,
                messages: messagesFormatted.replace(/\n/g, ' | '),
                continuation: result.continuation,
                pollIntervalMs: result.pollIntervalMs,
                isLive: result.isLive,
                streaming: true
              }
            };
          }

          // Normal mode: single fetch
          console.log(`Fetching live chat for video: ${videoId}`);

          const result = await getLiveChat({
            videoID: videoId,
            continuation: continuation as string | undefined
          });

          console.log(`Fetched ${result.messages.length} live chat messages`);

          const messagesFormatted = result.messages.map((m: LiveChatMessage) => {
            const prefix = m.isPaid ? `[${m.paidAmount}] ` : '';
            return `${prefix}${m.author}: ${m.text}`;
          }).join('\n');

          return {
            content: [{
              type: "text" as const,
              text: messagesFormatted || '[No new messages]'
            }],
            structuredContent: {
              meta: `${result.videoTitle || 'Live Stream'} | ${result.channelName || 'Unknown'} | ${result.messages.length} messages | poll: ${result.pollIntervalMs}ms`,
              messages: messagesFormatted,
              continuation: result.continuation,
              pollIntervalMs: result.pollIntervalMs,
              isLive: result.isLive,
              streaming: false
            }
          };
        } catch (error) {
          console.error('Live chat fetch failed:', error);

          if (error instanceof McpError) {
            throw error;
          }

          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch live chat: ${(error as Error).message}`
          );
        }
      }

      case "stop_live_chat": {
        const { url: input } = args as { url: string };

        if (!input || typeof input !== 'string') {
          throw new McpError(
            ErrorCode.InvalidParams,
            'URL parameter is required and must be a string'
          );
        }

        try {
          const videoId = this.extractor.extractYoutubeId(input);
          console.log(`[live-chat] Stopping stream for: ${videoId}`);

          const result = stopLiveChatStream(videoId);

          if (!result) {
            return {
              content: [{
                type: "text" as const,
                text: `No active stream found for video: ${videoId}`
              }]
            };
          }

          const messagesFormatted = result.finalMessages.map((m: LiveChatMessage) => {
            const prefix = m.isPaid ? `[${m.paidAmount}] ` : '';
            return `${prefix}${m.author}: ${m.text}`;
          }).join('\n');

          const durationSec = Math.floor(result.stats.streamDurationMs / 1000);
          const durationMin = Math.floor(durationSec / 60);
          const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec % 60}s` : `${durationSec}s`;

          return {
            content: [{
              type: "text" as const,
              text: `[Stream stopped after ${durationStr}]\n\nFinal messages:\n${messagesFormatted || '[No remaining messages]'}`
            }],
            structuredContent: {
              meta: `Stream stopped | Duration: ${durationStr} | Total fetched: ${result.stats.totalFetched}`,
              finalMessages: messagesFormatted.replace(/\n/g, ' | '),
              stats: result.stats
            }
          };
        } catch (error) {
          console.error('Stop live chat failed:', error);

          if (error instanceof McpError) {
            throw error;
          }

          throw new McpError(
            ErrorCode.InternalError,
            `Failed to stop live chat: ${(error as Error).message}`
          );
        }
      }

      case "list_live_streams": {
        const streams = listActiveStreams();

        if (streams.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: '[No active live streams]'
            }]
          };
        }

        const streamsList = streams.map(s => {
          const durationSec = Math.floor(s.streamDurationMs / 1000);
          const durationMin = Math.floor(durationSec / 60);
          const durationStr = durationMin > 0 ? `${durationMin}m ${durationSec % 60}s` : `${durationSec}s`;

          return `🔴 ${s.videoTitle || s.videoId}\n   Channel: ${s.channelName || 'Unknown'}\n   Status: ${s.isPolling ? 'POLLING' : 'STOPPED'}\n   Duration: ${durationStr}\n   Buffered: ${s.bufferSize} msgs\n   Total: ${s.totalFetched} msgs`;
        }).join('\n\n');

        return {
          content: [{
            type: "text" as const,
            text: `Active Live Streams (${streams.length}):\n\n${streamsList}`
          }],
          structuredContent: {
            count: streams.length,
            streams: streams
          }
        };
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
      stopAllStreams();
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