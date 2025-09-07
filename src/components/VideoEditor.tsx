"use client";

import { useState, useEffect, useRef } from "react";
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
	const [frameInterval, setFrameInterval] = useState(1);
	const [maxFrames, setMaxFrames] = useState<number | null>(null);
	const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [progress, setProgress] = useState<EditProgress | null>(null);
	const [error, setError] = useState<string | null>(null);
	
	// Frame data
	const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
	const [editedFrames, setEditedFrames] = useState<EditedFrame[]>([]);
	const [currentEditingFrame, setCurrentEditingFrame] = useState<number>(-1);
	
	// Diff analysis data
	const [detailedDiff, setDetailedDiff] = useState<string>("");
	const [firstFrameEdited, setFirstFrameEdited] = useState<string>("");
	
	// Video URLs
	const [editedVideoUrl, setEditedVideoUrl] = useState<string | null>(null);
	const [originalVideoUrl] = useState<string>(() =>
		URL.createObjectURL(videoFile),
	);
	
	// Ref for auto-scrolling
	const framesContainerRef = useRef<HTMLDivElement>(null);

	// Auto-start processing when frames are extracted and we're in editing step
	useEffect(() => {
		if (currentStep === "editing" && extractedFrames.length > 0 && !isProcessing && editedFrames.length === 0) {
			console.log(`[VIDEO-EDITOR] 🚀 Auto-starting frame processing with ${extractedFrames.length} frames`);
			handleProcessFrames();
		}
	}, [currentStep, extractedFrames.length, isProcessing, editedFrames.length]);

	// Auto-scroll to the latest edited frame
	useEffect(() => {
		if (currentStep === "editing" && framesContainerRef.current && editedFrames.length > 0) {
			// Find the latest edited frame (highest index)
			const latestEditedFrame = editedFrames.reduce((latest, current) => 
				current.index > latest.index ? current : latest
			);
			
			// Find the corresponding DOM element for this frame
			const frameElement = framesContainerRef.current.querySelector(`[data-frame-index="${latestEditedFrame.index}"]`);
			if (frameElement) {
				frameElement.scrollIntoView({ 
					behavior: 'smooth', 
					block: 'center' 
				});
			}
		}
	}, [editedFrames.length, currentStep]);

	// Helper function to process a frame using the detailed diff specification
	const processFrameWithDiff = async (
		frame: ExtractedFrame, 
		frameIndex: number, 
		detailedDiffSpec: string, 
		originalPrompt: string
	): Promise<EditedFrame> => {
		console.log(`[VIDEO-EDITOR] Processing frame ${frameIndex + 1} with detailed diff...`);
		
		// Truncate the detailed diff if it's too long to fit within the 2000 char limit
		const maxDiffLength = 1500 - originalPrompt.length; // Leave room for other text
		const truncatedDiff = detailedDiffSpec.length > maxDiffLength 
			? detailedDiffSpec.substring(0, maxDiffLength) + "... [truncated]"
			: detailedDiffSpec;
			
		const diffBasedPrompt = `Apply this specification: "${originalPrompt}"

Details: ${truncatedDiff}

Apply these changes precisely to maintain consistency.`;

		const frameStart = Date.now();
		
		const response = await fetch("/api/edit-frame", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				prompt: diffBasedPrompt,
				imageUrls: [frame.base64],
				outputFormat: "png",
			}),
		});

		if (!response.ok) {
			throw new Error(`Frame ${frameIndex + 1} processing failed: ${response.statusText}`);
		}

		const result = await response.json();
		const editedUrl = result.images[0].url;
		
		const frameTime = Date.now() - frameStart;
		console.log(`[VIDEO-EDITOR] ✅ Frame ${frameIndex + 1} processed in ${frameTime}ms`);

		return {
			index: frameIndex,
			originalUrl: frame.base64,
			editedUrl,
		};
	};

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
			maxFrames: maxFrames || 'unlimited',
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
					maxFrames: maxFrames || undefined,
				},
			);
			
			console.log(`[VIDEO-EDITOR] ✅ Frame extraction completed in ${Date.now() - extractStart}ms`);
			console.log(`[VIDEO-EDITOR] Extracted ${result.frames.length} frames:`, {
				metadata: result.metadata,
				frameTimestamps: result.frames.map(f => `${f.timestamp.toFixed(2)}s`),
			});

			setExtractedFrames(result.frames);
			
			// Skip preview-frames and go directly to editing
			console.log(`[VIDEO-EDITOR] 🚀 Skipping preview, going directly to editing step`);
			setCurrentStep("editing");
			
			console.log(`[VIDEO-EDITOR] 🎯 Frame extraction pipeline completed in ${Date.now() - startTime}ms`);
		} catch (err) {
			console.error(`[VIDEO-EDITOR] ❌ Frame extraction failed after ${Date.now() - startTime}ms:`, err);
			setError(err instanceof Error ? err.message : "Failed to extract frames");
			setCurrentStep("setup");
		} finally {
			setIsProcessing(false);
		}
	};

	// Step 2: NEW WORKFLOW - Process frames through AI
	const handleProcessFrames = async () => {
		const startTime = Date.now();
		console.log(`[VIDEO-EDITOR] 🚀 Starting NEW WORKFLOW: First frame → Diff analysis → Parallel processing`);
		console.log(`[VIDEO-EDITOR] Processing ${extractedFrames.length} frames with prompt: "${prompt.substring(0, 100)}${prompt.length > 100 ? '...' : ''}"`);

		// Safety check - ensure we have frames to process
		if (!extractedFrames || extractedFrames.length === 0) {
			console.error(`[VIDEO-EDITOR] ❌ Cannot process frames: no extracted frames available`);
			setError("No frames available to process. Please extract frames first.");
			return;
		}

		setIsProcessing(true);
		setError(null);
		setCurrentStep("editing");
		setEditedFrames([]);
		setCurrentEditingFrame(0);

		try {
			// PHASE 1: Edit the first frame to establish the change
			console.log(`[VIDEO-EDITOR] 📸 PHASE 1: Editing first frame to establish change...`);
			setProgress({
				current: 1,
				total: extractedFrames.length + 2, // +1 for first frame, +1 for diff analysis
				currentFrame: 0,
				status: "processing",
				message: "Editing first frame to establish change pattern...",
			});

			const firstFrame = extractedFrames[0];
			const firstFramePrompt = `Edit this video frame:

"${prompt}"

This is the first frame - apply the requested change clearly and distinctly.`;

			console.log(`[VIDEO-EDITOR] Calling Gemini Image Edit for first frame...`);
			const firstFrameStart = Date.now();

			const firstFrameResponse = await fetch("/api/edit-frame", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					prompt: firstFramePrompt,
					imageUrls: [firstFrame.base64],
					outputFormat: "png",
				}),
			});

			if (!firstFrameResponse.ok) {
				throw new Error(`First frame editing failed: ${firstFrameResponse.statusText}`);
			}

			const firstFrameResult = await firstFrameResponse.json();
			const firstFrameEditedUrl = firstFrameResult.images[0].url;
			setFirstFrameEdited(firstFrameEditedUrl);

			console.log(`[VIDEO-EDITOR] ✅ First frame edited in ${Date.now() - firstFrameStart}ms`);

			// Add the first frame to edited frames
			const firstEditedFrame: EditedFrame = {
				index: 0,
				originalUrl: firstFrame.base64,
				editedUrl: firstFrameEditedUrl,
			};
			setEditedFrames([firstEditedFrame]);

			// PHASE 2: Analyze the diff to create detailed specification
			console.log(`[VIDEO-EDITOR] 🔍 PHASE 2: Analyzing diff to create detailed specification...`);
			setProgress({
				current: 2,
				total: extractedFrames.length + 2,
				currentFrame: 0,
				status: "processing",
				message: "Analyzing changes to create detailed specification...",
			});

			console.log(`[VIDEO-EDITOR] Calling diff analysis API...`);
			const diffAnalysisStart = Date.now();

			const diffResponse = await fetch("/api/analyze-diff", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					originalPrompt: prompt,
					originalFrameBase64: firstFrame.base64,
					editedFrameUrl: firstFrameEditedUrl,
				}),
			});

			if (!diffResponse.ok) {
				throw new Error(`Diff analysis failed: ${diffResponse.statusText}`);
			}

			const diffResult = await diffResponse.json();
			const detailedDiffSpec = diffResult.detailedDiff;
			setDetailedDiff(detailedDiffSpec);

			console.log(`[VIDEO-EDITOR] ✅ Diff analysis completed in ${Date.now() - diffAnalysisStart}ms`);
			console.log(`[VIDEO-EDITOR] Generated detailed diff specification (${detailedDiffSpec.length} chars):`, 
				detailedDiffSpec.substring(0, 200) + '...'
			);

			// PHASE 3: Process remaining frames IN PARALLEL using the detailed diff
			let allEditedFrames = [firstEditedFrame]; // Initialize with first frame
			
			if (extractedFrames.length > 1) {
				console.log(`[VIDEO-EDITOR] 🚀 PHASE 3: Processing remaining ${extractedFrames.length - 1} frames in PARALLEL...`);
				
				const remainingFrames = extractedFrames.slice(1); // Skip first frame
				let completedFrames = 0;

				// Process frames with streaming updates
				const processFrameWithStreaming = async (frame: ExtractedFrame, frameIndex: number) => {
					try {
						const result = await processFrameWithDiff(frame, frameIndex, detailedDiffSpec, prompt);
						completedFrames++;
						
						// Update UI immediately when this frame completes
						allEditedFrames.push(result);
						setEditedFrames([...allEditedFrames]); // Create new array to trigger re-render
						
						// Update progress for this individual frame
						setProgress({
							current: 2 + completedFrames,
							total: extractedFrames.length + 2,
							currentFrame: frameIndex,
							status: "processing",
							message: `Processing frame ${frameIndex + 1}/${extractedFrames.length} (${completedFrames}/${remainingFrames.length} parallel frames complete)`,
						});
						
						console.log(`[VIDEO-EDITOR] ✅ Frame ${frameIndex} completed (${completedFrames}/${remainingFrames.length})`);
						return result;
					} catch (error) {
						console.error(`[VIDEO-EDITOR] ❌ Frame ${frameIndex} failed:`, error);
						throw error;
					}
				};

				// Create parallel processing promises with streaming updates
				const parallelPromises = remainingFrames.map((frame, i) => 
					processFrameWithStreaming(frame, i + 1)
				);

				// Process all frames in parallel
				console.log(`[VIDEO-EDITOR] 🔄 Processing ${remainingFrames.length} frames in parallel...`);
				const parallelStart = Date.now();
				
				await Promise.all(parallelPromises);
				
				console.log(`[VIDEO-EDITOR] ✅ All ${remainingFrames.length} frames processed in parallel in ${Date.now() - parallelStart}ms`);

				// Final progress update
				setProgress({
					current: extractedFrames.length + 2,
					total: extractedFrames.length + 2,
					status: "processing",
					message: "All frames processed! Preparing for video assembly...",
				});
			}

			// Step 3: Reassemble video with validation and retry logic
			console.log(`[VIDEO-EDITOR] 🎥 Starting video reassembly...`);
			setCurrentStep("reassembling");

			// Convert edited frames to the format needed for reassembly - use local allEditedFrames array
			const editedFramesForReassembly = allEditedFrames.map(frame => ({
				index: frame.index,
				url: frame.editedUrl,
			}));

			console.log(`[VIDEO-EDITOR] Using ${allEditedFrames.length} frames for reassembly (vs ${editedFrames.length} in state)`);

			// Validate URLs before attempting reassembly
			console.log(`[VIDEO-EDITOR] 🔍 Validating frame URLs before reassembly...`);
			const urlValidationPromises = editedFramesForReassembly.slice(0, 3).map(async (frame, index) => {
				try {
					const response = await fetch(frame.url, { method: 'HEAD' });
					const isValid = response.ok;
					console.log(`[VIDEO-EDITOR] Frame ${frame.index} URL validation: ${isValid ? '✅' : '❌'} (${response.status})`);
					return isValid;
				} catch (error) {
					console.log(`[VIDEO-EDITOR] Frame ${frame.index} URL validation: ❌ (${error})`);
					return false;
				}
			});

			const validationResults = await Promise.all(urlValidationPromises);
			const allUrlsValid = validationResults.every(result => result);

			if (!allUrlsValid) {
				console.warn(`[VIDEO-EDITOR] ⚠️ Some URLs appear invalid, but proceeding with reassembly attempt...`);
			}

			console.log(`[VIDEO-EDITOR] Calling video reassembly API with ${editedFramesForReassembly.length} frames...`);
			const reassemblyStart = Date.now();

			let editedVideo;
			let reassemblyAttempt = 1;
			const maxRetries = 2;

			while (reassemblyAttempt <= maxRetries) {
				try {
					console.log(`[VIDEO-EDITOR] Reassembly attempt ${reassemblyAttempt}/${maxRetries}...`);
					const videoProcessor = createVideoProcessor();
					editedVideo = await videoProcessor.reassembleVideo(editedFramesForReassembly, {
						fps: 30,
						outputFormat: "mp4",
					});
					break; // Success, exit retry loop
				} catch (error) {
					console.error(`[VIDEO-EDITOR] ❌ Reassembly attempt ${reassemblyAttempt} failed:`, error);
					
					if (reassemblyAttempt === maxRetries) {
						// Last attempt failed, handle gracefully
						console.error(`[VIDEO-EDITOR] ❌ All reassembly attempts failed. URLs may have expired.`);
						setProgress({
							current: extractedFrames.length + 2,
							total: extractedFrames.length + 2,
							status: "processing",
							message: "Automatic assembly failed. Please use manual assembly button.",
						});
						
						// Don't throw error, just stop automatic flow and show manual controls
						console.log(`[VIDEO-EDITOR] 🔄 Falling back to manual assembly mode`);
						setCurrentStep("editing");
						setIsProcessing(false);
						return; // Exit the function early
					}
					
					reassemblyAttempt++;
					// Wait a bit before retrying
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}

			console.log(`[VIDEO-EDITOR] ✅ Video reassembly completed in ${Date.now() - reassemblyStart}ms`);
			console.log(`[VIDEO-EDITOR] Final video size: ${(editedVideo.size / (1024 * 1024)).toFixed(2)} MB`);

			const videoUrl = URL.createObjectURL(editedVideo);
			setEditedVideoUrl(videoUrl);
			setCurrentStep("complete");

			const totalTime = Date.now() - startTime;
			const avgProcessingTime = allEditedFrames.length > 0 ? totalTime / allEditedFrames.length : 0;
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
		setDetailedDiff("");
		setFirstFrameEdited("");
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
			setDetailedDiff("");
			setFirstFrameEdited("");
		} else if (step === "preview-frames") {
			setEditedFrames([]);
			setEditedVideoUrl(null);
			setDetailedDiff("");
			setFirstFrameEdited("");
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

	const handleManualAssemble = async () => {
		if (editedFrames.length === 0) {
			console.error("[VIDEO-EDITOR] No edited frames available for assembly");
			return;
		}

		console.log(`[VIDEO-EDITOR] 🎬 Manual video assembly with ${editedFrames.length} frames`);
		setCurrentStep("reassembling");
		setIsProcessing(true);

		try {
			// Convert edited frames to the format needed for reassembly
			const editedFramesForReassembly = editedFrames.map(frame => ({
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

			// Create download URL
			const url = URL.createObjectURL(editedVideo);
			setEditedVideoUrl(url);
			setCurrentStep("complete");

			setProgress({
				current: extractedFrames.length + 3,
				total: extractedFrames.length + 3,
				status: "complete",
				message: "Video editing complete!",
			});

		} catch (error) {
			console.error("[VIDEO-EDITOR] Manual assembly failed:", error);
			setError(`Manual assembly failed: ${error instanceof Error ? error.message : "Unknown error"}`);
			setCurrentStep("editing"); // Go back to editing step
		} finally {
			setIsProcessing(false);
		}
	};

	return (
		<div className="w-full h-screen">
			<div className="bg-white dark:bg-gray-800 h-full">
				{/* Progress Steps Header */}
				<div className="border-b border-gray-200 dark:border-gray-700 p-6">
					<div className="flex items-center justify-end mb-4">
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

				<div className="p-6 h-full overflow-auto">
					{/* Step 1: Setup */}
					{currentStep === "setup" && (
						<div className="space-y-6">
							<div>
								<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
									Describe your edits
								</label>
								<textarea
									value={prompt}
									onChange={(e) => setPrompt(e.target.value)}
									placeholder="Describe how you want to edit the video (e.g., 'make it look like a vintage film', 'add a cyberpunk aesthetic')"
									className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
									rows={3}
								/>
							</div>

							{/* Advanced Settings Toggle */}
							<div>
								<button
									type="button"
									onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
									className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
								>
									<span>Advanced Settings</span>
									<svg 
										className={`h-4 w-4 transition-transform ${showAdvancedSettings ? 'rotate-180' : ''}`} 
										fill="none" 
										stroke="currentColor" 
										viewBox="0 0 24 24"
									>
										<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
									</svg>
								</button>
							</div>

							{/* Advanced Settings Panel */}
							{showAdvancedSettings && (
								<div className="grid grid-cols-2 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
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
										<div className="flex items-center gap-2">
											<input
												type="number"
												min="1"
												max="100"
												value={maxFrames || ''}
												onChange={(e) => setMaxFrames(e.target.value ? Number(e.target.value) : null)}
												placeholder="Unlimited"
												className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-gray-100"
											/>
											<button
												type="button"
												onClick={() => setMaxFrames(null)}
												className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 whitespace-nowrap"
											>
												Unlimited
											</button>
										</div>
										<p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
											Leave empty for unlimited frames
										</p>
									</div>
								</div>
							)}

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

								{/* Frame Comparison Grid - Two columns layout */}
								<div 
									ref={framesContainerRef}
									className="max-h-96 overflow-y-auto p-4 bg-gray-50 dark:bg-gray-900 rounded-lg scroll-smooth"
								>
									<div className="space-y-4">
										{extractedFrames.map((frame, index) => {
											const editedFrame = editedFrames.find(ef => ef.index === frame.index);
											const isCurrentlyEditing = currentEditingFrame === index;
											
											return (
												<div key={frame.index} data-frame-index={frame.index} className="grid grid-cols-2 gap-4">
													{/* Original Image - Left Column */}
													<div className="space-y-2">
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
														<div className="text-center text-xs text-gray-500 dark:text-gray-400">
															Frame {index + 1} - Original
														</div>
													</div>
													
													{/* Edited Image - Right Column */}
													<div className="space-y-2">
														<div className="relative">
															{editedFrame ? (
																<img
																	src={editedFrame.editedUrl}
																	alt={`Edited ${index + 1}`}
																	className="w-full h-auto rounded border-2 border-green-500"
																/>
															) : isCurrentlyEditing ? (
																<div className="w-full rounded border-2 border-yellow-500 flex items-center justify-center" style={{ aspectRatio: '16/9', minHeight: '100px' }}>
																	<svg className="animate-spin h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24">
																		<circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
																		<path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
																	</svg>
																</div>
															) : (
																<div className="w-full rounded border-2 border-gray-200 dark:border-gray-700 flex items-center justify-center bg-gray-100 dark:bg-gray-800" style={{ aspectRatio: '16/9', minHeight: '100px' }}>
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
															Frame {index + 1} - {editedFrame ? 'Edited' : isCurrentlyEditing ? 'Processing...' : 'Pending'}
														</div>
													</div>
												</div>
											);
										})}
									</div>
								</div>
							</div>


							{/* Navigation Controls During Editing */}
							{!isProcessing && (
								<div className="mt-6 flex flex-wrap gap-4">
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
									{editedFrames.length > 0 && (
										<button
											onClick={handleManualAssemble}
											className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 transition-colors font-medium"
										>
											🎬 Assemble Video Now
										</button>
									)}
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