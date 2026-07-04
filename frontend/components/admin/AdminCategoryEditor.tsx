"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
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
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { AdminFormField } from "@/components/admin/AdminFormField";
import { useAdminFormValidation } from "@/hooks/use-admin-form-validation";
import { resolveProductImageUrl } from "@/lib/media-url";
import { uploadAdminCategoryImage } from "@/lib/admin-product-media";
import { useAuthStore } from "@/stores/auth";

const inputClass =
  "h-10 w-full rounded-md border border-border bg-background px-3 text-sm focus:border-zinc-900 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

interface AdminCategoryEditorProps {
  categoryId?: string;
}

export function AdminCategoryEditor({ categoryId }: AdminCategoryEditorProps) {
  const isCreate = !categoryId;
  const router = useRouter();
  const api = useAuthenticatedApi();
  const { adminUser } = useAdminAuth();
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.categoriesWrite);

  const [categories, setCategories] = useState<AdminCategoryListItem[]>([]);
  const [category, setCategory] = useState<AdminCategoryListItem | null>(null);
  const [loading, setLoading] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Surface transient error/success as global toast popups instead of large in-panel banners.
  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);
  useEffect(() => {
    if (success) toast.success(success);
  }, [success]);
  const {
    clearFieldErrors,
    clearFieldError,
    fieldClassName,
    getFieldError,
    validateRequired,
    handleSubmitError
  } = useAdminFormValidation();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [parentId, setParentId] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [isActive, setIsActive] = useState(true);
  // Direct file upload (single optional image, stored via the same provider as
  // product images — local disk or Cloudflare R2). In edit mode the file
  // uploads immediately; in create mode it is held and uploaded right after
  // the category is created (no id exists before that).
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);

  async function handleImageFileSelected(file: File | null) {
    if (!file) return;
    if (isCreate || !categoryId) {
      setPendingImageFile(file);
      setPendingPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(file);
      });
      return;
    }
    if (!accessToken) {
      setError("Session expired — sign in again to upload images.");
      return;
    }
    setUploadingImage(true);
    setError(null);
    try {
      const uploadedUrl = await uploadAdminCategoryImage(accessToken, categoryId, file);
      setImageUrl(uploadedUrl);
      setSuccess("Category image uploaded.");
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  }

  const loadCategories = useCallback(async () => {
    try {
      const all = await fetchAllPaginatedItems<AdminCategoryListItem>(
        async (page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(
            `/admin/categories${buildAdminQuery({ page, limit, isActive: true })}`,
          ),
      );
      setCategories(all);
    } catch {
      // non-fatal
    }
  }, [api]);

  const loadCategory = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    setError(null);
    try {
      const [found, all] = await Promise.all([
        api<AdminCategoryListItem>(`/admin/categories/${categoryId}`),
        fetchAllPaginatedItems<AdminCategoryListItem>(async (page, limit) =>
          api<PaginatedResponse<AdminCategoryListItem>>(
            `/admin/categories${buildAdminQuery({ page, limit })}`,
          ),
        ),
      ]);
      setCategories(all);
      setCategory(found);
      setName(found.name);
      setSlug(found.slug);
      setSlugTouched(true);
      setParentId(found.parentId ?? "");
      setImageUrl(found.imageUrl ?? "");
      setIsActive(found.isActive);
    } catch (err) {
      setError(getApiErrorMessage(err));
      setCategory(null);
    } finally {
      setLoading(false);
    }
  }, [api, categoryId]);

  useEffect(() => {
    if (isCreate) {
      void loadCategories();
    } else {
      void loadCategory();
    }
  }, [isCreate, loadCategories, loadCategory]);

  useAdminDataRefreshEffect(() => {
    if (isCreate) {
      void loadCategories();
    } else {
      void loadCategory();
    }
  }, "categories");

  useEffect(() => {
    if (isCreate && !canWrite && adminUser) {
      router.replace("/admin/categories");
    }
  }, [isCreate, canWrite, adminUser, router]);

  useEffect(() => {
    if (isCreate && !slugTouched && name) {
      setSlug(slugify(name));
    }
  }, [isCreate, name, slugTouched]);

  async function handleSave() {
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    clearFieldErrors();

    const requiredResult = validateRequired([
        { field: "name", label: "Name", isEmpty: () => !name.trim() },
        { field: "slug", label: "Slug", isEmpty: () => !slug.trim() },
      ]);
    if (!requiredResult.valid) {
      setError(requiredResult.message);
      setSaving(false);
      return;
    }

    try {
      if (isCreate) {
        const payload: AdminCreateCategoryInput = {
          name: name.trim(),
          slug: slug.trim(),
          isActive,
          ...(parentId.trim() ? { parentId: parentId.trim() } : {}),
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        };
        const created = await api<AdminCategoryListItem>("/admin/categories", {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });
        // Upload the held image file now that the category has an id. A failed
        // upload must not roll back the created category — surface it instead.
        if (pendingImageFile && created?.id && accessToken) {
          try {
            await uploadAdminCategoryImage(accessToken, created.id, pendingImageFile);
          } catch (uploadErr) {
            toast.error(
              uploadErr instanceof Error
                ? `Category created, but the image upload failed: ${uploadErr.message}`
                : "Category created, but the image upload failed.",
            );
          }
        }
        notifyAdminDataChanged(["categories", "products", "dashboard"]);
        router.push("/admin/categories");
      } else if (categoryId) {
        const payload: AdminUpdateCategoryInput = {
          name: name.trim(),
          slug: slug.trim(),
          isActive,
          parentId: parentId.trim() ? parentId.trim() : null,
          imageUrl: imageUrl.trim() ? imageUrl.trim() : null,
        };
        const updated = await api<AdminCategoryListItem>(
          `/admin/categories/${categoryId}`,
          {
            method: "PATCH",
            idempotencyKey: createIdempotencyKey(),
            body: JSON.stringify(payload),
          },
        );
        setCategory(updated);
        setSuccess("Category saved.");
        notifyAdminDataChanged(["categories", "products", "dashboard"]);
      }
    } catch (err) {
      setError(handleSubmitError(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!canWrite || !categoryId) return;
    if (
      !window.confirm(
        "Deactivate this category? It will be hidden from the storefront. You can restore it later.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/categories/${categoryId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
      router.push("/admin/categories");
    } catch (err) {
      setError(getApiErrorMessage(err));
      setSaving(false);
    }
  }

  async function handleRestore() {
    if (!canWrite || !categoryId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/categories/${categoryId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ isActive: true }),
      });
      setIsActive(true);
      setCategory((prev) => (prev ? { ...prev, isActive: true } : prev));
      setSuccess("Category restored.");
      notifyAdminDataChanged(["categories", "products", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!isCreate && !category && error) {
    return (
      <div className="rounded-md bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  const inputsDisabled = !canWrite;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/admin" className="hover:text-foreground transition-colors">
          Dashboard
        </Link>
        <span className="text-muted-foreground/60">&gt;</span>
        <Link href="/admin/categories" className="hover:text-foreground transition-colors">
          Categories
        </Link>
        <span className="text-muted-foreground/60">&gt;</span>
        <span className="font-medium text-foreground">
          {isCreate ? "New Category" : (category?.name ?? categoryId)}
        </span>
      </div>

      <div className="rounded-xl border border-border/40 bg-card shadow-sm">
        <div className="border-b border-border/40 px-5 py-4">
          <h2 className="text-base font-semibold">
            {isCreate ? "New Category" : "Edit Category"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {inputsDisabled
              ? "View-only — you do not have permission to edit categories."
              : "Manage product taxonomy."}
          </p>
        </div>

        <div className="p-5 grid gap-5 sm:grid-cols-2">
          <AdminFormField
            label="Name"
            field="name"
            required
            error={getFieldError("name")}
          >
            <input
              id="category-name"
              data-admin-field="name"
              aria-invalid={Boolean(getFieldError("name"))}
              className={fieldClassName("name", inputClass)}
              value={name}
              disabled={inputsDisabled}
              placeholder="e.g. Fresh Vegetables"
              onChange={(e) => {
                clearFieldError("name");
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </AdminFormField>

          <AdminFormField
            label="Slug"
            field="slug"
            required
            error={getFieldError("slug")}
          >
            <input
              id="category-slug"
              data-admin-field="slug"
              aria-invalid={Boolean(getFieldError("slug"))}
              className={fieldClassName("slug", inputClass)}
              value={slug}
              disabled={inputsDisabled}
              placeholder="e.g. fresh-vegetables"
              onChange={(e) => {
                clearFieldError("slug");
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
            />
          </AdminFormField>

          <AdminFormField label="Parent Category" field="parentId">
            <select
              data-admin-field="parentId"
              className={fieldClassName("parentId", inputClass)}
              value={parentId}
              disabled={inputsDisabled}
              onChange={(e) => setParentId(e.target.value)}
            >
              <option value="">None (top-level)</option>
              {categories
                .filter((c) => c.id !== categoryId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </AdminFormField>

          {/* Category image — direct file upload only (same pipeline as product
              images: validated, stored on local disk or Cloudflare R2). */}
          <div className="sm:col-span-2 grid min-w-0 grid-cols-1 gap-2">
            <span className="text-sm font-medium">Category image</span>

            {pendingPreviewUrl || imageUrl.trim() ? (
              <div className="flex flex-wrap items-start gap-3">
                <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border/50">
                  <Image
                    src={pendingPreviewUrl ?? resolveProductImageUrl(imageUrl.trim())}
                    alt={name || "Category image preview"}
                    fill
                    className="object-cover"
                    unoptimized={Boolean(pendingPreviewUrl)}
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    {pendingPreviewUrl
                      ? "Uploads when the category is created."
                      : "Stored on the CDN. Uploading a new file replaces it."}
                  </span>
                  <button
                    type="button"
                    disabled={inputsDisabled || uploadingImage || saving}
                    className="w-fit rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-destructive hover:text-destructive disabled:opacity-60"
                    onClick={() => {
                      // Clearing removes the pending file, or marks the saved image
                      // for removal (PATCH sends imageUrl: null on Save).
                      setPendingImageFile(null);
                      setPendingPreviewUrl((prev) => {
                        if (prev) URL.revokeObjectURL(prev);
                        return null;
                      });
                      setImageUrl("");
                    }}
                  >
                    Remove image
                  </button>
                </div>
              </div>
            ) : null}

            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              disabled={inputsDisabled || uploadingImage}
              className="block w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70 disabled:opacity-60"
              aria-label="Upload category image"
              onChange={(e) => {
                void handleImageFileSelected(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            <span className="text-xs text-muted-foreground">
              Optional — JPEG/PNG/WebP/AVIF, one image per category.
              {isCreate ? " Uploads after the category is created." : uploadingImage ? " Uploading…" : " Uploads immediately."}
            </span>
          </div>

          <div className="sm:col-span-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-zinc-900 focus:ring-zinc-900 disabled:opacity-60"
                checked={isActive}
                disabled={inputsDisabled}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span className="text-sm font-medium">Active (visible on storefront)</span>
            </label>
          </div>
        </div>

        <div className="border-t border-border/40 px-5 py-4 flex flex-wrap gap-2 justify-between">
          <div className="flex flex-wrap gap-2">
            {canWrite && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="h-9 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {saving ? "Saving…" : isCreate ? "Create Category" : "Save Changes"}
              </button>
            )}
            <Link href="/admin/categories">
              <button
                type="button"
                className="h-9 rounded-md border border-border/50 bg-card px-4 text-sm font-medium text-foreground hover:bg-muted/50"
              >
                Back to Categories
              </button>
            </Link>
          </div>

          {canWrite && !isCreate && category && (
            category.isActive ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleDelete()}
                className="h-9 rounded-md border border-rose-300 bg-rose-50 px-4 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-60"
              >
                Deactivate
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleRestore()}
                className="h-9 rounded-md border border-emerald-300 bg-emerald-50 px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              >
                Restore
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
