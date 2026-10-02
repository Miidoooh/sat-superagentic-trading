/**
 * SAT background worker (Railway). Keeps shared snapshots warm in Upstash so
 * every Vercel instance serves the same fresh data, and sends Telegram alerts
 * 24/7 for linked chats. It reads the chain and sends messages; it never trades.
 *
 *   npm run worker
 */
import { picksFor } from "../src/lib/agent/picks";
import { STYLE_PRESETS, type Strategy } from "../src/lib/agent/strategy";
import { recordPicks } from "../src/lib/agent/track";
import { detectAlerts, type AlertItem, type AlertSettings } from "../src/lib/alerts/detect";
import { exploreUniverse } from "../src/lib/radar/explore";
import { tierOf } from "../src/lib/sat/gate";
import { evaluateRules, newRuleState, planPoll, type RuleState } from "../src/lib/alerts/rules";
import { getProvider } from "../src/lib/data/provider";
import { RobinhoodChainProvider } from "../src/lib/data/robinhood";
import { getTrenches, TRENCHES_KEY, type TrenchesSnapshot } from "../src/lib/radar/trenches";
import { getLeaderboard, LEADERBOARD_KEY } from "../src/lib/radar/wallets";
import { getWhaleRadar, RADAR_MAX_TRADES, RADAR_SIZES, radarKey, type RadarSnapshot } from "../src/lib/radar/whales";
import { getKv } from "../src/lib/store/kv";
import { beatWorker, MARKET_KEY, writeSnapshot } from "../src/lib/store/snapshots";
import { buildFlowReport, REPORT_KEY } from "../src/lib/report/flow";
import {
  formatAlert,
  formatAlpha,
  formatPick,
  formatReport,
  listSubscriptions,
  markSent,
  pollUpdates,
  sendMessage,
  sendPhoto,
  telegramConfig,
} from "../src/lib/telegram/telegram";
import type { TokenMarket } from "../src/lib/types";

const TICK_MS = 8_000;
const MARKET_EVERY = 2;
const LEADERBOARD_EVERY = 5;
const MAX_SENDS_PER_TICK = 10;
const VENUES = ["all", "stock", "pons"] as const;

const log = (...args: unknown[]) => console.log(new Date().toISOString(), ...args);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

interface SubState {
  first: boolean;
  plan: string;
  seen: Set<string>;
  rules: RuleState;
  /** Alerts waiting out the free-tier delay. */
  queue: { item: AlertItem; dueAt: number }[];
}

async function warmRadar(live: RobinhoodChainProvider): Promise<Map<string, RadarSnapshot>> {
  const out = new Map<string, RadarSnapshot>();
  for (const venue of VENUES) {
    for (const minUsd of RADAR_SIZES) {
      const radar = await getWhaleRadar(live, { minUsd, venue, limit: RADAR_MAX_TRADES });
      await writeSnapshot(radarKey(venue, minUsd), radar);
      out.set(radarKey(venue, minUsd), radar);
    }
  }
  return out;
}

