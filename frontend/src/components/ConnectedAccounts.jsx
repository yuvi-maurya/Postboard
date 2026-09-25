import { useEffect, useState } from "react";
import Notice from "./Notice.jsx";

const accountDetails = [
  { platform: "youtube", name: "YouTube", icon: "▶", accent: "text-red-400" },
  { platform: "instagram", name: "Instagram", icon: "◎", accent: "text-pink-400" },
  { platform: "linkedin", name: "LinkedIn", icon: "in", accent: "text-slate-500", comingSoon: true }
];

export default function ConnectedAccounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyPlatform, setBusyPlatform] = useState("");
  const [error, setError] = useState("");

  async function loadStatus() {
    try {
      const response = await fetch("/api/auth/status");
      if (!response.ok) throw new Error("Unable to load connected accounts.");
      setAccounts(await response.json());
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("oauth")) {
      window.history.replaceState({}, document.title, window.location.pathname);
      if (params.get("result") === "error") setError("The account connection was not completed.");
    }
    loadStatus();
  }, []);

  function connect(platform) {
    window.location.assign(`/api/auth/${platform}`);
  }

  async function disconnect(platform) {
    setBusyPlatform(platform);
    setError("");
    try {
      const response = await fetch(`/api/auth/logout/${platform}`, { method: "POST" });
      if (!response.ok) throw new Error("Unable to disconnect account.");
      await loadStatus();
    } catch (disconnectError) {
      setError(disconnectError.message);
    } finally {
      setBusyPlatform("");
    }
  }

  return (
    <section className="mb-10 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-7">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">Connected accounts</h2>
        <p className="mt-1 text-sm text-slate-400">Connect accounts now; publishing will be added in a later phase.</p>
      </div>
      <div className="mb-4"><Notice message={error} /></div>
      {loading ? (
        <p className="text-sm text-slate-500">Checking connection status...</p>
      ) : (
        <>
        {!accounts.some((account) => account.connected) && (
          <p className="mb-4 rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm text-slate-400">
            No accounts connected yet. Connect YouTube or Instagram here to enable publishing.
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accountDetails.map((details) => {
            const account = accounts.find((item) => item.platform === details.platform);
            const connected = account?.connected;
            return (
              <div key={details.platform} className={`flex items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 ${details.comingSoon ? "opacity-50" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`text-2xl ${details.accent}`} aria-hidden="true">{details.icon}</span>
                  <div className="min-w-0">
                    <h3 className="font-medium">{details.name}</h3>
                    <p className="truncate text-sm text-slate-400">{details.comingSoon ? "Coming soon" : connected ? account.accountName : "Not connected"}</p>
                  </div>
                </div>
                {details.comingSoon ? (
                  <span className="text-xs text-slate-500">Coming soon</span>
                ) : connected ? (
                  <button disabled={busyPlatform === details.platform} onClick={() => disconnect(details.platform)} className="shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-rose-400 hover:text-rose-300 disabled:opacity-50">
                    {busyPlatform === details.platform ? "Disconnecting..." : "Disconnect"}
                  </button>
                ) : (
                  <button onClick={() => connect(details.platform)} className="shrink-0 rounded-lg bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                    Connect
                  </button>
                )}
              </div>
            );
          })}
        </div>
        </>
      )}
    </section>
  );
}
