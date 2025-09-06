export interface ExtractedFrame {
	index: number;
	timestamp: number;
	base64: string;
	filename: string;
}

export interface VideoMetadata {
	duration: number;
	fps: number;
	width: number;
	height: number;
}

export interface EditedFrame {
	index: number;
	base64?: string;
	url?: string;
}

class VideoProcessor {
	async extractFrames(
		videoFile: File,
		options: {
			interval?: number;
			maxFrames?: number;
		} = {},
	): Promise<{
		frames: ExtractedFrame[];
		metadata: VideoMetadata;
	}> {
		const { interval = 30, maxFrames = 10 } = options;

		// Create FormData for file upload
		const formData = new FormData();
		formData.append("video", videoFile);
		formData.append("interval", interval.toString());
		formData.append("maxFrames", maxFrames.toString());

		// Call server-side frame extraction API
		const response = await fetch("/api/extract-frames", {
			method: "POST",
			body: formData,
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || "Failed to extract frames");
		}

		const result = await response.json();
		return {
			frames: result.frames,
			metadata: result.metadata,
		};
	}

	async reassembleVideo(
		frames: EditedFrame[],
		options: {
			fps?: number;
			outputFormat?: "mp4" | "webm";
		} = {},
	): Promise<Blob> {
		const { fps = 30, outputFormat = "mp4" } = options;

		// Call server-side video reassembly API
		const response = await fetch("/api/reassemble-video", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				frames: frames.map(frame => ({
					base64: frame.base64,
					url: frame.url,
				})),
				fps,
				outputFormat,
			}),
		});

		if (!response.ok) {
			const error = await response.json();
			throw new Error(error.error || "Failed to reassemble video");
		}

		const result = await response.json();
		
		// Convert base64 video back to blob
		const base64Data = result.video.replace(/^data:video\/[a-z0-9]+;base64,/, "");
		const videoBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
		
		return new Blob([videoBuffer], { type: `video/${outputFormat}` });
	}
}

export const createVideoProcessor = () => {
	return new VideoProcessor();
};