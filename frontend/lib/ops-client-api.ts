"use client";

import { getBrowserApiBaseUrl, getInternalApiBaseUrl } from "@/lib/api-base";
import { apiClient, ApiError } from "@/lib/api";
import { isOpsSessionAuthFailure } from "@/lib/error-messages";
import { normalizeOtpCodeInput } from "@/lib/otp-code";
import type { ReadinessStatus } from "@/types/api";

export type OpsPermission = "ops:read" | "ops:write";

export type OpsOtpActionType =
  | "config-save"
  | "load-shed-change"
  | "user-deactivate"
  | "admin-user-deactivate"
  | "system-restart"
  | "invite-revoke";

export interface OpsSession {
  id: string;
  email: string;
  name: string;
  permissions: OpsPermission[];
  mfaEnabled: boolean;
  ipAllowlist: string[];
  lastLoginAt: string | null;
}

export type OpsLoadShedMode = "normal" | "reduced" | "emergency" | "maintenance";

/**
 * Snapshot of the durable load-shed/maintenance state.
 *
 * `phase` is only populated when `mode === 'maintenance'`:
 *   - `pending` — 2-minute warning window with emergency-style gating; the
 *                 storefront still serves but blocks new checkout
 *                 mutations. The frontend banner shows a countdown to
 *                 `pendingUntil`.
 *   - `active`  — Full maintenance. Nginx serves the static maintenance
 *                 page for every non-ops, non-health, non-webhook route.
 *                 The banner will normally not render in this phase
 *                 (because the storefront SSR isn't reachable) but the
 *                 ops console still shows it for clarity.
 */
export interface OpsLoadShedStatus {
  mode: OpsLoadShedMode;
  phase: "pending" | "active" | null;
  pendingUntil: string | null;
  activatedAt: string | null;
  reason: string | null;
}

export interface OpsAuditRecord {
  id: string;
  requestId: string;
  actionType?: string;
  actionStatus: "EXECUTED" | "FAILED";
  requestPath: string;
  method: string;
  summary: Record<string, unknown> | null;
  createdAt: string;
}

export interface OpsAuditList {
  items: OpsAuditRecord[];
  page: number;
  limit: number;
  total: number;
}

export interface OpsConfigOverview {
  generatedAt: string;
  runtimeProfile: "development-like" | "production-like";
  domains: Array<{
    domain: "core" | "media" | "payments" | "shipping" | "notifications" | "opsSecurity";
    label: string;
    items: Array<{
      key: string;
      present: boolean;
      placeholder: boolean;
      mutableViaOps: boolean;
      requiresRestart: boolean;
      runtimeSource?: "env-bootstrap" | "db-overlay";
      note?: string;
    }>;
  }>;
  strictProfileHealth: {
    noPlaceholdersInStrict: boolean;
    missingRequiredKeysInStrict: string[];
  };
}

export interface OpsStoredConfig {
  items: Array<{
    domain: "core" | "media" | "payments" | "shipping" | "notifications" | "opsSecurity";
    key: string;
    maskedValue: string;
    /**
     * Plaintext stored value — returned for **every** active DB-overlay row,
     * INCLUDING real cryptographic secrets (`_SECRET`, `_TOKEN`, `_PASSWORD`,
     * `_API_KEY`, `_AUTH_KEY`, `_APP_SECRET`, signed approval tokens, ops
     * cookie secret). This is a deliberate operator-UX choice for the Ops
     * console (see `backend/src/modules/ops/ops.service.ts → getStoredConfigSecrets`
     * JSDoc): the Ops console is platform-operator-only behind ops login +
     * email OTP (for writes) + fail-closed `ops:read`/`ops:write` +
     * tamper-evident audit chain logging. Returning every saved value in
     * plaintext lets the operator see and edit what is actually stored
     * instead of needing an external vault to know what was last persisted.
     *
     * The field is typed required (not optional) because the backend always
     * returns it for active rows.
     */
    plaintextValue: string;
    keyVersion: number;
    requiresRestart: boolean;
    updatedAt: string;
  }>;
}

export interface OpsConfigValidationResponse {
  valid: boolean;
  domain: "core" | "payments" | "shipping" | "notifications" | "opsSecurity" | null;
  checkedKeys: string[];
  errors: Array<{ key: string; code: string; message: string }>;
  warnings: Array<{ key: string; code: string; message: string }>;
  requiresRestart: boolean;
}

export interface OpsOtpChallengeResponse {
  challengeId: string;
  expiresAt: string;
}

