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

		// Create the meta-prompt focused on merging specific elements
		const metaPrompt = `You are an expert image merging analyst. Your job is to create precise MERGE instructions for an AI image editor that specializes in combining elements from multiple images.

CONTEXT: The user requested this edit: "${userPrompt}"

You are analyzing two images from a video sequence:
- One image shows the DESIRED EFFECT/CHANGE already applied (the edited version)
- One image shows the NEW POSITION/SCENE that needs the effect applied (the current frame)

YOUR ANALYSIS PROCESS:

STEP 1 - IDENTIFY THE SPECIFIC CHANGE:
What exactly did "${userPrompt}" change in the edited image? (hair style, lighting, objects, colors, effects, etc.)

STEP 2 - IDENTIFY SOURCE vs TARGET:
- SOURCE IMAGE: Which image contains the desired change/effect from "${userPrompt}"?
- TARGET IMAGE: Which image has the position/pose/scene where this change should be applied?

STEP 3 - CREATE MERGE INSTRUCTION:
Follow this exact pattern focused on MERGING:

"You have two images to merge: one shows [describe the specific CHANGE/EFFECT from the source], and one shows [describe the TARGET POSITION/SCENE]. Merge the [specific visual elements] from the first image onto the positioning and scene of the second image. Take the [exact change description] and apply it to the [target scene description]. The result should combine the [source effect] with the [target positioning]."

CRITICAL REQUIREMENTS:
- Focus on MERGING specific elements, not "using as reference"
- Be explicit about what gets taken from each image
- Use "merge", "combine", "take from X and apply to Y" language
- Specify the exact visual elements being transferred
- Make it clear this is a combination, not editing with reference

Example for "give this guy long hair":
"You have two images to merge: one shows a man with long flowing hair, and one shows a man with short hair in a different pose. Merge the long hair from the first image onto the head and positioning of the man with short hair. Take the hair length, style, and flow from the long-haired man and apply it to the short-haired man's head position. The result should combine the long hair style with the short-haired man's exact pose and scene."

Generate your merge instruction:`;

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