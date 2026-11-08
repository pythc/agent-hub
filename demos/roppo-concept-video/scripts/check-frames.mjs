import { bundle } from "@remotion/bundler";
import { getCompositions, openBrowser, renderStill } from "@remotion/renderer";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = process.cwd();
await mkdir(".evidence/frames", { recursive: true });
const serveUrl = await bundle({
  entryPoint: path.resolve("src/index.ts"),
  outDir: path.resolve(".evidence/bundle"),
  onProgress: () => {},
});
const browserExecutable = process.argv[2];
const browser = await openBrowser("chrome", {
  browserExecutable,
  logLevel: "error",
});
try {
  const compositions = await getCompositions(serveUrl, {
    puppeteerInstance: browser,
    logLevel: "error",
  });
  const composition = compositions.find((c) => c.id === "Roppo-Concept");
  if (!composition || composition.durationInFrames !== 4770)
    throw Error("Composition metadata mismatch");
  const frames = process.argv.slice(3).map(Number);
  const targets = frames.length
    ? frames
    : [75, 300, 480, 720, 975, 1230, 1470, 1725, 1830, 1890, 1950, 2100, 2190, 2280, 2400, 2735, 2920, 3210, 3450, 3750, 4040, 4290, 4530, 4710];
  for (const frame of targets) {
    await renderStill({
      serveUrl,
      composition,
      frame,
      output: path.resolve(".evidence/frames/" + frame + ".png"),
      puppeteerInstance: browser,
      logLevel: "error",
    });
    console.log("Checked frame " + frame);
  }
  await writeFile(
    ".evidence/compositions.json",
    JSON.stringify(
      compositions.map(({ id, width, height, fps, durationInFrames }) => ({
        id,
        width,
        height,
        fps,
        durationInFrames,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close({ silent: true });
}
