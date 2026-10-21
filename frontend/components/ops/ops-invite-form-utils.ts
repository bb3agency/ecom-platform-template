import { z } from "zod";
import { emailSchema } from "@/lib/validators";

/** Site origin only (no path/query) — the backend rejects anything else for setup links. */
export const originSchema = z
  .string()
  .trim()
  .url("Enter the site address, e.g. https://shop.example.com")
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.pathname === "/" && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, "Use the site address only — no path after the domain.");

export const baseSchema = z.object({
  name: z.string().trim().min(2, "Enter their name."),
  email: emailSchema,
  setupBaseUrl: originSchema,
});

export const operatorSchema = baseSchema.extend({
  ipAllowlist: z.string().trim().optional(),
});

export function defaultOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export interface InviteFormProps {
  onCreated: (message: string) => void;
  onCancel: () => void;
}

export function fieldProps(id: string, error: string | undefined) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  } as const;
}

