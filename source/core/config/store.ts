/**
 * مخزن إعدادات التطبيق (البند 37-41).
 *
 * - ملف JSON قابل للحقن للمسار (للاختبار وللإنتاج عبر app.getPath("userData")).
 * - الكتابة ذرية: ملف مؤقت ثم rename (لا تلف عند الانقطاع).
 * - مفتاح API يُحفظ على القرص فقط إذا كان keepApiKey صريحاً (البند 40).
 * - تحميل تالف أو مفقود → قيم افتراضية آمنة بلا تعطل.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import type { AppSettings } from "../types";

/** النسخة الحالية من مخطط الملف. */
const SCHEMA_VERSION = 1;

/** صيغة الملف المحفوظ. */
interface PersistedConfig {
  version: number;
  sources?: string[];
  destination?: string;
  recursive?: boolean;
  keepApiKey?: boolean;
  apiKey?: string;
}

/** قيم افتراضية آمنة. */
export function defaultSettings(): AppSettings {
  return {
    sources: [],
    destination: "",
    recursive: true,
    keepApiKey: false,
    apiKey: "",
  };
}

/** تحقق من كون القيمة مصفوفة سلاسل. */
function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** خزّان الإعدادات. */
export class AppConfigStore {
  private readonly filePath: string;

  /**
   * @param filePath مسار ملف الإعدادات JSON.
   */
  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * تحميل الإعدادات الحالية (أو الافتراضية عند الغياب/التلف).
   * @returns الإعدادات المحمّلة.
   */
  async load(): Promise<AppSettings> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch {
      return defaultSettings();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaultSettings();
    }

    const base = defaultSettings();
    if (typeof parsed !== "object" || parsed === null) {
      return base;
    }
    const cfg = parsed as PersistedConfig;
    const result: AppSettings = {
      sources: isStringList(cfg.sources) ? cfg.sources.slice() : base.sources,
      destination: typeof cfg.destination === "string" ? cfg.destination : base.destination,
      recursive: typeof cfg.recursive === "boolean" ? cfg.recursive : base.recursive,
      keepApiKey: typeof cfg.keepApiKey === "boolean" ? cfg.keepApiKey : base.keepApiKey,
      apiKey: cfg.keepApiKey && typeof cfg.apiKey === "string" ? cfg.apiKey : base.apiKey,
    };
    return result;
  }

  /**
   * حفظ الإعدادات (تكتب المفتاح على القرص فقط عند keepApiKey).
   * @param settings الإعدادات المراد حفظها.
   */
  async save(settings: AppSettings): Promise<void> {
    const payload: PersistedConfig = {
      version: SCHEMA_VERSION,
      sources: settings.sources.slice(),
      destination: settings.destination,
      recursive: settings.recursive,
      keepApiKey: settings.keepApiKey,
      apiKey: settings.keepApiKey ? settings.apiKey : undefined,
    };

    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
    try {
      await fsp.rename(tmp, this.filePath);
    } catch (error) {
      try {
        await fsp.unlink(tmp);
      } catch {
        /* تجاهل فشل التنظيف. */
      }
      throw error;
    }
  }

  /**
   * مسح الملف المحفوظ (إعادة ضبط للإعدادات الافتراضية).
   */
  async reset(): Promise<void> {
    try {
      await fsp.unlink(this.filePath);
    } catch {
      /* غياب الملف ليس خطأ. */
    }
  }
}