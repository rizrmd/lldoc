import { LiteParse } from "@llamaindex/liteparse";
import path from "node:path";

function envInt(name, fallback) {
  const raw = process.env[name];
  return raw ? Number.parseInt(raw, 10) : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

const sourcePath = process.argv[2];

if (!sourcePath) {
  console.error("Usage: node scripts/liteparse_parse.mjs <file>");
  process.exit(1);
}

const parser = new LiteParse({
  outputFormat: "json",
  ocrEnabled: envBool("LITEPARSE_OCR_ENABLED", true),
  ocrLanguage: process.env.LITEPARSE_OCR_LANGUAGE ?? "en",
  maxPages: envInt("LITEPARSE_MAX_PAGES", 1000),
  dpi: envInt("LITEPARSE_DPI", 150),
  targetPages: process.env.LITEPARSE_TARGET_PAGES || undefined,
});

try {
  const result = await parser.parse(sourcePath, true);
  const payload = {
    sourcePath: path.resolve(sourcePath),
    text: result.text,
    pages: result.pages.map((page) => ({
      pageNum: page.pageNum,
      width: page.width,
      height: page.height,
      text: page.text,
    })),
  };
  process.stdout.write(JSON.stringify(payload));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
