import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { Scene } from "./ai";

const execAsync = promisify(exec);

export interface VideoGenerationOptions {
  videoPath: string;
  narrationPath: string;
  scenes: Scene[];
  outputDir: string;
  videoId: string;
}

export async function generateShort(options: VideoGenerationOptions): Promise<string> {
  const { videoPath, narrationPath, scenes, outputDir, videoId } = options;
  
  // Get narration duration to sync video
  const narrationDuration = await getMediaDuration(narrationPath);
  
  // Step 1: Extract and process each scene clip
  const clipPaths: string[] = [];
  let totalClipDuration = 0;
  
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const clipPath = path.join(outputDir, `clip_${i}.mp4`);
    
    // Calculate clip duration proportional to narration segment
    const words = scene.narrationText.split(/\s+/).length;
    const clipDuration = Math.max(2, Math.min(8, (words / 150) * 60 * 1.1)); // Slightly longer than speech
    
    // Extract clip, convert to vertical (9:16), and remove audio
    await execAsync(`ffmpeg -y -ss ${scene.startTime} -i "${videoPath}" -t ${clipDuration} \
      -vf "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1" \
      -an -c:v libx264 -preset fast -crf 23 "${clipPath}"`, 
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    clipPaths.push(clipPath);
    totalClipDuration += clipDuration;
  }

  // Step 2: Create concat file for ffmpeg
  const concatFile = path.join(outputDir, "concat.txt");
  const concatContent = clipPaths.map(p => `file '${p}'`).join("\n");
  await fs.writeFile(concatFile, concatContent);

  // Step 3: Concatenate all clips
  const concatenatedPath = path.join(outputDir, `${videoId}_concat.mp4`);
  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${concatenatedPath}"`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // Step 4: Adjust video speed to match narration duration
  const videoDuration = await getMediaDuration(concatenatedPath);
  const speedFactor = videoDuration / narrationDuration;
  
  const adjustedPath = path.join(outputDir, `${videoId}_adjusted.mp4`);
  
  if (Math.abs(speedFactor - 1) > 0.1) {
    // Need to adjust speed
    const setpts = speedFactor > 1 ? `setpts=${1/speedFactor}*PTS` : `setpts=${1/speedFactor}*PTS`;
    await execAsync(
      `ffmpeg -y -i "${concatenatedPath}" -filter:v "${setpts}" -an "${adjustedPath}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
  } else {
    // Speed is close enough, just copy
    await fs.copyFile(concatenatedPath, adjustedPath);
  }

  // Step 5: Add narration audio
  const finalPath = path.join(outputDir, `${videoId}_short.mp4`);
  await execAsync(
    `ffmpeg -y -i "${adjustedPath}" -i "${narrationPath}" \
      -c:v copy -c:a aac -b:a 192k \
      -map 0:v:0 -map 1:a:0 \
      -shortest "${finalPath}"`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // Step 6: Ensure final video is under 61 seconds
  const finalDuration = await getMediaDuration(finalPath);
  
  if (finalDuration > 61) {
    const trimmedPath = path.join(outputDir, `${videoId}_final.mp4`);
    await execAsync(
      `ffmpeg -y -i "${finalPath}" -t 61 -c copy "${trimmedPath}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    
    // Cleanup and rename
    await fs.unlink(finalPath);
    await fs.rename(trimmedPath, finalPath);
  }

  // Cleanup intermediate files
  await cleanupIntermediateFiles(outputDir, clipPaths, [
    concatFile, concatenatedPath, adjustedPath
  ]);

  return finalPath;
}

async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`
    );
    return parseFloat(stdout.trim());
  } catch {
    return 55; // Default fallback
  }
}

async function cleanupIntermediateFiles(
  outputDir: string, 
  clipPaths: string[], 
  otherFiles: string[]
): Promise<void> {
  const filesToDelete = [...clipPaths, ...otherFiles];
  
  for (const file of filesToDelete) {
    try {
      await fs.unlink(file);
    } catch {
      // Ignore errors for files that don't exist
    }
  }
}

export async function addSubtitlesToVideo(
  videoPath: string,
  scenes: Scene[],
  outputPath: string
): Promise<string> {
  // Generate ASS subtitle file for animated captions
  const assContent = generateASSSubtitles(scenes);
  const assPath = videoPath.replace(".mp4", ".ass");
  await fs.writeFile(assPath, assContent);

  // Burn subtitles into video
  await execAsync(
    `ffmpeg -y -i "${videoPath}" -vf "ass=${assPath}" -c:a copy "${outputPath}"`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  await fs.unlink(assPath);
  return outputPath;
}

function generateASSSubtitles(scenes: Scene[]): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,0,2,50,50,100,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  let currentTime = 0;
  const events: string[] = [];

  for (const scene of scenes) {
    const words = scene.narrationText.split(/\s+/).length;
    const duration = Math.max(2, (words / 150) * 60);
    
    const startTime = formatASSTime(currentTime);
    const endTime = formatASSTime(currentTime + duration);
    
    // Split long text into multiple lines
    const text = scene.narrationText.replace(/(.{40,}?)\s/g, "$1\\N");
    
    events.push(`Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`);
    currentTime += duration;
  }

  return header + events.join("\n");
}

function formatASSTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  
  return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}
