import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import ffprobePath from "ffprobe-static";
import { google } from "googleapis";
import { getYoutubeAuthClient } from "./auth.js";
import multer from "multer";
import { accountRepository } from "../repositories/accountRepository.js";
import { postRepository } from "../repositories/postRepository.js";
import { buildPublicMediaUrl } from "../utils/mediaUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDirectory = path.join(__dirname, "..", "uploads");
const processedDirectory = path.join(uploadsDirectory, "processed");
const thumbnailsDirectory = path.join(uploadsDirectory, "thumbnails");
const tempAudioDirectory = path.join(uploadsDirectory, "tmp-audio");
const router = express.Router();
const maxFileSize = 50 * 1024 * 1024;
const allowedExtensions = new Set([".jpg", ".jpeg", ".png", ".mp4"]);
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "video/mp4"]);
const audioExtensions = new Set([".mp3", ".wav"]);
const audioMimeTypes = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav"]);
const publishingLocks = new Set();

function publishLock(platform) {
  return (req, res, next) => {
    const key = `${req.params.id}:${platform}`;
    if (publishingLocks.has(key)) return res.status(409).json({ message: "Already publishing." });
    publishingLocks.add(key);
    res.on("finish", () => publishingLocks.delete(key));
    return next();
  };
}
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath.path);

await Promise.all([
  mkdir(processedDirectory, { recursive: true }),
  mkdir(thumbnailsDirectory, { recursive: true }),
  mkdir(tempAudioDirectory, { recursive: true })
]);

const storage = multer.diskStorage({
  destination: uploadsDirectory,
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: maxFileSize },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!allowedExtensions.has(extension) || !allowedMimeTypes.has(file.mimetype)) {
      return callback(new Error("Only JPG, PNG, and MP4 files are supported."));
    }
    return callback(null, true);
  }
});

const audioUpload = multer({
  storage: multer.diskStorage({
    destination: tempAudioDirectory,
    filename: (_req, file, callback) => {
      callback(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    }
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!audioExtensions.has(extension) || !audioMimeTypes.has(file.mimetype)) {
      return callback(new Error("Only MP3 and WAV audio files are supported."));
    }
    return callback(null, true);
  }
});

function toPublicPost(post, req) {
  return {
    ...post,
    mediaUrl: `${req.protocol}://${req.get("host")}/uploads/${encodeURIComponent(post.filename)}`,
    thumbnailUrl: post.thumbnailPath
      ? `${req.protocol}://${req.get("host")}/uploads/${post.thumbnailPath.split(/[\\/]/).map(encodeURIComponent).join("/")}`
      : null,
    processedMediaUrl: post.processedVideoPath
      ? `${req.protocol}://${req.get("host")}/uploads/${post.processedVideoPath.split(/[\\/]/).map(encodeURIComponent).join("/")}`
      : null
  };
}

function getStoredMediaPath(post) {
  return path.join(uploadsDirectory, post.processedVideoPath || post.filename);
}

function generateThumbnail(videoPath, thumbnailPath, timestamp) {
  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .outputOptions([`-ss ${timestamp}`, "-frames:v 1"])
      .output(thumbnailPath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });
}

async function createVideoThumbnail(videoPath, thumbnailPath) {
  try {
    await generateThumbnail(videoPath, thumbnailPath, 1);
  } catch (error) {
    await generateThumbnail(videoPath, thumbnailPath, 0);
  }
}

function mergeAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (probeError, metadata) => {
      if (probeError) return reject(probeError);
      const duration = metadata.format?.duration;
      if (!duration) return reject(new Error("Unable to determine the video duration."));

      ffmpeg(videoPath)
        .input(audioPath)
        .outputOptions([
          "-map 0:v:0",
          "-map 1:a:0",
          "-c:v copy",
          "-c:a aac",
          `-t ${duration}`,
          "-movflags +faststart"
        ])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });
  });
}

function getYoutubePrivacyStatus(value) {
  const allowedStatuses = new Set(["public", "unlisted", "private"]);
  return allowedStatuses.has(value) ? value : null;
}

function getYoutubeErrorMessage(error) {
  const reason = error.errors?.[0]?.reason;
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "userRateLimitExceeded") {
    return "YouTube upload quota exceeded. Please try again after the quota resets.";
  }
  return error.message || "YouTube upload failed.";
}

function getInstagramErrorMessage(error) {
  return error.message || "Instagram publishing failed.";
}

async function instagramGraphRequest(pathname, options = {}) {
  const response = await fetch(`https://graph.facebook.com/v20.0${pathname}`, options);
  const body = await response.json();
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || "Instagram Graph API request failed.");
  }
  return body;
}

