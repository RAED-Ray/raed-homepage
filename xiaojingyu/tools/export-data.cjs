#!/usr/bin/env node
"use strict";

/**
 * 小鲸鱼公开看板快照导出器（新版 BOT）
 *
 * 直接运行：node tools/export-data.cjs
 * 可选参数：
 *   --app-dir <目录>   BOT 根目录，默认 D:/Xiaojingyu-QQbot-main
 *   --legacy-dir <目录> 旧版目录，默认 <app-dir>/oldassets
 *   --env-file <文件>  指定 .env，默认 <app-dir>/.env
 *   --url <地址>       面板地址，默认按 PORT 使用 http://127.0.0.1:<PORT>
 *   --output <文件>    输出位置，默认 ../data/dashboard.json
 *
 * 只从原面板读取数据，不启动/停止 BOT，也不修改 BOT 的任何文件。
 */

const fs = require("fs");
const path = require("path");

const DAYS = 30;
const DEFAULT_APP_DIR = "D:/Xiaojingyu-QQbot-main";
const args = process.argv.slice(2);

function readArg(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log([
    "用法：node tools/export-data.cjs [选项]",
    "",
    "  --app-dir <目录>   小鲸鱼 BOT 根目录",
    "  --legacy-dir <目录> 旧版 BOT 根目录或 data 目录",
    "  --env-file <文件>  自定义 .env 路径",
    "  --url <地址>       自定义控制面板地址",
    "  --output <文件>    自定义快照输出路径",
    "  --help             显示帮助"
  ].join("\n"));
  process.exit(0);
}

const appDir = path.resolve(readArg(
  "--app-dir",
  process.env.XIAOJINGYU_APP_DIR || DEFAULT_APP_DIR
));
const envFile = path.resolve(readArg("--env-file", path.join(appDir, ".env")));
const output = path.resolve(readArg(
  "--output",
  path.join(__dirname, "..", "data", "dashboard.json")
));
const legacyDir = path.resolve(readArg(
  "--legacy-dir",
  process.env.XIAOJINGYU_LEGACY_DIR || path.join(appDir, "oldassets")
));
const legacyDataDir = fs.existsSync(path.join(legacyDir, "data"))
  ? path.join(legacyDir, "data")
  : legacyDir;

// Node 22 原生读取 .env；密码只进入当前进程，不会写入公开快照。
if (fs.existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch (error) {
    console.error(`无法读取环境配置 ${envFile}：${error.message}`);
    process.exit(1);
  }
}

const password = process.env.LOG_PASSWORD || "";
const port = String(process.env.PORT || "8080");
const baseUrl = String(readArg(
  "--url",
  process.env.XIAOJINGYU_PANEL_URL || `http://127.0.0.1:${port}`
)).replace(/\/+$/, "");

if (!password) {
  console.error(`缺少 LOG_PASSWORD。请检查 ${envFile}，或通过环境变量提供。`);
  process.exit(1);
}

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const rounded = (value) => Math.round(finite(value) * 1000000) / 1000000;

function normalizeDate(value) {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value || ""));
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

