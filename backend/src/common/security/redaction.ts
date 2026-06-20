const SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|password|cookie|session|signature|api[_-]?key|bearer|refresh|csrf|credential|private[_-]?key|client[_-]?secret|set-cookie|otp|passcode)/i;

function redactStringValue(value: string, maxLength = 512): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
}

export function redactSensitiveData(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return '[REDACTED_DEPTH_LIMIT]';
  }

  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return redactStringValue(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveData(entry, depth + 1));
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      sanitized[key] = '[REDACTED]';
      continue;
    }
    sanitized[key] = redactSensitiveData(entry, depth + 1);
  }
  return sanitized;
}
