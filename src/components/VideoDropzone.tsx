"use client";

import { useState, useRef, DragEvent, ChangeEvent } from "react";

interface VideoFile {
	id: string;
	file: File;
	name: string;
	size: number;
	url: string;
}

interface VideoDropzoneProps {
	onVideoSelect?: (file: File) => void;
}

export default function VideoDropzone({ onVideoSelect }: VideoDropzoneProps) {
	const [videos, setVideos] = useState<VideoFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleDragEnter = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	};

	const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
	};

	const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
	};

	const handleDrop = (e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);

		const files = Array.from(e.dataTransfer.files);
		processFiles(files);
	};

	const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
		if (e.target.files) {
			const files = Array.from(e.target.files);
			processFiles(files);
		}
	};

	const processFiles = (files: File[]) => {
		const videoFiles = files.filter((file) => file.type.startsWith("video/"));

		const newVideos: VideoFile[] = videoFiles.map((file) => ({
			id: `${Date.now()}-${Math.random()}`,
			file,
			name: file.name,
			size: file.size,
			url: URL.createObjectURL(file),
		}));

		setVideos((prev) => [...prev, ...newVideos]);

		// If only one video is selected and callback is provided, auto-select it
		if (videoFiles.length === 1 && onVideoSelect) {
			onVideoSelect(videoFiles[0]);
		}
	};

	const removeVideo = (id: string) => {
		setVideos((prev) => {
			const video = prev.find((v) => v.id === id);
			if (video) {
				URL.revokeObjectURL(video.url);
			}
			return prev.filter((v) => v.id !== id);
		});
	};

	const formatFileSize = (bytes: number) => {
		if (bytes === 0) return "0 Bytes";
		const k = 1024;
		const sizes = ["Bytes", "KB", "MB", "GB"];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
	};

	const handleClick = () => {
		fileInputRef.current?.click();
	};

	return (
		<div className="w-full max-w-4xl mx-auto p-6">
			<div
				className={`relative border-2 border-dashed rounded-lg p-8 transition-colors ${
					isDragging
						? "border-blue-500 bg-blue-50 dark:bg-blue-950/20"
						: "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
				}`}
				onDragEnter={handleDragEnter}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={handleClick}
			>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					accept="video/*"
					onChange={handleFileSelect}
					className="hidden"
				/>

				<div className="text-center cursor-pointer">
					<svg
						className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
						stroke="currentColor"
						fill="none"
						viewBox="0 0 48 48"
						aria-hidden="true"
					>
						<path
							d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
							strokeWidth={2}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
						<span className="font-semibold">Click to upload</span> or drag and
						drop
					</p>
					<p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
						MP4, MOV, AVI, MKV, WEBM up to 100MB
					</p>
				</div>
			</div>

			{videos.length > 0 && (
				<div className="mt-6 space-y-4">
					<h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
						Uploaded Videos ({videos.length})
					</h3>
					<div className="grid gap-4">
						{videos.map((video) => (
							<div
								key={video.id}
								className="flex items-center justify-between p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700"
							>
								<div className="flex items-center space-x-4 flex-1">
									<div className="w-20 h-14 bg-gray-200 dark:bg-gray-700 rounded overflow-hidden">
										<video
											src={video.url}
											className="w-full h-full object-cover"
											muted
										/>
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
											{video.name}
										</p>
										<p className="text-sm text-gray-500 dark:text-gray-400">
											{formatFileSize(video.size)}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									{onVideoSelect && (
										<button
											onClick={(e) => {
												e.stopPropagation();
												onVideoSelect(video.file);
											}}
											className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
										>
											Edit
										</button>
									)}
									<button
										onClick={(e) => {
											e.stopPropagation();
											removeVideo(video.id);
										}}
										className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 transition-colors"
										aria-label="Remove video"
									>
										<svg
											className="w-5 h-5"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												strokeWidth={2}
												d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
											/>
										</svg>
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}