import * as fs from "fs/promises";
import * as path from "path";

export interface TTSResult {
  audioPath: string;
  duration: number;
}

export async function generateNarration(
  text: string,
  outputDir: string,
  videoId: string
): Promise<TTSResult> {
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // Prefer ElevenLabs for more natural voice, fallback to OpenAI TTS
  if (elevenLabsKey) {
    return generateWithElevenLabs(text, outputDir, videoId, elevenLabsKey);
  } else if (openaiKey) {
    return generateWithOpenAI(text, outputDir, videoId, openaiKey);
  } else {
    throw new Error("Nenhuma API de TTS configurada (ELEVENLABS_API_KEY ou OPENAI_API_KEY)");
  }
}

async function generateWithElevenLabs(
  text: string,
  outputDir: string,
  videoId: string,
  apiKey: string
): Promise<TTSResult> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Default: Rachel

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.5,
          use_speaker_boost: true,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs error: ${error}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const audioPath = path.join(outputDir, `${videoId}_narration.mp3`);
  await fs.writeFile(audioPath, Buffer.from(audioBuffer));

  // Estimate duration based on text length (~150 words per minute)
  const wordCount = text.split(/\s+/).length;
  const duration = (wordCount / 150) * 60;

  return { audioPath, duration };
}

async function generateWithOpenAI(
  text: string,
  outputDir: string,
  videoId: string,
  apiKey: string
): Promise<TTSResult> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey });

  const response = await client.audio.speech.create({
    model: "tts-1-hd",
    voice: "onyx", // Deep, engaging voice good for narration
    input: text,
    speed: 1.0,
  });

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  const audioPath = path.join(outputDir, `${videoId}_narration.mp3`);
  await fs.writeFile(audioPath, audioBuffer);

  // Estimate duration
  const wordCount = text.split(/\s+/).length;
  const duration = (wordCount / 150) * 60;

  return { audioPath, duration };
}

export async function getAudioDuration(audioPath: string): Promise<number> {
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    // Fallback estimation
    return 55;
  }
}
