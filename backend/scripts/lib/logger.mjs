/**
 * Script Logger Utility (ES Module version)
 *
 * Provides structured logging for CLI scripts with proper levels,
 * redaction support, and consistent formatting.
 */

// Log levels
const LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  FATAL: 4
};

// Get log level from environment or default to INFO
const currentLevel = LEVELS[process.env.SCRIPT_LOG_LEVEL?.toUpperCase()] ?? LEVELS.INFO;

// Determine if we should use structured JSON or human-readable format
const useJson = process.env.SCRIPT_LOG_FORMAT === 'json';

// Redact sensitive patterns
const SENSITIVE_PATTERNS = [
  /password[=:]\S+/gi,
  /secret[=:]\S+/gi,
  /token[=:]\S+/gi,
  /api[_-]?key[=:]\S+/gi,
  /authorization:\s*bearer\s+\S+/gi,
  /["']password["']:\s*["'][^"']+["']/gi,
  /["']secret["']:\s*["'][^"']+["']/gi,
  /["']token["']:\s*["'][^"']+["']/gi
];

/**
 * Redact sensitive information from log messages
 * @param {string} message
 * @returns {string}
 */
function redact(message) {
  if (typeof message !== 'string') {
    message = String(message);
  }
  let redacted = message;
  for (const pattern of SENSITIVE_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}

/**
 * Format log entry
 * @param {string} level
 * @param {string} message
 * @param {object} [meta]
 * @returns {string}
 */
function formatLog(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const redactedMessage = redact(message);

  if (useJson) {
    return JSON.stringify({
      timestamp,
      level,
      message: redactedMessage,
      ...meta
    });
  }

  // Human-readable format
  const levelPad = level.padStart(5, ' ');
  let output = `[${timestamp}] ${levelPad}: ${redactedMessage}`;

  if (Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${k}=${redact(String(v))}`)
      .join(' ');
    output += ` | ${metaStr}`;
  }

  return output;
}

/**
 * Write log to appropriate stream
 * @param {string} level
 * @param {string} output
 */
function writeLog(level, output) {
  const isError = level === 'ERROR' || level === 'FATAL' || level === 'WARN';
  const stream = isError ? process.stderr : process.stdout;
  stream.write(output + '\n');
}

/**
 * Log at specified level
 * @param {string} level
 * @param {string} message
 * @param {object} [meta]
 */
function log(level, message, meta) {
  const levelValue = LEVELS[level];
  if (levelValue < currentLevel) {
    return;
  }

  const output = formatLog(level, message, meta);
  writeLog(level, output);
}

// Export logger interface
export const logger = {
  debug: (message, meta) => log('DEBUG', message, meta),
  info: (message, meta) => log('INFO', message, meta),
  warn: (message, meta) => log('WARN', message, meta),
  error: (message, meta) => log('ERROR', message, meta),
  fatal: (message, meta) => {
    log('FATAL', message, meta);
    process.exit(1);
  },
  success: (message, meta) => log('INFO', `✓ ${message}`, meta),
  section: (title) => {
    if (currentLevel <= LEVELS.INFO) {
      const output = useJson
        ? JSON.stringify({ timestamp: new Date().toISOString(), type: 'section', title })
        : `\n=== ${title} ===`;
      process.stdout.write(output + '\n');
    }
  }
};

export default logger;
