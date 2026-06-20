import { ApiError } from "@/lib/api";
import { getErrorMessage } from "@/lib/error-messages";
import { cn } from "@/lib/utils";

export type AdminFieldErrors = Record<string, string>;

export interface AdminValidationField {
  field: string;
  message: string;
  rule?: string;
}

/** `!` so later utility classes (e.g. `border-border/50`) cannot override error state. */
const FIELD_ERROR_RING =
  "!border-destructive ring-2 ring-destructive/25 focus:!border-destructive focus:ring-destructive/25";

export const ADMIN_FIELD_LABELS: Record<string, string> = {
  name: "Product name",
  slug: "URL slug",
  description: "Description",
  categoryId: "Category",
  sku: "SKU",
  price: "Price",
  variantName: "Variant name",
  variants: "Variants",
  code: "Code",
  type: "Type",
  value: "Value",
  validFrom: "Valid from",
  validUntil: "Valid until",
  parentId: "Parent category",
  imageUrl: "Image URL",
};

/** Normalize JSON-schema instance paths (`/name`, `variants/0/sku`) to form field keys. */
export function normalizeAdminValidationFieldKey(rawField: string): string {
  const normalized = rawField.replace(/^\//, "").trim();
  if (!normalized) return "unknown";

  const variantSku = normalized.match(/^variants\/\d+\/sku$/);
  if (variantSku) return "sku";

  const variantName = normalized.match(/^variants\/\d+\/name$/);
  if (variantName) return "variantName";

  const variantPrice = normalized.match(/^variants\/\d+\/price$/);
  if (variantPrice) return "price";

  if (normalized === "variants") return "variants";

  return normalized;
}

export function extractAdminValidationFields(error: unknown): AdminValidationField[] {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") {
    return [];
  }

  const fields = error.details?.fields;
  if (!Array.isArray(fields)) {
    return [];
  }

  const parsed: AdminValidationField[] = [];
  for (const entry of fields) {
    if (!entry || typeof entry !== "object") continue;
    const field = typeof entry.field === "string" ? entry.field : "";
    const message =
      typeof entry.message === "string" && entry.message.trim().length > 0
        ? entry.message.trim()
        : "Invalid value";
    if (!field) continue;
    parsed.push({
      field: normalizeAdminValidationFieldKey(field),
      message,
      rule: typeof entry.rule === "string" ? entry.rule : undefined,
    });
  }
  return parsed;
}

export function adminValidationFieldsToMap(
  fields: AdminValidationField[],
): AdminFieldErrors {
  const map: AdminFieldErrors = {};
  for (const entry of fields) {
    if (!map[entry.field]) {
      map[entry.field] = entry.message;
    }
  }
  return map;
}

export function adminInputClassName(
  baseClass: string,
  hasError: boolean,
): string {
  return cn(baseClass, hasError && FIELD_ERROR_RING);
}

export function scrollToFirstAdminFieldError(fieldKeys: string[]): void {
  if (typeof document === "undefined" || fieldKeys.length === 0) {
    return;
  }

  for (const key of fieldKeys) {
    const escaped = CSS.escape(key);
    const element = document.querySelector<HTMLElement>(
      `[data-admin-field="${escaped}"], [data-admin-field-label="${escaped}"]`,
    );
    if (!element) continue;
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusTarget =
      element.matches("input,select,textarea,button")
        ? element
        : element.querySelector<HTMLElement>("input,select,textarea,button");
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus({ preventScroll: true });
    }
    break;
  }
}

export function formatAdminValidationSummary(
  fieldErrors: AdminFieldErrors,
): string {
  const entries = Object.entries(fieldErrors);
  if (entries.length === 0) {
    return getErrorMessage("VALIDATION_ERROR");
  }

  const details = entries
    .map(([field, message]) => {
      const label = ADMIN_FIELD_LABELS[field] ?? field;
      return message.toLowerCase().includes(label.toLowerCase())
        ? message
        : `${label}: ${message}`;
    })
    .join(" · ");

  return `${getErrorMessage("VALIDATION_ERROR")} ${details}`;
}

export interface AdminRequiredFieldCheck {
  field: string;
  label: string;
  isEmpty: () => boolean;
}

export function collectRequiredFieldErrors(
  checks: AdminRequiredFieldCheck[],
): AdminFieldErrors {
  const errors: AdminFieldErrors = {};
  for (const check of checks) {
    if (check.isEmpty()) {
      errors[check.field] = `${check.label} is required.`;
    }
  }
  return errors;
}

export function processAdminFormSubmitError(error: unknown): {
  message: string;
  fieldErrors: AdminFieldErrors;
} {
  const apiFields = extractAdminValidationFields(error);
  if (apiFields.length > 0) {
    const fieldErrors = adminValidationFieldsToMap(apiFields);
    return {
      message: formatAdminValidationSummary(fieldErrors),
      fieldErrors,
    };
  }

  if (error instanceof ApiError && error.code === "VALIDATION_ERROR") {
    const serverMessage = (error.message ?? "").trim();
    if (
      serverMessage &&
      serverMessage !== "Request validation failed" &&
      serverMessage !== "Internal server error"
    ) {
      return { message: serverMessage, fieldErrors: {} };
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return { message: error.message.trim(), fieldErrors: {} };
  }

  if (error instanceof ApiError) {
    return { message: getErrorMessage(error.code), fieldErrors: {} };
  }

  return { message: getErrorMessage("UNKNOWN_ERROR"), fieldErrors: {} };
}
