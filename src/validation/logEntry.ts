export type LogLevel = "debug" | "info" | "warn" | "error";

const VALID_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

export interface ValidatedLogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Record<string, string | number | boolean>;
}

export type ValidationResult =
  | { valid: true; entry: ValidatedLogEntry }
  | { valid: false; reason: string };

export function validateLogEntry(raw: unknown): ValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { valid: false, reason: "entry must be an object" };
  }

  const obj = raw as Record<string, unknown>;

  // timestamp
  if (typeof obj.timestamp !== "string" || obj.timestamp.trim() === "") {
    return { valid: false, reason: "timestamp is required" };
  }
  const parsedDate = new Date(obj.timestamp);
  if (isNaN(parsedDate.getTime())) {
    return { valid: false, reason: `invalid timestamp: '${obj.timestamp}'` };
  }
  const fiveMinutesFromNow = Date.now() + 5 * 60 * 1000;
  if (parsedDate.getTime() > fiveMinutesFromNow) {
    return { valid: false, reason: "timestamp is more than five minutes in the future" };
  }

  // level
  if (typeof obj.level !== "string" || !VALID_LEVELS.includes(obj.level as LogLevel)) {
    return { valid: false, reason: `invalid level: '${obj.level}'` };
  }

  // service
  if (typeof obj.service !== "string" || obj.service.trim() === "") {
    return { valid: false, reason: "service is required and must be a non-empty string" };
  }

  // message
  if (typeof obj.message !== "string" || obj.message.trim() === "") {
    return { valid: false, reason: "message is required and must be a non-empty string" };
  }

  // attributes (optional)
  const attributes: Record<string, string | number | boolean> = {};
  if (obj.attributes !== undefined) {
    if (
      typeof obj.attributes !== "object" ||
      obj.attributes === null ||
      Array.isArray(obj.attributes)
    ) {
      return { valid: false, reason: "attributes must be a flat object" };
    }
    for (const [key, value] of Object.entries(obj.attributes as Record<string, unknown>)) {
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        return {
          valid: false,
          reason: `attribute '${key}' must be a string, number, or boolean`,
        };
      }
      attributes[key] = value;
    }
  }

  return {
    valid: true,
    entry: {
      timestamp: obj.timestamp,
      level: obj.level as LogLevel,
      service: obj.service,
      message: obj.message,
      attributes,
    },
  };
}