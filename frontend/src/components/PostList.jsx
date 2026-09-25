import { useEffect, useState } from "react";
import Notice from "./Notice.jsx";

export default function PostList({ posts, loading, onDelete, onPublished, onNotify }) {
  const [deletingId, setDeletingId] = useState("");
  const [error, setError] = useState("");
  const [postingId, setPostingId] = useState("");
  const [postingPlatform, setPostingPlatform] = useState("");
  const [audioPostId, setAudioPostId] = useState("");
  const [audioOpen, setAudioOpen] = useState({});
  const [privacyByPost, setPrivacyByPost] = useState({});
  const [publishErrors, setPublishErrors] = useState({});
  const [instagramPublicUrlConfigured, setInstagramPublicUrlConfigured] = useState(false);
  const [allResults, setAllResults] = useState({});

  useEffect(() => {
    fetch("/api/posts/publishing-config")
      .then((response) => response.json())
      .then((config) => setInstagramPublicUrlConfigured(config.instagramPublicUrlConfigured))
      .catch(() => setInstagramPublicUrlConfigured(false));
  }, []);

  async function handleDelete(id) {
    if (!window.confirm("Delete this draft and its media file?")) return;
    setDeletingId(id);
    setError("");
    try {
      await onDelete(id);
      onNotify("Draft deleted.", "success");
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setDeletingId("");
    }
  }

  async function handlePublish(post, platform) {
    setPostingId(post.id);
    setPostingPlatform(platform);
    setPublishErrors((current) => ({ ...current, [`${post.id}:${platform}`]: "" }));
    try {
      const response = await fetch(`/api/posts/${post.id}/publish/${platform}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: platform === "youtube"
          ? JSON.stringify({ privacyStatus: privacyByPost[post.id] || "public" })
          : undefined
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Unable to publish to ${platform}.`);
      onPublished(result);
      onNotify(`${platform === "youtube" ? "YouTube" : "Instagram"} publishing completed.`, "success");
    } catch (publishError) {
      setPublishErrors((current) => ({ ...current, [`${post.id}:${platform}`]: publishError.message }));
    } finally {
      setPostingId("");
      setPostingPlatform("");
    }

    async function handlePostAll(post) {
      setPostingId(post.id);
      setPostingPlatform("all");
      try {
        const response = await fetch(`/api/posts/${post.id}/publish/all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ privacyStatus: privacyByPost[post.id] || "public" }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Unable to post to connected platforms.");
        setAllResults((current) => ({ ...current, [post.id]: result }));
        onNotify("Post to All completed. Review each platform result.", "success");
      } catch (allError) {
        setPublishErrors((current) => ({ ...current, [`${post.id}:all`]: allError.message }));
      } finally {
        setPostingId("");
        setPostingPlatform("");
      }
    }

    async function handleAudioChange(post, event) {
      const audioFile = event.target.files?.[0];
      if (!audioFile) return;
      setAudioPostId(post.id);
      setPublishErrors((current) => ({ ...current, [`${post.id}:audio`]: "" }));
      const formData = new FormData();
      formData.append("audio", audioFile);
      try {
        const response = await fetch(`/api/posts/${post.id}/audio`, {
          method: "POST",
          body: formData
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || "Unable to add background audio.");
        onPublished(result);
        onNotify("Custom audio added successfully.", "success");
      } catch (audioError) {
        setPublishErrors((current) => ({ ...current, [`${post.id}:audio`]: audioError.message }));
      } finally {
        setAudioPostId("");
        event.target.value = "";
      }
    }
  }

  if (loading) return <p className="py-12 text-center text-slate-500">Loading drafts...</p>;
  if (!posts.length) return <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-slate-400">Upload your first post to get started.</div>;

  return (
    <>
      <div className="mb-4"><Notice message={error} /></div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <article key={post.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="aspect-video bg-slate-950">
              {post.mediaType === "video" ? (
                <video className="h-full w-full object-cover" src={post.mediaUrl} controls />
              ) : (
                <img className="h-full w-full object-cover" src={post.mediaUrl} alt={post.caption || "Saved post"} />
              )}
            </div>
            <div className="p-4">
              <p className="line-clamp-2 min-h-12 font-medium">{post.caption || "Untitled draft"}</p>
              {post.description && <p className="mt-2 line-clamp-2 text-sm text-slate-400">{post.description}</p>}
              {post.mediaType === "video" && (
                <div className="mt-4 border-t border-slate-800 pt-4">
                  {post.thumbnailUrl ? (
                    <img className="mb-3 aspect-video w-full rounded-lg object-cover" src={post.thumbnailUrl} alt={`${post.caption || "Video"} thumbnail`} />
                  ) : (
                    <video className="mb-3 aspect-video w-full rounded-lg object-cover" src={post.mediaUrl} controls />
                  )}
                  <button onClick={() => handlePostAll(post)} disabled={postingId === post.id} className="mt-4 w-full rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50">
                    {postingId === post.id && postingPlatform === "all" ? "Posting..." : "Post to All Connected Platforms"}
                  </button>
                  {allResults[post.id] && (
                    <div className="mt-2 space-y-1 text-xs">
                      {Object.entries(allResults[post.id]).map(([platform, result]) => (
                        <p key={platform} className={result.status === "posted" ? "text-emerald-300" : "text-amber-300"}>
                          {platform}: {result.status === "posted" ? "✅ Posted" : result.status}
                          {result.error ? ` — ${result.error}` : ""}
                        </p>
                      ))}
                    </div>
                  )}
                  {publishErrors[`${post.id}:all`] && <p className="mt-2 text-xs text-rose-300">{publishErrors[`${post.id}:all`]}</p>}
                  {post.hasCustomAudio && (
                    <span className="mb-3 inline-block rounded-full bg-emerald-950 px-2 py-1 text-xs font-medium text-emerald-300">
                      Custom audio added ✅
                    </span>
                  )}
                  {post.platforms?.youtube?.status === "posted" ? (
                    <a className="text-sm font-semibold text-emerald-400 hover:text-emerald-300" href={post.platforms.youtube.videoUrl} target="_blank" rel="noreferrer">
                      Posted ✅ · Watch on YouTube
                    </a>
                  ) : (
                    <div className="flex items-center gap-2">
                      <select value={privacyByPost[post.id] || "public"} onChange={(event) => setPrivacyByPost((current) => ({ ...current, [post.id]: event.target.value }))} disabled={postingId === post.id} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs text-slate-300 outline-none focus:border-cyan-500">
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                      </select>
                      <button disabled={postingId === post.id} onClick={() => handlePublish(post, "youtube")} className="flex-1 rounded-lg bg-red-500 px-3 py-2 text-xs font-semibold text-white hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50">
                        {postingId === post.id && postingPlatform === "youtube" ? "Uploading..." : "Post to YouTube"}
                      </button>
                    </div>
                  )}
                  {(publishErrors[`${post.id}:youtube`] || post.platforms?.youtube?.error) && post.platforms?.youtube?.status !== "posted" && (
                    <p className="mt-2 text-xs text-rose-300">{publishErrors[`${post.id}:youtube`] || post.platforms.youtube.error}</p>
                  )}
                  <div className="mt-3">
                    <button type="button" onClick={() => setAudioOpen((current) => ({ ...current, [post.id]: !current[post.id] }))} className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
                      {audioOpen[post.id] ? "Hide audio options" : "Add background audio"}
                    </button>
                    {audioOpen[post.id] && (
                      <label className="mt-2 block cursor-pointer rounded-lg border border-dashed border-slate-700 p-3 text-xs text-slate-400 hover:border-cyan-500">
                        <input
                          className="sr-only"
                          type="file"
                          accept=".mp3,.wav,audio/mpeg,audio/wav"
                          onChange={(event) => handleAudioChange(post, event)}
                          disabled={audioPostId === post.id}
                        />
                        {audioPostId === post.id ? (
                          <span className="inline-flex items-center gap-2">
                            <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-cyan-400" />
                            Processing audio...
                          </span>
                        ) : "Choose an MP3 or WAV file (max 15MB)"}
                      </label>
                    )}
                    {publishErrors[`${post.id}:audio`] && (
                      <p className="mt-2 text-xs text-rose-300">{publishErrors[`${post.id}:audio`]}</p>
                    )}
                  </div>
                </div>
              )}
              <div className="mt-4 border-t border-slate-800 pt-4">
                {post.platforms?.instagram?.status === "posted" ? (
                  <a className="text-sm font-semibold text-emerald-400 hover:text-emerald-300" href={post.platforms.instagram.permalink} target="_blank" rel="noreferrer">
                    Posted ✅ · View on Instagram
                  </a>
                ) : (
                  <>
                    <button
                      disabled={!instagramPublicUrlConfigured || postingId === post.id}
                      title={!instagramPublicUrlConfigured ? "Set up a public URL first" : undefined}
                      onClick={() => handlePublish(post, "instagram")}
                      className="w-full rounded-lg bg-pink-500 px-3 py-2 text-xs font-semibold text-white hover:bg-pink-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {postingId === post.id && postingPlatform === "instagram" ? "Publishing..." : "Post to Instagram"}
                    </button>
                    {!instagramPublicUrlConfigured && (
                      <p className="mt-2 text-xs text-amber-300">Set up a public URL first to publish on Instagram.</p>
                    )}
                  </>
                )}
                {(publishErrors[`${post.id}:instagram`] || post.platforms?.instagram?.error) && post.platforms?.instagram?.status !== "posted" && (
                  <p className="mt-2 text-xs text-rose-300">{publishErrors[`${post.id}:instagram`] || post.platforms.instagram.error}</p>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <time className="text-xs text-slate-500" dateTime={post.createdAt}>{new Date(post.createdAt).toLocaleDateString()}</time>
                <button disabled={deletingId === post.id} onClick={() => handleDelete(post.id)} className="text-sm font-medium text-rose-400 hover:text-rose-300 disabled:opacity-50">
                  {deletingId === post.id ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
