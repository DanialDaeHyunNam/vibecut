// Renders an SVG to a transparent PNG using Electron's offscreen renderer.
// qlmanage/QuickLook composites SVG thumbnails onto white, so it can't be
// used for icons that need real alpha (dock/tray). Usage:
//   npx electron scripts/render-icon.mjs <input.svg> <output.png> <size>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";

const [, , inputSvg, outputPng, sizeArg] = process.argv;
const size = Number(sizeArg) || 1024;

if (!inputSvg || !outputPng) {
	console.error("usage: electron scripts/render-icon.mjs <input.svg> <output.png> <size>");
	process.exit(1);
}

app.whenReady().then(async () => {
	const win = new BrowserWindow({
		show: false,
		width: size,
		height: size,
		transparent: true,
		frame: false,
		webPreferences: { offscreen: true },
	});

	const svg = readFileSync(path.resolve(inputSvg), "utf-8");
	const html = `<!doctype html><html><body style="margin:0;background:transparent">
		<img id="i" width="${size}" height="${size}"
			src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}"/>
	</body></html>`;
	await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString("base64")}`);
	// Give the SVG image a beat to decode before capturing.
	await new Promise((resolve) => setTimeout(resolve, 500));

	const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
	writeFileSync(path.resolve(outputPng), image.toPNG());
	console.log(`wrote ${outputPng} (${size}x${size})`);
	app.quit();
});
