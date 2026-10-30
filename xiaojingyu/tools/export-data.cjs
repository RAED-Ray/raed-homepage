#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
// 此个人主页版本的“本月”展示口径固定为最近 30 天。
const days = 30;
const output = path.resolve(readArg("--output", path.join(__dirname, "..", "data", "dashboard.json")));
const baseUrl = String(process.env.XIAOJINGYU_PANEL_URL || "http://127.0.0.1:8080").replace(/\/+$/, "");
const appDir = String(process.env.XIAOJINGYU_APP_DIR || "D:/Program Files (x86)/Xiaojingyu");
const password = process.env.LOG_PASSWORD || "";

if (!password) {
  console.error("缺少 LOG_PASSWORD。可用 Node 的 --env-file 指向小鲸鱼 .env，不要直接把密码写进本项目。");
  process.exit(1);
}

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};
const rounded = (value) => Math.round(finite(value) * 1000000) / 1000000;

async function getJson(pathname, search = {}) {
  const url = new URL(baseUrl + pathname);
  url.searchParams.set("p", password);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, String(value));

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

function readVisionTotal(usageDays) {
  const statsFile = path.join(appDir, "data", "vision-stats.json");
  try {
    const stats = JSON.parse(fs.readFileSync(statsFile, "utf8"));
    const dates = new Set(usageDays.map((item) => item.date));
    let total = 0;
    for (const [date, item] of Object.entries(stats.days || {})) {
      if (dates.has(date)) total += Math.round(finite(item && item.ok));
    }
    return total;
  } catch (error) {
    console.warn(`未能按 ${usageDays.length} 天快照汇总识图数据：${error.message}`);
    return null;
  }
}

async function main() {
  const [state, usage] = await Promise.all([
    getJson("/api/state"),
    getJson("/api/usage", { days })
  ]);
  const budget = state && state.budget;
  if (!budget) throw new Error("面板没有返回 budget 数据");

  const dailyLimit = finite(budget.dailyLimit);
  const daySpent = rounded(budget.daySpent);
  const usageDays = (Array.isArray(usage.days) ? usage.days : [])
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item.date || "")))
    .slice(-days)
    .map((item) => ({
      date: String(item.date),
      md: String(item.date).slice(5),
      calls: Math.round(finite(item.calls)),
      spent: rounded(item.spent)
    }));
  const publicData = {
    schemaVersion: 1,
    source: "snapshot",
    generatedAt: new Date().toISOString(),
    budget: {
      daySpent,
      dailyLimit,
      dayLeft: Math.max(0, rounded(dailyLimit - daySpent)),
      spentYuan: rounded(budget.spentYuan),
      totalLimit: finite(budget.totalLimit),
      dayCalls: Math.round(finite(budget.dayCalls)),
      dailyCallLimit: Math.round(finite(budget.dailyCallLimit)),
      visionUsed: readVisionTotal(usageDays),
      visionLimit: Math.round(finite(state.vision && state.vision.limit))
    },
    usage: usageDays
  };

  const directory = path.dirname(output);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = output + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(publicData, null, 2) + "\n", "utf8");
  fs.renameSync(temporary, output);
  console.log(`已导出 ${publicData.usage.length} 天脱敏用量数据：${output}`);
  console.log(`本月识图已按同一快照范围汇总：${publicData.budget.visionUsed == null ? "不可用" : publicData.budget.visionUsed + " 张"}`);
  console.log("公开文件仅包含额度、调用次数与趋势，不含密码、日志、聊天或设置。请检查后再提交到 GitHub Pages。");
}

main().catch((error) => {
  const message = String(error && error.message ? error.message : error).split(password).join("***");
  console.error(`导出失败：${message}`);
  console.error("请确认小鲸鱼面板已启动，且 LOG_PASSWORD 与 XIAOJINGYU_PANEL_URL 配置正确。");
  process.exitCode = 1;
});
