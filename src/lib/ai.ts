import OpenAI from "openai";
import { Subtitle } from "./youtube";

export interface Scene {
  startTime: number;
  endTime: number;
  narrationText: string;
}

export interface AnalysisResult {
  script: string;
  scenes: Scene[];
}

export async function analyzeAndCreateScript(
  subtitles: Subtitle[],
  title: string,
  openaiApiKey: string
): Promise<AnalysisResult> {
  const client = new OpenAI({ apiKey: openaiApiKey });

  // Prepare subtitle text with timestamps for context
  const subtitleText = subtitles
    .slice(0, 200) // Limit to first ~200 segments to avoid token limits
    .map(s => `[${formatTime(s.start)}-${formatTime(s.end)}] ${s.text}`)
    .join("\n");

  // Step 1: Analyze the content and create a narration script
  const scriptResponse = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Você é um roteirista especializado em criar narrações envolventes para shorts/reels de filmes.
        
Regras:
- Crie uma narração de NO MÁXIMO 150 palavras (aproximadamente 50-55 segundos quando falada)
- Use linguagem simples e direta, estilo TikTok/Reels
- Comece com um gancho que prenda a atenção
- Conte a história de forma envolvente sem dar spoilers do final
- Use frases curtas e impactantes
- Termine com algo que gere curiosidade

Formato de saída: Apenas o texto da narração, sem marcações ou instruções.`
      },
      {
        role: "user",
        content: `Título do vídeo/filme: "${title}"

Legendas/diálogos do vídeo:
${subtitleText}

Crie uma narração envolvente para um short de 1 minuto sobre este conteúdo.`
      }
    ],
    temperature: 0.8,
    max_tokens: 500,
  });

  const script = scriptResponse.choices[0]?.message?.content?.trim() || "";

  // Step 2: Map the script to video timestamps
  const scenesResponse = await client.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Você é um editor de vídeo que mapeia narrações para cenas de vídeo.

Sua tarefa é dividir a narração em 8-12 segmentos e associar cada um a um momento do vídeo original.

Regras:
- Cada segmento deve ter 3-8 segundos de duração
- O tempo total deve ser aproximadamente 55-60 segundos
- Escolha momentos do vídeo que correspondam ao que está sendo narrado
- Use os timestamps das legendas como referência

Formato de saída JSON (array):
[
  {"startTime": 12.5, "endTime": 17.0, "narrationText": "texto da narração para este trecho"},
  ...
]

Retorne APENAS o JSON, sem explicações.`
      },
      {
        role: "user",
        content: `Narração completa:
"${script}"

Legendas com timestamps disponíveis:
${subtitleText}

Divida a narração em segmentos e associe cada um a timestamps do vídeo original.`
      }
    ],
    temperature: 0.3,
    max_tokens: 2000,
  });

  let scenes: Scene[] = [];
  
  try {
    const scenesText = scenesResponse.choices[0]?.message?.content?.trim() || "[]";
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = scenesText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      scenes = JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Error parsing scenes:", error);
    // Fallback: create evenly distributed scenes
    scenes = createFallbackScenes(script, subtitles);
  }

  // Validate and fix scenes
  scenes = validateScenes(scenes, subtitles);

  return { script, scenes };
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function createFallbackScenes(script: string, subtitles: Subtitle[]): Scene[] {
  const sentences = script.split(/[.!?]+/).filter(s => s.trim());
  const scenes: Scene[] = [];
  const totalDuration = 55;
  const segmentDuration = totalDuration / sentences.length;

  let currentTime = subtitles[0]?.start || 0;

  for (const sentence of sentences) {
    if (!sentence.trim()) continue;
    
    scenes.push({
      startTime: currentTime,
      endTime: currentTime + segmentDuration,
      narrationText: sentence.trim(),
    });
    
    // Jump to a different part of the video for variety
    currentTime += Math.max(segmentDuration * 3, 15);
    
    // Wrap around if we exceed available content
    const maxTime = subtitles[subtitles.length - 1]?.end || 300;
    if (currentTime > maxTime - segmentDuration) {
      currentTime = subtitles[Math.floor(subtitles.length / 2)]?.start || 60;
    }
  }

  return scenes;
}

function validateScenes(scenes: Scene[], subtitles: Subtitle[]): Scene[] {
  if (scenes.length === 0) return [];

  const maxTime = subtitles[subtitles.length - 1]?.end || 300;

  return scenes.map(scene => ({
    startTime: Math.max(0, Math.min(scene.startTime, maxTime - 5)),
    endTime: Math.max(scene.startTime + 2, Math.min(scene.endTime, maxTime)),
    narrationText: scene.narrationText,
  }));
}
