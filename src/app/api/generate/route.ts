import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs/promises";
import { generateNarration, getAudioDuration } from "@/lib/tts";
import { generateShort, addSubtitlesToVideo } from "@/lib/video";
import { Scene } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    const { videoId, script, scenes } = await request.json();

    if (!videoId || !script || !scenes) {
      return NextResponse.json(
        { error: "videoId, script e scenes são obrigatórios" },
        { status: 400 }
      );
    }

    const tmpDir = path.join(process.cwd(), "tmp", videoId);
    const outputDir = path.join(process.cwd(), "output");
    
    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Check if video was downloaded
    const videoPath = path.join(tmpDir, `${videoId}.mp4`);
    try {
      await fs.access(videoPath);
    } catch {
      return NextResponse.json(
        { error: "Vídeo não encontrado. Execute a extração primeiro." },
        { status: 400 }
      );
    }

    // Step 1: Generate narration audio
    const { audioPath: narrationPath } = await generateNarration(
      script,
      tmpDir,
      videoId
    );

    // Step 2: Generate the short video
    const shortPath = await generateShort({
      videoPath,
      narrationPath,
      scenes: scenes as Scene[],
      outputDir: tmpDir,
      videoId,
    });

    // Step 3: Add subtitles (optional but recommended for shorts)
    const finalPath = path.join(outputDir, `${videoId}_final.mp4`);
    await addSubtitlesToVideo(shortPath, scenes as Scene[], finalPath);

    // Move to output directory if not already there
    const publicPath = `/api/download/${videoId}`;

    // Cleanup tmp files (keep only the final output)
    try {
      const tmpFiles = await fs.readdir(tmpDir);
      for (const file of tmpFiles) {
        if (!file.includes("_final")) {
          await fs.unlink(path.join(tmpDir, file)).catch(() => {});
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    return NextResponse.json({
      success: true,
      videoId,
      downloadUrl: publicPath,
    });

  } catch (error) {
    console.error("Generate error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro na geração" },
      { status: 500 }
    );
  }
}
