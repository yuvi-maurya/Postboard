import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import authRouter from "./routes/auth.js";
import postsRouter from "./routes/posts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const app = express();
const port = process.env.PORT || 5000;

const requiredEnvironment = [
  ["GOOGLE_CLIENT_ID", "YouTube OAuth"],
  ["GOOGLE_CLIENT_SECRET", "YouTube OAuth"],
  ["META_APP_ID", "Instagram OAuth"],
  ["META_APP_SECRET", "Instagram OAuth"],
  ["PUBLIC_BASE_URL", "Instagram publishing"]
];
const missingEnvironment = requiredEnvironment.filter(([name]) => !process.env[name]);
if (missingEnvironment.length) {
  console.warn(`Configuration warning: missing ${missingEnvironment.map(([name]) => name).join(", ")}. Unavailable features: ${[...new Set(missingEnvironment.map(([, feature]) => feature))].join(", ")}.`);
}

async function reportOrphanedUploads() {
  const posts = await (await import("./repositories/postRepository.js")).postRepository.findAll();
  const referenced = new Set(posts.flatMap((post) => [post.filename, post.processedVideoPath, post.thumbnailPath].filter(Boolean).map((file) => file.replace(/\\/g, "/"))));
  const directories = [
    [path.join(__dirname, "uploads"), ""],
    [path.join(__dirname, "uploads", "processed"), "processed/"],
    [path.join(__dirname, "uploads", "thumbnails"), "thumbnails/"]
  ];
  for (const [directory, prefix] of directories) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
      if (entry.isFile() && entry.name !== ".gitkeep" && !referenced.has(`${prefix}${entry.name}`)) console.warn(`Orphaned upload detected (not deleted): ${path.join(directory, entry.name)}`);
    }
  }
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/auth", authRouter);
app.use("/api/posts", postsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use((error, _req, res, _next) => {
  if (error.code === "LIMIT_FILE_SIZE") {
    const message = error.field === "audio"
      ? "Audio file must be 15MB or smaller."
      : "Media file must be 50MB or smaller.";
    return res.status(400).json({ message });
  }

  if (error.message === "Only JPG, PNG, and MP4 files are supported.") {
    return res.status(400).json({ message: error.message });
  }

  if (error.message === "Only MP3 and WAV audio files are supported.") {
    return res.status(400).json({ message: error.message });
  }
  console.error(error.message);
  return res.status(error.status || 500).json({ message: error.status ? error.message : "An unexpected server error occurred." });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
  reportOrphanedUploads().catch((error) => console.error(`Unable to scan uploads: ${error.message}`));
});