function instagramCaption(post) {
  // Instagram captions are limited to 2,200 characters.
  return `${post.caption || ""}${post.caption && post.description ? "\n\n" : ""}${post.description || ""}`.slice(0, 2200);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForInstagramVideo(containerId, accessToken) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const status = await instagramGraphRequest(`/${containerId}?fields=status_code&access_token=${encodeURIComponent(accessToken)}`);
    if (status.status_code === "FINISHED") return;
    if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
      throw new Error(`Instagram media processing failed with status ${status.status_code}.`);
    }
    await delay(3000);
  }
  throw new Error("Instagram video processing timed out before the container finished.");
}

router.get("/publishing-config", (_req, res) => {
  res.json({ instagramPublicUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL?.trim()) });
});

router.post("/:id/publish/all", async (req, res, next) => {
  const post = await postRepository.findById(req.params.id);
  if (!post) return res.status(404).json({ message: "Post not found." });

  const platforms = ["instagram"];
  if (post.mediaType === "video") platforms.unshift("youtube");
  const results = await Promise.all(platforms.map(async (platform) => {
    const account = await accountRepository.findByPlatform(platform);
    if (!account?.connected) return { status: "skipped", error: `${platform} is not connected.` };
    if (platform === "instagram" && !process.env.PUBLIC_BASE_URL?.trim()) {
      return { status: "failed", error: "PUBLIC_BASE_URL is required for Instagram publishing." };
    }
    try {
      const response = await fetch(`${req.protocol}://${req.get("host")}/api/posts/${post.id}/publish/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: platform === "youtube" ? JSON.stringify({ privacyStatus: req.body.privacyStatus || "public" }) : undefined
      });
      const body = await response.json();
      const platformData = body.platforms?.[platform];
      return platformData || { status: response.ok ? "posted" : "failed", error: body.message };
    } catch (error) {
      return { status: "failed", error: error.message };
    }
  }));
  return res.json(Object.fromEntries(results.map((result, index) => [platforms[index], result])));
});

router.post("/:id/publish/instagram", publishLock("instagram"), async (req, res, next) => {
  let post;
  try {
    post = await postRepository.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });

    const account = await accountRepository.findByPlatform("instagram");
    if (!account?.connected || !account.accessToken || !account.accountId) {
      const error = new Error("Instagram not connected.");
      error.status = 401;
      throw error;
    }

    const mediaUrl = buildPublicMediaUrl(post.processedVideoPath || post.filename);
    const caption = instagramCaption(post);
    const params = new URLSearchParams({
      access_token: account.accessToken,
      caption
    });
    if (post.mediaType === "video") {
      params.set("video_url", mediaUrl);
      params.set("media_type", "REELS");
    } else {
      params.set("image_url", mediaUrl);
    }

    const container = await instagramGraphRequest(`/${account.accountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params
    });
    if (!container.id) throw new Error("Instagram did not return a media container ID.");
    if (post.mediaType === "video") {
      await waitForInstagramVideo(container.id, account.accessToken);
    }

    const publishParams = new URLSearchParams({
      access_token: account.accessToken,
      creation_id: container.id
    });
    const published = await instagramGraphRequest(`/${account.accountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: publishParams
    });
    if (!published.id) throw new Error("Instagram did not return a published media ID.");

    const media = await instagramGraphRequest(`/${published.id}?fields=permalink&access_token=${encodeURIComponent(account.accessToken)}`);
    const updatedPost = await postRepository.updateInstagramStatus(post.id, {
      status: "posted",
      mediaId: published.id,
      permalink: media.permalink ?? null,
      postedAt: new Date().toISOString(),
      error: null
    });
    return res.json(toPublicPost(updatedPost, req));
  } catch (error) {
    if (!post) return next(error);
    const message = getInstagramErrorMessage(error);
    try {
      await postRepository.updateInstagramStatus(post.id, {
        status: "failed",
        mediaId: null,
        permalink: null,
        postedAt: null,
        error: message
      });
    } catch (updateError) {
      return next(updateError);
    }
    return res.status(error.status ?? 502).json({ message });
  }
});

router.post("/:id/publish/youtube", publishLock("youtube"), async (req, res, next) => {
  let post;
  try {
    post = await postRepository.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (post.mediaType !== "video") {
      return res.status(400).json({ message: "YouTube only supports video uploads" });
    }

    const privacyStatus = req.body.privacyStatus === undefined
      ? "public"
      : getYoutubePrivacyStatus(req.body.privacyStatus);
    if (!privacyStatus) {
      return res.status(400).json({ message: "privacyStatus must be public, unlisted, or private." });
    }

    const youtubeClient = await getYoutubeAuthClient();
    const mediaPath = getStoredMediaPath(post);
    const mediaStats = await stat(mediaPath);
    const youtube = google.youtube({ version: "v3", auth: youtubeClient });
    const response = await youtube.videos.insert({
      part: ["snippet", "status"],
      requestBody: {
        snippet: {
          title: (post.caption || "Untitled video").slice(0, 100),
          description: post.description || "",
          categoryId: "22"
        },
        status: { privacyStatus }
      },
      media: {
        body: createReadStream(mediaPath),
        mimeType: "video/mp4",
        resumable: true,
        uploadType: "resumable",
        uploadSize: mediaStats.size
      }
    });

    const videoId = response.data.id;
    if (!videoId) throw new Error("YouTube did not return a video ID.");
    const updatedPost = await postRepository.updateYoutubeStatus(post.id, {
      status: "posted",
      videoId,
      videoUrl: `https://youtube.com/watch?v=${videoId}`,
      postedAt: new Date().toISOString(),
      error: null
    });
    return res.json(toPublicPost(updatedPost, req));
  } catch (error) {
    if (!post) return next(error);
    const message = getYoutubeErrorMessage(error);
    try {
      await postRepository.updateYoutubeStatus(post.id, {
        status: "failed",
        videoId: null,
        videoUrl: null,
        postedAt: null,
        error: message
      });
    } catch (updateError) {
      return next(updateError);
    }
    if (error.status === 401) return res.status(401).json({ message });
    if (message.startsWith("YouTube upload quota exceeded")) {
      return res.status(502).json({ message });
    }
    return res.status(502).json({ message });
  }
});

router.post("/", upload.single("media"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "A media file is required." });
    }

    const caption = (req.body.caption ?? "").trim();
    const description = (req.body.description ?? "").trim();
    if (!caption) {
      await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: "Caption is required." });
    }
    if (caption.length > 200) {
      await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: "Caption must be 200 characters or fewer." });
    }
    if (description.length > 3000) {
      await unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: "Description must be 3000 characters or fewer." });
    }

    const post = await postRepository.create({
      id: randomUUID(),
      filename: req.file.filename,
      mediaType: req.file.mimetype.startsWith("video/") ? "video" : "image",
      caption,
      description,
      createdAt: new Date().toISOString(),
      status: "draft"
    });

    if (post.mediaType === "video") {
      const thumbnailPath = path.join(thumbnailsDirectory, `${post.id}.jpg`);
      try {
        await createVideoThumbnail(path.join(uploadsDirectory, post.filename), thumbnailPath);
        post.thumbnailPath = path.join("thumbnails", `${post.id}.jpg`);
        await postRepository.updateMediaProcessing(post.id, {
          thumbnailPath: post.thumbnailPath
        });
      } catch (thumbnailError) {
        console.error(`Unable to generate thumbnail for post ${post.id}: ${thumbnailError.message}`);
      }
    }

    return res.status(201).json(toPublicPost(post, req));
  } catch (error) {
    if (req.file) await unlink(req.file.path).catch(() => {});
    return next(error);
  }
});

