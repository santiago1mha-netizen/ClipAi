import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";

const execAsync = promisify(exec);

// Ensure deno is in PATH for yt-dlp
const ENV_WITH_DENO = {
  ...process.env,
  PATH: `/home/codespace/.deno/bin:${process.env.PATH}`,
};

// Base yt-dlp options to avoid bot detection
const YT_DLP_BASE_OPTS = [
  "--remote-components ejs:github",
  "--extractor-args youtube:player_client=web,default",
  "--no-check-certificates",
  "--user-agent 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'",
  "--sleep-interval 1",
  "--max-sleep-interval 3",
].join(" ");

export interface Subtitle {
  start: number;
  end: number;
  text: string;
}

export interface VideoInfo {
  videoId: string;
  title: string;
  duration: number;
  subtitles: Subtitle[];
  videoPath: string;
  audioPath: string;
}

export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

export async function downloadVideo(videoId: string, outputDir: string): Promise<{ videoPath: string; audioPath: string; title: string; duration: number }> {
  const videoPath = path.join(outputDir, `${videoId}.mp4`);
  const audioPath = path.join(outputDir, `${videoId}.mp3`);

  // Get video info first
  try {
    const { stdout: infoJson } = await execAsync(
      `yt-dlp ${YT_DLP_BASE_OPTS} --dump-json "https://www.youtube.com/watch?v=${videoId}"`,
      { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO }
    );
    var info = JSON.parse(infoJson);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    if (errorMsg.includes("not made this video available in your country")) {
      throw new Error("Este vídeo não está disponível na sua região. Tente outro vídeo.");
    }
    if (errorMsg.includes("Video unavailable") || errorMsg.includes("Private video")) {
      throw new Error("Vídeo indisponível ou privado. Verifique o link.");
    }
    if (errorMsg.includes("Sign in to confirm your age")) {
      throw new Error("Este vídeo requer verificação de idade. Tente outro vídeo.");
    }
    if (errorMsg.includes("Sign in to confirm you're not a bot") || errorMsg.includes("bot")) {
      throw new Error("YouTube está pedindo verificação. Tente novamente em alguns minutos ou use outro vídeo.");
    }
    
    throw new Error(`Erro ao obter informações do vídeo: ${errorMsg}`);
  }
  
  const title = info.title || "Unknown";
  const duration = info.duration || 0;

  // Download video (best quality up to 720p for processing speed)
  try {
    await execAsync(
      `yt-dlp ${YT_DLP_BASE_OPTS} -f "bestvideo[height<=720]+bestaudio/best[height<=720]" --merge-output-format mp4 -o "${videoPath}" "https://www.youtube.com/watch?v=${videoId}"`,
      { maxBuffer: 50 * 1024 * 1024, env: ENV_WITH_DENO }
    );
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    throw new Error(`Erro ao baixar vídeo: ${errorMsg}`);
  }

  // Extract audio separately for TTS mixing
  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`,
    { maxBuffer: 10 * 1024 * 1024 }
  );

  return { videoPath, audioPath, title, duration };
}

export async function downloadSubtitles(videoId: string, outputDir: string): Promise<Subtitle[]> {
  const subtitlePath = path.join(outputDir, `${videoId}.srt`);
  
  try {
    // Try to download existing subtitles (auto or manual)
    await execAsync(
      `yt-dlp ${YT_DLP_BASE_OPTS} --write-auto-sub --write-sub --sub-lang pt,en --sub-format srt --skip-download -o "${path.join(outputDir, videoId)}" "https://www.youtube.com/watch?v=${videoId}"`,
      { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO }
    );

    // Find the subtitle file
    const files = await fs.readdir(outputDir);
    const subFile = files.find(f => f.startsWith(videoId) && (f.endsWith(".srt") || f.endsWith(".vtt")));
    
    if (subFile) {
      const content = await fs.readFile(path.join(outputDir, subFile), "utf-8");
      return parseSRT(content);
    }
  } catch (error) {
    console.log("No subtitles found, will use Whisper for transcription");
  }

  return [];
}

function parseSRT(content: string): Subtitle[] {
  const subtitles: Subtitle[] = [];
  const blocks = content.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 2) continue;

    // Find timestamp line
    const timestampLine = lines.find(l => l.includes("-->"));
    if (!timestampLine) continue;

    const [startStr, endStr] = timestampLine.split("-->");
    const start = parseTimestamp(startStr.trim());
    const end = parseTimestamp(endStr.trim());

    // Get text (everything after timestamp)
    const textIndex = lines.indexOf(timestampLine) + 1;
    const text = lines.slice(textIndex).join(" ").replace(/<[^>]*>/g, "").trim();

    if (text && !isNaN(start) && !isNaN(end)) {
      subtitles.push({ start, end, text });
    }
  }

  return subtitles;
}

function parseTimestamp(ts: string): number {
  // Handle both SRT (00:00:00,000) and VTT (00:00:00.000) formats
  const cleaned = ts.replace(",", ".");
  const parts = cleaned.split(":");
  
  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return parseFloat(hours) * 3600 + parseFloat(minutes) * 60 + parseFloat(seconds);
  } else if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return parseFloat(minutes) * 60 + parseFloat(seconds);
  }
  
  return parseFloat(cleaned);
}

export async function transcribeWithWhisper(audioPath: string, openaiApiKey: string): Promise<Subtitle[]> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: openaiApiKey });

  const audioFile = await fs.readFile(audioPath);
  
  // Whisper has a 25MB limit, so we may need to chunk for long videos
  const response = await client.audio.transcriptions.create({
    file: new File([audioFile], "audio.mp3", { type: "audio/mpeg" }),
    model: "whisper-1",
    response_format: "verbose_json",
    timestamp_granularities: ["segment"],
  });

  const subtitles: Subtitle[] = [];
  
  if (response.segments) {
    for (const segment of response.segments) {
      subtitles.push({
        start: segment.start,
        end: segment.end,
        text: segment.text.trim(),
      });
    }
  }

  return subtitles;
}
