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
	console.log(`[REASSEMBLE-VIDEO] Starting video reassembly at ${new Date().toISOString()}`);

	let tempDir: string | null = null;
	let tempVideoPath: string | null = null;

	try {
		console.log("[REASSEMBLE-VIDEO] Parsing request data...");
		const { frames, fps = 30, outputFormat = "mp4" } = await request.json();

		console.log(`[REASSEMBLE-VIDEO] Request parameters:`, {
			frameCount: frames?.length || 0,
			fps,
			outputFormat,
		});

		if (!frames || !Array.isArray(frames) || frames.length === 0) {
			console.error("[REASSEMBLE-VIDEO] No frames provided");
			return NextResponse.json(
				{ error: "No frames provided" },
				{ status: 400 },
			);
		}

		// Create temporary directory for frames
		const sessionId = randomUUID();
		tempDir = join(tmpdir(), `video_reassemble_${sessionId}`);
		console.log(`[REASSEMBLE-VIDEO] Creating temporary directory: ${tempDir}`);
		
		if (!existsSync(tempDir)) {
			await mkdir(tempDir, { recursive: true });
			console.log(`[REASSEMBLE-VIDEO] Temporary directory created`);
		}

		// Write all frame images to temporary directory in parallel
		console.log(`[REASSEMBLE-VIDEO] Processing ${frames.length} frames in parallel...`);
		const frameProcessingStart = Date.now();

		const processFrame = async (frame: any, index: number) => {
			const frameStart = Date.now();
			const frameFilename = `frame_${index.toString().padStart(4, "0")}.png`;
			const framePath = join(tempDir!, frameFilename);

			console.log(`[REASSEMBLE-VIDEO] Processing frame ${index + 1}/${frames.length}: ${frameFilename}`);

			// Convert base64 or URL back to buffer
			let frameBuffer: Buffer;
			if (frame.base64) {
				console.log(`[REASSEMBLE-VIDEO] Converting frame ${index + 1} from base64...`);
				// Remove data:image/png;base64, prefix if present
				const base64Data = frame.base64.replace(/^data:image\/[a-z]+;base64,/, "");
				frameBuffer = Buffer.from(base64Data, "base64");
			} else if (frame.url) {
				console.log(`[REASSEMBLE-VIDEO] Fetching frame ${index + 1} from URL: ${frame.url.substring(0, 100)}...`);
				// If it's a URL, fetch the image
				const fetchStart = Date.now();
				const response = await fetch(frame.url);
				if (!response.ok) {
					console.error(`[REASSEMBLE-VIDEO] Failed to fetch frame ${index + 1}: ${response.statusText}`);
					throw new Error(`Failed to fetch frame image: ${response.statusText}`);
				}
				frameBuffer = Buffer.from(await response.arrayBuffer());
				console.log(`[REASSEMBLE-VIDEO] Frame ${index + 1} fetched in ${Date.now() - fetchStart}ms (${frameBuffer.length} bytes)`);
			} else {
				console.error(`[REASSEMBLE-VIDEO] Invalid frame data at index ${index}`);
				throw new Error(`Invalid frame data at index ${index}`);
			}

			await writeFile(framePath, frameBuffer);
			console.log(`[REASSEMBLE-VIDEO] Frame ${index + 1} written to disk in ${Date.now() - frameStart}ms`);
			return framePath;
		};

		// Process all frames in parallel
		const framePaths = await Promise.all(
			frames.map((frame, index) => processFrame(frame, index))
		);

		console.log(`[REASSEMBLE-VIDEO] All ${frames.length} frames processed in ${Date.now() - frameProcessingStart}ms`);

		// Create video from frames using FFmpeg
		const outputFilename = `output_${sessionId}.${outputFormat}`;
		tempVideoPath = join(tempDir, outputFilename);
		console.log(`[REASSEMBLE-VIDEO] Creating video: ${outputFilename}`);

		// Use FFmpeg to create video from image sequence
		const ffmpegCommand = `ffmpeg -framerate ${fps} -pattern_type sequence -i "${join(tempDir, "frame_%04d.png")}" -c:v libx264 -pix_fmt yuv420p -preset fast "${tempVideoPath}"`;
		console.log(`[REASSEMBLE-VIDEO] Executing FFmpeg command: ${ffmpegCommand}`);
		
		const ffmpegStart = Date.now();
		await execAsync(ffmpegCommand);
		console.log(`[REASSEMBLE-VIDEO] FFmpeg video creation completed in ${Date.now() - ffmpegStart}ms`);

		// Read the generated video file
		console.log(`[REASSEMBLE-VIDEO] Reading generated video file...`);
		const readStart = Date.now();
		const videoBuffer = await readFile(tempVideoPath);
		console.log(`[REASSEMBLE-VIDEO] Video file read in ${Date.now() - readStart}ms (${videoBuffer.length} bytes = ${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);

		// Clean up temporary files in parallel
		console.log(`[REASSEMBLE-VIDEO] Starting parallel cleanup...`);
		const cleanupStart = Date.now();
		try {
			// Remove frame files in parallel
			console.log(`[REASSEMBLE-VIDEO] Removing ${framePaths.length} frame files in parallel...`);
			const frameCleanupPromises = framePaths.map(framePath => 
				unlink(framePath).catch(err => 
					console.warn(`[REASSEMBLE-VIDEO] Failed to remove frame ${framePath}:`, err)
				)
			);
			
			// Remove video file
			const videoCleanupPromise = tempVideoPath 
				? unlink(tempVideoPath).then(() => 
					console.log(`[REASSEMBLE-VIDEO] Removed video file: ${tempVideoPath}`)
				).catch(err => 
					console.warn(`[REASSEMBLE-VIDEO] Failed to remove video file:`, err)
				)
				: Promise.resolve();
			
			// Wait for all file deletions to complete
			await Promise.all([...frameCleanupPromises, videoCleanupPromise]);
			
			// Remove temporary directory (after all files are deleted)
			if (tempDir) {
				await unlink(tempDir);
				console.log(`[REASSEMBLE-VIDEO] Removed temporary directory: ${tempDir}`);
			}
		} catch (cleanupError) {
			console.warn("[REASSEMBLE-VIDEO] Cleanup error:", cleanupError);
		}
		console.log(`[REASSEMBLE-VIDEO] Cleanup completed in ${Date.now() - cleanupStart}ms`);

		// Return video as base64 for download
		console.log(`[REASSEMBLE-VIDEO] Converting video to base64...`);
		const base64Start = Date.now();
		const videoBase64 = videoBuffer.toString("base64");
		console.log(`[REASSEMBLE-VIDEO] Base64 conversion completed in ${Date.now() - base64Start}ms`);

		const totalTime = Date.now() - startTime;
		console.log(`[REASSEMBLE-VIDEO] ✅ SUCCESS: Video reassembly completed in ${totalTime}ms`);

		return NextResponse.json({
			video: `data:video/${outputFormat};base64,${videoBase64}`,
			size: videoBuffer.length,
			processingTime: totalTime,
		});
	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`[REASSEMBLE-VIDEO] ❌ ERROR after ${totalTime}ms:`, error);

		// Clean up on error with parallel processing
		console.log("[REASSEMBLE-VIDEO] Performing error cleanup...");
		try {
			const cleanupPromises: Promise<void>[] = [];
			
			// Clean up video file
			if (tempVideoPath) {
				cleanupPromises.push(
					unlink(tempVideoPath)
						.then(() => console.log(`[REASSEMBLE-VIDEO] Cleaned up video file: ${tempVideoPath}`))
						.catch(err => console.warn(`[REASSEMBLE-VIDEO] Failed to clean up video file:`, err))
				);
			}
			
			// Clean up temp directory files
			if (tempDir && existsSync(tempDir)) {
				const { readdirSync } = require("fs");
				const files = readdirSync(tempDir);
				console.log(`[REASSEMBLE-VIDEO] Cleaning up ${files.length} files in temp directory in parallel...`);
				
				// Add parallel file cleanup promises
				files.forEach(file => {
					cleanupPromises.push(
						unlink(join(tempDir, file))
							.catch(err => console.warn(`[REASSEMBLE-VIDEO] Failed to clean up file ${file}:`, err))
					);
				});
			}
			
			// Wait for all file cleanups
			await Promise.all(cleanupPromises);
			
			// Remove temp directory after all files are cleaned
			if (tempDir && existsSync(tempDir)) {
				await unlink(tempDir);
				console.log(`[REASSEMBLE-VIDEO] Cleaned up temp directory: ${tempDir}`);
			}
		} catch (cleanupError) {
			console.warn("[REASSEMBLE-VIDEO] Error during cleanup:", cleanupError);
		}
		console.log("[REASSEMBLE-VIDEO] Error cleanup completed");

		return NextResponse.json(
			{
				error: "Failed to reassemble video",
				details: error instanceof Error ? error.message : "Unknown error",
				processingTime: totalTime,
			},
			{ status: 500 },
		);
	}
}