async function deliver(
  live: RobinhoodChainProvider,
  states: Map<string, SubState>,
  radars: Map<string, RadarSnapshot>,
  trenches: TrenchesSnapshot | null,
  markets: TokenMarket[] | null,
) {
  const cfg = telegramConfig();
  if (!cfg) return;
  await pollUpdates(cfg);
  for (const { token, sub } of await listSubscriptions()) {
    if (!sub.settings.enabled) {
      states.delete(token);
      continue;
    }
    const tier = await tierOf(sub.wallet);
    const rules = sub.rules.slice(0, tier.maxRules);
    const plan = planPoll(sub.settings, sub.follows, rules);
    const planKey = JSON.stringify([plan, sub.settings, rules]);
    let state = states.get(token);
    if (!state || state.plan !== planKey) {
      state = { first: true, plan: planKey, seen: new Set(), rules: newRuleState(), queue: state?.queue ?? [] };
      states.set(token, state);
    }
    try {
      const radar = plan.wallets.length
        ? await getWhaleRadar(live, { minUsd: plan.minUsd, venue: "all", limit: RADAR_MAX_TRADES, wallets: plan.wallets })
        : (radars.get(radarKey("all", plan.minUsd)) ?? null);
      const followed = new Set(sub.follows.map((f) => f.toLowerCase()));
      const builtIn = detectAlerts(radar, trenches, sub.settings, followed, state.seen);
      const fromRules = evaluateRules(rules, { radar, trenches, markets }, state.rules);
      // The first pass only records what already happened, except price levels that are already met.
      const items = state.first ? fromRules.filter((a) => a.id.includes(":price:")) : [...builtIn, ...fromRules];
      state.first = false;
      const now = Date.now();
      for (const item of items) state.queue.push({ item, dueAt: now + tier.telegramDelayMs });
      const due = state.queue.filter((q) => q.dueAt <= now);
      state.queue = state.queue.filter((q) => q.dueAt > now).slice(-50);
      let sent = 0;
      for (const { item } of due.slice(0, MAX_SENDS_PER_TICK)) {
        if (!(await markSent(token, item.id))) continue;
        await sendMessage(cfg, sub.chatId, formatAlert(item, cfg.siteUrl, tier.id));
        sent++;
      }
      if (sent) log(`sent ${sent} alert(s) to chat ${sub.chatId} (${tier.id})`);
    } catch (err) {
      log("delivery failed", sub.chatId, message(err));
    }
  }
}

/**
 * Public alpha channel: the biggest whale trades and graduations, posted 60s
 * after holders get them and capped so the channel never floods.
 */
const ALPHA_SETTINGS: AlertSettings = { enabled: true, whaleUsd: 25_000, graduationPct: 95, followed: false };
const ALPHA_DELAY_MS = 60_000;
const ALPHA_WINDOW_MS = 10 * 60_000;
const ALPHA_MAX_PER_WINDOW = 6;

interface AlphaState {
  first: boolean;
  seen: Set<string>;
  queue: { item: AlertItem; dueAt: number }[];
  sentAt: number[];
}

async function postAlpha(state: AlphaState, radars: Map<string, RadarSnapshot>, trenches: TrenchesSnapshot | null) {
  const cfg = telegramConfig();
  const chat = process.env.TELEGRAM_ALPHA_CHAT_ID;
  if (!cfg || !chat) return;
  const items = detectAlerts(radars.get(radarKey("all", 25_000)) ?? null, trenches, ALPHA_SETTINGS, new Set(), state.seen);
  const now = Date.now();
  if (!state.first) for (const item of items) state.queue.push({ item, dueAt: now + ALPHA_DELAY_MS });
  state.first = false;
  state.sentAt = state.sentAt.filter((t) => now - t < ALPHA_WINDOW_MS);
  const due = state.queue.filter((q) => q.dueAt <= now);
  state.queue = state.queue.filter((q) => q.dueAt > now).slice(-30);
  for (const { item } of due) {
    if (state.sentAt.length >= ALPHA_MAX_PER_WINDOW) break;
    await sendMessage(cfg, chat, formatAlpha(item, cfg.siteUrl));
    state.sentAt.push(now);
  }
}

const AGENT_EVERY = Math.round(2 * 60_000 / TICK_MS);
const PRESETS = ["sniper", "momentum", "graduation", "whale"] as const;

/**
 * Run every preset style so their public track records build around the
 * clock, then send each linked user the new picks for their own style.
 */
