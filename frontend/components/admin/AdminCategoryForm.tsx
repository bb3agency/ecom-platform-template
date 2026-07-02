"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Tag,
  FolderTree,
} from "lucide-react";
import {
  buildAdminQuery,
  fetchAllPaginatedItems,
  type AdminCategoryListItem,
  type AdminCreateCategoryInput,
  type AdminUpdateCategoryInput,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import { cn } from "@/lib/utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

// ── Field sub-component ───────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

function Field({ label, required, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
        {required && <span className="text-rose-500">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground/70">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-50 transition-colors";

// ── Toggle switch ─────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900/20",
        checked ? "bg-zinc-900" : "bg-zinc-200",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform",
          checked ? "translate-x-5" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface AdminCategoryFormProps {
  open: boolean;
  category?: AdminCategoryListItem | null;
  onSaved: () => void;
  onClose: () => void;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AdminCategoryForm({ open, category, onSaved, onClose }: AdminCategoryFormProps) {
  const api = useAuthenticatedApi();
  const isEdit = Boolean(category);

  const [categories, setCategories] = useState<AdminCategoryListItem[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [parentId, setParentId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  // Surface transient error/success as global toast popups instead of in-modal banners.
  useEffect(() => {
    if (submitError) toast.error(submitError);
  }, [submitError]);
  useEffect(() => {
    if (success) toast.success(`Category ${isEdit ? "updated" : "created"} successfully!`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success]);

  const nameRef = useRef<HTMLInputElement>(null);

  // Load all categories for parent selector
  const loadCategories = useCallback(async () => {
    try {
      const all = await fetchAllPaginatedItems<AdminCategoryListItem>(
        async (page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(
            `/admin/categories${buildAdminQuery({ page, limit })}`,
          ),
      );
      setCategories(all);
    } catch {
      // non-fatal
    }
  }, [api]);

  // Reset form when opened or category changes
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setSuccess(false);
    setSaving(false);
    void loadCategories();

    if (category) {
      setName(category.name);
      setSlug(category.slug);
      setSlugTouched(true);
      setParentId(category.parentId ?? "");
      setImageUrl(category.imageUrl ?? "");
      setIsActive(category.isActive);
    } else {
      setName("");
      setSlug("");
      setSlugTouched(false);
      setParentId("");
      setImageUrl("");
      setIsActive(true);
    }

    setTimeout(() => nameRef.current?.focus(), 50);
  }, [open, category, loadCategories]);

  // Auto-slug from name
  useEffect(() => {
    if (!slugTouched && name) {
      setSlug(slugify(name));
    }
  }, [name, slugTouched]);

  // Esc key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required.";
    if (!slug.trim()) next.slug = "Slug is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setSubmitError(null);

    try {
      if (isEdit && category) {
        const payload: AdminUpdateCategoryInput = {
          name: name.trim(),
          slug: slug.trim(),
          isActive,
          parentId: parentId.trim() ? parentId.trim() : null,
          imageUrl: imageUrl.trim() ? imageUrl.trim() : null,
        };
        await api(`/admin/categories/${category.id}`, {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });
      } else {
        const payload: AdminCreateCategoryInput = {
          name: name.trim(),
          slug: slug.trim(),
          isActive,
          ...(parentId.trim() ? { parentId: parentId.trim() } : {}),
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        };
        await api("/admin/categories", {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });
      }

      notifyAdminDataChanged(["categories", "products", "dashboard"]);
      setSuccess(true);
      setTimeout(() => {
        onSaved();
        onClose();
      }, 600);
    } catch (err) {
      setSubmitError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  const availableParents = categories.filter((c) => c.id !== category?.id);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? "Edit Category" : "New Category"}
        className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-card shadow-2xl sm:w-[440px] sm:rounded-l-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100">
              <FolderTree className="h-4 w-4 text-zinc-700" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {isEdit ? "Edit Category" : "New Category"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {isEdit ? "Update category details" : "Add a new product category"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="flex flex-col gap-5">
            {/* Name & Slug */}
            <div className="flex flex-col gap-1.5 rounded-xl border border-border/40 bg-muted/20 px-4 py-4">
              <div className="mb-2 flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Identity</span>
              </div>
              <div className="flex flex-col gap-4">
                <Field label="Name" required error={errors.name}>
                  <input
                    ref={nameRef}
                    className={cn(inputClass, errors.name && "border-destructive ring-2 ring-destructive/20")}
                    placeholder="e.g. Fresh Vegetables"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setErrors((prev) => ({ ...prev, name: "" }));
                    }}
                  />
                </Field>

                <Field
                  label="Slug"
                  required
                  hint="Used in URLs. Auto-generated from name."
                  error={errors.slug}
                >
                  <input
                    className={cn(inputClass, "font-mono text-xs", errors.slug && "border-destructive ring-2 ring-destructive/20")}
                    placeholder="e.g. fresh-vegetables"
                    value={slug}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(e.target.value);
                      setErrors((prev) => ({ ...prev, slug: "" }));
                    }}
                  />
                </Field>
              </div>
            </div>

            {/* Parent & Image */}
            <div className="flex flex-col gap-4">
              <Field label="Parent Category" hint="Leave empty to make this a top-level category">
                <select
                  className={inputClass}
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                >
                  <option value="">None (top-level)</option>
                  {availableParents.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Image URL" hint="Optional. Must start with https://">
                <input
                  className={inputClass}
                  placeholder="https://example.com/image.jpg"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </Field>
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/20 px-4 py-3.5">
              <div>
                <p className="text-sm font-semibold text-foreground">Active</p>
                <p className="text-xs text-muted-foreground">
                  {isActive ? "Visible on storefront" : "Hidden from storefront"}
                </p>
              </div>
              <Toggle checked={isActive} onChange={setIsActive} />
            </div>

            {/* Error/success feedback surfaces via global toast popups (mirror effects above). */}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border/40 px-5 py-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 items-center rounded-lg border border-border/50 bg-card px-4 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || success}
            onClick={() => void handleSubmit()}
            className={cn(
              "flex h-10 min-w-32 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition-all",
              saving || success
                ? "bg-zinc-700 text-white opacity-80"
                : "bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm active:scale-[0.98]",
            )}
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : success ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Saved!
              </>
            ) : (
              isEdit ? "Save Changes" : "Create Category"
            )}
          </button>
        </div>
      </div>
    </>
  );
}
