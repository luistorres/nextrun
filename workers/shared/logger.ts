type LogLevel = "debug" | "info" | "warn" | "error";

interface LogPayload {
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, extra?: LogPayload): void {
  const entry = {
    level,
    message,
    ...extra,
    timestamp: new Date().toISOString(),
  };
  const line = JSON.stringify(entry);

  switch (level) {
    case "error":
      process.stderr.write(line + "\n");
      break;
    case "warn":
      process.stderr.write(line + "\n");
      break;
    default:
      process.stdout.write(line + "\n");
      break;
  }
}

export const logger = {
  debug(message: string, extra?: LogPayload) {
    emit("debug", message, extra);
  },
  info(message: string, extra?: LogPayload) {
    emit("info", message, extra);
  },
  warn(message: string, extra?: LogPayload) {
    emit("warn", message, extra);
  },
  error(message: string, extra?: LogPayload) {
    emit("error", message, extra);
  },
};
