import { randomBytes } from "node:crypto";
import { z } from "zod";
import { DEFAULT_ALERT_SETTINGS, type AlertItem, type AlertSettings } from "../alerts/detect";
import { RuleListSchema, type Rule } from "../alerts/rules";
import type { FlowReport } from "../report/flow";
import type { TierId } from "../sat/tiers";
import { getKv } from "../store/kv";

/**
 * Telegram delivery. A browser links a chat by opening t.me/<bot>?start=<code>;
 * the bot answers /start <code> and the browser receives a private token it
 * uses to sync alert settings and rules. The token is the only credential, so
 * it is long, random and never shown in the UI.
 */

const LINK_TTL_MS = 15 * 60 * 1000;
const SENT_TTL_MS = 6 * 60 * 60 * 1000;
const SUBS_KEY = "tg:subs";

export interface TelegramConfig {
  token: string;
  username: string;
  webhookSecret: string | null;
  siteUrl: string;
}

export function telegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const username = process.env.TELEGRAM_BOT_USERNAME?.replace(/^@/, "");
  if (!token || !username) return null;
  return {
    token,
    username,
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || null,
    siteUrl: (process.env.SAT_SITE_URL || "https://sathood.xyz").replace(/\/$/, ""),
  };
}

export const SubscriptionSchema = z.object({
  settings: z
    .object({
      enabled: z.boolean(),
      whaleUsd: z.number().min(0).max(1e9),
      graduationPct: z.number().min(1).max(100),
      followed: z.boolean(),
    })
    .default(DEFAULT_ALERT_SETTINGS),
  follows: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).max(100).default([]),
  rules: RuleListSchema.default([]),
});

export interface Subscription {
  chatId: number;
  username?: string;
  /** A wallet proven by signature; its SAT holding sets the tier. */
  wallet?: `0x${string}`;
  settings: AlertSettings;
  follows: string[];
  rules: Rule[];
  createdAt: number;
  updatedAt: number;
}

interface LinkRecord {
  token?: string;
}

const subKey = (token: string) => `tg:sub:${token}`;
const linkKey = (code: string) => `tg:link:${code}`;
const chatKey = (chatId: number) => `tg:chat:${chatId}`;

