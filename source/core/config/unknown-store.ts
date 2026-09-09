/**
 * مخزن العناصر غير المعروفة (UnknownItem) — Phase A.
 * نمط الكتابة الذرية نفسه في store.ts: tmp → rename، تحميل متسامح.
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { UnknownItem } from "../types";

const SCHEMA_VERSION = 1;

interface PersistedUnknown {
  version: number;
  items: UnknownItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function toUnknownItem(raw: unknown): UnknownItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || !isUuid(raw.id)) return null;
  if (typeof raw.folderName !== "string") return null;
  if (typeof raw.originalPath !== "string") return null;
  if (typeof raw.reason !== "string") return null;
  if (typeof raw.date !== "string") return null;
  if (typeof raw.source !== "string") return null;
  if (raw.details !== undefined && typeof raw.details !== "string") return null;
  return {
    id: raw.id,
    folderName: raw.folderName,
    originalPath: raw.originalPath,
    reason: raw.reason,
    details: typeof raw.details === "string" ? raw.details : undefined,
    date: raw.date,
    source: raw.source,
  };
}

export class UnknownStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async load(): Promise<UnknownItem[]> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!isRecord(parsed) || !Array.isArray((parsed as unknown as PersistedUnknown).items)) {
      return [];
    }
    const items = (parsed as unknown as PersistedUnknown).items;
    const result: UnknownItem[] = [];
    for (const entry of items) {
      const item = toUnknownItem(entry);
      if (item) result.push(item);
    }
    return result;
  }

  private async saveAll(items: UnknownItem[]): Promise<void> {
    const payload: PersistedUnknown = { version: SCHEMA_VERSION, items };
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
        /* ignore */
      }
      throw error;
    }
  }

  async add(item: Omit<UnknownItem, "id" | "date">): Promise<UnknownItem> {
    const created: UnknownItem = {
      ...item,
      id: randomUUID(),
      date: new Date().toISOString(),
    };
    const items = await this.load();
    items.push(created);
    await this.saveAll(items);
    return created;
  }

  async addMany(items: Omit<UnknownItem, "id" | "date">[]): Promise<UnknownItem[]> {
    const created = items.map((it) => ({
      ...it,
      id: randomUUID(),
      date: new Date().toISOString(),
    }));
    const existing = await this.load();
    existing.push(...created);
    await this.saveAll(existing);
    return created;
  }

  async remove(id: string): Promise<boolean> {
    if (!isUuid(id)) return false;
    const items = await this.load();
    const filtered = items.filter((it) => it.id !== id);
    if (filtered.length === items.length) return false;
    await this.saveAll(filtered);
    return true;
  }

  async clearAll(): Promise<void> {
    await this.saveAll([]);
  }
}
