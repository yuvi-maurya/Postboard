export default function Notice({ message, tone = "error" }) {
  if (!message) return null;
  const styles = tone === "success"
    ? "border-emerald-900 bg-emerald-950/60 text-emerald-300"
    : "border-rose-900 bg-rose-950/60 text-rose-300";
  return <p role="status" className={`rounded-lg border p-3 text-sm ${styles}`}>{message}</p>;
}
