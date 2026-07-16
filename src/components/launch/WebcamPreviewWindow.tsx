import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Content of the floating webcam self-view window. Opens its own low-res
 * stream for the device the recorder uses (macOS allows concurrent camera
 * access, so this never conflicts with the recording stream). Mirrored like
 * every self-view; draggable via -webkit-app-region; the window itself is
 * content-protected in the main process so it never appears in the capture.
 */
export function WebcamPreviewWindow() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const [deviceId, setDeviceId] = useState<string | null>(() =>
		new URLSearchParams(window.location.search).get("deviceId"),
	);
	const [error, setError] = useState(false);

	// A device change while the window is open arrives over IPC.
	useEffect(() => {
		const unsubscribe = window.electronAPI.onWebcamPreviewDevice?.((nextDeviceId) => {
			setDeviceId(nextDeviceId);
		});
		return unsubscribe;
	}, []);

	useEffect(() => {
		let stream: MediaStream | null = null;
		let cancelled = false;

		(async () => {
			try {
				stream = await navigator.mediaDevices.getUserMedia({
					video: {
						...(deviceId ? { deviceId: { exact: deviceId } } : {}),
						width: { ideal: 640 },
						height: { ideal: 480 },
					},
					audio: false,
				});
				if (cancelled) {
					for (const track of stream.getTracks()) track.stop();
					return;
				}
				setError(false);
				if (videoRef.current) {
					videoRef.current.srcObject = stream;
				}
			} catch (err) {
				console.error("webcam preview stream failed:", err);
				if (!cancelled) setError(true);
			}
		})();

		return () => {
			cancelled = true;
			if (stream) {
				for (const track of stream.getTracks()) track.stop();
			}
		};
	}, [deviceId]);

	return (
		<div
			className="group relative h-screen w-screen overflow-hidden rounded-2xl bg-black ring-1 ring-white/15"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			{error ? (
				<div className="flex h-full w-full items-center justify-center text-xs text-white/50">
					⚠︎
				</div>
			) : (
				<video
					ref={videoRef}
					autoPlay
					muted
					playsInline
					className="h-full w-full object-cover -scale-x-100"
				/>
			)}
			<button
				type="button"
				aria-label="Close"
				onClick={() => void window.electronAPI.webcamPreviewHide?.()}
				className="absolute top-2 right-2 hidden h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white/80 hover:bg-black/80 group-hover:flex"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
