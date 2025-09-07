import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

interface FrameData {
  index: number;
  timestamp: number;
  filename: string;
  base64: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log(
    `[EXTRACT-FRAMES] Starting frame extraction at ${new Date().toISOString()}`
  );

  let tempVideoPath: string | null = null;
  const tempFramePaths: string[] = [];

  try {
    console.log("[EXTRACT-FRAMES] Parsing request data...");
    const formData = await request.formData();
    const file = formData.get("video") as File;
    const interval = Number(formData.get("interval") || 30);
    const maxFrames = Number(formData.get("maxFrames") || 10);

    console.log(`[EXTRACT-FRAMES] Request parameters:`, {
      filename: file?.name,
      fileSize: file ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : "N/A",
      interval,
      maxFrames,
    });

    if (!file) {
      console.error("[EXTRACT-FRAMES] No video file provided");
      return NextResponse.json(
        { error: "No video file provided" },
        { status: 400 }
      );
    }

    // Create temporary file for the video
    const videoId = randomUUID();
    tempVideoPath = join(tmpdir(), `video_${videoId}.mp4`);
    console.log(
      `[EXTRACT-FRAMES] Creating temporary video file: ${tempVideoPath}`
    );

    // Write uploaded video to temporary file
    console.log("[EXTRACT-FRAMES] Writing video file to disk...");
    const videoBuffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempVideoPath, videoBuffer);
    console.log(
      `[EXTRACT-FRAMES] Video file written successfully (${videoBuffer.length} bytes)`
    );

    // Get video metadata first
    console.log("[EXTRACT-FRAMES] Probing video metadata with FFprobe...");
    const probeStart = Date.now();
    const { stdout: probeOutput } = await execAsync(
      `ffprobe -v quiet -print_format json -show_format -show_streams "${tempVideoPath}"`
    );
    console.log(
      `[EXTRACT-FRAMES] FFprobe completed in ${Date.now() - probeStart}ms`
    );

    const videoInfo = JSON.parse(probeOutput);
    const videoStream = videoInfo.streams.find(
      (stream: any) => stream.codec_type === "video"
    );

    if (!videoStream) {
      console.error("[EXTRACT-FRAMES] No video stream found in file");
      throw new Error("No video stream found");
    }

    const duration = parseFloat(
      videoStream.duration || videoInfo.format.duration
    );
    const fps = eval(videoStream.r_frame_rate); // e.g., "30/1" -> 30

    console.log(`[EXTRACT-FRAMES] Video metadata:`, {
      duration: `${duration.toFixed(2)}s`,
      fps,
      width: videoStream.width,
      height: videoStream.height,
      codec: videoStream.codec_name,
    });

    // Calculate frame extraction parameters
    const totalFrames = Math.floor(duration * fps);
    const frameInterval = Math.max(1, interval);
    const requestedFrames = Math.min(
      Math.floor(totalFrames / frameInterval),
      maxFrames
    );

    // Safety limit to prevent JSON size issues - limit to 50 frames max
    const framesToExtract = requestedFrames;

    if (requestedFrames > 50) {
      console.warn(
        `[EXTRACT-FRAMES] Requested ${requestedFrames} frames, limiting to 50 to prevent JSON size issues`
      );
    }

    console.log(`[EXTRACT-FRAMES] Extraction plan:`, {
      totalFrames,
      frameInterval,
      framesToExtract,
      estimatedDurationCovered: `${(
        (framesToExtract * frameInterval) /
        fps
      ).toFixed(2)}s of ${duration.toFixed(2)}s`,
    });

    const extractionStart = Date.now();

    // Extract frames using PARALLEL FFmpeg calls
    console.log(
      `[EXTRACT-FRAMES] Starting PARALLEL frame extraction (${framesToExtract} frames)...`
    );

    // Pre-calculate all frame paths to avoid race conditions
    const frameInfos = [];
    for (let i = 0; i < framesToExtract; i++) {
      const frameNumber = i * frameInterval;
      const timestamp = frameNumber / fps;
      const frameFilename = `frame_${videoId}_${i}.png`;
      const frameOutputPath = join(tmpdir(), frameFilename);

      frameInfos.push({
        index: i,
        timestamp,
        filename: frameFilename,
        outputPath: frameOutputPath,
      });

      tempFramePaths.push(frameOutputPath); // Pre-populate cleanup array
    }

