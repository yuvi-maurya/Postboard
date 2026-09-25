import { useEffect, useState } from "react";
import Notice from "./Notice.jsx";

export default function UploadForm({ onCreated, onNotify }) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return undefined;
    }
    if (!caption.trim()) {
      setError("Caption is required.");
      return;
    }
    if (caption.trim().length > 200) {
      setError("Caption must be 200 characters or fewer.");
      return;
    }
    if (description.length > 3000) {
      setError("Description must be 3000 characters or fewer.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function handleFileChange(event) {
    const selectedFile = event.target.files?.[0] ?? null;
    setFile(selectedFile);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose an image or MP4 video first.");
      return;
    }
    setSubmitting(true);
    setError("");
    const formData = new FormData();
    formData.append("media", file);
    formData.append("caption", caption);
    formData.append("description", description);

    try {
      const response = await fetch("/api/posts", { method: "POST", body: formData });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to save post.");
      await onCreated(result);
      onNotify("Draft saved successfully.", "success");
      setFile(null);
      setCaption("");
      setDescription("");
      event.target.reset();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-7">
      <div className="mb-6">
        <h2 className="text-xl font-semibold">Create a draft</h2>
        <p className="mt-1 text-sm text-slate-400">JPG, PNG, or MP4 · maximum 50MB</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <label className="flex min-h-64 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-700 bg-slate-950/60 p-5 text-center transition hover:border-cyan-500">
            <input className="sr-only" type="file" accept=".jpg,.jpeg,.png,.mp4,image/jpeg,image/png,video/mp4" onChange={handleFileChange} />
            {previewUrl ? (
              file.type.startsWith("video/") ? (
                <video className="max-h-64 rounded-lg object-contain" src={previewUrl} controls />
              ) : (
                <img className="max-h-64 rounded-lg object-contain" src={previewUrl} alt="Selected preview" />
              )
            ) : (
              <span className="text-slate-500">Click to choose media</span>
            )}
          </label>
        </div>
        <div className="space-y-5">
          <label className="block text-sm font-medium text-slate-300">
            Caption
            <input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={200} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500" placeholder="Write a short caption..." />
          </label>
          <label className="block text-sm font-medium text-slate-300">
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={3000} rows={5} className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500" placeholder="Add more context for this draft..." />
          </label>
          <Notice message={error} />
          <button disabled={submitting} className="w-full rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? "Saving draft..." : "Save draft"}
          </button>
        </div>
      </div>
    </form>
  );
}
