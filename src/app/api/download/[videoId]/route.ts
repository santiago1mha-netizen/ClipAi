import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs/promises";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ videoId: string }> }
) {
  try {
    const { videoId } = await params;
    
    if (!videoId || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
      return NextResponse.json({ error: "ID inválido" }, { status: 400 });
    }

    const outputDir = path.join(process.cwd(), "output");
    const filePath = path.join(outputDir, `${videoId}_final.mp4`);

    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json(
        { error: "Arquivo não encontrado" },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(filePath);
    const stat = await fs.stat(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": stat.size.toString(),
        "Content-Disposition": `attachment; filename="${videoId}_short.mp4"`,
      },
    });

  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Erro no download" },
      { status: 500 }
    );
  }
}
