/**
 * منطق الواجهة الكامل (Renderer).
 * يتواصل مع Main عبر جسر IPC الآمن فقط؛ بلا أي صلاحيات Node.js.
 */

import type { AppSettings, Decision, JobPhase, Stats } from "../core/types";
import type { JobEvent } from "../core/ipc-contracts";

const PHASE_LABELS: Record<JobPhase, string> = {
  ready: "جاهز",
  preparing: "تحضير…",
  scanning: "فحص المصادر…",
  parsing: "تحليل الأسماء…",
  searching: "الاستعلام عن التصنيفات…",
  moving: "نقل المحتوى…",
  stopping: "إيقاف آمن…",
  stopped: "متوقف",
  complete: "مكتمل",
  aborted: "متوقف (خطأ حرج)",
};

const RUNNING_PHASES: ReadonlySet<JobPhase> = new Set([
  "preparing",
  "scanning",
  "parsing",
  "searching",
  "moving",
  "stopping",
]);

const OUTCOME_LABELS: Record<Decision["outcome"], string> = {
  MOVE: "نقل",
  SKIP: "تجاوز",
  ERROR: "خطأ",
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`missing element #${id}`);
  }
  return node as T;
}

let settings: AppSettings = {
  sources: [],
  destination: "",
  recursive: true,
  keepApiKey: false,
  apiKey: "",
};

let running = false;
let logLines = 0;
const MAX_LOG_LINES = 600;

/* ------------------------------ أدوات عرض ------------------------------ */

function renderSources(): void {
  const list = el<HTMLUListElement>("sources-list");
  const empty = el<HTMLParagraphElement>("sources-empty");
  list.replaceChildren();
  empty.hidden = settings.sources.length > 0;

  settings.sources.forEach((source, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = source;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕";
    remove.title = "إزالة هذا المصدر";
    remove.addEventListener("click", () => {
      if (running) {
        return;
      }
      void removeSource(index);
    });
    item.append(label, remove);
    list.append(item);
  });
}

function appendLog(level: "info" | "warn" | "error" | "debug", message: string, time?: string): void {
  const area = el<HTMLDivElement>("log-area");
  const line = document.createElement("div");
  line.className = `log-line level-${level}`;
  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = time ? `[${time}] ` : "";
  const msgSpan = document.createElement("span");
  msgSpan.className = "msg";
  msgSpan.textContent = message;
  line.append(timeSpan, msgSpan);
  area.append(line);
  logLines += 1;
  if (logLines > MAX_LOG_LINES) {
    area.firstElementChild?.remove();
    logLines -= 1;
  }
  area.scrollTop = area.scrollHeight;
}

function appendDecision(folder: string, decision: Decision): void {
  const label = OUTCOME_LABELS[decision.outcome];
  appendLog(
    decision.outcome === "ERROR" ? "error" : decision.outcome === "MOVE" ? "info" : "warn",
    `${folder} → ${label} (${decision.reason})${decision.details ? ` — ${decision.details}` : ""}`
  );
}

function setBadge(state: string, label: string): void {
  const badge = el<HTMLDivElement>("job-badge");
  badge.setAttribute("data-state", state);
  badge.textContent = label;
}

function setPhase(phase: JobPhase): void {
  el<HTMLSpanElement>("job-phase-label").textContent = PHASE_LABELS[phase] ?? phase;
  running = RUNNING_PHASES.has(phase);
  setBadge(
    running ? "running" : phase === "complete" ? "complete" : phase === "aborted" || phase === "stopped" ? "stopped" : "idle",
    running ? "قيد التشغيل" : PHASE_LABELS[phase] ?? phase
  );
  syncControlState();
}

function setStats(stats: Stats): void {
  el<HTMLSpanElement>("stat-processed").textContent = String(stats.processed);
  el<HTMLSpanElement>("stat-moved").textContent = String(stats.moved);
  el<HTMLSpanElement>("stat-skipped").textContent = String(stats.skipped);
  el<HTMLSpanElement>("stat-errors").textContent = String(stats.errors);
}

function syncControlState(): void {
  const disabled = running;
  el<HTMLButtonElement>("add-source-btn").disabled = disabled;
  el<HTMLButtonElement>("pick-destination-btn").disabled = disabled;
  el<HTMLInputElement>("destination-input").disabled = disabled;
  el<HTMLInputElement>("recursive-check").disabled = disabled;
  el<HTMLInputElement>("keep-key-check").disabled = disabled;
  el<HTMLInputElement>("api-key-input").disabled = disabled;
  el<HTMLButtonElement>("toggle-key-btn").disabled = disabled;
  el<HTMLButtonElement>("start-btn").disabled = disabled;
  el<HTMLButtonElement>("stop-btn").disabled = !disabled;
}

/* ------------------------------ حفظ الإعدادات ------------------------------ */

