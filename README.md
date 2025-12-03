[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/kimtaeyoon83-mcp-server-youtube-transcript-badge.png)](https://mseep.ai/app/kimtaeyoon83-mcp-server-youtube-transcript)

# YouTube Transcript Server
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/kimtaeyoon83/mcp-server-youtube-transcript)](https://archestra.ai/mcp-catalog/kimtaeyoon83__mcp-server-youtube-transcript)

[![smithery badge](https://smithery.ai/badge/@kimtaeyoon83/mcp-server-youtube-transcript)](https://smithery.ai/server/@kimtaeyoon83/mcp-server-youtube-transcript)

A Model Context Protocol server that enables retrieval of transcripts from YouTube videos. This server provides direct access to video captions and subtitles through a simple interface.

<a href="https://glama.ai/mcp/servers/z429kk3te7"><img width="380" height="200" src="https://glama.ai/mcp/servers/z429kk3te7/badge" alt="mcp-server-youtube-transcript MCP server" /></a>

### Installing via Smithery

To install YouTube Transcript Server for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@kimtaeyoon83/mcp-server-youtube-transcript):

```bash
npx -y @smithery/cli install @kimtaeyoon83/mcp-server-youtube-transcript --client claude
```

## Components

### Tools

- **get_transcript**
  - Extract transcripts from YouTube videos
  - Inputs:
    - `url` (string, required): YouTube video URL, Shorts URL, or video ID
    - `lang` (string, optional, default: "en"): Language code for transcript (e.g., 'ko', 'en'). Automatically falls back to available languages if requested language is not found.
    - `include_timestamps` (boolean, optional, default: false): Include timestamps in output (e.g., '[0:05] text')
    - `strip_ads` (boolean, optional, default: true): Prepend instruction to remove sponsorships, ads, and promotional content from transcript

## Key Features

- Support for multiple video URL formats (including YouTube Shorts)
- Language-specific transcript retrieval with automatic fallback
- Optional timestamps for referencing specific moments
- Built-in ad/sponsorship filtering (enabled by default)
- Zero external dependencies for transcript fetching
- Detailed metadata in responses

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

## Usage Examples

1. Get transcript by video URL:
```typescript
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/watch?v=VIDEO_ID",
  lang: "en"
});
```

2. Get transcript by video ID:
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  lang: "ko"
});
```

3. Get transcript from YouTube Shorts:
```typescript
await server.callTool("get_transcript", {
  url: "https://www.youtube.com/shorts/VIDEO_ID"
});
```

4. Get transcript with timestamps:
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  include_timestamps: true
});
```

5. Get raw transcript without ad filtering:
```typescript
await server.callTool("get_transcript", {
  url: "VIDEO_ID",
  strip_ads: false
});
```

6. How to Extract YouTube Subtitles in Claude Desktop App
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