async function runAgents(live: RobinhoodChainProvider) {
  const { rows } = await exploreUniverse(live);
  const marks = new Map(rows.filter((r) => r.mcapUsd).map((r) => [r.token.toLowerCase(), r.mcapUsd as number]));
  const byStyle = new Map<string, Awaited<ReturnType<typeof picksFor>>>();
  const picks = async (s: Strategy) => {
    const key = JSON.stringify(s);
    if (!byStyle.has(key)) byStyle.set(key, await picksFor(live, s, 5));
    return byStyle.get(key)!;
  };
  for (const preset of PRESETS) {
    const r = await picks(STYLE_PRESETS[preset]);
    await recordPicks(preset, r.picks, marks);
  }
  const cfg = telegramConfig();
  if (!cfg) return;
  for (const { token, sub } of await listSubscriptions()) {
    if (!sub.agent?.enabled) continue;
    try {
      const tier = await tierOf(sub.wallet);
      const { picks: found } = await picks(sub.agent.strategy);
      let sent = 0;
      for (const p of found) {
        if (sent >= (tier.id === "free" ? 1 : 3)) break;
        if (!(await markSent(token, `pick:${p.token}`))) continue;
        await sendMessage(cfg, sub.chatId, formatPick(p, sub.agent.strategy.name, cfg.siteUrl));
        sent++;
      }
      if (sent) log(`sent ${sent} agent pick(s) to chat ${sub.chatId}`);
    } catch (err) {
      log("agent picks failed", sub.chatId, message(err));
    }
  }
}

const REPORT_EVERY = Math.round(10 * 60_000 / TICK_MS);
const REPORT_POST_HOUR_UTC = Number(process.env.REPORT_POST_HOUR_UTC ?? 14);

/** Keep the daily report warm, and post it to the alpha channel once a day. */
async function runReport(live: RobinhoodChainProvider) {
  const report = await buildFlowReport(live);
  await writeSnapshot(REPORT_KEY, report);
  const cfg = telegramConfig();
  const chat = process.env.TELEGRAM_ALPHA_CHAT_ID;
  if (!cfg || !chat || new Date().getUTCHours() < REPORT_POST_HOUR_UTC) return;
  const key = `report:posted:${report.date}`;
  if (await getKv().get(key)) return;
  await getKv().set(key, 1, 48 * 3600_000);
  await sendPhoto(cfg, chat, `${cfg.siteUrl}/api/card/report?d=${report.date}`, formatReport(report, cfg.siteUrl)).catch(() =>
    sendMessage(cfg, chat, formatReport(report, cfg.siteUrl)),
  );
  log(`posted the ${report.date} flow report`);
}

function main() {
  if (!getKv().shared) {
    console.error("The worker needs UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN so the site can read what it writes.");
    process.exit(1);
  }
  const provider = getProvider();
  if (!(provider instanceof RobinhoodChainProvider)) {
    console.error("The worker needs the live Robinhood Chain provider (SAT_DATA_SOURCE=chain).");
    process.exit(1);
  }
  const live = provider;
  const states = new Map<string, SubState>();
  const alpha: AlphaState = { first: true, seen: new Set(), queue: [], sentAt: [] };
  let tick = 0;
  let markets: TokenMarket[] | null = null;

  const loop = async () => {
    const started = Date.now();
    try {
      await beatWorker();
      const [radars, trenches] = await Promise.all([
        warmRadar(live),
        getTrenches(live)
          .then(async (t) => {
            await writeSnapshot(TRENCHES_KEY, t);
            return t;
          })
          .catch((err) => {
            log("trenches failed", message(err));
            return null;
          }),
      ]);
      if (tick % MARKET_EVERY === 0) {
        markets = await live.listTokens(500);
        await writeSnapshot(MARKET_KEY, markets);
      }
      if (tick % LEADERBOARD_EVERY === 0) {
        await writeSnapshot(LEADERBOARD_KEY, await getLeaderboard(live));
      }
      await deliver(live, states, radars, trenches, markets);
      await postAlpha(alpha, radars, trenches).catch((err) => log("alpha failed", message(err)));
      if (tick % REPORT_EVERY === 0) await runReport(live).catch((err) => log("report failed", message(err)));
      if (tick % AGENT_EVERY === 0) await runAgents(live).catch((err) => log("agents failed", message(err)));
    } catch (err) {
      log("tick failed", message(err));
    }
    tick++;
    setTimeout(loop, Math.max(1_000, TICK_MS - (Date.now() - started)));
  };

  log("SAT worker started");
  void loop();
}

main();
