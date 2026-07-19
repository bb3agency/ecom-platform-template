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
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
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
            className={`inline-block size-5 transform rounded-full bg-background shadow transition-transform ${
              enabled ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* Hidden file input — shared by both the empty-state CTA and the
          "add more" dropzone so the upload trigger always exists. */}
      {canWrite && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => void handleUpload(e.target.files)}
        />
      )}

      {/* "Add more" dropzone — only when the gallery already has images. When
          empty, the EmptyState below is the single upload affordance (avoids a
          duplicate dropzone + empty-state both prompting to upload). */}
      {canWrite && images.length > 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-8 text-center">
          <Upload className="size-6 text-muted-foreground" aria-hidden />
          <Button
            type="button"
            loading={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Uploading…" : "Upload images"}
          </Button>
          <p className="text-xs text-muted-foreground">
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
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : images.length === 0 ? (
        <EmptyState
          icon={ImageOff}
          headline="No media uploaded"
          description="Upload your first gallery image to show it on the storefront."
          action={
            canWrite ? (
              <Button
                type="button"
                loading={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {!uploading && <Upload aria-hidden />}
                Upload images
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {images.map((img, index) => (
            <li
              key={img.id}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card"
            >
              <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-muted">
                <Image
                  src={img.imageUrl}
                  alt={img.altText || "Gallery image"}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  className="object-cover"
                />
                {!img.isActive && (
                  <span className="absolute left-2 top-2 rounded-full bg-foreground/80 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-background">
                    Hidden
                  </span>
                )}
              </div>

              <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
                <div className="flex shrink-0 items-center gap-1 border-t border-border px-4 py-2">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0 || busyId === img.id}
                    onClick={() => void handleMove(index, -1)}
                  >
                    <ArrowUp aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === images.length - 1 || busyId === img.id}
                    onClick={() => void handleMove(index, 1)}
                  >
                    <ArrowDown aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={img.isActive ? "Hide image" : "Show image"}
                    disabled={busyId === img.id}
                    onClick={() => void patchImage(img.id, { isActive: !img.isActive })}
                  >
                    {img.isActive ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Delete image"
                    disabled={busyId === img.id}
                    className="ml-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void handleDelete(img.id)}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
