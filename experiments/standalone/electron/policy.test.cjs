const assert = require("node:assert/strict");
const { test } = require("node:test");
const { pdfEnvelope, trustedSender, allowedResource } = require("./policy.cjs");

const svg =
	'<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480px"><text>日本語の成果物</text></svg>';

test("wraps the complete SVG with requested CSS pixel dimensions and no DTD", () => {
	const html = pdfEnvelope(svg, 640, 480);
	assert.match(html, /width:640px;height:480px/);
	assert.match(html, /日本語の成果物/);
	assert.match(html, /default-src 'none'/);
	assert.doesNotMatch(html, /DOCTYPE svg/);
});

test("rejects invalid PDF dimensions, scripts, events, HTML, and external resource SVG", () => {
	for (const size of [0, -1, NaN, Infinity, 32769]) {
		assert.throws(() => pdfEnvelope(svg, size, 100));
		assert.throws(() => pdfEnvelope(svg, 100, size));
	}
	for (const content of [
		"<script>alert(1)</script>",
		"<foreignObject><p>HTML</p></foreignObject>",
		'<text onclick="bad()">bad</text>',
		'<image href="https://example.com/a.png"/>',
		"<style>@import url(https://example.com/a.css)</style>",
		'<use href="file:///etc/passwd"/>',
	]) {
		assert.throws(
			() =>
				pdfEnvelope(
					`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`,
					100,
					100,
				),
			undefined,
			content,
		);
	}
	assert.throws(() => pdfEnvelope("<html>wrong</html>", 100, 100));
});

test("accepts IPC only from the expected window main frame and exact dist entry", () => {
	const url = "file:///prototype/dist/index.html";
	const mainFrame = { url };
	const sender = { mainFrame };
	assert.equal(
		trustedSender({ sender, senderFrame: mainFrame }, sender, url),
		true,
	);
	assert.equal(
		trustedSender({ sender, senderFrame: { url } }, sender, url),
		false,
	);
	assert.equal(
		trustedSender({ sender: {}, senderFrame: mainFrame }, sender, url),
		false,
	);
	mainFrame.url = "https://example.com/";
	assert.equal(
		trustedSender({ sender, senderFrame: mainFrame }, sender, url),
		false,
	);
});

test("limits resources to dist and local data/blob URLs", () => {
	assert.equal(
		allowedResource("file:///prototype/dist/assets/main.js", "/prototype/dist"),
		true,
	);
	assert.equal(
		allowedResource("data:image/svg+xml,test", "/prototype/dist"),
		true,
	);
	assert.equal(allowedResource("blob:null/example", "/prototype/dist"), true);
	for (const url of [
		"https://example.com/",
		"file:///etc/passwd",
		"file:///prototype/dist-other/a.js",
		"file:///prototype/dist/../secret",
	]) {
		assert.equal(allowedResource(url, "/prototype/dist"), false, url);
	}
});