async function getJson(pathname, search = {}) {
  const url = new URL(baseUrl + pathname);
  url.searchParams.set("p", password);
  for (const [key, value] of Object.entries(search)) {
    url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "error"
    });
    if (!response.ok) throw new Error(`${pathname} 返回 HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function readJsonFile(file, optional = false) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (!optional || error.code !== "ENOENT") {
      console.warn(`未能读取 ${file}：${error.message}`);
    }
    return null;
  }
}

function readLegacyUsage() {
  const data = readJsonFile(path.join(legacyDataDir, "usage.json"), true);
  const days = data && data.days && typeof data.days === "object" ? data.days : {};
  return Object.entries(days).map(([date, item]) => ({ ...(item || {}), date }));
}

function visionStatsFile() {
  if (process.env.XIAOJINGYU_DATA_DIR) {
    return path.join(path.resolve(process.env.XIAOJINGYU_DATA_DIR), "vision-stats.json");
  }
  const serverFile = path.join(appDir, "server", "data", "vision-stats.json");
  const legacyFile = path.join(appDir, "data", "vision-stats.json");
  if (fs.existsSync(serverFile) || !fs.existsSync(legacyFile)) return serverFile;
  return legacyFile;
}

function readVisionTotal(usageDays) {
  const dates = new Set(usageDays.map((item) => item.date));
  const files = [
    path.join(legacyDataDir, "vision-stats.json"),
    visionStatsFile()
  ];
  let total = 0;
  let available = false;

  for (const file of new Set(files)) {
    const stats = readJsonFile(file, file.startsWith(legacyDataDir));
    if (!stats) continue;
    available = true;
    for (const [key, item] of Object.entries(stats.days || {})) {
      const date = normalizeDate(key);
      // 新旧版本在迁移日记录的是不同时间段，因此同日数据相加。
      if (date && dates.has(date)) total += Math.round(finite(item && item.ok));
    }
  }
  return available ? total : null;
}

function mergeUsageDays(usage, legacyRecords) {
  const byDate = new Map();
  const currentRecords = Array.isArray(usage.days) ? usage.days : [];

  for (const item of [...legacyRecords, ...currentRecords]) {
    const date = normalizeDate(item && item.date);
    if (!date) continue;
    const current = byDate.get(date) || { calls: 0, spent: 0 };
    byDate.set(date, {
      date,
      md: date.slice(5),
      calls: current.calls + Math.round(finite(item.calls)),
      spent: rounded(current.spent + finite(item.spent))
    });
  }

  return Array.from(byDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS);
}

async function main() {
  const [state, usage] = await Promise.all([
    getJson("/api/state"),
    getJson("/api/usage", { days: DAYS })
  ]);
  const budget = state && state.budget;
  if (!budget || typeof budget !== "object") {
    throw new Error("面板没有返回有效的 budget 数据");
  }

  const legacyUsage = readLegacyUsage();
  const usageDays = mergeUsageDays(usage, legacyUsage);
  if (!usageDays.length) {
    throw new Error("面板没有返回用量趋势，已保留现有公开快照");
  }

  const daySpent = rounded(budget.daySpent);
  const dailyLimit = finite(budget.dailyLimit);
  const spentYuan = rounded(budget.spentYuan);
  const totalLimit = finite(budget.totalLimit);

  // 明确构造公开对象：/api/state 中的日志、对话、设置等字段不会进入文件。
  const publicData = {
    schemaVersion: 1,
    source: "snapshot",
    generatedAt: new Date().toISOString(),
    budget: {
      daySpent,
      dailyLimit,
      dayLeft: Math.max(0, rounded(dailyLimit - daySpent)),
      spentYuan,
      totalLimit,
      dayCalls: Math.round(finite(budget.dayCalls)),
      dailyCallLimit: Math.round(finite(budget.dailyCallLimit)),
      visionUsed: readVisionTotal(usageDays),
      visionLimit: Math.round(finite(state.vision && state.vision.limit))
    },
    usage: usageDays
  };

  const directory = path.dirname(output);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(publicData, null, 2) + "\n", "utf8");
    fs.renameSync(temporary, output);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }

  const monthLeft = Math.max(0, rounded(totalLimit - spentYuan));
  console.log(`已合并旧版 ${legacyUsage.length} 天用量，导出 ${usageDays.length} 天脱敏快照：${output}`);
  console.log(`本月已花 ¥${spentYuan.toFixed(6)}，本月剩余 ¥${monthLeft.toFixed(6)}（月度额度 ¥${totalLimit}）`);
  console.log(`最近 ${usageDays.length} 天识图：${publicData.budget.visionUsed == null ? "不可用" : publicData.budget.visionUsed + " 张"}`);
  console.log("公开文件不含密码、日志、聊天或设置。检查 dashboard.json 后即可提交到 GitHub Pages。");
}

main().catch((error) => {
  const raw = error && error.name === "AbortError"
    ? "连接面板超时"
    : String(error && error.message ? error.message : error);
  console.error(`导出失败：${raw.split(password).join("***")}`);
  console.error(`请确认新版面板已启动：${baseUrl}，配置目录：${appDir}`);
  process.exitCode = 1;
});