export interface OpsConfigSaveResponse {
  valid: boolean;
  savedKeys: string[];
  domain: "core" | "payments" | "shipping" | "notifications" | "opsSecurity";
  requiresRestart: boolean;
  masked: Array<{ key: string; maskedValue: string }>;
}

export interface OpsInviteListItem {
  id: string;
  inviteEmail: string;
  inviteName: string;
  status: "CREATED" | "EMAIL_SENT" | "CONSUMED" | "CANCELLED" | "EXPIRED_CLEANED";
  expiresAt: string;
  createdAt: string;
}

export type AdminInviteStatus =
  | "CREATED"
  | "EMAIL_SENT"
  | "CONSUMED"
  | "CANCELLED"
  | "EXPIRED_CLEANED";

export interface AdminInviteListItem {
  id: string;
  inviteEmail: string;
  inviteName: string;
  status: AdminInviteStatus;
  permissions: string[];
  expiresAt: string;
  createdAt: string;
  createdByOpsUserId: string | null;
  consumedAt: string | null;
}

export interface AdminInviteList {
  items: AdminInviteListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface OpsInviteList {
  items: OpsInviteListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface OpsUserListItem {
  id: string;
  email: string;
  name: string;
  permissions: OpsPermission[];
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface OpsUserList {
  items: OpsUserListItem[];
  page: number;
  limit: number;
  total: number;
}

export interface OpsPendingOtpItem {
  id: string;
  action: string;
  expiresAt: string;
}

export interface OpsDlqSummary {
  total: number;
  bySourceQueue: Record<string, number>;
}

function buildPath(
  endpoint: string,
  query?: Record<string, string | number | undefined>,
): string {
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  if (!query) {
    return path;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function opsFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  return apiClient<T>(endpoint, {
    ...options,
    credentials: "include",
  });
}

function normalizeOpsPermission(value: string): OpsPermission | null {
  const normalized = value.trim().toLowerCase().replace("_", ":");
  if (normalized === "ops:read") {
    return "ops:read";
  }
  if (normalized === "ops:write") {
    return "ops:write";
  }
  return null;
}

function normalizeOpsPermissions(values: string[] | undefined): OpsPermission[] {
  const resolved = new Set<OpsPermission>();
  for (const value of values ?? []) {
    const permission = normalizeOpsPermission(value);
    if (permission) {
      resolved.add(permission);
    }
  }
  return [...resolved];
}

export async function requestOpsLoginOtp(input: {
  email: string;
  turnstileToken?: string;
}): Promise<{ expiresAt: string; message?: string; devOtp?: string }> {
  return opsFetch("/ops/auth/login/request-otp", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

function normalizedOtpCode(value: string): string {
  return normalizeOtpCodeInput(value);
}

export async function verifyOpsLoginOtp(input: {
  email: string;
  otp: string;
}): Promise<{
  opsUserId: string;
  name: string;
  email: string;
  permissions: OpsPermission[];
  expiresAt: string;
}> {
  const result = await opsFetch<{
    opsUserId: string;
    name: string;
    email: string;
    permissions: string[];
    expiresAt: string;
  }>("/ops/auth/login/verify-otp", {
    method: "POST",
    body: JSON.stringify({ ...input, otp: normalizeOtpCodeInput(input.otp) }),
  });
  return {
    ...result,
    permissions: normalizeOpsPermissions(result.permissions),
  };
}

export async function logoutOpsSession(): Promise<{ message: string }> {
  return opsFetch("/ops/auth/logout", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function getOpsSessionClient(): Promise<OpsSession> {
  const result = await opsFetch<{
    id: string;
    email: string;
    name: string;
    permissions: string[];
    mfaEnabled: boolean;
    ipAllowlist: string[];
    lastLoginAt: string | null;
  }>("/ops/session");
  return {
    ...result,
    permissions: normalizeOpsPermissions(result.permissions),
  };
}

export async function getOpsLoadShedStatusClient(): Promise<OpsLoadShedStatus> {
  return opsFetch<OpsLoadShedStatus>("/ops/load-shed");
}

export async function setOpsLoadShedMode(input: {
  mode: OpsLoadShedStatus["mode"];
  reason: string;
  challengeId: string;
  otpCode: string;
}): Promise<{
  mode: OpsLoadShedStatus["mode"];
  updated: boolean;
  phase: "pending" | "active" | null;
  pendingUntil: string | null;
}> {
  return opsFetch("/ops/load-shed", {
    method: "POST",
    body: JSON.stringify({ ...input, otpCode: normalizedOtpCode(input.otpCode) }),
  });
}

export async function requestOpsOtpChallenge(
  action: OpsOtpActionType,
): Promise<OpsOtpChallengeResponse> {
  return opsFetch("/ops/otp/request", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
}

export async function verifyOpsOtpChallenge(input: {
  challengeId: string;
  code: string;
}): Promise<{ verified: boolean }> {
  return opsFetch("/ops/otp/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeId: input.challengeId,
      code: normalizeOtpCodeInput(input.code),
    }),
  });
}

export async function getOpsPendingOtps(): Promise<{ items: OpsPendingOtpItem[] }> {
  return opsFetch("/ops/otp/pending");
}

export async function getOpsConfigOverviewClient(): Promise<OpsConfigOverview> {
  return opsFetch<OpsConfigOverview>("/ops/config/overview");
}

export async function getOpsStoredConfigClient(query?: {
  domain?: OpsStoredConfig["items"][number]["domain"];
}): Promise<OpsStoredConfig> {
  return opsFetch<OpsStoredConfig>(buildPath("/ops/config/stored", query));
}

export async function validateOpsConfigClient(input: {
  domain?: OpsStoredConfig["items"][number]["domain"];
  values: Record<string, string | number | boolean | null>;
}): Promise<OpsConfigValidationResponse> {
  return opsFetch("/ops/config/validate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function saveOpsConfigClient(input: {
  domain?: OpsStoredConfig["items"][number]["domain"];
  values: Record<string, string | number | boolean | null>;
  challengeId: string;
  otpCode: string;
}): Promise<OpsConfigSaveResponse> {
  return opsFetch("/ops/config/save", {
    method: "POST",
    body: JSON.stringify({ ...input, otpCode: normalizedOtpCode(input.otpCode) }),
  });
}

function getOpsApiBase(): string {
  return getBrowserApiBaseUrl();
}

/** Readiness may return HTTP 503 with payload in envelope `data` when not ready. */
export async function fetchOpsReadinessStatus(): Promise<ReadinessStatus> {
  const url = `${getOpsApiBase()}/health/ready`;
  const response = await fetch(url, { cache: "no-store", credentials: "include" });
  const rawBody = await response.text();
  let body: unknown = {};
  if (rawBody) {
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = {};
    }
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    typeof (body as { data: unknown }).data === "object" &&
    (body as { data: { status?: string; runtimeConfigMissingKeys?: unknown } }).data
  ) {
    const envelopeData = (body as { data: ReadinessStatus }).data;
    if (typeof envelopeData.status === "string") {
      return envelopeData;
    }
    if (Array.isArray((envelopeData as { runtimeConfigMissingKeys?: unknown }).runtimeConfigMissingKeys)) {
      return {
        status: "not_ready",
        database: "disconnected",
        redis: "disconnected",
        degradationMode: "runtime_config_missing",
        runtimeConfigMissingKeys: (envelopeData as { runtimeConfigMissingKeys: string[] })
          .runtimeConfigMissingKeys,
        queues: {
          waiting: 0,
          active: 0,
          oldestWaitingAgeSeconds: 0,
          workerFreshness: "unknown",
        },
        timestamp: new Date().toISOString(),
        version: "unknown",
      };
    }
  }

  if (
    typeof body === "object" &&
    body !== null &&
    "status" in body &&
    !("success" in body)
  ) {
    return body as ReadinessStatus;
  }

  if (typeof body === "object" && body !== null && "error" in body) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? "Readiness check failed",
      response.status,
    );
  }

  throw new ApiError("UNKNOWN_ERROR", "Readiness check failed", response.status);
}

export async function listOpsInvitesClient(query?: {
  status?: OpsInviteListItem["status"];
  page?: number;
  limit?: number;
}): Promise<OpsInviteList> {
  return opsFetch<OpsInviteList>(buildPath("/ops/invites", query));
}

export async function createOpsInviteClient(input: {
  email: string;
  name: string;
  setupBaseUrl: string;
  ipAllowlist?: string[];
}): Promise<{ inviteId: string; expiresAt: string; setupUrl: string }> {
  return opsFetch("/ops/invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeOpsInviteClient(input: {
  inviteId: string;
  challengeId: string;
  otpCode: string;
}): Promise<{ inviteId: string; revoked: boolean }> {
  return opsFetch(`/ops/invites/${input.inviteId}/revoke`, {
    method: "POST",
    body: JSON.stringify({
      challengeId: input.challengeId,
      otpCode: normalizedOtpCode(input.otpCode),
    }),
  });
}

export async function cleanupExpiredOpsInvitesClient(): Promise<{ cleaned: number }> {
  return opsFetch("/ops/invites/cleanup-expired", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listAdminInvitesClient(query?: {
  status?: AdminInviteStatus;
  page?: number;
  limit?: number;
}): Promise<AdminInviteList> {
  return opsFetch<AdminInviteList>(buildPath("/ops/admin-invites", query));
}

/**
 * Create merchant admin invite (`POST /ops/admin-invites`).
 * Deactivated merchant admin emails are allowed; setup consume reactivates the same user id.
 */
export async function createAdminInviteClient(input: {
  email: string;
  name: string;
  setupBaseUrl: string;
  permissions: string[];
}): Promise<{ inviteId: string; expiresAt: string; setupUrl: string; permissions: string[] }> {
  return opsFetch("/ops/admin-invites", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function revokeAdminInviteClient(input: {
  inviteId: string;
  challengeId: string;
  otpCode: string;
}): Promise<{ inviteId: string; revoked: boolean }> {
  return opsFetch(`/ops/admin-invites/${input.inviteId}/revoke`, {
    method: "POST",
    body: JSON.stringify({
      challengeId: input.challengeId,
      otpCode: normalizedOtpCode(input.otpCode),
    }),
  });
}

export async function cleanupExpiredAdminInvitesClient(): Promise<{ cleaned: number }> {
  return opsFetch("/ops/admin-invites/cleanup-expired", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function listOpsUsersClient(query?: {
  page?: number;
  limit?: number;
}): Promise<OpsUserList> {
  const result = await opsFetch<{
    items: Array<{
      id: string;
      email: string;
      name: string;
      permissions: string[];
      isActive: boolean;
      lastLoginAt: string | null;
    }>;
    page: number;
    limit: number;
    total: number;
  }>(buildPath("/ops/users", query));
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      permissions: normalizeOpsPermissions(item.permissions),
    })),
  };
}

export async function deactivateOpsUserClient(input: {
  opsUserId: string;
  reason: string;
  challengeId: string;
  otpCode: string;
}): Promise<{ opsUserId: string; deactivated: boolean }> {
  return opsFetch(`/ops/users/${input.opsUserId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      challengeId: input.challengeId,
      otpCode: normalizedOtpCode(input.otpCode),
    }),
  });
}

export interface MerchantAdminUserListItem {
  id: string;
  email: string;
  name: string;
  permissions: string[];
  isActive: boolean;
  isVerified: boolean;
  phone: string | null;
  createdAt: string;
  deactivatedAt: string | null;
  deactivatedReason: string | null;
}

export interface MerchantAdminUserList {
  items: MerchantAdminUserListItem[];
  page: number;
  limit: number;
  total: number;
}

export async function listMerchantAdminUsersClient(query?: {
  page?: number;
  limit?: number;
}): Promise<MerchantAdminUserList> {
  return opsFetch<MerchantAdminUserList>(buildPath("/ops/admin-users", query));
}

export async function deactivateMerchantAdminUserClient(input: {
  adminUserId: string;
  reason: string;
  challengeId: string;
  otpCode: string;
}): Promise<{ adminUserId: string; deactivated: boolean }> {
  return opsFetch(`/ops/admin-users/${input.adminUserId}/deactivate`, {
    method: "POST",
    body: JSON.stringify({
      reason: input.reason,
      challengeId: input.challengeId,
      otpCode: normalizedOtpCode(input.otpCode),
    }),
  });
}

export async function scheduleOpsSystemRestart(input: {
  delayMinutes: number;
  challengeId: string;
  otpCode: string;
}): Promise<{ jobId: string; scheduledFor: string }> {
  return opsFetch("/ops/system/restart", {
    method: "POST",
    body: JSON.stringify({ ...input, otpCode: normalizedOtpCode(input.otpCode) }),
  });
}

export async function getOpsAuditLogsClient(query?: {
  actionStatus?: "EXECUTED" | "FAILED";
  actionType?: string;
  opsUserId?: string;
  page?: number;
  limit?: number;
}): Promise<OpsAuditList> {
  return opsFetch<OpsAuditList>(buildPath("/ops/audit/logs", query));
}

export async function getOpsDlqSummaryClient(): Promise<OpsDlqSummary> {
  return opsFetch<OpsDlqSummary>("/ops/queues/dlq/summary");
}

/** Bull Board runs on the API host and uses the `ops_session` cookie set there. */
export function getOpsQueuesBoardUrl(): string {
  return `${getInternalApiBaseUrl()}/ops/queues`;
}

export function isOpsUnauthorisedError(error: unknown): boolean {
  return isOpsSessionAuthFailure(error);
}
