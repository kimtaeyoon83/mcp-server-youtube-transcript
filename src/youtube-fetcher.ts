import https from 'https';

interface TranscriptLine {
  text: string;
  start: number;
  dur: number;
}

interface PageData {
  visitorData: string;
  clientVersion: string;
}

const REQUEST_TIMEOUT = 30000; // 30 seconds
const DEFAULT_CLIENT_VERSION = '2.20251201.01.00';

/**
 * Encodes a number as a protobuf varint
 * Handles lengths > 127 correctly (multi-byte encoding)
 */
function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return bytes;
}

/**
 * Builds the protobuf-encoded params for the transcript API
 */
function buildParams(videoId: string, lang: string = 'en'): string {
  // Inner protobuf: language params
  // Field 1: "asr" (auto speech recognition)
  // Field 2: language code
  // Field 3: empty string
  const innerParts: number[] = [
    0x0a, 0x03, ...Buffer.from('asr'),           // Field 1, "asr"
    0x12, ...encodeVarint(lang.length), ...Buffer.from(lang),  // Field 2, language code
    0x1a, 0x00                                    // Field 3, empty
  ];
  const innerBuf = Buffer.from(innerParts);
  const innerB64 = innerBuf.toString('base64');
  const innerEncoded = encodeURIComponent(innerB64);

  // Outer protobuf
  const panelName = 'engagement-panel-searchable-transcript-search-panel';
  const outerParts: number[] = [
    0x0a, ...encodeVarint(videoId.length), ...Buffer.from(videoId),      // Field 1, video ID
    0x12, ...encodeVarint(innerEncoded.length), ...Buffer.from(innerEncoded), // Field 2, language params
    0x18, 0x01,                                          // Field 3, value 1
    0x2a, ...encodeVarint(panelName.length), ...Buffer.from(panelName),  // Field 5, panel name
    0x30, 0x01,                                          // Field 6, value 1
    0x38, 0x01,                                          // Field 7, value 1
    0x40, 0x01                                           // Field 8, value 1
  ];

  return Buffer.from(outerParts).toString('base64');
}

/**
 * Makes an HTTPS request and returns the response body
 * Includes timeout and HTTP status code validation
 */
function httpsRequest(options: https.RequestOptions, data?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...options, timeout: REQUEST_TIMEOUT }, (res) => {
      // Validate HTTP status code
      if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage || 'Unknown error'}`));
        return;
      }

      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });

    req.on('error', (err) => {
      reject(new Error(`Network error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${REQUEST_TIMEOUT}ms`));
    });

    if (data) req.write(data);
    req.end();
  });
}

/**
 * Fetches the YouTube video page and extracts visitor data and client version
 */
async function getPageData(videoId: string): Promise<PageData> {
  let html: string;

  try {
    html = await httpsRequest({
      hostname: 'www.youtube.com',
      path: `/watch?v=${videoId}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
  } catch (err) {
    throw new Error(`Failed to fetch video page: ${(err as Error).message}`);
  }

  // Extract visitor data
  const visitorMatch = html.match(/"visitorData":"([^"]+)"/);
  const visitorData = visitorMatch?.[1] || '';

  if (!visitorData) {
    console.error(`[youtube-fetcher] Warning: Could not extract visitorData for video ${videoId}. Request may fail.`);
  }

  // Extract client version (format: "2.YYYYMMDD.XX.XX")
  const versionMatch = html.match(/"clientVersion":"([\d.]+)"/);
  const clientVersion = versionMatch?.[1] || DEFAULT_CLIENT_VERSION;

  return { visitorData, clientVersion };
}

/**
 * Fetches transcript using the YouTube internal API
 */
export async function getSubtitles(options: { videoID: string; lang?: string }): Promise<TranscriptLine[]> {
  const { videoID, lang = 'en' } = options;

  // Validate video ID format
  if (!videoID || typeof videoID !== 'string') {
    throw new Error('Invalid video ID: must be a non-empty string');
  }

  // Get page data (visitor data and client version)
  const { visitorData, clientVersion } = await getPageData(videoID);

  // Build request payload using ANDROID client to avoid FAILED_PRECONDITION errors
  // The ANDROID client bypasses YouTube's A/B test for poToken enforcement
  const params = buildParams(videoID, lang);
  const payload = JSON.stringify({
    context: {
      client: {
        hl: lang,
        gl: 'US',
        clientName: 'ANDROID',
        clientVersion: '19.29.37',
        androidSdkVersion: 30,
        visitorData: visitorData
      }
    },
    params: params
  });

  // Make API request
  let response: string;
  try {
    response = await httpsRequest({
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/get_transcript?prettyPrint=false',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'User-Agent': 'com.google.android.youtube/19.29.37 (Linux; U; Android 11) gzip',
        'Origin': 'https://www.youtube.com'
      }
    }, payload);
  } catch (err) {
    throw new Error(`Failed to fetch transcript API: ${(err as Error).message}`);
  }

  // Parse response with error handling
  let json: any;
  try {
    json = JSON.parse(response);
  } catch (err) {
    throw new Error(`Failed to parse YouTube API response: ${(err as Error).message}. Response preview: ${response.substring(0, 200)}`);
  }

  // Check for API-level errors
  if (json.error) {
    const errorMsg = json.error.message || json.error.code || 'Unknown API error';
    throw new Error(`YouTube API error: ${errorMsg}`);
  }

  // Extract transcript segments - handle both WEB and ANDROID response formats
  const webSegments = json?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments;

  const androidSegments = json?.actions?.[0]?.elementsCommand?.transformEntityCommand
    ?.arguments?.transformTranscriptSegmentListArguments?.overwrite?.initialSegments;

  const segments = webSegments || androidSegments || [];

  if (segments.length === 0) {
    throw new Error('No transcript available for this video. The video may not have captions enabled.');
  }

  // Convert to TranscriptLine format
  return segments
    .filter((seg: any) => seg?.transcriptSegmentRenderer) // Skip section headers
    .map((seg: any) => {
      const renderer = seg.transcriptSegmentRenderer;

      // Handle both WEB format (snippet.runs) and ANDROID format (snippet.elementsAttributedString)
      const webText = renderer?.snippet?.runs?.map((r: any) => r.text || '').join('');
      const androidText = renderer?.snippet?.elementsAttributedString?.content;
      const text = webText || androidText || '';

      const startMs = parseInt(renderer?.startMs || '0', 10);
      const endMs = parseInt(renderer?.endMs || '0', 10);

      return {
        text: text,
        start: startMs / 1000,
        dur: (endMs - startMs) / 1000
      };
    })
    .filter((line: TranscriptLine) => line.text.length > 0);
}
