import { useCallback, useEffect, useState } from "react";
import ConnectedAccounts from "./components/ConnectedAccounts.jsx";
import UploadForm from "./components/UploadForm.jsx";
import PostList from "./components/PostList.jsx";
import Notice from "./components/Notice.jsx";

export default function App() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  function notify(message, tone = "error") {
    setNotice({ message, tone });
    window.setTimeout(() => setNotice(null), 3500);
  }

  const loadPosts = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/posts");
      if (!response.ok) throw new Error("Unable to load posts.");
      setPosts(await response.json());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  async function handleCreated(post) {
    setPosts((currentPosts) => [post, ...currentPosts]);
  }

  async function handleDelete(id) {
    const response = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || "Unable to delete post.");
    }
    setPosts((currentPosts) => currentPosts.filter((post) => post.id !== id));
  }

  function handlePublished(updatedPost) {
    setPosts((currentPosts) => currentPosts.map((post) => (
      post.id === updatedPost.id ? updatedPost : post
    )));
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10">
          <p className="mb-2 text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
            Phase 05 · Local workspace
          </p>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Postboard</h1>
          <p className="mt-3 max-w-2xl text-slate-400">
            Draft and review your media posts locally. Social platform publishing comes later.
          </p>
        </header>

        <ConnectedAccounts />
        {notice && <div className="mb-4"><Notice message={notice.message} tone={notice.tone} /></div>}
        <UploadForm onCreated={handleCreated} onNotify={notify} />

        <section className="mt-14">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold">Saved drafts</h2>
              <p className="mt-1 text-sm text-slate-500">Your local media library</p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-400">
              {posts.length} {posts.length === 1 ? "post" : "posts"}
            </span>
          </div>
          <div className="mb-4"><Notice message={error} /></div>
          <PostList posts={posts} loading={loading} onDelete={handleDelete} onPublished={handlePublished} onNotify={notify} />
        </section>
      </div>
    </main>
  );
}
