[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/kimtaeyoon83-mcp-server-youtube-transcript-badge.png)](https://mseep.ai/app/kimtaeyoon83-mcp-server-youtube-transcript)

# YouTube Transcript Server
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/kimtaeyoon83/mcp-server-youtube-transcript)](https://archestra.ai/mcp-catalog/kimtaeyoon83__mcp-server-youtube-transcript)

[![smithery badge](https://smithery.ai/badge/@kimtaeyoon83/mcp-server-youtube-transcript)](https://smithery.ai/server/@kimtaeyoon83/mcp-server-youtube-transcript)

A Model Context Protocol server that enables retrieval of transcripts, live chat, and comments from YouTube videos. This server provides direct access to video captions, subtitles, live stream chat, and community engagement through a simple interface.

<a href="https://glama.ai/mcp/servers/z429kk3te7"><img width="380" height="200" src="https://glama.ai/mcp/servers/z429kk3te7/badge" alt="mcp-server-youtube-transcript MCP server" /></a>

### Installing via Smithery

To install YouTube Transcript Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@kimtaeyoon83/mcp-server-youtube-transcript):

```bash
npx -y @smithery/cli install @kimtaeyoon83/mcp-server-youtube-transcript --client claude
```

## Components

### Tools

- **get_transcript**
  - Extract transcripts from YouTube videos with inline chapter markers, metadata, and optional comments
  - Inputs:
    - `url` (string, required): YouTube video URL, Shorts URL, or video ID
    - `lang` (string, optional, default: "en"): Language code for transcript. Automatically falls back to available languages if requested language is not found.
    - `include_timestamps` (boolean, optional, default: false): Include per-line timestamps (only when no chapters are available; chapter timestamps are always shown)
    - `strip_ads` (boolean, optional, default: true): Filter out sponsorships, ads, and promotional content based on chapter markers
    - `include_chapters` (boolean, optional, default: true): Include chapter markers inline with the transcript as section dividers with timestamps
    - `include_comments` (number, optional, default: 0): Number of top comments to fetch alongside the transcript (0 = disabled)
    - `comments_only` (boolean, optional, default: false): Fetch only comments, skip transcript. Uses `include_comments` as the limit if set (> 0), otherwise defaults to 500
  - Auto-detects live streams and redirects to live chat with background streaming

- **get_live_chat**
  - Connect to YouTube live stream chat with background polling and message buffering
  - Inputs:
    - `url` (string, required): YouTube live stream URL or video ID
    - `stream` (boolean, optional, default: false): Enable background streaming mode for continuous polling
    - `continuation` (string, optional): Continuation token for manual polling to resume from a specific chat position (non-streaming mode only)

- **stop_live_chat**
  - Stop background live chat streaming for a video
  - Inputs:
    - `url` (string, required): YouTube live stream URL or video ID

- **list_live_streams**
  - List all active background live chat streams with stats (no inputs required)

## Key Features

- **Inline Chapter Integration** — When chapters are available, they appear as `--- [mm:ss] Title ---` section dividers directly in the transcript, providing structural timestamps without per-line noise
- **Live Stream Auto-Detection** — Calling `get_transcript` on a live stream automatically redirects to live chat with background streaming
- **Live Chat Streaming** — Background polling with message buffering, deduplication, and visitor data tracking
- **Comments Integration** — Fetch top comments alongside transcripts, or use `comments_only` mode for comment-focused analysis
- **Rich Metadata** — Title, author, duration, subscriber count, view count, publish date, and comment count in every response
- **Ad/Sponsorship Filtering** — Automatically strips sponsored segments based on chapter markers (enabled by default)
- Support for multiple video URL formats (standard, Shorts, short links, embed URLs)
- Language-specific transcript retrieval with automatic fallback
- Zero external dependencies for transcript fetching
- Tool annotations for improved LLM tool selection

## Configuration

To use with Claude Desktop, add this server configuration:

```json
{
  "mcpServers": {
    "youtube-transcript": {
      "command": "npx",
      "args": ["-y", "@kimtaeyoon83/mcp-server-youtube-transcript"]
    }
  }
}
```

## Install via tool

[mcp-get](https://github.com/michaellatman/mcp-get) A command-line tool for installing and managing Model Context Protocol (MCP) servers.

```shell
npx @michaellatman/mcp-get@latest install @kimtaeyoon83/mcp-server-youtube-transcript
```

## Awesome-mcp-servers
[awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) A curated list of awesome Model Context Protocol (MCP) servers.

## Development

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Setup

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

### Testing

```bash
npm test
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the MCP Inspector for development:

```bash
npm run inspector
```



## Running evals

The evals package loads an mcp client that then runs the index.ts file, so there is no need to rebuild between tests. You can load environment variables by prefixing the npx command. Full documentation can be found [here](https://www.mcpevals.io/docs).

```bash
OPENAI_API_KEY=your-key  npx mcp-eval src/evals/evals.ts src/index.ts
```
## Error Handling

The server implements robust error handling for common scenarios:
- Invalid video URLs or IDs
- Unavailable transcripts
- Language availability issues
- Network errors
- Live stream detection and fallback
- Malformed API responses

## Usage Examples

1. Get transcript with inline chapters:
```typescript
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/watch?v=VIDEO_ID"
});
```
Output includes chapter markers like `--- [2:45] Main Topic ---` as section dividers with flowing text between them.

2. Get transcript with per-line timestamps (for videos without chapters):
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  include_timestamps: true
});
```

3. Get transcript with top comments:
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  include_comments: 50
});
```

4. Get only comments (no transcript):
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  comments_only: true
});
```

5. Get transcript from YouTube Shorts:
```typescript
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/shorts/VIDEO_ID"
});
```

6. Connect to live stream chat:
```typescript
await server.callTool("get_live_chat", {
  url: "https://www.youtube.com/watch?v=LIVE_VIDEO_ID",
  stream: true
});
```

7. Check for new live chat messages:
```typescript
await server.callTool("get_live_chat", {
  url: "LIVE_VIDEO_ID",
  stream: true
});
```

8. Stop live chat streaming:
```typescript
await server.callTool("stop_live_chat", {
  url: "LIVE_VIDEO_ID"
});
```

9. How to Extract YouTube Subtitles in Claude Desktop App
```
chat: https://youtu.be/ODaHJzOyVCQ?si=aXkJgso96Deri0aB Extract subtitles
```

## Security Considerations

The server:
- Validates all input parameters
- Handles YouTube API errors gracefully
- Implements timeouts for transcript retrieval
- Provides detailed error messages for troubleshooting

## License

This MCP server is licensed under the MIT License. See the LICENSE file for details.