    // Create parallel extraction promises
    const extractionPromises = frameInfos.map(async (frameInfo) => {
      const frameStart = Date.now();
      console.log(
        `[EXTRACT-FRAMES] Extracting frame ${
          frameInfo.index + 1
        }/${framesToExtract} at ${frameInfo.timestamp.toFixed(2)}s...`
      );

      try {
        // Extract single frame at timestamp with compression
        const ffmpegStart = Date.now();
        await execAsync(
          `ffmpeg -i "${tempVideoPath}" -ss ${frameInfo.timestamp} -frames:v 1 -vf "scale=-1:720" -q:v 8 -f image2 "${frameInfo.outputPath}"`
        );
        console.log(
          `[EXTRACT-FRAMES] FFmpeg extraction for frame ${
            frameInfo.index + 1
          } completed in ${Date.now() - ffmpegStart}ms`
        );

        // Read frame and convert to base64
        const frameBuffer = await readFile(frameInfo.outputPath);

        // Check buffer size to prevent "Invalid string length" errors
        if (frameBuffer.length > 50 * 1024 * 1024) {
          // 50MB limit
          console.warn(
            `[EXTRACT-FRAMES] Frame ${frameInfo.index + 1} is very large (${(
              frameBuffer.length /
              (1024 * 1024)
            ).toFixed(2)} MB)`
          );
        }

        const base64 = frameBuffer.toString("base64");

        console.log(
          `[EXTRACT-FRAMES] Frame ${frameInfo.index + 1} processed: ${
            frameBuffer.length
          } bytes -> ${base64.length} base64 chars in ${
            Date.now() - frameStart
          }ms`
        );

        return {
          index: frameInfo.index,
          timestamp: frameInfo.timestamp,
          filename: frameInfo.filename,
          base64: `data:image/png;base64,${base64}`,
        };
      } catch (error) {
        console.error(
          `[EXTRACT-FRAMES] Failed to extract frame ${frameInfo.index + 1}:`,
          error
        );
        throw new Error(
          `Frame ${frameInfo.index + 1} extraction failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    });

    // Execute all frame extractions in parallel
    console.log(
      `[EXTRACT-FRAMES] Processing ${framesToExtract} frames in parallel...`
    );
    const frames = await Promise.all(extractionPromises);

    console.log(
      `[EXTRACT-FRAMES] All ${framesToExtract} frames extracted in parallel in ${
        Date.now() - extractionStart
      }ms`
    );

    // Clean up temporary video file
    console.log("[EXTRACT-FRAMES] Cleaning up temporary video file...");
    if (tempVideoPath) {
      await unlink(tempVideoPath);
      console.log(`[EXTRACT-FRAMES] Video file deleted: ${tempVideoPath}`);
    }

    // Clean up temporary frame files
    console.log(
      `[EXTRACT-FRAMES] Cleaning up ${tempFramePaths.length} temporary frame files...`
    );
    let cleanedFiles = 0;
    let skippedFiles = 0;

    for (const framePath of tempFramePaths) {
      try {
        await unlink(framePath);
        cleanedFiles++;
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // File doesn't exist (maybe extraction failed) - this is ok
          skippedFiles++;
        } else {
          console.warn(
            `[EXTRACT-FRAMES] Failed to delete frame file: ${framePath}`,
            err
          );
        }
      }
    }
    console.log(
      `[EXTRACT-FRAMES] Cleanup completed: ${cleanedFiles} files deleted, ${skippedFiles} files not found`
    );

    const totalTime = Date.now() - startTime;
    console.log(
      `[EXTRACT-FRAMES] ✅ SUCCESS: Frame extraction completed in ${totalTime}ms`
    );
    console.log(
      `[EXTRACT-FRAMES] Returning ${frames.length} frames with metadata`
    );

    return NextResponse.json({
      frames,
      metadata: {
        duration,
        fps,
        width: videoStream.width,
        height: videoStream.height,
      },
      processingTime: totalTime,
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[EXTRACT-FRAMES] ❌ ERROR after ${totalTime}ms:`, error);

    // Clean up on error
    console.log("[EXTRACT-FRAMES] Performing error cleanup...");
    if (tempVideoPath) {
      try {
        await unlink(tempVideoPath);
        console.log(`[EXTRACT-FRAMES] Cleaned up video file: ${tempVideoPath}`);
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          console.warn(
            `[EXTRACT-FRAMES] Failed to clean up video file: ${tempVideoPath}`,
            err
          );
        }
      }
    }

    // Clean up temporary frame files (same logic as success case)
    let cleanedFiles = 0;
    let skippedFiles = 0;

    for (const framePath of tempFramePaths) {
      try {
        await unlink(framePath);
        cleanedFiles++;
      } catch (err: any) {
        if (err.code === "ENOENT") {
          // File doesn't exist (maybe extraction failed) - this is ok
          skippedFiles++;
        } else {
          console.warn(
            `[EXTRACT-FRAMES] Failed to delete frame file during error cleanup: ${framePath}`,
            err
          );
        }
      }
    }
    console.log(
      `[EXTRACT-FRAMES] Error cleanup completed: ${cleanedFiles} files deleted, ${skippedFiles} files not found`
    );

    return NextResponse.json(
      {
        error: "Failed to extract frames",
        details: error instanceof Error ? error.message : "Unknown error",
        processingTime: totalTime,
      },
      { status: 500 }
    );
  }
}