async function persist(patch: Partial<AppSettings>): Promise<void> {
  try {
    settings = await window.adultMover.saveSettings(patch);
  } catch (error) {
    appendLog("error", `تعذر حفظ الإعدادات: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function syncFromSettings(): void {
  renderSources();
  el<HTMLInputElement>("destination-input").value = settings.destination;
  el<HTMLInputElement>("recursive-check").checked = settings.recursive;
  el<HTMLInputElement>("keep-key-check").checked = settings.keepApiKey;
  if (!el<HTMLInputElement>("api-key-input").matches(":focus")) {
    el<HTMLInputElement>("api-key-input").value = settings.apiKey;
  }
}

/* ------------------------------ الأحداث ------------------------------ */

async function addSource(): Promise<void> {
  const result = await window.adultMover.pickFolder();
  if (result.canceled || result.path === null) {
    return;
  }
  if (settings.sources.includes(result.path)) {
    appendLog("warn", `المصدر موجود مسبقاً: ${result.path}`);
    return;
  }
  const next = settings.sources.concat(result.path);
  await persist({ sources: next });
  syncFromSettings();
}

async function removeSource(index: number): Promise<void> {
  const next = settings.sources.filter((_, i) => i !== index);
  await persist({ sources: next });
  syncFromSettings();
}

async function pickDestination(): Promise<void> {
  const result = await window.adultMover.pickFolder();
  if (result.canceled || result.path === null) {
    return;
  }
  await persist({ destination: result.path });
  syncFromSettings();
}

async function toggleKeyVisibility(): Promise<void> {
  const input = el<HTMLInputElement>("api-key-input");
  const btn = el<HTMLButtonElement>("toggle-key-btn");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  btn.textContent = show ? "إخفاء" : "إظهار";
}

async function startJob(): Promise<void> {
  el<HTMLDivElement>("start-error").textContent = "";
  const result = await window.adultMover.startJob();
  if (!result.ok) {
    el<HTMLDivElement>("start-error").textContent = result.error ?? "تعذر بدء الوظيفة.";
    return;
  }
  setPhase("preparing");
}

function handleJobEvent(event: JobEvent): void {
  switch (event.type) {
    case "log":
      appendLog(event.level, event.message, event.time);
      break;
    case "phase":
      setPhase(event.phase);
      break;
    case "stats":
      setStats(event.stats);
      break;
    case "decision":
      appendDecision(event.folder, event.decision);
      break;
    case "complete": {
      setStats(event.stats);
      setPhase(event.phase);
      const how = event.stopped ? "أُوقفت الوظيفة بناءً على طلبك" : event.phase === "complete" ? "اكتملت الوظيفة" : "توقفت الوظيفة بسبب خطأ حرج";
      appendLog(
        event.phase === "complete" ? "info" : "warn",
        `${how} — نُقل: ${event.stats.moved}، تخطّى: ${event.stats.skipped}، أخطاء: ${event.stats.errors}`
      );
      if (event.stopped) {
        appendLog("warn", "تمت معالجة المجلد الحالي ثم أوقفت الوظيفة بأمان.");
      }
      break;
    }
  }
}

/* ------------------------------ الإقلاع ------------------------------ */

async function init(): Promise<void> {
  try {
    const info = await window.adultMover.probe();
    el<HTMLSpanElement>("app-version").textContent = `الإصدار ${info.appVersion} — Electron ${info.electronVersion}`;
  } catch (error) {
    appendLog("error", `تعذر الاتصال بالمضيف: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    settings = await window.adultMover.getSettings();
  } catch (error) {
    appendLog("error", `تعذر تحميل الإعدادات: ${error instanceof Error ? error.message : String(error)}`);
  }
  syncFromSettings();
  setPhase("ready");
  appendLog("info", "جاهز للبدء.");

  window.adultMover.onJobEvent(handleJobEvent);

  el<HTMLButtonElement>("add-source-btn").addEventListener("click", () => void addSource());
  el<HTMLButtonElement>("pick-destination-btn").addEventListener("click", () => void pickDestination());
  el<HTMLButtonElement>("toggle-key-btn").addEventListener("click", () => void toggleKeyVisibility());
  el<HTMLInputElement>("destination-input").addEventListener("change", () => {
    if (!running) {
      void persist({ destination: el<HTMLInputElement>("destination-input").value });
    }
  });
  el<HTMLInputElement>("api-key-input").addEventListener("change", () => {
    if (!running) {
      void persist({ apiKey: el<HTMLInputElement>("api-key-input").value });
    }
  });
  el<HTMLInputElement>("recursive-check").addEventListener("change", () => {
    if (!running) {
      void persist({ recursive: el<HTMLInputElement>("recursive-check").checked });
    }
  });
  el<HTMLInputElement>("keep-key-check").addEventListener("change", () => {
    if (!running) {
      void persist({ keepApiKey: el<HTMLInputElement>("keep-key-check").checked });
    }
  });
  el<HTMLButtonElement>("start-btn").addEventListener("click", () => void startJob());
  el<HTMLButtonElement>("stop-btn").addEventListener("click", () => {
    if (running) {
      void window.adultMover.stopJob();
      appendLog("warn", "يُوقف الآن — يُكمل المجلد الحالي ثم يتوقف.");
    }
  });
  el<HTMLButtonElement>("clear-log-btn").addEventListener("click", () => {
    el<HTMLDivElement>("log-area").replaceChildren();
    logLines = 0;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});