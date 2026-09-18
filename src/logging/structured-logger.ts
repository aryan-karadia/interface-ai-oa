import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Redactor } from "../guardrail/redactor";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export type Subsystem = "discovery" | "replay" | "escalation" | "guardrail" | "surface" | "system";

export interface LogEntry {
  timestamp: string;
  subsystem: Subsystem;
  level: LogLevel;
  action: string;
  message: string;
  reason?: string;
  context?: Record<string, unknown>;
}

export interface LogFilter {
  subsystem?: Subsystem;
  level?: LogLevel;
  action?: string;
  runId?: string;
  since?: string;
}

export class StructuredLogger {
  private entries: LogEntry[] = [];

  /**
   * Records a structured log entry with automatic point-of-capture PII/secrets redaction
   */
  log(entry: Omit<LogEntry, "timestamp">): LogEntry {
    const rawEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      subsystem: entry.subsystem,
      level: entry.level,
      action: entry.action,
      message: entry.message,
      reason: entry.reason,
      context: entry.context,
    };

    const sanitizedEntry = Redactor.redactDeep(rawEntry) as LogEntry;
    this.entries.push(sanitizedEntry);
    return sanitizedEntry;
  }

  info(
    subsystem: Subsystem,
    action: string,
    message: string,
    reason?: string,
    context?: Record<string, unknown>,
  ): LogEntry {
    return this.log({ subsystem, level: "INFO", action, message, reason, context });
  }

  warn(
    subsystem: Subsystem,
    action: string,
    message: string,
    reason?: string,
    context?: Record<string, unknown>,
  ): LogEntry {
    return this.log({ subsystem, level: "WARN", action, message, reason, context });
  }

  error(
    subsystem: Subsystem,
    action: string,
    message: string,
    reason?: string,
    context?: Record<string, unknown>,
  ): LogEntry {
    return this.log({ subsystem, level: "ERROR", action, message, reason, context });
  }

  debug(
    subsystem: Subsystem,
    action: string,
    message: string,
    reason?: string,
    context?: Record<string, unknown>,
  ): LogEntry {
    return this.log({ subsystem, level: "DEBUG", action, message, reason, context });
  }

  getAll(): LogEntry[] {
    return [...this.entries];
  }

  query(filter: LogFilter): LogEntry[] {
    return this.entries.filter((e) => {
      if (filter.subsystem && e.subsystem !== filter.subsystem) return false;
      if (filter.level && e.level !== filter.level) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.runId && e.context?.runId !== filter.runId) return false;
      if (filter.since && new Date(e.timestamp) < new Date(filter.since)) return false;
      return true;
    });
  }

  exportJsonl(): string {
    return this.entries.map((e) => JSON.stringify(e)).join("\n");
  }

  writeToFile(filePath: string): void {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const content = this.exportJsonl();
    writeFileSync(filePath, content, "utf-8");
  }

  static loadFromJsonl(filePath: string): LogEntry[] {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LogEntry);
  }
}
