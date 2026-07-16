import type { BrowserWindow, IpcMain } from "electron";
import { createWebcamPreviewWindow } from "../windows";

/**
 * Owns the singleton floating webcam self-view window. The launch window
 * shows/hides it as the user toggles the webcam; a device change while
 * visible is pushed to the existing window instead of recreating it.
 */
export function registerWebcamPreviewHandlers(ipcMain: IpcMain): void {
	let previewWindow: BrowserWindow | null = null;

	ipcMain.handle("webcam-preview-show", async (_event, deviceId?: string) => {
		if (previewWindow && !previewWindow.isDestroyed()) {
			previewWindow.webContents.send("webcam-preview-device", deviceId ?? null);
			return { success: true };
		}
		previewWindow = createWebcamPreviewWindow(deviceId);
		previewWindow.on("closed", () => {
			previewWindow = null;
		});
		return { success: true };
	});

	ipcMain.handle("webcam-preview-hide", async () => {
		if (previewWindow && !previewWindow.isDestroyed()) {
			previewWindow.close();
		}
		previewWindow = null;
		return { success: true };
	});
}