async function api<T>(cfg: TelegramConfig, method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${cfg.token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

/** chatId is a numeric chat, or "@channel" for a public channel the bot admins. */
export async function sendMessage(cfg: TelegramConfig, chatId: number | string, html: string): Promise<void> {
  await api(cfg, "sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true });
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function formatAlert(alert: AlertItem, siteUrl: string, tier: TierId = "holder"): string {
  const link = alert.token ? `${siteUrl}/app?token=${alert.token}` : alert.wallet ? `${siteUrl}/app?view=wallets&wallet=${alert.wallet}` : `${siteUrl}/app`;
  const upsell = tier === "free" ? `\n<i>SAT holders got this 60s earlier.</i> <a href="${siteUrl}/app?view=sat">Hold SAT</a>` : "";
  return `<b>${escape(alert.title)}</b>\n${escape(alert.body)}\n<a href="${link}">Open in SAT</a>${upsell}`;
}

/** Post an image by URL; Telegram fetches it, so the URL must be public. */
export async function sendPhoto(cfg: TelegramConfig, chatId: number | string, photoUrl: string, captionHtml: string): Promise<void> {
  await api(cfg, "sendPhoto", { chat_id: chatId, photo: photoUrl, caption: captionHtml, parse_mode: "HTML" });
}

/** The daily report caption for the alpha channel. */
export function formatReport(r: FlowReport, siteUrl: string): string {
  const usd = (n: number) => `$${Math.abs(n) >= 1e6 ? `${(Math.abs(n) / 1e6).toFixed(2)}M` : `${(Math.abs(n) / 1e3).toFixed(1)}K`}`;
  const lines = [
    `<b>Robinhood Chain, last 24h</b>`,
    `${usd(r.totals.volumeUsd)} volume · ${r.totals.trades.toLocaleString("en-US")} trades · ${r.pons.launches} Pons launches`,
    "",
    ...r.inflows.slice(0, 3).map((f) => `🟢 ${escape(f.symbol)} +${usd(f.netUsd)} net inflow`),
    ...r.outflows.slice(0, 2).map((f) => `🔴 ${escape(f.symbol)} −${usd(f.netUsd)} net outflow`),
    "",
    `<a href="${siteUrl}/report">Full report</a> · <a href="${siteUrl}/app">Live on SAT</a>`,
  ];
  return lines.join("\n");
}

/** A public alpha-channel post: the alert plus the reason to hold. */
export function formatAlpha(alert: AlertItem, siteUrl: string): string {
  const link = alert.token ? `${siteUrl}/app?token=${alert.token}` : `${siteUrl}/app`;
  return [
    `<b>${escape(alert.title)}</b>`,
    escape(alert.body),
    `<a href="${link}">Chart and trade on SAT</a>`,
    "",
    `<i>SAT holders got this 60 seconds ago.</i> <a href="${siteUrl}/app?view=sat">Hold SAT for instant alerts</a>`,
  ].join("\n");
}

export async function createLinkCode(): Promise<string> {
  const code = randomBytes(9).toString("hex");
  await getKv().set(linkKey(code), {} satisfies LinkRecord, LINK_TTL_MS);
  return code;
}

/** The private token once the chat has pressed Start, or null while waiting. Throws if the code expired. */
export async function checkLinkCode(code: string): Promise<string | null> {
  const rec = await getKv().get<LinkRecord>(linkKey(code));
  if (!rec) throw new Error("This link expired. Start again.");
  if (!rec.token) return null;
  await getKv().del(linkKey(code));
  return rec.token;
}

export async function getSubscription(token: string): Promise<Subscription | null> {
  return getKv().get<Subscription>(subKey(token));
}

export async function saveSubscription(
  token: string,
  patch: z.infer<typeof SubscriptionSchema> & { wallet?: `0x${string}` | null },
): Promise<Subscription> {
  const current = await getSubscription(token);
  if (!current) throw new Error("This Telegram link is no longer active. Connect again.");
  const { wallet, ...rest } = patch;
  const next: Subscription = { ...current, ...rest, updatedAt: Date.now() };
  if (wallet === null) delete next.wallet;
  else if (wallet) next.wallet = wallet;
  await getKv().set(subKey(token), next);
  return next;
}

export async function removeSubscription(token: string): Promise<void> {
  const current = await getSubscription(token);
  await getKv().del(subKey(token));
  await getKv().srem(SUBS_KEY, token);
  if (current) await getKv().del(chatKey(current.chatId));
}

export async function listSubscriptions(): Promise<{ token: string; sub: Subscription }[]> {
  const tokens = await getKv().smembers(SUBS_KEY);
  const out: { token: string; sub: Subscription }[] = [];
  for (const token of tokens) {
    const sub = await getSubscription(token);
    if (sub) out.push({ token, sub });
    else await getKv().srem(SUBS_KEY, token);
  }
  return out;
}

/** Record that an alert went out, so the browser and worker never send it twice. */
export async function markSent(token: string, alertId: string): Promise<boolean> {
  const key = `tg:sent:${token}:${alertId}`;
  if (await getKv().get(key)) return false;
  await getKv().set(key, 1, SENT_TTL_MS);
  return true;
}

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number; type: string }; from?: { username?: string }; text?: string };
}

/** Handle one bot update: /start <code> links a chat, /stop unlinks it. */
export async function handleUpdate(cfg: TelegramConfig, update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const [command, arg] = msg.text.trim().split(/\s+/, 2);

  if (command.startsWith("/start")) {
    if (!arg || !/^[0-9a-f]{18}$/.test(arg)) {
      await sendMessage(cfg, chatId, `Open SAT, go to <b>Alerts → Telegram</b> and press <b>Connect Telegram</b> to link this chat.\n${cfg.siteUrl}/app`);
      return;
    }
    const rec = await getKv().get<LinkRecord>(linkKey(arg));
    if (!rec) {
      await sendMessage(cfg, chatId, "That link expired. Press Connect Telegram in SAT again.");
      return;
    }
    const previous = await getKv().get<string>(chatKey(chatId));
    if (previous) await removeSubscription(previous);
    const token = randomBytes(24).toString("hex");
    const sub: Subscription = {
      chatId,
      username: msg.from?.username,
      settings: { ...DEFAULT_ALERT_SETTINGS, enabled: true },
      follows: [],
      rules: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await getKv().set(subKey(token), sub);
    await getKv().sadd(SUBS_KEY, token);
    await getKv().set(chatKey(chatId), token);
    await getKv().set(linkKey(arg), { token } satisfies LinkRecord, LINK_TTL_MS);
    await sendMessage(cfg, chatId, "Linked to SAT. Your alerts and rules will arrive here.\nSend /stop at any time to unlink.");
    return;
  }

  if (command.startsWith("/stop")) {
    const token = await getKv().get<string>(chatKey(chatId));
    if (token) await removeSubscription(token);
    await sendMessage(cfg, chatId, token ? "Unlinked. You will not get SAT alerts here any more." : "This chat is not linked to SAT.");
  }
}

/**
 * Without a webhook (local development), read pending bot messages directly.
 * Telegram refuses this while a webhook is set, which is the production setup.
 */
export async function pollUpdates(cfg: TelegramConfig): Promise<void> {
  if (cfg.webhookSecret) return;
  const offset = (await getKv().get<number>("tg:offset")) ?? 0;
  const updates = await api<TgUpdate[]>(cfg, "getUpdates", { offset, timeout: 0, allowed_updates: ["message"] }).catch(() => [] as TgUpdate[]);
  for (const u of updates) {
    await handleUpdate(cfg, u).catch(() => undefined);
    await getKv().set("tg:offset", u.update_id + 1);
  }
}