router.post("/:id/audio", audioUpload.single("audio"), async (req, res, next) => {
  let audioPath = req.file?.path;
  let outputPath;
  try {
    const post = await postRepository.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });
    if (post.mediaType !== "video") {
      return res.status(400).json({ message: "Background audio can only be added to video posts." });
    }
    if (!req.file) {
      return res.status(400).json({ message: "An MP3 or WAV audio file is required." });
    }

    // Users must only provide audio they own or are explicitly licensed to use.
    const outputFilename = `${post.id}-${Date.now()}.mp4`;
    outputPath = path.join(processedDirectory, outputFilename);
    await mergeAudio(path.join(uploadsDirectory, post.filename), audioPath, outputPath);

    const updatedPost = await postRepository.updateMediaProcessing(post.id, {
      processedVideoPath: path.join("processed", outputFilename),
      hasCustomAudio: true
    });
    return res.json(toPublicPost(updatedPost, req));
  } catch (error) {
    if (outputPath) await unlink(outputPath).catch(() => {});
    const message = error.message || "Unable to add background audio.";
    return res.status(502).json({ message: `Audio processing failed: ${message}` });
  } finally {
    if (audioPath) await unlink(audioPath).catch(() => {});
  }
});

router.get("/", async (req, res, next) => {
  try {
    const posts = await postRepository.findAll();
    return res.json(posts.map((post) => toPublicPost(post, req)));
  } catch (error) {
    return next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const post = await postRepository.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });
    return res.json(toPublicPost(post, req));
  } catch (error) {
    return next(error);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const post = await postRepository.deleteById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found." });

    const derivedFiles = [
      post.filename,
      post.processedVideoPath,
      post.thumbnailPath
    ].filter(Boolean);
    await Promise.all(derivedFiles.map((file) => unlink(path.join(uploadsDirectory, file)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    })));
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
