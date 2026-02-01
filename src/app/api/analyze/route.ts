import { NextRequest, NextResponse } from "next/server";
import { analyzeAndCreateScript } from "@/lib/ai";
import { Subtitle } from "@/lib/youtube";

// Increase timeout for AI analysis
export const maxDuration = 120; // 2 minutes

export async function POST(request: NextRequest) {
  try {
    const { videoId, subtitles, title } = await request.json();

    if (!videoId || !subtitles || !title) {
      return NextResponse.json(
        { error: "videoId, subtitles e title são obrigatórios" },
        { status: 400 }
      );
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY não configurada" },
        { status: 500 }
      );
    }

    const result = await analyzeAndCreateScript(
      subtitles as Subtitle[],
      title,
      openaiKey
    );

    return NextResponse.json({
      videoId,
      script: result.script,
      scenes: result.scenes,
    });

  } catch (error) {
    console.error("Analyze error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro na análise" },
      { status: 500 }
    );
  }
}
