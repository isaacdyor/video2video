import type { ExtractedFrame } from "./video-processor";

export interface EditedFrame {
	index: number;
	originalUrl: string;
	editedUrl: string;
	editedBlob?: Blob;
}

export interface EditProgress {
	current: number;
	total: number;
	currentFrame?: number;
	status: "processing" | "completed" | "error";
	message?: string;
}

export class GeminiEditor {
	private onProgress?: (progress: EditProgress) => void;

	constructor(onProgress?: (progress: EditProgress) => void) {
		this.onProgress = onProgress;
	}

	async editFrames(
		frames: ExtractedFrame[],
		prompt: string,
		options: {
			outputFormat?: "jpeg" | "png";
			batchSize?: number;
		} = {},
	): Promise<EditedFrame[]> {
		const { outputFormat = "png" } = options;
		const editedFrames: EditedFrame[] = [];
		let previousEditedUrl: string | null = null;

		for (let i = 0; i < frames.length; i++) {
			const frame = frames[i];

			this.onProgress?.({
				current: i + 1,
				total: frames.length,
				currentFrame: frame.index,
				status: "processing",
				message: `Processing frame ${i + 1} of ${frames.length}`,
			});

			try {
				// Prepare image URLs for the API call
				const imageUrls: string[] = [];

				// Always include the current frame
				imageUrls.push(frame.url);

				// Include the previous edited frame for consistency (except for the first frame)
				if (previousEditedUrl && i > 0) {
					imageUrls.push(previousEditedUrl);
				}

				// Call the API route instead of directly calling Fal
				const response = await fetch("/api/edit-frame", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						prompt,
						imageUrls,
						outputFormat,
					}),
				});

				if (!response.ok) {
					throw new Error(`API request failed: ${response.statusText}`);
				}

				const result = await response.json();

				// The API should return the edited image URL
				const editedUrl = result.images[0].url;

				// Download the edited image as a blob for local processing
				const editedBlob = await this.downloadImage(editedUrl);

				const editedFrame: EditedFrame = {
					index: frame.index,
					originalUrl: frame.url,
					editedUrl,
					editedBlob,
				};

				editedFrames.push(editedFrame);

				// Update the previous edited URL for the next iteration
				previousEditedUrl = editedUrl;
			} catch (error) {
				console.error(`Error processing frame ${i}:`, error);

				this.onProgress?.({
					current: i + 1,
					total: frames.length,
					currentFrame: frame.index,
					status: "error",
					message: `Error processing frame ${i + 1}: ${error}`,
				});

				// Optionally continue with original frame or stop processing
				// For now, we'll continue with the original frame
				editedFrames.push({
					index: frame.index,
					originalUrl: frame.url,
					editedUrl: frame.url,
				});
			}
		}

		this.onProgress?.({
			current: frames.length,
			total: frames.length,
			status: "completed",
			message: "All frames processed successfully",
		});

		return editedFrames;
	}

	private async downloadImage(url: string): Promise<Blob> {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to download image: ${response.statusText}`);
		}
		return await response.blob();
	}

	async convertFramesToBlobs(frames: EditedFrame[]): Promise<Blob[]> {
		const blobs: Blob[] = [];

		for (const frame of frames) {
			if (frame.editedBlob) {
				blobs.push(frame.editedBlob);
			} else {
				// Download the blob if not already available
				const blob = await this.downloadImage(frame.editedUrl);
				blobs.push(blob);
			}
		}

		return blobs;
	}
}

export const createGeminiEditor = (
	onProgress?: (progress: EditProgress) => void,
) => {
	return new GeminiEditor(onProgress);
};