"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";
const state = { data: null, range: 14 };
const numberFormat = new Intl.NumberFormat("zh-CN");
const yuanFormat = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const finite = (value) => {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const yuan = (value) => yuanFormat.format(finite(value));

function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text !== undefined) element.textContent = String(text);
  return element;
}

function setStatus(label, mode) {
  $("#sourceLabel").textContent = label;
  $("#snapshotStatus").dataset.state = mode;
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "快照时间未知";
  return "快照更新于 " + new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date).replaceAll("/", ".");
}

function setMetric(name, options) {
  const card = document.querySelector(`[data-metric="${name}"]`);
  if (!card) return;
  const percent = options.limit > 0 ? clamp((finite(options.used) / options.limit) * 100, 0, 100) : 0;
  card.querySelector("[data-value]").textContent = options.value;
  card.querySelector("[data-limit]").textContent = options.limitText;
  const progress = card.querySelector("[data-progress]");
  progress.querySelector("i").style.width = percent + "%";
  progress.setAttribute("aria-valuenow", String(Math.round(percent)));
  progress.setAttribute("aria-valuetext", options.limitText);
  card.classList.toggle("warning", options.limit > 0 && finite(options.used) >= options.limit * 0.8 && finite(options.used) < options.limit);
  card.classList.toggle("danger", options.limit > 0 && finite(options.used) >= options.limit);
}

function renderBudget(budget, usage) {
  const monthDays = usage.slice(-30);
  const monthCalls = monthDays.reduce((sum, item) => sum + finite(item.calls), 0);
  const monthlyCallLimit = finite(budget.dailyCallLimit) * 30;
  const monthlyVisionLimit = finite(budget.visionLimit) * 30;


  setMetric("monthCalls", {
    value: numberFormat.format(monthCalls),
    used: monthCalls,
    limit: monthlyCallLimit,
    limitText: `近 30 天估算上限 ${numberFormat.format(monthlyCallLimit)} 次`
  });
  setMetric("visionUsed", {
    value: budget.visionUsed == null ? "—" : numberFormat.format(finite(budget.visionUsed)),
    used: budget.visionUsed,
    limit: monthlyVisionLimit,
    limitText: `近 30 天估算上限 ${numberFormat.format(monthlyVisionLimit)} 张`
  });
  // 原面板的累计账本即月度账单，月度总额度为 30 元。
  setMetric("spentYuan", {
    value: yuan(budget.spentYuan),
    used: budget.spentYuan,
    limit: finite(budget.totalLimit),
    limitText: `本月剩余 ${yuan(Math.max(0, finite(budget.totalLimit) - finite(budget.spentYuan)))}`
  });
  $("#dailyLimitNote").textContent = `每日调用上限 ${numberFormat.format(finite(budget.dailyCallLimit))} 次`;
}

function niceMaximum(value) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude * 2) / 2 * magnitude;
}

function createGradient(defs, id, colors) {
  const gradient = svgElement("linearGradient", { id, x1: "0", y1: "0", x2: "0", y2: "1" });
  gradient.append(
    svgElement("stop", { offset: "0%", "stop-color": colors[0] }),
    svgElement("stop", { offset: "100%", "stop-color": colors[1] })
  );
  defs.append(gradient);
}

function showTooltip(event, day, stage, tooltip) {
  tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = day.date;
  const calls = document.createElement("span");
  calls.textContent = `调用 ${numberFormat.format(day.calls)} 次`;
  const spent = document.createElement("span");
  spent.textContent = `估算花费 ${yuan(day.spent)}`;
  tooltip.append(title, calls, spent);
  tooltip.hidden = false;

  const bounds = stage.getBoundingClientRect();
  let clientX = event.clientX;
  let clientY = event.clientY;
  if ((!clientX && !clientY) && event.currentTarget) {
    const targetBounds = event.currentTarget.getBoundingClientRect();
    clientX = targetBounds.left + targetBounds.width / 2;
    clientY = targetBounds.top;
  }
  const x = clamp(clientX - bounds.left, 85, bounds.width - 85);
  const y = Math.max(75, clientY - bounds.top);
  tooltip.style.left = x + "px";
  tooltip.style.top = y + "px";
}

