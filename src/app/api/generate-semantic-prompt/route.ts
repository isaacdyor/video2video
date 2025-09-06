import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
	const startTime = Date.now();
	console.log(`[GENERATE-SEMANTIC-PROMPT] Starting semantic prompt generation at ${new Date().toISOString()}`);

	try {
		// Get Google API key
		const googleApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
		if (!googleApiKey) {
			console.error("[GENERATE-SEMANTIC-PROMPT] ❌ No Google API key found");
			return NextResponse.json(
				{ error: "Google API key not configured" },
				{ status: 500 },
			);
		}

		console.log(`[GENERATE-SEMANTIC-PROMPT] ✅ Google API key found`);

		// Parse request
		const { userPrompt, currentFrameBase64, previousEditedFrameUrl } = await request.json();

		console.log(`[GENERATE-SEMANTIC-PROMPT] Request parameters:`, {
			userPrompt: userPrompt?.substring(0, 100) + (userPrompt?.length > 100 ? '...' : ''),
			hasCurrentFrame: !!currentFrameBase64,
			hasPreviousFrame: !!previousEditedFrameUrl,
		});

		if (!userPrompt || !currentFrameBase64 || !previousEditedFrameUrl) {
			console.error("[GENERATE-SEMANTIC-PROMPT] ❌ Missing required parameters");
			return NextResponse.json(
				{ error: "Missing required parameters: userPrompt, currentFrameBase64, previousEditedFrameUrl" },
				{ status: 400 },
			);
		}

		// Initialize Gemini 2.5 Pro
		const genAI = new GoogleGenerativeAI(googleApiKey);
		const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

		console.log("[GENERATE-SEMANTIC-PROMPT] Downloading previous edited frame...");
		
		// Download the previous edited frame
		const previousFrameResponse = await fetch(previousEditedFrameUrl);
		if (!previousFrameResponse.ok) {
			throw new Error(`Failed to fetch previous frame: ${previousFrameResponse.statusText}`);
		}
		const previousFrameBuffer = await previousFrameResponse.arrayBuffer();
		const previousFrameBase64 = Buffer.from(previousFrameBuffer).toString("base64");

		console.log("[GENERATE-SEMANTIC-PROMPT] Both images ready, calling Gemini 2.5 Pro...");

		// Create the meta-prompt
		const metaPrompt = `You are an expert image editing analyst. Your job is to create precise editing instructions for an AI image editor.

CONTEXT: The user requested this edit: "${userPrompt}"

You are analyzing two images from a video sequence:
- One image already has the user's requested edit successfully applied
- One image is the original that still needs the edit applied

YOUR ANALYSIS PROCESS:

STEP 1 - UNDERSTAND THE USER'S INTENT:
What does "${userPrompt}" mean? What should the final result look like?

STEP 2 - IDENTIFY WHICH IMAGE IS WHICH:
Examine both images carefully:
- Which image already demonstrates the successful result of "${userPrompt}"?
- Which image is in the original state before "${userPrompt}" was applied?

STEP 3 - CREATE SEMANTIC DESCRIPTIONS:
REFERENCE IMAGE (already edited): Describe the visual characteristics that show the completed edit
TARGET IMAGE (needs editing): Describe its current unedited state

STEP 4 - GENERATE EDITING INSTRUCTION:
Follow this exact pattern:

"You are editing a video frame. You see two images: one shows [detailed REFERENCE description with completed edit], and one shows [detailed TARGET description in original state]. Your task is to edit the [TARGET semantic description] to achieve [specific visual changes] exactly like shown in the [REFERENCE semantic description]. You are ONLY modifying the [TARGET description], using the reference as a visual guide. Apply the same [specific effects/changes] to transform the target image."

CRITICAL REQUIREMENTS:
- Use semantic descriptions of visual content, never positions
- Make it absolutely clear which image to edit vs reference
- Specify exactly what visual elements to transfer/apply
- Ensure the instruction will reproduce the user's original request
- Be precise about the transformation needed

Example for "give this guy long hair":
"You are editing a video frame. You see two images: one shows a man with flowing long hair reaching his shoulders, and one shows the same man with a short cropped haircut. Your task is to edit the man with short hair to have flowing long hair exactly like shown in the reference image of the man with long hair. You are ONLY modifying the short-haired man, using the long-haired reference as a visual guide. Apply the same hair length and style to transform the target image."

Generate your editing instruction:`;

		// Prepare images for Gemini
		const currentFrameImagePart = {
			inlineData: {
				data: currentFrameBase64.replace(/^data:image\/[a-z]+;base64,/, ""),
				mimeType: "image/png",
			},
		};

		const previousFrameImagePart = {
			inlineData: {
				data: previousFrameBase64,
				mimeType: "image/png",
			},
		};

		const apiStart = Date.now();
		console.log("[GENERATE-SEMANTIC-PROMPT] Calling Gemini 2.5 Pro with images...");

		// Generate the semantic prompt
		const result = await model.generateContent([
			metaPrompt,
			currentFrameImagePart,
			previousFrameImagePart,
		]);

		const response = await result.response;
		const semanticPrompt = response.text();

		const apiTime = Date.now() - apiStart;
		console.log(`[GENERATE-SEMANTIC-PROMPT] ✅ Gemini 2.5 Pro responded in ${apiTime}ms`);
		console.log(`[GENERATE-SEMANTIC-PROMPT] Generated semantic prompt (${semanticPrompt.length} chars):`, 
			semanticPrompt.substring(0, 200) + '...'
		);

		const totalTime = Date.now() - startTime;
		console.log(`[GENERATE-SEMANTIC-PROMPT] 🎯 SUCCESS: Semantic prompt generation completed in ${totalTime}ms`);

		return NextResponse.json({
			semanticPrompt,
			processingTime: totalTime,
			apiTime,
		});

	} catch (error) {
		const totalTime = Date.now() - startTime;
		console.error(`[GENERATE-SEMANTIC-PROMPT] ❌ ERROR after ${totalTime}ms:`, error);

		return NextResponse.json(
			{
				error: "Failed to generate semantic prompt",
				details: error instanceof Error ? error.message : "Unknown error",
				processingTime: totalTime,
			},
			{ status: 500 },
		);
	}
}