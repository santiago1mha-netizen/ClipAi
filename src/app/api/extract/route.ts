import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs/promises";
import { 
  extractVideoId, 
  downloadVideo, 
  downloadSubtitles, 
  transcribeWithWhisper 
} from "@/lib/youtube";

// Increase timeout for long video downloads
export const maxDuration = 300; // 5 minutes

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: "URL é obrigatória" }, { status: 400 });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return NextResponse.json({ error: "URL do YouTube inválida" }, { status: 400 });
    }

    // Create temp directory for this video
    const tmpDir = path.join(process.cwd(), "tmp", videoId);
    await fs.mkdir(tmpDir, { recursive: true });

    // Download video and audio
    const { videoPath, audioPath, title, duration } = await downloadVideo(videoId, tmpDir);

    // Try to get subtitles from YouTube
    let subtitles = await downloadSubtitles(videoId, tmpDir);

    // If no subtitles, use Whisper
    if (subtitles.length === 0) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return NextResponse.json(
          { error: "OPENAI_API_KEY não configurada para transcrição" },
          { status: 500 }
        );
      }
      subtitles = await transcribeWithWhisper(audioPath, openaiKey);
    }

    return NextResponse.json({
      videoId,
      title,
      duration,
      subtitles,
      videoPath,
      audioPath,
    });

  } catch (error) {
    console.error("Extract error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro na extração" },
      { status: 500 }
    );
  }
}