function renderChart(allDays, dailyLimit) {
  const days = allDays.slice(-state.range).map((item) => ({
    date: String(item.date),
    md: String(item.md || String(item.date).slice(5)),
    calls: Math.round(finite(item.calls)),
    spent: finite(item.spent)
  }));
  const chart = $("#usageChart");
  const empty = $("#emptyState");
  chart.replaceChildren();
  $("#chartTooltip").hidden = true;

  const total = days.reduce((sum, item) => sum + item.calls, 0);
  const peak = days.reduce((max, item) => Math.max(max, item.calls), 0);
  $("#totalCalls").textContent = days.length ? numberFormat.format(total) : "—";
  $("#averageCalls").textContent = days.length ? numberFormat.format(Math.round(total / days.length)) : "—";
  $("#peakCalls").textContent = days.length ? numberFormat.format(peak) : "—";
  $("#rangeLabel").textContent = `最近 ${state.range} 天 · ${days.length} 天有记录`;
  empty.hidden = days.length > 0;
  chart.hidden = days.length === 0;
  if (!days.length) return;

  const width = Math.max(900, days.length * 54 + 90);
  const height = 340;
  const margin = { top: 34, right: 22, bottom: 52, left: 57 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maximum = niceMaximum(Math.max(1, peak));
  const band = plotWidth / days.length;
  const barWidth = Math.min(32, band * 0.58);
  const stage = $("#chartStage");
  const tooltip = $("#chartTooltip");
  stage.style.minWidth = Math.min(width, 660) + "px";
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.style.width = width + "px";
  chart.style.maxWidth = "none";

  const defs = svgElement("defs");
  createGradient(defs, "barGradient", ["#4398f5", "#216bd2"]);
  createGradient(defs, "hotGradient", ["#f0ba5c", "#d98d24"]);
  createGradient(defs, "overGradient", ["#ed8389", "#cd454e"]);
  chart.append(defs);
  chart.append(
    svgElement("title", { id: "chartTitle" }, "每日模型调用次数柱状图"),
    svgElement("desc", { id: "chartDesc" }, `最近 ${days.length} 天调用次数，总计 ${total} 次，单日峰值 ${peak} 次。`)
  );

  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = margin.top + plotHeight - ratio * plotHeight;
    chart.append(
      svgElement("line", { class: "grid-line", x1: margin.left, x2: width - margin.right, y1: y, y2: y }),
      svgElement("text", { class: "axis-label", x: margin.left - 12, y: y + 3, "text-anchor": "end" }, numberFormat.format(Math.round(maximum * ratio)))
    );
  }

  const labelStep = Math.max(1, Math.ceil(days.length / 15));
  days.forEach((day, index) => {
    const x = margin.left + index * band + (band - barWidth) / 2;
    const barHeight = day.calls > 0 ? Math.max(2, (day.calls / maximum) * plotHeight) : 0;
    const y = margin.top + plotHeight - barHeight;
    const level = dailyLimit > 0 && day.calls >= dailyLimit ? "over" : dailyLimit > 0 && day.calls >= dailyLimit * 0.8 ? "hot" : "";
    const group = svgElement("g", {
      class: "bar-group",
      tabindex: "0",
      role: "img",
      "aria-label": `${day.date}，调用 ${day.calls} 次，估算花费 ${yuan(day.spent)}`
    });
    group.append(
      svgElement("rect", { class: "bar-hit", x: margin.left + index * band, y: margin.top, width: band, height: plotHeight }),
      svgElement("rect", { class: `bar ${level}`.trim(), x, y, width: barWidth, height: barHeight, rx: Math.min(6, barWidth / 3) })
    );
    if (days.length <= 14 || index % labelStep === 0 || index === days.length - 1) {
      group.append(svgElement("text", {
        class: "value-label",
        x: x + barWidth / 2,
        y: Math.max(14, y - 8),
        "text-anchor": "middle"
      }, day.calls));
    }
    if (index % labelStep === 0 || index === days.length - 1) {
      group.append(svgElement("text", {
        class: `date-label${index === days.length - 1 ? " latest" : ""}`,
        x: x + barWidth / 2,
        y: height - 20,
        "text-anchor": "middle"
      }, day.md));
    }
    group.addEventListener("mouseenter", (event) => showTooltip(event, day, stage, tooltip));
    group.addEventListener("mousemove", (event) => showTooltip(event, day, stage, tooltip));
    group.addEventListener("mouseleave", () => { tooltip.hidden = true; });
    group.addEventListener("focus", (event) => showTooltip(event, day, stage, tooltip));
    group.addEventListener("blur", () => { tooltip.hidden = true; });
    chart.append(group);
  });
}

function render(data) {
  state.data = data;
  renderBudget(data.budget || {}, Array.isArray(data.usage) ? data.usage : []);
  renderChart(Array.isArray(data.usage) ? data.usage : [], finite(data.budget && data.budget.dailyCallLimit));
  const demo = data.source === "demo";
  setStatus(demo ? "示例数据" : "公开只读快照", demo ? "demo" : "ready");
  $("#updatedAt").textContent = formatUpdatedAt(data.generatedAt);
  $("#notice").hidden = true;
}

async function loadData() {
  setStatus("读取快照中", "loading");
  try {
    const response = await fetch(`./data/dashboard.json?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data || typeof data !== "object" || !data.budget || !Array.isArray(data.usage)) {
      throw new Error("数据格式不完整");
    }
    render(data);
  } catch (error) {
    setStatus("快照读取失败", "error");
    $("#updatedAt").textContent = "暂时无法读取数据";
    const notice = $("#notice");
    notice.textContent = `数据加载失败：${error.message}。请确认 data/dashboard.json 已与网页一起发布。`;
    notice.hidden = false;
    $("#emptyState").hidden = false;
    $("#emptyState").textContent = "用量快照暂时不可用。";
    $("#usageChart").hidden = true;
  }
}

$$("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.range = Number(button.dataset.range) || 14;
    $$("[data-range]").forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    if (state.data) renderChart(state.data.usage, finite(state.data.budget.dailyCallLimit));
  });
});

loadData();
