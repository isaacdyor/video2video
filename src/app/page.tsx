"use client";

import { useState } from "react";
import VideoDropzone from "@/components/VideoDropzone";
import VideoEditor from "@/components/VideoEditor";

export default function Home() {
	const [selectedVideo, setSelectedVideo] = useState<File | null>(null);

	const handleVideoSelect = (file: File) => {
		setSelectedVideo(file);
	};

	const handleComplete = (editedVideo: Blob) => {
		console.log("Video editing complete!", editedVideo);
	};

	const handleCancel = () => {
		setSelectedVideo(null);
	};

	return (
		<div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
			<div className="container mx-auto px-4 py-16">
				<header className="text-center mb-12">
					<h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">
						AI Video Editor
					</h1>
					<p className="text-lg text-gray-600 dark:text-gray-400">
						{selectedVideo
							? "Configure your edits and process the video"
							: "Upload a video to get started"}
					</p>
				</header>

				{!selectedVideo ? (
					<VideoDropzone onVideoSelect={handleVideoSelect} />
				) : (
					<VideoEditor
						videoFile={selectedVideo}
						onComplete={handleComplete}
						onCancel={handleCancel}
					/>
				)}
			</div>
		</div>
	);
}