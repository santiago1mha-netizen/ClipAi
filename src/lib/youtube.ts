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

// Invidious instances (public YouTube frontends that bypass bot detection)
const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de", 
  "https://invidious.jing.rocks",
  "https://yt.artemislena.eu",
];

// Check if cookies file exists - try multiple locations
async function getCookiesPath(): Promise<string | null> {
  const possiblePaths = [
    path.join(process.cwd(), "cookies.txt"),
    "/workspaces/workspaces/shorts-ai/cookies.txt",
    path.resolve(__dirname, "../../cookies.txt"),
    path.resolve(__dirname, "../../../cookies.txt"),
  ];
  
  for (const p of possiblePaths) {
    try {
      await fs.access(p);
      console.log(`Found cookies at: ${p}`);
      return p;
    } catch {
      continue;
    }
  }
  console.log("No cookies.txt found");
  return null;
}



// Base yt-dlp options
const getYtDlpOpts = async () => {
  const cookiesPath = await getCookiesPath();
  const hasCookies = !!cookiesPath;
  
  // iOS client doesn't support cookies, so use web only when cookies are present
  const playerClient = hasCookies ? "web" : "ios,web";
  
  return [
    "--remote-components ejs:github",
    `--extractor-args youtube:player_client=${playerClient}`,
    "--no-check-certificates", 
    "--no-warnings",
    "--socket-timeout 30",
    hasCookies ? `--cookies "${cookiesPath}"` : "",
  ].filter(Boolean).join(" ");
};

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
  const YT_DLP_OPTS = await getYtDlpOpts();

  let info: any = null;
  let lastError = "";

  // Try YouTube directly first
  console.log(`Attempting to fetch video: ${videoId}`);
  console.log(`Using options: ${YT_DLP_OPTS}`);
  
  try {
    const cmd = `yt-dlp ${YT_DLP_OPTS} --dump-json "https://www.youtube.com/watch?v=${videoId}"`;
    console.log(`Running: ${cmd}`);
    const { stdout: infoJson, stderr } = await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO });
    if (stderr) console.log(`stderr: ${stderr}`);
    info = JSON.parse(infoJson);
    console.log(`Success! Video title: ${info.title}`);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    console.log(`YouTube direct failed with error: ${lastError.substring(0, 500)}`);
  }

  // If YouTube fails, try Invidious instances
  if (!info) {
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        const { stdout: infoJson } = await execAsync(
          `yt-dlp --no-warnings --dump-json "${instance}/watch?v=${videoId}"`,
          { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO }
        );
        info = JSON.parse(infoJson);
        console.log(`Success with Invidious instance: ${instance}`);
        break;
      } catch (e) {
        console.log(`Invidious instance ${instance} failed`);
        continue;
      }
    }
  }

  if (!info) {
    console.log(`All attempts failed. Last error: ${lastError}`);
    
    // Parse the original error for user-friendly message
    // Check for bot detection first (most common)
    if (lastError.includes("Sign in to confirm you're not a bot") || 
        lastError.includes("confirm you're not a bot") ||
        lastError.includes("bot")) {
      throw new Error("O YouTube está bloqueando requisições deste servidor (detecção de bot). Verifique se o arquivo cookies.txt está configurado corretamente.");
    }
    if (lastError.includes("not made this video available in your country") ||
        lastError.includes("not available in your country")) {
      throw new Error("Este vídeo não está disponível na região do servidor. Erro original: " + lastError.substring(0, 200));
    }
    if (lastError.includes("Video unavailable") || lastError.includes("Private video")) {
      throw new Error("Vídeo indisponível ou privado. Verifique o link.");
    }
    if (lastError.includes("Sign in to confirm your age")) {
      throw new Error("Este vídeo requer verificação de idade.");
    }
    // Show the actual error for debugging
    throw new Error(`Erro: ${lastError.substring(0, 300)}`);
  }
  
  const title = info.title || "Unknown";
  const duration = info.duration || 0;

  // Download video - try direct URL from info if available, otherwise use yt-dlp
  try {
    // Try to find a direct video URL from the info
    const videoUrl = info.url || `https://www.youtube.com/watch?v=${videoId}`;
    
    await execAsync(
      `yt-dlp ${YT_DLP_OPTS} -f "bestvideo[height<=720]+bestaudio/best[height<=720]/best" --merge-output-format mp4 -o "${videoPath}" "${videoUrl}"`,
      { maxBuffer: 50 * 1024 * 1024, env: ENV_WITH_DENO }
    );
  } catch (error) {
    // Try Invidious for download
    let downloaded = false;
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        await execAsync(
          `yt-dlp --no-warnings -f "bestvideo[height<=720]+bestaudio/best[height<=720]/best" --merge-output-format mp4 -o "${videoPath}" "${instance}/watch?v=${videoId}"`,
          { maxBuffer: 50 * 1024 * 1024, env: ENV_WITH_DENO }
        );
        downloaded = true;
        break;
      } catch (e) {
        continue;
      }
    }
    if (!downloaded) {
      throw new Error(`Erro ao baixar vídeo. Tente outro link.`);
    }
  }

  // Extract audio separately for TTS mixing
  await execAsync(
    `ffmpeg -i "${videoPath}" -vn -acodec libmp3lame -q:a 2 "${audioPath}" -y`,
    { maxBuffer: 10 * 1024 * 1024 }
  );

  return { videoPath, audioPath, title, duration };
}

export async function downloadSubtitles(videoId: string, outputDir: string): Promise<Subtitle[]> {
  const YT_DLP_OPTS = await getYtDlpOpts();
  
  // Try YouTube directly
  try {
    await execAsync(
      `yt-dlp ${YT_DLP_OPTS} --write-auto-sub --write-sub --sub-lang pt,en --sub-format srt --skip-download -o "${path.join(outputDir, videoId)}" "https://www.youtube.com/watch?v=${videoId}"`,
      { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO }
    );
  } catch (error) {
    // Try Invidious instances
    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        await execAsync(
          `yt-dlp --no-warnings --write-auto-sub --write-sub --sub-lang pt,en --sub-format srt --skip-download -o "${path.join(outputDir, videoId)}" "${instance}/watch?v=${videoId}"`,
          { maxBuffer: 10 * 1024 * 1024, env: ENV_WITH_DENO }
        );
        break;
      } catch (e) {
        continue;
      }
    }
  }

  // Find the subtitle file
  try {
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
