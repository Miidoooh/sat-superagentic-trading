/**
 * SAT background worker (Railway). Keeps shared snapshots warm in Upstash so
 * every Vercel instance serves the same fresh data, and sends Telegram alerts
 * 24/7 for linked chats. It reads the chain and sends messages; it never trades.
 *
 *   npm run worker
 */
import { detectAlerts } from "../src/lib/alerts/detect";
import { evaluateRules, newRuleState, planPoll, type RuleState } from "../src/lib/alerts/rules";
import { getProvider } from "../src/lib/data/provider";
import { RobinhoodChainProvider } from "../src/lib/data/robinhood";
import { getTrenches, TRENCHES_KEY, type TrenchesSnapshot } from "../src/lib/radar/trenches";
import { getLeaderboard, LEADERBOARD_KEY } from "../src/lib/radar/wallets";
import { getWhaleRadar, RADAR_MAX_TRADES, RADAR_SIZES, radarKey, type RadarSnapshot } from "../src/lib/radar/whales";
import { getKv } from "../src/lib/store/kv";
import { beatWorker, MARKET_KEY, writeSnapshot } from "../src/lib/store/snapshots";
import { formatAlert, listSubscriptions, markSent, pollUpdates, sendMessage, telegramConfig } from "../src/lib/telegram/telegram";
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
    const plan = planPoll(sub.settings, sub.follows, sub.rules);
    const planKey = JSON.stringify([plan, sub.settings, sub.rules]);
    let state = states.get(token);
    if (!state || state.plan !== planKey) {
      state = { first: true, plan: planKey, seen: new Set(), rules: newRuleState() };
      states.set(token, state);
    }
    try {
      const radar = plan.wallets.length
        ? await getWhaleRadar(live, { minUsd: plan.minUsd, venue: "all", limit: RADAR_MAX_TRADES, wallets: plan.wallets })
        : (radars.get(radarKey("all", plan.minUsd)) ?? null);
      const followed = new Set(sub.follows.map((f) => f.toLowerCase()));
      const builtIn = detectAlerts(radar, trenches, sub.settings, followed, state.seen);
      const fromRules = evaluateRules(sub.rules, { radar, trenches, markets }, state.rules);
      // The first pass only records what already happened, except price levels that are already met.
      const items = state.first ? fromRules.filter((a) => a.id.includes(":price:")) : [...builtIn, ...fromRules];
      state.first = false;
      let sent = 0;
      for (const item of items.slice(0, MAX_SENDS_PER_TICK)) {
        if (!(await markSent(token, item.id))) continue;
        await sendMessage(cfg, sub.chatId, formatAlert(item, cfg.siteUrl));
        sent++;
      }
      if (sent) log(`sent ${sent} alert(s) to chat ${sub.chatId}`);
    } catch (err) {
      log("delivery failed", sub.chatId, message(err));
    }
  }
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
