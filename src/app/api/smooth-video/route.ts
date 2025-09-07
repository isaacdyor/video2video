import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink, readFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";

const execAsync = promisify(exec);

export async function POST(request: NextRequest) {
	const startTime = Date.now();
	console.log(`[SMOOTH-VIDEO] Starting video smoothing at ${new Date().toISOString()}`);

	let tempDir: string | null = null;
	let inputVideoPath: string | null = null;
	let outputVideoPath: string | null = null;

	try {
		console.log("[SMOOTH-VIDEO] Parsing request data...");
		const { videoData, smoothingLevel = "medium" } = await request.json();

		console.log(`[SMOOTH-VIDEO] Request parameters:`, {
			videoDataLength: videoData?.length || 0,
			smoothingLevel,
		});

		if (!videoData) {
			console.error("[SMOOTH-VIDEO] No video data provided");
			return NextResponse.json(
				{ error: "No video data provided" },
				{ status: 400 },
			);
		}

		// Create temporary directory
		const sessionId = randomUUID();
		tempDir = join(tmpdir(), `video_smooth_${sessionId}`);
		console.log(`[SMOOTH-VIDEO] Creating temporary directory: ${tempDir}`);
		
		if (!existsSync(tempDir)) {
			await mkdir(tempDir, { recursive: true });
			console.log(`[SMOOTH-VIDEO] Temporary directory created`);
		}

		// Write input video to temporary file
		inputVideoPath = join(tempDir, `input_${sessionId}.mp4`);
		console.log(`[SMOOTH-VIDEO] Writing input video to: ${inputVideoPath}`);

		// Convert base64 video data to buffer
		let videoBuffer: Buffer;
		if (videoData.startsWith('data:video/')) {
			// Remove data URL prefix
			const base64Data = videoData.split(',')[1];
			videoBuffer = Buffer.from(base64Data, "base64");
		} else {
			// Assume it's already base64
			videoBuffer = Buffer.from(videoData, "base64");
		}

		await writeFile(inputVideoPath, videoBuffer);
		console.log(`[SMOOTH-VIDEO] Input video written (${videoBuffer.length} bytes = ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);

		// Create output video path
		outputVideoPath = join(tempDir, `smoothed_${sessionId}.mp4`);

		// Build FFmpeg command based on smoothing level
		let ffmpegCommand: string;
		
		switch (smoothingLevel) {
			case "light":
				// Light smoothing - just deflicker
				ffmpegCommand = `ffmpeg -i "${inputVideoPath}" -vf "deflicker=mode=pm:size=3" -c:a copy "${outputVideoPath}"`;
				break;
			case "heavy":
				// Heavy smoothing - balanced blend with crispness (minimal frame mixing with strong current frame weight)
				ffmpegCommand = `ffmpeg -i "${inputVideoPath}" -vf "deflicker=mode=pm:size=7,hqdn3d=luma_spatial=1:chroma_spatial=1:luma_tmp=10:chroma_tmp=8,tmix=frames=3:weights='1 8 1':scale=10,unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=0.8" -c:a copy "${outputVideoPath}"`;
				break;
			case "medium":
			default:
				// Medium smoothing - balanced approach (the best combo from your request)
				ffmpegCommand = `ffmpeg -i "${inputVideoPath}" -vf "deflicker=mode=pm:size=5,hqdn3d=luma_spatial=0:chroma_spatial=0:luma_tmp=8:chroma_tmp=6,tmix=frames=3:weights='1 3 1':scale=5" -c:a copy "${outputVideoPath}"`;
				break;
		}

		console.log(`[SMOOTH-VIDEO] Executing FFmpeg smoothing command (${smoothingLevel}): ${ffmpegCommand}`);
		
		const ffmpegStart = Date.now();
		try {
			const { stdout, stderr } = await execAsync(ffmpegCommand);
			console.log(`[SMOOTH-VIDEO] FFmpeg stdout:`, stdout);
			if (stderr) {
				console.log(`[SMOOTH-VIDEO] FFmpeg stderr:`, stderr);
			}
		} catch (error: any) {
			console.error(`[SMOOTH-VIDEO] FFmpeg error:`, error);
			throw new Error(`FFmpeg smoothing failed: ${error.message}`);
		}
		
		console.log(`[SMOOTH-VIDEO] FFmpeg smoothing completed in ${Date.now() - ffmpegStart}ms`);

		// Read the smoothed video file
		console.log(`[SMOOTH-VIDEO] Reading smoothed video file...`);
		const readStart = Date.now();
		const smoothedVideoBuffer = await readFile(outputVideoPath);
		console.log(`[SMOOTH-VIDEO] Smoothed video file read in ${Date.now() - readStart}ms (${smoothedVideoBuffer.length} bytes = ${(smoothedVideoBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);

		// Clean up temporary files
		console.log(`[SMOOTH-VIDEO] Starting cleanup...`);
		const cleanupStart = Date.now();
		try {
			if (inputVideoPath) {
				await unlink(inputVideoPath);
				console.log(`[SMOOTH-VIDEO] Removed input video file`);
			}
			if (outputVideoPath) {
				await unlink(outputVideoPath);
				console.log(`[SMOOTH-VIDEO] Removed output video file`);
			}
			if (tempDir) {
				await unlink(tempDir);
				console.log(`[SMOOTH-VIDEO] Removed temporary directory`);
			}
		} catch (cleanupError) {
			console.warn("[SMOOTH-VIDEO] Cleanup error:", cleanupError);
		}
		console.log(`[SMOOTH-VIDEO] Cleanup completed in ${Date.now() - cleanupStart}ms`);

		// Return smoothed video as base64
		console.log(`[SMOOTH-VIDEO] Converting smoothed video to base64...`);
		const base64Start = Date.now();
		const videoBase64 = smoothedVideoBuffer.toString("base64");
		console.log(`[SMOOTH-VIDEO] Base64 conversion completed in ${Date.now() - base64Start}ms`);

		const totalTime = Date.now() - startTime;
		console.log(`[SMOOTH-VIDEO] ✅ SUCCESS: Video smoothing completed in ${totalTime}ms`);

		return NextResponse.json({
			video: `data:video/mp4;base64,${videoBase64}`,
			size: smoothedVideoBuffer.length,
			processingTime: totalTime,
			smoothingLevel,
		});
	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`[SMOOTH-VIDEO] ❌ ERROR after ${totalTime}ms:`, error);

		// Clean up on error
		console.log("[SMOOTH-VIDEO] Performing error cleanup...");
		try {
			if (inputVideoPath) {
				await unlink(inputVideoPath);
				console.log(`[SMOOTH-VIDEO] Cleaned up input video file`);
			}
			if (outputVideoPath) {
				await unlink(outputVideoPath);
				console.log(`[SMOOTH-VIDEO] Cleaned up output video file`);
			}
			if (tempDir && existsSync(tempDir)) {
				const { readdirSync } = require("fs");
				const files = readdirSync(tempDir);
				console.log(`[SMOOTH-VIDEO] Cleaning up ${files.length} files in temp directory...`);
				for (const file of files) {
					await unlink(join(tempDir, file));
				}
				await unlink(tempDir);
				console.log(`[SMOOTH-VIDEO] Cleaned up temp directory`);
			}
		} catch (cleanupError) {
			console.warn("[SMOOTH-VIDEO] Error during cleanup:", cleanupError);
		}
		console.log("[SMOOTH-VIDEO] Error cleanup completed");

		return NextResponse.json(
			{
				error: "Failed to smooth video",
				details: error instanceof Error ? error.message : "Unknown error",
				processingTime: totalTime,
			},
			{ status: 500 },
		);
	}
}