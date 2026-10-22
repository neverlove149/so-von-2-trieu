import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const projectRoot = new URL("../", import.meta.url);
const ledgerUrl = new URL("data/ledger.json", projectRoot);
const threadId = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID;
const userProfile = process.env.USERPROFILE;

const pricing = {
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
};

const pricingSource = "https://developers.openai.com/api/docs/pricing";
const fxSource = "https://open.er-api.com/v6/latest/USD";

async function findSessionFile(directory, id) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findSessionFile(path, id);
      if (nested) return nested;
    } else if (entry.name.endsWith(`${id}.jsonl`)) {
      return path;
    }
  }
  return null;
}

function vietnamIso(value) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+07:00`;
}

function aggregateUsage(lines) {
  let currentModel = "unknown";
  let latestTimestamp = null;
  const seenResponses = new Set();
  const models = new Map();

  for (const line of lines) {
    if (!line.trim()) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }

    if (row.type === "turn_context" && row.payload?.model) currentModel = row.payload.model;
    if (row.type !== "token_usage_record") continue;

    const responseId = row.payload?.response_id;
    if (!responseId || seenResponses.has(responseId)) continue;
    seenResponses.add(responseId);

    const usage = row.payload?.usage || {};
    const totals = models.get(currentModel) || {
      model: currentModel,
      responses: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    };
    totals.responses += 1;
    totals.inputTokens += Number(usage.input_tokens) || 0;
    totals.cachedInputTokens += Number(usage.cached_input_tokens) || 0;
    totals.cacheWriteInputTokens += Number(usage.cache_write_input_tokens) || 0;
    totals.outputTokens += Number(usage.output_tokens) || 0;
    totals.reasoningOutputTokens += Number(usage.reasoning_output_tokens) || 0;
    models.set(currentModel, totals);
    latestTimestamp = row.timestamp || latestTimestamp;
  }

  return { models: [...models.values()], latestTimestamp };
}

function calculateCost(models) {
  const unpricedModels = [];
  let totalUsd = 0;

  const pricedModels = models.map((usage) => {
    const rate = pricing[usage.model];
    if (!rate) {
      unpricedModels.push(usage.model);
      return { ...usage, costUsd: null };
    }

    const uncachedInputTokens = Math.max(
      usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteInputTokens,
      0,
    );
    const costUsd =
      (uncachedInputTokens * rate.input +
        usage.cachedInputTokens * rate.cachedInput +
        usage.cacheWriteInputTokens * rate.cacheWrite +
        usage.outputTokens * rate.output) /
      1_000_000;
    totalUsd += costUsd;
    return {
      ...usage,
      uncachedInputTokens,
      ratesUsdPerMillionTokens: rate,
      costUsd: Number(costUsd.toFixed(6)),
    };
  });

  return {
    models: pricedModels,
    unpricedModels,
    totalUsd: Number(totalUsd.toFixed(6)),
  };
}

async function getFxRate(existingAccounting) {
  try {
    const response = await fetch(fxSource);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const rate = Number(data.rates?.VND);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Tỷ giá VND không hợp lệ.");
    return {
      rate,
      updatedAt: vietnamIso(data.time_last_update_utc),
      status: "Đã cập nhật từ nguồn tỷ giá",
    };
  } catch (error) {
    const fallback = Number(existingAccounting?.fxRateVndPerUsd);
    if (!Number.isFinite(fallback) || fallback <= 0) throw error;
    return {
      rate: fallback,
      updatedAt: existingAccounting.fxUpdatedAt,
      status: "Dùng tỷ giá lần đo trước do nguồn tỷ giá tạm thời không phản hồi",
    };
  }
}

if (!threadId || !userProfile) {
  throw new Error("Thiếu CODEX_THREAD_ID/CODEX_SESSION_ID hoặc USERPROFILE.");
}

const sessionsRoot = join(userProfile, ".codex", "sessions");
const sessionFile = await findSessionFile(sessionsRoot, threadId);
if (!sessionFile) throw new Error(`Không tìm thấy token log cho thread ${threadId}.`);

const usage = aggregateUsage((await readFile(sessionFile, "utf8")).split(/\r?\n/));
const cost = calculateCost(usage.models);
if (!usage.latestTimestamp) throw new Error("Token log chưa có bản ghi usage.");
if (cost.unpricedModels.length) {
  throw new Error(`Chưa có bảng giá cho model: ${cost.unpricedModels.join(", ")}`);
}

const measuredAt = vietnamIso(usage.latestTimestamp);
const ledger = JSON.parse(await readFile(ledgerUrl, "utf8"));
const fx = await getFxRate(ledger.meta.apiAccounting);
cost.totalVnd = Math.round(cost.totalUsd * fx.rate);
ledger.meta.updatedAt = measuredAt;
ledger.meta.timezone = "Asia/Ho_Chi_Minh";
ledger.meta.apiAccounting = {
  status: "Ước tính từ token log, chưa đối soát hóa đơn",
  pricingBasis: "Giá API Standard, USD trên 1 triệu token",
  pricingSource,
  fxRateVndPerUsd: fx.rate,
  fxSource,
  fxUpdatedAt: fx.updatedAt,
  fxStatus: fx.status,
  lastMeasuredAt: measuredAt,
  totalCostUsd: cost.totalUsd,
  totalCostVnd: cost.totalVnd,
  models: cost.models,
};

const apiEntry = {
  id: "2026-10-22-api-001",
  date: "2026-10-22",
  timestamp: measuredAt,
  activity: "Hạch toán lũy kế chi phí API Codex theo token usage của thread",
  channel: "OpenAI API",
  market: "Không áp dụng",
  language: "Không áp dụng",
  kind: "api-cost",
  status: "Ước tính từ usage, chưa đối soát hóa đơn",
  cost: cost.totalVnd,
  revenue: 0,
  evidence: pricingSource,
  note: `${cost.totalUsd.toFixed(6)} USD, tỷ giá ${fx.rate.toLocaleString("vi-VN")} VND/USD. Chi phí được cập nhật lũy kế, không cộng trùng giữa các lần đo.`,
};
const apiEntryIndex = ledger.entries.findIndex((entry) => entry.id === apiEntry.id);
if (apiEntryIndex >= 0) ledger.entries[apiEntryIndex] = apiEntry;
else ledger.entries.push(apiEntry);

await writeFile(ledgerUrl, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    session: basename(sessionFile),
    measuredAt,
    totalCostUsd: cost.totalUsd,
    totalCostVnd: cost.totalVnd,
    models: cost.models.map((model) => model.model),
  }),
);
