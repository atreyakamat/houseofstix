"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) {
        window.location.reload();
        return;
      }
      setError(res.status === 429 ? "Too many tries. Wait a minute." : "Wrong password.");
    } catch {
      setError("Couldn't reach the control room.");
    }
    setBusy(false);
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="display text-5xl">House of Stix</h1>
        <p className="text-sm text-mute">Control room</p>
        <label className="block">
          <span className="mb-1 block text-xs text-mute">Password</span>
          <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="field" />
        </label>
        {error && (
          <p className="text-sm text-down" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn w-full" disabled={busy || !password}>
          {busy ? "Opening…" : "Open"}
        </button>
      </form>
    </main>
  );
}
