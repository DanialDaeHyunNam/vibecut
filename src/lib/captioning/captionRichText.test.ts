import { describe, expect, it } from "vitest";
import { hasCaptionMarkup, parseCaptionSegments, stripCaptionMarkup } from "./captionRichText";

describe("captionRichText", () => {
	it("parses inline color spans into ordered segments", () => {
		expect(parseCaptionSegments("Turn {#FFD700|raw} recordings")).toEqual([
			{ text: "Turn " },
			{ text: "raw", color: "#FFD700" },
			{ text: " recordings" },
		]);
	});

	it("supports multiple spans and 8-digit hex", () => {
		expect(parseCaptionSegments("{#f00|A} and {#00FF00CC|B}")).toEqual([
			{ text: "A", color: "#f00" },
			{ text: " and " },
			{ text: "B", color: "#00FF00CC" },
		]);
	});

	it("renders malformed or non-hex spans literally", () => {
		expect(parseCaptionSegments("{red|nope} {#GGG|bad}")).toEqual([
			{ text: "{red|nope} {#GGG|bad}" },
		]);
	});

	it("returns the whole line as one segment when there is no markup", () => {
		expect(parseCaptionSegments("plain 자막")).toEqual([{ text: "plain 자막" }]);
		expect(hasCaptionMarkup("plain 자막")).toBe(false);
	});

	it("strips markup for SRT/labels", () => {
		expect(stripCaptionMarkup("Turn {#FFD700|raw} recordings")).toBe("Turn raw recordings");
	});
});
