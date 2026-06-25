//evals.ts

import { EvalConfig } from 'mcp-evals';
import { openai } from "@ai-sdk/openai";
import { grade, EvalFunction } from "mcp-evals";

const get_transcriptEval: EvalFunction = {
    name: "get_transcript Tool Evaluation",
    description: "Evaluates the extraction of transcripts from YouTube video URLs or IDs",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Please extract the English transcript from the YouTube video with ID dQw4w9WgXcQ.");
        return JSON.parse(result);
    }
};

const analyze_videoEval: EvalFunction = {
    name: "analyze_video Tool Evaluation",
    description: "Evaluates prompt-based video analysis with TwelveLabs Pegasus from a direct video URL",
    run: async () => {
        const result = await grade(openai("gpt-4"), "Summarize the video at https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4 in one sentence.");
        return JSON.parse(result);
    }
};

const config: EvalConfig = {
    model: openai("gpt-4"),
    evals: [get_transcriptEval, analyze_videoEval]
};

export default config;

export const evals = [get_transcriptEval, analyze_videoEval];