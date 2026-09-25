import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(__dirname, "..", "data");
const dataFile = path.join(dataDirectory, "posts.json");

async function ensureStore() {
  await mkdir(dataDirectory, { recursive: true });
  try {
    await readFile(dataFile, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(dataFile, "[]", "utf8");
  }
}

async function readPosts() {
  await ensureStore();
  const contents = await readFile(dataFile, "utf8");
  return JSON.parse(contents);
}

async function writePosts(posts) {
  await ensureStore();
  await writeFile(dataFile, `${JSON.stringify(posts, null, 2)}\n`, "utf8");
}

function withPlatformDefaults(post) {
  return {
    ...post,
    processedVideoPath: post.processedVideoPath ?? null,
    thumbnailPath: post.thumbnailPath ?? null,
    hasCustomAudio: post.hasCustomAudio ?? false,
    platforms: {
      ...post.platforms,
      youtube: {
        status: "not_posted",
        videoId: null,
        videoUrl: null,
        postedAt: null,
        error: null,
        ...post.platforms?.youtube
      },
      instagram: {
        status: "not_posted",
        mediaId: null,
        permalink: null,
        postedAt: null,
        error: null,
        ...post.platforms?.instagram
      }
    }
  };
}

// Keeping persistence behind this interface makes replacing JSON with PostgreSQL
// a repository-only change; the route handlers do not know where data lives.
export const postRepository = {
  async findAll() {
    return (await readPosts()).map(withPlatformDefaults);
  },

  async findById(id) {
    const posts = await readPosts();
    const post = posts.find((item) => item.id === id);
    return post ? withPlatformDefaults(post) : null;
  },

  async create(post) {
    const posts = await readPosts();
    const normalizedPost = withPlatformDefaults(post);
    posts.unshift(normalizedPost);
    await writePosts(posts);
    return normalizedPost;
  },

  async updateYoutubeStatus(id, youtubeStatus) {
    const posts = await readPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index === -1) return null;

    const updatedPost = withPlatformDefaults(posts[index]);
    updatedPost.platforms.youtube = {
      ...updatedPost.platforms.youtube,
      ...youtubeStatus
    };
    posts[index] = updatedPost;
    await writePosts(posts);
    return updatedPost;
  },

  async updateInstagramStatus(id, instagramStatus) {
    const posts = await readPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index === -1) return null;

    const updatedPost = withPlatformDefaults(posts[index]);
    updatedPost.platforms.instagram = {
      ...updatedPost.platforms.instagram,
      ...instagramStatus
    };
    posts[index] = updatedPost;
    await writePosts(posts);
    return updatedPost;
  },

  async updateMediaProcessing(id, mediaProcessing) {
    const posts = await readPosts();
    const index = posts.findIndex((post) => post.id === id);
    if (index === -1) return null;

    const updatedPost = {
      ...withPlatformDefaults(posts[index]),
      ...mediaProcessing
    };
    posts[index] = updatedPost;
    await writePosts(posts);
    return updatedPost;
  },

  async deleteById(id) {
    const posts = await readPosts();
    const post = posts.find((item) => item.id === id) ?? null;
    if (!post) return null;
    await writePosts(posts.filter((item) => item.id !== id));
    return withPlatformDefaults(post);
  }
};
