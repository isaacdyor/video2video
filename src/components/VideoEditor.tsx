"use client";

import { useState } from "react";
import { createVideoProcessor, type ExtractedFrame } from "@/lib/video-processor";
import { createGeminiEditor, type EditProgress, type EditedFrame } from "@/lib/gemini-editor";

interface VideoEditorProps {
	videoFile: File;
	onComplete?: (editedVideo: Blob) => void;
	onCancel?: () => void;
}

type ProcessingStep = "setup" | "extracting" | "preview-frames" | "editing" | "reassembling" | "complete";

export default function VideoEditor({
	videoFile,
	onComplete,
	onCancel,
}: VideoEditorProps) {
	const [currentStep, setCurrentStep] = useState<ProcessingStep>("setup");
	const [prompt, setPrompt] = useState("");
	const [frameInterval, setFrameInterval] = useState(30);
	const [maxFrames, setMaxFrames] = useState(10);
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState<EditProgress | null>(null);
	const [error, setError] = useState<string | null>(null);
	
	// Frame data
	const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
	const [editedFrames, setEditedFrames] = useState<EditedFrame[]>([]);
	const [currentEditingFrame, setCurrentEditingFrame] = useState<number>(-1);
	
	// Video URLs
	const [editedVideoUrl, setEditedVideoUrl] = useState<string | null>(null);
	const [originalVideoUrl] = useState<string>(() =>
		URL.createObjectURL(videoFile),
	);

	// Step 1: Extract frames from video
	const handleExtractFrames = async () => {
		const startTime = Date.now();
		console.log(`[VIDEO-EDITOR] 🎬 Starting frame extraction at ${new Date().toISOString()}`);
		console.log(`[VIDEO-EDITOR] Video file:`, {
			name: videoFile.name,
			size: `${(videoFile.size / (1024 * 1024)).toFixed(2)} MB`,
			type: videoFile.type,
		});
		console.log(`[VIDEO-EDITOR] Extraction settings:`, {
			prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
			frameInterval,
			maxFrames,
		});

		if (!prompt.trim()) {
			console.warn("[VIDEO-EDITOR] ❌ No prompt provided");
			setError("Please enter a prompt");
			return;
		}

		setIsProcessing(true);
		setError(null);
		setCurrentStep("extracting");

		try {
			console.log("[VIDEO-EDITOR] Creating video processor...");
			const videoProcessor = createVideoProcessor();
			
			console.log("[VIDEO-EDITOR] Calling frame extraction API...");
			const extractStart = Date.now();
			const result = await videoProcessor.extractFrames(
				videoFile,
				{
					interval: frameInterval,
					maxFrames,
				},
			);
			
			console.log(`[VIDEO-EDITOR] ✅ Frame extraction completed in ${Date.now() - extractStart}ms`);
			console.log(`[VIDEO-EDITOR] Extracted ${result.frames.length} frames:`, {
				metadata: result.metadata,
				frameTimestamps: result.frames.map(f => `${f.timestamp.toFixed(2)}s`),
			});

			setExtractedFrames(result.frames);
			setCurrentStep("preview-frames");
			
			console.log(`[VIDEO-EDITOR] 🎯 Frame extraction pipeline completed in ${Date.now() - startTime}ms`);
		} catch (err) {
			console.error(`[VIDEO-EDITOR] ❌ Frame extraction failed after ${Date.now() - startTime}ms:`, err);
			setError(err instanceof Error ? err.message : "Failed to extract frames");
			setCurrentStep("setup");
		} finally {
			setIsProcessing(false);
		}
	};

	// Step 2: Process frames through AI
	const handleProcessFrames = async () => {
		const startTime = Date.now();
		console.log(`[VIDEO-EDITOR] 🤖 Starting AI frame processing at ${new Date().toISOString()}`);
		console.log(`[VIDEO-EDITOR] Processing ${extractedFrames.length} frames with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);

		setIsProcessing(true);
		setError(null);
		setCurrentStep("editing");
		setEditedFrames([]);
		setCurrentEditingFrame(0);

		try {
			const editor = createGeminiEditor((editProgress) => {
				setProgress(editProgress);
				if (editProgress.currentFrame !== undefined) {
					setCurrentEditingFrame(editProgress.currentFrame);
				}
			});

			// Set up a callback to update edited frames as they complete
			const processedFrames: EditedFrame[] = [];
			const processingTimes: number[] = [];
			
			for (let i = 0; i < extractedFrames.length; i++) {
				const frameStart = Date.now();
				const frame = extractedFrames[i];
				setCurrentEditingFrame(i);

				console.log(`[VIDEO-EDITOR] Processing frame ${i + 1}/${extractedFrames.length} (timestamp: ${frame.timestamp.toFixed(2)}s)`);

				// Prepare images and create semantic prompt
				const imageUrls: string[] = [frame.base64];
				let finalPrompt = "";

				if (i === 0) {
					// First frame - establish the style
					finalPrompt = `Edit this video frame (frame ${i + 1} of ${extractedFrames.length}):

"${prompt}"

This is the first frame - create a distinctive visual style that will be consistent throughout the video sequence.`;

					console.log(`[VIDEO-EDITOR] Frame 1 using direct prompt`);
				} else {
					// Subsequent frames - generate semantic prompt using AI
					console.log(`[VIDEO-EDITOR] Frame ${i + 1}: Generating semantic prompt...`);
					const semanticPromptStart = Date.now();

					try {
						const semanticResponse = await fetch("/api/generate-semantic-prompt", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
							},
							body: JSON.stringify({
								userPrompt: prompt,
								currentFrameBase64: frame.base64,
								previousEditedFrameUrl: processedFrames[i - 1].editedUrl,
							}),
						});

						if (!semanticResponse.ok) {
							throw new Error(`Semantic prompt generation failed: ${semanticResponse.statusText}`);
						}

						const semanticResult = await semanticResponse.json();
						finalPrompt = semanticResult.semanticPrompt;
						
						// Also include previous frame for reference
						imageUrls.push(processedFrames[i - 1].editedUrl);

						const semanticTime = Date.now() - semanticPromptStart;
						console.log(`[VIDEO-EDITOR] ✅ Semantic prompt generated in ${semanticTime}ms`);
						console.log(`[VIDEO-EDITOR] Semantic prompt preview:`, finalPrompt.substring(0, 300) + '...');

					} catch (semanticError) {
						console.error(`[VIDEO-EDITOR] ❌ Semantic prompt generation failed:`, semanticError);
						
						// Fallback to the previous approach
						finalPrompt = `Edit this video frame (frame ${i + 1} of ${extractedFrames.length}):

"${prompt}"

CONSISTENCY REQUIREMENTS:
- This is part of a video sequence, so maintain visual consistency with previous frames
- Apply the same editing style, color grading, effects, and overall aesthetic as established in the first frame
- Keep the same visual treatment (lighting, contrast, saturation, etc.)
- Ensure smooth visual continuity between frames
- The editing style should look identical to how you edited the previous frames in this sequence

Apply the requested edit while maintaining perfect visual consistency with the established style.`;

						console.log(`[VIDEO-EDITOR] Using fallback prompt due to semantic generation failure`);
					}
				}

				console.log(`[VIDEO-EDITOR] Frame ${i + 1} setup:`, {
					imageCount: imageUrls.length,
					hasReference: i > 0,
					promptLength: finalPrompt.length,
					isSemanticPrompt: i > 0
				});
				console.log(`[VIDEO-EDITOR] Calling Gemini Image Edit API for frame ${i + 1}...`);
				const apiStart = Date.now();

				// Call the API
				const response = await fetch("/api/edit-frame", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt: finalPrompt,
						imageUrls,
						outputFormat: "png",
					}),
				});

				if (!response.ok) {
					console.error(`[VIDEO-EDITOR] ❌ API request failed for frame ${i + 1}: ${response.status} ${response.statusText}`);
					throw new Error(`API request failed: ${response.statusText}`);
				}

				const result = await response.json();
				const editedUrl = result.images[0].url;
				const apiTime = Date.now() - apiStart;
				
				console.log(`[VIDEO-EDITOR] ✅ Frame ${i + 1} edited in ${apiTime}ms`);
				console.log(`[VIDEO-EDITOR] Gemini response:`, {
					imageUrl: editedUrl.substring(0, 100) + '...',
					description: result.description?.substring(0, 200) + (result.description?.length > 200 ? '...' : ''),
				});

				const editedFrame: EditedFrame = {
					index: frame.index,
					originalUrl: frame.base64,
					editedUrl,
				};

				processedFrames.push(editedFrame);
				processingTimes.push(Date.now() - frameStart);
				
				// Update state to show the newly edited frame
				setEditedFrames([...processedFrames]);
				
				const totalFrameTime = Date.now() - frameStart;
				console.log(`[VIDEO-EDITOR] Frame ${i + 1} completed in ${totalFrameTime}ms (API: ${apiTime}ms)`);
			}

			const avgProcessingTime = processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length;
			console.log(`[VIDEO-EDITOR] ✅ All frames processed! Average time per frame: ${avgProcessingTime.toFixed(0)}ms`);

			// Step 3: Reassemble video
			console.log(`[VIDEO-EDITOR] 🎥 Starting video reassembly...`);
			setCurrentStep("reassembling");

			// Convert edited frames to the format needed for reassembly
			const editedFramesForReassembly = processedFrames.map(frame => ({
				index: frame.index,
				url: frame.editedUrl,
			}));

			console.log(`[VIDEO-EDITOR] Calling video reassembly API with ${editedFramesForReassembly.length} frames...`);
			const reassemblyStart = Date.now();

			const videoProcessor = createVideoProcessor();
			const editedVideo = await videoProcessor.reassembleVideo(editedFramesForReassembly, {
				fps: 30,
				outputFormat: "mp4",
			});

			console.log(`[VIDEO-EDITOR] ✅ Video reassembly completed in ${Date.now() - reassemblyStart}ms`);
			console.log(`[VIDEO-EDITOR] Final video size: ${(editedVideo.size / (1024 * 1024)).toFixed(2)} MB`);

			const videoUrl = URL.createObjectURL(editedVideo);
			setEditedVideoUrl(videoUrl);
			setCurrentStep("complete");

			const totalTime = Date.now() - startTime;
			console.log(`[VIDEO-EDITOR] 🎯 COMPLETE! Total pipeline time: ${totalTime}ms`);
			console.log(`[VIDEO-EDITOR] Performance breakdown:`, {
				totalFrames: extractedFrames.length,
				avgFrameTime: `${avgProcessingTime.toFixed(0)}ms`,
				totalProcessingTime: `${totalTime}ms`,
				finalVideoSize: `${(editedVideo.size / (1024 * 1024)).toFixed(2)} MB`,
			});

			onComplete?.(editedVideo);

			// Note: No need to clean up base64 URLs or external URLs
		} catch (err) {
			const totalTime = Date.now() - startTime;
			console.error(`[VIDEO-EDITOR] ❌ Frame processing failed after ${totalTime}ms:`, err);
			console.error(`[VIDEO-EDITOR] Error details:`, {
				currentStep,
				processedFrames: editedFrames.length,
				totalFrames: extractedFrames.length,
				currentEditingFrame,
			});
			setError(err instanceof Error ? err.message : "Failed to process frames");
			setCurrentStep("preview-frames");
		} finally {
			setIsProcessing(false);
			setCurrentEditingFrame(-1);
			console.log(`[VIDEO-EDITOR] Frame processing cleanup completed`);
		}
	};

	const handleDownload = () => {
		if (editedVideoUrl) {
			const a = document.createElement("a");
			a.href = editedVideoUrl;
			a.download = `edited_${videoFile.name}`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
		}
	};

	const handleReset = () => {
		setCurrentStep("setup");
		setExtractedFrames([]);
		setEditedFrames([]);
		setEditedVideoUrl(null);
		setError(null);
		setProgress(null);
	};

	const handleGoToStep = (step: ProcessingStep) => {
		console.log(`[VIDEO-EDITOR] 🔄 Navigating to step: ${step}`);
		setCurrentStep(step);
		setError(null);
		setIsProcessing(false);
		setCurrentEditingFrame(-1);
		
		// Clear step-specific data when going backwards
		if (step === "setup") {
			setExtractedFrames([]);
			setEditedFrames([]);
			setEditedVideoUrl(null);
		} else if (step === "preview-frames") {
			setEditedFrames([]);
			setEditedVideoUrl(null);
		} else if (step === "editing") {
			setEditedVideoUrl(null);
		}
	};

	const handleRetryEditing = () => {
		console.log(`[VIDEO-EDITOR] 🔄 Retrying image editing with ${extractedFrames.length} frames`);
		handleProcessFrames();
	};

	const handleModifyPrompt = () => {
		console.log(`[VIDEO-EDITOR] 🔄 Going back to modify prompt`);
		handleGoToStep("preview-frames");
	};

	return (
		<div className="w-full max-w-7xl mx-auto p-6">
			<div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg">
				{/* Progress Steps Header */}
				<div className="border-b border-gray-200 dark:border-gray-700 p-6">
					<div className="flex items-center justify-between mb-4">
						<h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
							AI Video Editor
						</h2>
						<button
							onClick={onCancel}
							className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
						>
							✕
						</button>
					</div>
					
					{/* Step Indicators */}
					<div className="flex items-center space-x-2">
						<StepIndicator 
							number={1} 
							label="Setup" 
							active={currentStep === "setup"}
							completed={["extracting", "preview-frames", "editing", "reassembling", "complete"].includes(currentStep)}
							onClick={() => handleGoToStep("setup")}
							clickable={true}
						/>
						<div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700" />
						<StepIndicator 
							number={2} 
							label="Extract Frames" 
							active={currentStep === "extracting" || currentStep === "preview-frames"}
							completed={["editing", "reassembling", "complete"].includes(currentStep)}
							onClick={() => extractedFrames.length > 0 && handleGoToStep("preview-frames")}
							clickable={extractedFrames.length > 0}
						/>
						<div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700" />
						<StepIndicator 
							number={3} 
							label="Edit Frames" 
							active={currentStep === "editing"}
							completed={["reassembling", "complete"].includes(currentStep)}
							onClick={() => extractedFrames.length > 0 && handleGoToStep("editing")}
							clickable={extractedFrames.length > 0}
						/>
						<div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700" />
						<StepIndicator 
							number={4} 
							label="Complete" 
							active={currentStep === "reassembling" || currentStep === "complete"}
							completed={currentStep === "complete"}
							onClick={() => editedVideoUrl && handleGoToStep("complete")}
							clickable={!!editedVideoUrl}
						/>
					</div>
				</div>

				<div className="p-6">
					{/* Step 1: Setup */}
					{currentStep === "setup" && (
						<div className="space-y-6">
							<div>
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Edit Prompt
								</label>
								<textarea
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									placeholder="Describe how you want to edit the video (e.g., 'make it look like a vintage film', 'add a cyberpunk aesthetic')"
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
									rows={3}
								/>
							</div>

							<div className="grid grid-cols-2 gap-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
										Frame Interval (extract every N frames)
									</label>
									<input
										type="number"
										min="1"
										max="60"
										value={frameInterval}
										onChange={(e) => setFrameInterval(Number(e.target.value))}
										className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
									/>
								</div>

								<div>
									<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
										Max Frames to Process
									</label>
									<input
										type="number"
										min="1"
										max="100"
										value={maxFrames}
										onChange={(e) => setMaxFrames(Number(e.target.value))}
										className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
									/>
								</div>
							</div>

							<div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
								<h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Original Video Preview
								</h3>
								<video
									src={originalVideoUrl}
									controls
									className="w-full max-w-md rounded-lg bg-gray-100 dark:bg-gray-700"
								/>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
									File size: {(videoFile.size / (1024 * 1024)).toFixed(2)} MB
								</p>
							</div>

							<button
								onClick={handleExtractFrames}
								disabled={!prompt.trim() || isProcessing}
								className="w-full bg-blue-600 text-white px-4 py-3 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
							>
								Extract Frames
							</button>
						</div>
					)}

					{/* Step 2: Extracting */}
					{currentStep === "extracting" && (
						<div className="text-center py-12">
							<div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full mb-4">
								<svg className="animate-spin h-8 w-8 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
								</svg>
							</div>
							<p className="text-gray-600 dark:text-gray-400">Extracting frames from video...</p>
						</div>
					)}

					{/* Step 3: Preview Frames */}
					{currentStep === "preview-frames" && (
						<div className="space-y-6">
							<div>
								<h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
									Extracted Frames ({extractedFrames.length} frames)
								</h3>
								<div className="grid grid-cols-4 md:grid-cols-6 gap-4 max-h-96 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
									{extractedFrames.map((frame, index) => (
										<div key={frame.index} className="relative">
											<img
												src={frame.base64}
												alt={`Frame ${index + 1}`}
												className="w-full h-auto rounded border-2 border-gray-200 dark:border-gray-700"
											/>
											<span className="absolute bottom-1 right-1 text-xs bg-black bg-opacity-50 text-white px-1 rounded">
												{index + 1}
											</span>
											<span className="absolute top-1 left-1 text-xs bg-blue-600 text-white px-1 rounded">
												{frame.timestamp.toFixed(1)}s
											</span>
										</div>
									))}
								</div>
							</div>

							<div className="flex gap-4">
								<button
									onClick={() => handleGoToStep("setup")}
									className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
								>
									← Back to Setup
								</button>
								<button
									onClick={handleProcessFrames}
									disabled={isProcessing}
									className="flex-1 bg-green-600 text-white px-4 py-3 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
								>
									Start AI Editing →
								</button>
							</div>

							{/* Prompt Modification */}
							<div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
								<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Want to modify your prompt?
								</h4>
								<div className="flex gap-4">
									<input
										type="text"
										value={prompt}
										onChange={(e) => setPrompt(e.target.value)}
										className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100 text-sm"
										placeholder="Edit your prompt here..."
									/>
								</div>
								<p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
									You can modify your prompt and reprocess the frames without re-extracting them.
								</p>
							</div>
						</div>
					)}

					{/* Step 4: Editing Frames */}
					{currentStep === "editing" && (
						<div className="space-y-6">
							<div>
								<div className="flex items-center justify-between mb-4">
									<h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
										Processing Frames
									</h3>
									<span className="text-sm text-gray-500 dark:text-gray-400">
										{editedFrames.length} / {extractedFrames.length} completed
									</span>
								</div>

								{/* Progress Bar */}
								<div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-6">
									<div
										className="bg-blue-600 h-2 rounded-full transition-all duration-300"
										style={{
											width: `${(editedFrames.length / extractedFrames.length) * 100}%`,
										}}
									/>
								</div>

								{/* Frame Comparison Grid */}
								<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
									{extractedFrames.map((frame, index) => {
										const editedFrame = editedFrames.find(ef => ef.index === frame.index);
										const isCurrentlyEditing = currentEditingFrame === index;
										
										return (
											<div key={frame.index} className="space-y-2">
												<div className="relative">
													<img
														src={frame.base64}
														alt={`Original ${index + 1}`}
														className={`w-full h-auto rounded border-2 ${
															isCurrentlyEditing ? "border-yellow-500" : "border-gray-200 dark:border-gray-700"
														}`}
													/>
													<span className="absolute top-1 left-1 text-xs bg-black bg-opacity-50 text-white px-1 rounded">
														Original
													</span>
												</div>
												
												<div className="relative">
													{editedFrame ? (
														<img
															src={editedFrame.editedUrl}
															alt={`Edited ${index + 1}`}
															className="w-full h-auto rounded border-2 border-green-500"
														/>
													) : isCurrentlyEditing ? (
														<div className="w-full aspect-video bg-gray-200 dark:bg-gray-700 rounded border-2 border-yellow-500 flex items-center justify-center">
															<svg className="animate-spin h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24">
																<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
																<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
															</svg>
														</div>
													) : (
														<div className="w-full aspect-video bg-gray-100 dark:bg-gray-800 rounded border-2 border-gray-200 dark:border-gray-700 flex items-center justify-center">
															<span className="text-xs text-gray-400">Pending</span>
														</div>
													)}
													{editedFrame && (
														<span className="absolute top-1 left-1 text-xs bg-green-600 text-white px-1 rounded">
															Edited
														</span>
													)}
												</div>
												
												<div className="text-center text-xs text-gray-500 dark:text-gray-400">
													Frame {index + 1}
												</div>
											</div>
										);
									})}
								</div>
							</div>

							{/* Navigation Controls During Editing */}
							{!isProcessing && (
								<div className="mt-6 flex gap-4">
									<button
										onClick={() => handleGoToStep("preview-frames")}
										className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
									>
										← Back to Frames
									</button>
									<button
										onClick={handleRetryEditing}
										className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors font-medium"
									>
										🔄 Retry Editing
									</button>
									<button
										onClick={handleModifyPrompt}
										className="bg-orange-600 text-white px-4 py-2 rounded-md hover:bg-orange-700 transition-colors font-medium"
									>
										✏️ Modify Prompt
									</button>
								</div>
							)}
						</div>
					)}

					{/* Step 5: Reassembling */}
					{currentStep === "reassembling" && (
						<div className="text-center py-12">
							<div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full mb-4">
								<svg className="animate-spin h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24">
									<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
									<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
								</svg>
							</div>
							<p className="text-gray-600 dark:text-gray-400">Reassembling video from edited frames...</p>
						</div>
					)}

					{/* Step 6: Complete */}
					{currentStep === "complete" && editedVideoUrl && (
						<div className="space-y-6">
							<div className="text-center mb-6">
								<div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full mb-4">
									<svg className="h-8 w-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
									</svg>
								</div>
								<h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
									Video Processing Complete!
								</h3>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
								<div>
									<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
										Original Video
									</h4>
									<video
										src={originalVideoUrl}
										controls
										className="w-full rounded-lg bg-gray-100 dark:bg-gray-700"
									/>
								</div>
								<div>
									<h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
										Edited Video
									</h4>
									<video
										src={editedVideoUrl}
										controls
										className="w-full rounded-lg bg-gray-100 dark:bg-gray-700"
									/>
								</div>
							</div>

							<div className="flex gap-4">
								<button
									onClick={() => handleGoToStep("preview-frames")}
									className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
								>
									← Back to Frames
								</button>
								<button
									onClick={handleModifyPrompt}
									className="border border-orange-300 dark:border-orange-600 text-orange-700 dark:text-orange-300 px-4 py-3 rounded-md hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-colors font-medium"
								>
									✏️ Try Different Prompt
								</button>
								<button
									onClick={handleDownload}
									className="flex-1 bg-green-600 text-white px-4 py-3 rounded-md hover:bg-green-700 transition-colors font-medium"
								>
									📥 Download Edited Video
								</button>
								<button
									onClick={handleReset}
									className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 px-4 py-3 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors font-medium"
								>
									🎬 Edit New Video
								</button>
							</div>
						</div>
					)}

					{/* Error Message */}
					{error && (
						<div className="mt-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
							<p className="text-sm text-red-600 dark:text-red-400">{error}</p>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function StepIndicator({ 
	number, 
	label, 
	active, 
	completed,
	onClick,
	clickable = false
}: { 
	number: number; 
	label: string; 
	active: boolean; 
	completed: boolean;
	onClick?: () => void;
	clickable?: boolean;
}) {
	return (
		<div 
			className={`flex flex-col items-center ${clickable ? 'cursor-pointer hover:opacity-75 transition-opacity' : ''}`}
			onClick={clickable ? onClick : undefined}
		>
			<div
				className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold transition-colors ${
					completed
						? "bg-green-600 text-white"
						: active
						? "bg-blue-600 text-white"
						: clickable
						? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500"
						: "bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400"
				}`}
			>
				{completed ? "✓" : number}
			</div>
			<span className={`text-xs mt-1 ${clickable ? 'text-gray-700 dark:text-gray-300' : 'text-gray-600 dark:text-gray-400'}`}>
				{label}
			</span>
		</div>
	);
}