import { describe, expect, it } from "vitest";
import type { AnnotationRegion } from "@/components/video-editor/types";
import { captionsToSrt } from "./srt";

function caption(partial: Partial<AnnotationRegion>): AnnotationRegion {
	return {
		id: "annotation-1",
		startMs: 0,
		endMs: 1000,
		type: "text",
		content: "hello",
		annotationSource: "auto-caption",
		position: { x: 20, y: 80 },
		size: { width: 60, height: 12 },
		style: {} as AnnotationRegion["style"],
		zIndex: 1,
		...partial,
	};
}

describe("captionsToSrt", () => {
	it("serializes sorted caption regions with SRT timecodes", () => {
		const srt = captionsToSrt([
			caption({ id: "b", startMs: 6500, endMs: 11_000, content: "질문 7개면 끝납니다" }),
			caption({ id: "a", startMs: 1500, endMs: 4800, content: "이 집, 지금 살 수 있을까?" }),
		]);
		expect(srt).toBe(
			"1\n00:00:01,500 --> 00:00:04,800\n이 집, 지금 살 수 있을까?\n\n2\n00:00:06,500 --> 00:00:11,000\n질문 7개면 끝납니다\n",
		);
	});

	it("excludes non-caption text annotations and empty lines", () => {
		const srt = captionsToSrt([
			caption({ annotationSource: undefined, content: "제목 오버레이" }),
			caption({ content: "   " }),
			caption({ startMs: 3_600_500, endMs: 3_601_000, content: "over an hour" }),
		]);
		expect(srt).toBe("1\n01:00:00,500 --> 01:00:01,000\nover an hour\n");
	});
});
