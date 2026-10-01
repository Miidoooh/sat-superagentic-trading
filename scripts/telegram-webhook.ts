/**
 * Point the Telegram bot at the deployed site. Run once after setting
 * TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and SAT_SITE_URL:
 *
 *   npm run telegram:webhook          register
 *   npm run telegram:webhook -- off   remove (back to polling for local dev)
 */
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const site = (process.env.SAT_SITE_URL || "https://www.satrobinhood.xyz").replace(/\/$/, "");
const off = process.argv.includes("off");

async function main() {
  if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN first.");
  if (!off && !secret) throw new Error("Set TELEGRAM_WEBHOOK_SECRET first (any long random string).");
  const body = off
    ? { drop_pending_updates: false }
    : { url: `${site}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message"] };
  const res = await fetch(`https://api.telegram.org/bot${token}/${off ? "deleteWebhook" : "setWebhook"}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; description?: string };
  if (!json.ok) throw new Error(json.description ?? `HTTP ${res.status}`);
  console.log(off ? "Webhook removed." : `Webhook set to ${site}/api/telegram/webhook`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
