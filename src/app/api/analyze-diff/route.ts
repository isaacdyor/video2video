import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
	const startTime = Date.now();
	console.log(`[ANALYZE-DIFF] Starting diff analysis at ${new Date().toISOString()}`);

	try {
		// Get Google API key
		const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!googleApiKey) {
			console.error("[ANALYZE-DIFF] ❌ No Google API key found");
			return NextResponse.json(
				{ error: "Google API key not configured" },
				{ status: 500 },
			);
		}

		console.log(`[ANALYZE-DIFF] ✅ Google API key found`);

		// Parse request
		const { originalPrompt, originalFrameBase64, editedFrameUrl } = await request.json();

		console.log(`[ANALYZE-DIFF] Request parameters:`, {
			originalPrompt: originalPrompt?.substring(0, 100) + (originalPrompt?.length > 100 ? '...' : ''),
			hasOriginalFrame: !!originalFrameBase64,
			hasEditedFrame: !!editedFrameUrl,
		});

		if (!originalPrompt || !originalFrameBase64 || !editedFrameUrl) {
			console.error("[ANALYZE-DIFF] ❌ Missing required parameters");
			return NextResponse.json(
				{ error: "Missing required parameters: originalPrompt, originalFrameBase64, editedFrameUrl" },
				{ status: 400 },
			);
		}

		// Initialize Gemini 2.5 Pro
		const genAI = new GoogleGenerativeAI(googleApiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

		console.log("[ANALYZE-DIFF] Downloading edited frame...");
		
		// Download the edited frame
		const editedFrameResponse = await fetch(editedFrameUrl);
		if (!editedFrameResponse.ok) {
			throw new Error(`Failed to fetch edited frame: ${editedFrameResponse.statusText}`);
		}
		const editedFrameBuffer = await editedFrameResponse.arrayBuffer();
		const editedFrameBase64 = Buffer.from(editedFrameBuffer).toString("base64");

		console.log("[ANALYZE-DIFF] Both images ready, calling Gemini 2.5 Pro for diff analysis...");

		// Create focused diff analysis prompt  
		const diffAnalysisPrompt = `Analyze the difference between these images to create a precise specification for applying "${originalPrompt}".

CRITICAL: 
- Focus ONLY on changes related to "${originalPrompt}". Ignore unrelated differences.
- Keep your response under 5000 characters total.

For changes related to "${originalPrompt}", document:
- Physical attributes: size, shape, proportions
- Colors: specific RGB/hex values
- Position: exact placement and alignment 
- Lighting: shadows, highlights, reflections
- Materials: transparency, texture, finish

Create a specification that another AI could use to apply identical changes.

Example for "add sunglasses":
"Add aviator sunglasses: Gold wire frame 1mm thick, dark gray lenses (RGB: 45,45,45, 80% opacity), 55mm lens width, centered on nose bridge 3mm above nostrils, cast soft shadow (RGB: 120,120,120, 25% opacity) on cheeks, partial eye visibility through tint."

Create specification for "${originalPrompt}":`;

		// Prepare images for Gemini
		const originalFrameImagePart = {
			inlineData: {
				data: originalFrameBase64.replace(/^data:image\/[a-z]+;base64,/, ""),
				mimeType: "image/png",
			},
		};

		const editedFrameImagePart = {
			inlineData: {
				data: editedFrameBase64,
				mimeType: "image/png",
			},
		};

		const apiStart = Date.now();
		console.log("[ANALYZE-DIFF] Calling Gemini 2.5 Pro for detailed diff analysis...");

		// Generate the detailed diff
		const result = await model.generateContent([
			diffAnalysisPrompt,
			"ORIGINAL IMAGE (BEFORE):",
			originalFrameImagePart,
			"EDITED IMAGE (AFTER):",
			editedFrameImagePart,
		]);

		const response = await result.response;
		let detailedDiff = response.text();

		// Enforce 5000 character limit for image model
		if (detailedDiff.length > 5000) {
			console.warn(`[ANALYZE-DIFF] ⚠️ Response too long (${detailedDiff.length} chars), truncating to 5000`);
			detailedDiff = detailedDiff.substring(0, 4997) + "...";
		}

		const apiTime = Date.now() - apiStart;
		console.log(`[ANALYZE-DIFF] ✅ Gemini 2.5 Pro responded in ${apiTime}ms`);
		console.log(`[ANALYZE-DIFF] Generated detailed diff (${detailedDiff.length} chars):`, 
			detailedDiff.substring(0, 300) + '...'
		);

		const totalTime = Date.now() - startTime;
		console.log(`[ANALYZE-DIFF] 🎯 SUCCESS: Detailed diff analysis completed in ${totalTime}ms`);

		return NextResponse.json({
			detailedDiff,
			originalPrompt,
			processingTime: totalTime,
			apiTime,
			diffLength: detailedDiff.length,
		});

	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`[ANALYZE-DIFF] ❌ ERROR after ${totalTime}ms:`, error);

		return NextResponse.json(
			{
				error: "Failed to analyze diff",
				details: error instanceof Error ? error.message : "Unknown error",
				processingTime: totalTime,
			},
			{ status: 500 },
		);
	}
}