"use client";

import { useEffect, useState } from "react";
import { useTelegramLink } from "./alertStore";

const CHECK_MS = 2_500;

interface Status {
  configured: boolean;
  bot: string | null;
  worker: boolean;
}

/** Link a Telegram chat so alerts and rules also arrive there. */
export default function TelegramPanel() {
  const { link, save } = useTelegramLink();
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<{ code: string; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/telegram/link")
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/telegram/link?code=${pending.code}`);
        const json = (await res.json()) as { linked?: boolean; token?: string; error?: string };
        if (!alive) return;
        if (!res.ok) {
          setError(json.error ?? "Linking failed");
          setPending(null);
        } else if (json.linked && json.token) {
          save(json.token);
          setPending(null);
        }
      } catch {
        /* keep checking */
      }
    }, CHECK_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [pending, save]);

  const start = async () => {
    setError(null);
    try {
      const res = await fetch("/api/telegram/link", { method: "POST" });
      const json = (await res.json()) as { code?: string; url?: string; error?: string };
      if (!res.ok || !json.code || !json.url) throw new Error(json.error ?? "Could not start linking");
      setPending({ code: json.code, url: json.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start linking");
    }
  };

  const unlink = async () => {
    if (link) {
      await fetch("/api/telegram/sync", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: link.token }),
      }).catch(() => undefined);
    }
    save(null);
  };

  if (!status) return null;

  return (
    <div className="tg">
      <div className="alerts-label">Telegram</div>
      {!status.configured ? (
        <div className="dim alerts-note">Telegram alerts are not set up on this deployment yet.</div>
      ) : link ? (
        <div className="tg-row">
          <span className="tg-dot" /> Linked to @{status.bot}
          <div className="spacer" />
          <button className="btn sm" onClick={unlink}>
            Unlink
          </button>
        </div>
      ) : pending ? (
        <div className="tg-row">
          <a className="btn sm primary" href={pending.url} target="_blank" rel="noreferrer">
            Open @{status.bot}
          </a>
          <span className="dim">Press Start in Telegram. Waiting…</span>
        </div>
      ) : (
        <button className="btn sm" onClick={start}>
          Connect Telegram
        </button>
      )}
      {error && <div className="rules-error">{error}</div>}
      {status.configured && (
        <div className="dim alerts-note">
          {status.worker
            ? "Sent 24/7 by the SAT worker, even with this tab closed."
            : "Sent while SAT is open in a browser. A background worker is not running."}
        </div>
      )}
    </div>
  );
}
