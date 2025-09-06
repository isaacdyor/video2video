import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";

export async function POST(request: NextRequest) {
	try {
		// Configure Fal client with API key (check both common env var names)
		const falApiKey = process.env.FAL_KEY || process.env.FAL_API_KEY;
		
		console.log("[EDIT-FRAME] Checking API key...");
		if (!falApiKey) {
			console.error("[EDIT-FRAME] ❌ No FAL API key found in environment variables");
			console.error("[EDIT-FRAME] Available env vars:", Object.keys(process.env).filter(key => key.includes('FAL')));
			return NextResponse.json(
				{ error: "FAL API key not configured. Please set FAL_KEY or FAL_API_KEY environment variable." },
				{ status: 500 },
			);
		}

		console.log(`[EDIT-FRAME] ✅ API key found: ${falApiKey.substring(0, 10)}...`);
		
		// Configure the client for this request
		fal.config({
			credentials: falApiKey,
		});
		const body = await request.json();
		const { prompt, imageUrls, outputFormat = "png" } = body;

		if (!prompt || !imageUrls || imageUrls.length === 0) {
			return NextResponse.json(
				{ error: "Missing required parameters" },
				{ status: 400 },
			);
		}

		// Call the Fal AI Gemini API
		const result = await fal.subscribe("fal-ai/gemini-25-flash-image/edit", {
			input: {
				prompt,
				image_urls: imageUrls,
				num_images: 1,
				output_format: outputFormat,
				sync_mode: false, // We want URLs, not data URIs
			},
			logs: true,
			onQueueUpdate: (update) => {
				if (update.status === "IN_PROGRESS") {
					console.log("[Fal AI Progress]", update.logs);
				}
			},
		});

		// Return the result
		return NextResponse.json(result.data);
	} catch (error) {
		console.error("Error processing frame:", error);
		return NextResponse.json(
			{ error: "Failed to process frame", details: error },
			{ status: 500 },
		);
	}
}