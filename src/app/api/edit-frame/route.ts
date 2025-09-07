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

		console.log("[EDIT-FRAME] Request details:", {
			promptLength: prompt?.length,
			imageUrlsCount: imageUrls?.length,
			outputFormat,
			imageUrlTypes: imageUrls?.map((url, i) => ({
				index: i,
				isDataUri: url.startsWith('data:'),
				length: url.length,
				preview: url.substring(0, 50) + '...'
			}))
		});

		if (!prompt || !imageUrls || imageUrls.length === 0) {
			console.error("[EDIT-FRAME] ❌ Missing required parameters:", { prompt: !!prompt, imageUrls: !!imageUrls, imageUrlsLength: imageUrls?.length });
			return NextResponse.json(
				{ error: "Missing required parameters" },
				{ status: 400 },
			);
		}

		// Validate prompt length
		if (prompt.length > 2000) {
			console.error("[EDIT-FRAME] ❌ Prompt too long:", prompt.length);
			return NextResponse.json(
				{ error: "Prompt too long. Maximum 2000 characters." },
				{ status: 400 },
			);
		}

		// Validate image URLs/data URIs
		for (let i = 0; i < imageUrls.length; i++) {
			const imageUrl = imageUrls[i];
			if (!imageUrl.startsWith('data:image/') && !imageUrl.startsWith('http')) {
				console.error(`[EDIT-FRAME] ❌ Invalid image URL format at index ${i}:`, imageUrl.substring(0, 100));
				return NextResponse.json(
					{ error: `Invalid image URL format at index ${i}` },
					{ status: 400 },
				);
			}
			
			// Check data URI size (rough estimate)
			if (imageUrl.startsWith('data:') && imageUrl.length > 10 * 1024 * 1024) { // ~10MB limit
				console.error(`[EDIT-FRAME] ❌ Image too large at index ${i}:`, imageUrl.length);
				return NextResponse.json(
					{ error: `Image too large at index ${i}. Please use smaller images.` },
					{ status: 400 },
				);
			}
		}

		// Call the Fal AI Gemini API
		console.log("[EDIT-FRAME] 🚀 Calling fal.ai API...");
		
		try {
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

			console.log("[EDIT-FRAME] ✅ fal.ai API success");
			// Return the result
			return NextResponse.json(result.data);
		} catch (falError) {
			console.error("[EDIT-FRAME] ❌ fal.ai API error:", {
				message: falError.message,
				status: falError.status,
				body: falError.body,
				stack: falError.stack
			});
			
			// Handle validation errors (422) specifically
			if (falError.status === 422) {
				return NextResponse.json(
					{ 
						error: "Invalid input for image editing", 
						details: falError.body || falError.message,
						suggestions: [
							"Check if the image is in a supported format (JPEG, PNG, WebP)",
							"Ensure the image is not too large (max ~10MB)",
							"Verify the prompt is clear and not too long",
							"Make sure the image data is valid base64 or accessible URL"
						]
					},
					{ status: 422 },
				);
			}
			
			// Re-throw for general error handling
			throw falError;
		}
	} catch (error) {
		console.error("[EDIT-FRAME] ❌ General error:", error);
		return NextResponse.json(
			{ error: "Failed to process frame", details: error },
			{ status: 500 },
		);
	}
}