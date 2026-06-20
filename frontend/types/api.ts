export interface ApiErrorBody {
  code: string;
  message: string;
  details?: {
    kind?: string;
    hintKey?: string;
    retryable?: boolean;
    remediation?: string;
    attemptsRemaining?: number;
    fields?: Array<{
      field: string;
      rule?: string;
      message?: string;
    }>;
  };
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta?: Record<string, unknown>;
  error?: ApiErrorBody;
}

export interface HealthStatus {
  status: string;
  db?: string;
  database?: string;
  redis: string;
}

export interface ReadinessStatus {
  status: "ready" | "not_ready";
  database: "connected" | "disconnected";
  redis: "connected" | "disconnected";
  degradationMode:
    | "none"
    | "database_down"
    | "redis_down"
    | "queue_stale"
    | "runtime_config_missing";
  queues: {
    waiting: number;
    active: number;
    oldestWaitingAgeSeconds: number;
    workerFreshness: "fresh" | "stale" | "unknown";
  };
  runtimeConfigMissingKeys: string[];
  timestamp: string;
  version: string;
}
