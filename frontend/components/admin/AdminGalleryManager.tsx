"use client";

import Image from "next/image";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImageOff,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthStore } from "@/stores/auth";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { getApiErrorMessage } from "@/lib/error-messages";
import {
  deleteGalleryImage,
  fetchAdminGallery,
  fetchGalleryEnabled,
  reorderGallery,
  setGalleryEnabled,
  updateGalleryImage,
  uploadGalleryImage,
  type GalleryImage,
} from "@/lib/gallery-api";

export function AdminGalleryManager() {
  const { adminUser } = useAdminAuth();
  const accessToken = useAuthStore((st) => st.accessToken);
  const canWrite = hasAdminPermission(adminUser, ADMIN_PERMISSIONS.settingsWrite);

  const [images, setImages] = useState<GalleryImage[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [uploading, setUploading] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const [items, isEnabled] = await Promise.all([
        fetchAdminGallery(accessToken),
        fetchGalleryEnabled(accessToken),
      ]);
      setImages(items);
      setEnabled(isEnabled);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleToggleEnabled = async () => {
    if (!accessToken || savingToggle) return;
    setSavingToggle(true);
    setError(null);
    try {
      const next = await setGalleryEnabled(accessToken, !enabled);
      setEnabled(next);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSavingToggle(false);
    }
  };

  const handleUpload = async (files: FileList | null) => {
    if (!accessToken || !files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const created = await uploadGalleryImage(accessToken, file, { altText: "" });
        setImages((prev) => [...prev, created]);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const patchImage = async (id: string, patch: Parameters<typeof updateGalleryImage>[2]) => {
    if (!accessToken) return;
    setBusyId(id);
    setError(null);
    try {
      const updated = await updateGalleryImage(accessToken, id, patch);
      setImages((prev) => prev.map((img) => (img.id === id ? updated : img)));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!accessToken) return;
    const ok = await confirm({
      title: "Delete Image?",
      description: "The image will be permanently removed from the gallery. This cannot be undone.",
      confirmLabel: "Delete Image",
    });
    if (!ok) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteGalleryImage(accessToken, id);
      setImages((prev) => prev.filter((img) => img.id !== id));
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!accessToken) return;
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const reordered = [...images];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setImages(reordered);
    try {
      const saved = await reorderGallery(
        accessToken,
        reordered.map((img) => img.id),
      );
      setImages(saved);
    } catch (err) {
      setError(getApiErrorMessage(err));
      void load();
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {confirmDialog}
      {/* Enable toggle */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-bold text-foreground">Show gallery on storefront</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            When on, the public <code className="rounded bg-secondary px-1 py-0.5">/gallery</code>{" "}
            page and its navigation link are visible to shoppers.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle storefront gallery"
          disabled={!canWrite || savingToggle}
          onClick={handleToggleEnabled}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            enabled ? "bg-primary" : "bg-muted"
          }`}
        >
          <span
            className={`inline-block size-5 transform rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Upload */}
      {canWrite && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {uploading ? "Uploading…" : "Upload images"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            JPEG, PNG, WebP or GIF, up to 5 MB each. Images are stored on Cloudflare.
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden /> Loading gallery…
        </div>
      ) : images.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-10 text-center">
          <ImageOff className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium text-muted-foreground">
            No images yet. Upload your first gallery image above.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {images.map((img, index) => (
            <li
              key={img.id}
              className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 sm:flex-row sm:items-start"
            >
              <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden rounded-xl bg-muted sm:w-40">
                <Image
                  src={img.imageUrl}
                  alt={img.altText || "Gallery image"}
                  fill
                  sizes="160px"
                  className="object-cover"
                />
                {!img.isActive && (
                  <span className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Hidden
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Caption
                  <input
                    type="text"
                    defaultValue={img.caption ?? ""}
                    disabled={!canWrite || busyId === img.id}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== (img.caption ?? "")) void patchImage(img.id, { caption: value || null });
                    }}
                    placeholder="Optional caption"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                  />
                </label>
                <label className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Alt text (accessibility)
                  <input
                    type="text"
                    defaultValue={img.altText}
                    disabled={!canWrite || busyId === img.id}
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== img.altText) void patchImage(img.id, { altText: value });
                    }}
                    placeholder="Describe the image"
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
                  />
                </label>
              </div>

              {canWrite && (
                <div className="flex shrink-0 items-center gap-1 sm:flex-col">
                  <button
                    type="button"
                    aria-label="Move up"
                    disabled={index === 0 || busyId === img.id}
                    onClick={() => void handleMove(index, -1)}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    <ArrowUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label="Move down"
                    disabled={index === images.length - 1 || busyId === img.id}
                    onClick={() => void handleMove(index, 1)}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    <ArrowDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={img.isActive ? "Hide image" : "Show image"}
                    disabled={busyId === img.id}
                    onClick={() => void patchImage(img.id, { isActive: !img.isActive })}
                    className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                  >
                    {img.isActive ? <Eye className="size-4" aria-hidden /> : <EyeOff className="size-4" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete image"
                    disabled={busyId === img.id}
                    onClick={() => void handleDelete(img.id)}
                    className="flex size-9 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
