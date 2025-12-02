import https from 'https';

interface TranscriptLine {
  text: string;
  start: number;
  dur: number;
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
    0x12, lang.length, ...Buffer.from(lang),      // Field 2, language code
    0x1a, 0x00                                    // Field 3, empty
  ];
  const innerBuf = Buffer.from(innerParts);
  const innerB64 = innerBuf.toString('base64');
  const innerEncoded = encodeURIComponent(innerB64);

  // Outer protobuf
  const panelName = 'engagement-panel-searchable-transcript-search-panel';
  const outerParts: number[] = [
    0x0a, videoId.length, ...Buffer.from(videoId),      // Field 1, video ID
    0x12, innerEncoded.length, ...Buffer.from(innerEncoded), // Field 2, language params
    0x18, 0x01,                                          // Field 3, value 1
    0x2a, panelName.length, ...Buffer.from(panelName),  // Field 5, panel name
    0x30, 0x01,                                          // Field 6, value 1
    0x38, 0x01,                                          // Field 7, value 1
    0x40, 0x01                                           // Field 8, value 1
  ];

  return Buffer.from(outerParts).toString('base64');
}

/**
 * Makes an HTTPS request and returns the response body
 */
function httpsRequest(options: https.RequestOptions, data?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Fetches the YouTube video page and extracts visitor data
 */
async function getVisitorData(videoId: string): Promise<string> {
  const html = await httpsRequest({
    hostname: 'www.youtube.com',
    path: `/watch?v=${videoId}`,
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  const match = html.match(/"visitorData":"([^"]+)"/);
  return match?.[1] || '';
}

/**
 * Fetches transcript using the YouTube internal API
 */
export async function getSubtitles(options: { videoID: string; lang?: string }): Promise<TranscriptLine[]> {
  const { videoID, lang = 'en' } = options;

  // Get visitor data from video page
  const visitorData = await getVisitorData(videoID);

  // Build request payload
  const params = buildParams(videoID, lang);
  const payload = JSON.stringify({
    context: {
      client: {
        hl: lang,
        gl: 'US',
        clientName: 'WEB',
        clientVersion: '2.20251201.01.00',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        visitorData: visitorData
      }
    },
    params: params
  });

  // Make API request
  const response = await httpsRequest({
    hostname: 'www.youtube.com',
    path: '/youtubei/v1/get_transcript?prettyPrint=false',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoID}`
    }
  }, payload);

  // Parse response
  const json = JSON.parse(response);

  if (json.error) {
    throw new Error(`YouTube API error: ${json.error.message}`);
  }

  // Extract transcript segments
  const segments = json?.actions?.[0]?.updateEngagementPanelAction?.content
    ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
    ?.transcriptSegmentListRenderer?.initialSegments || [];

  if (segments.length === 0) {
    throw new Error('No transcript available for this video');
  }

  // Convert to TranscriptLine format
  return segments.map((seg: any) => {
    const renderer = seg?.transcriptSegmentRenderer;
    const text = renderer?.snippet?.runs?.map((r: any) => r.text || '').join('') || '';
    const startMs = parseInt(renderer?.startMs || '0', 10);
    const endMs = parseInt(renderer?.endMs || '0', 10);

    return {
      text: text,
      start: startMs / 1000,
      dur: (endMs - startMs) / 1000
    };
  }).filter((line: TranscriptLine) => line.text.length > 0);
}
