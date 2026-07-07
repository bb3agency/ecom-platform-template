"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  type AdminBoxPresetsSettings,
  type BoxPreset,
} from "@/lib/admin-api";
import { getApiErrorMessage } from "@/lib/error-messages";
import { toast } from "@/lib/toast";
import { createIdempotencyKey } from "@/lib/idempotency";
import { cn } from "@/lib/utils";

interface BoxPresetsPanelProps {
  canWrite: boolean;
}

const inputClass =
  "h-10 w-full rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900/20";

export function BoxPresetsPanel({ canWrite }: BoxPresetsPanelProps) {
  const api = useAuthenticatedApi();
  const [presets, setPresets] = useState<BoxPreset[]>([]);
  const [loading, setLoading] = useState(true);
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
  const [newPreset, setNewPreset] = useState<Partial<BoxPreset>>({
    name: "",
    lengthCm: undefined,
    widthCm: undefined,
    heightCm: undefined,
    boxWeightGrams: undefined,
  });
  // Store-level flat packaging weight override (grams). Empty = automatic estimate.
  const [packagingWeightInput, setPackagingWeightInput] = useState<string>("");

  const loadPresets = useCallback(async () => {
    try {
      setLoading(true);
      const result = await api<AdminBoxPresetsSettings>(
        "/admin/settings/box-presets"
      );
      setPresets(result.presets || []);
      setPackagingWeightInput(
        result.packagingWeightGrams != null ? String(result.packagingWeightGrams) : "",
      );
      setError(null);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  const savePresets = useCallback(
    async (updatedPresets: BoxPreset[], packagingWeightGrams?: number | null) => {
      try {
        setSaving(true);
        setError(null);
        setSuccess(null);
        const result = await api<AdminBoxPresetsSettings>("/admin/settings/box-presets", {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({
            presets: updatedPresets,
            // Omit the field entirely to leave the override unchanged; null clears it.
            ...(packagingWeightGrams !== undefined ? { packagingWeightGrams } : {}),
          }),
        });
        setPresets(result.presets || updatedPresets);
        setPackagingWeightInput(
          result.packagingWeightGrams != null ? String(result.packagingWeightGrams) : "",
        );
        setSuccess("Packing settings updated successfully.");
      } catch (err) {
        setError(getApiErrorMessage(err));
      } finally {
        setSaving(false);
      }
    },
    [api]
  );

  const addPreset = async () => {
    if (
      !newPreset.name?.trim() ||
      !newPreset.lengthCm ||
      !newPreset.widthCm ||
      !newPreset.heightCm
    ) {
      setError("Name and dimensions are required for a new preset.");
      return;
    }

    const updated = [
      ...presets,
      {
        name: newPreset.name.trim(),
        lengthCm: Math.floor(newPreset.lengthCm),
        widthCm: Math.floor(newPreset.widthCm),
        heightCm: Math.floor(newPreset.heightCm),
        ...(newPreset.boxWeightGrams && newPreset.boxWeightGrams > 0
          ? { boxWeightGrams: Math.floor(newPreset.boxWeightGrams) }
          : {}),
      },
    ];

    await savePresets(updated);
    if (!error) {
      setNewPreset({
        name: "",
        lengthCm: undefined,
        widthCm: undefined,
        heightCm: undefined,
        boxWeightGrams: undefined,
      });
    }
  };

  const savePackagingWeight = async () => {
    const trimmed = packagingWeightInput.trim();
    if (trimmed === "") {
      await savePresets(presets, null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError("Packaging weight must be a positive number of grams (or empty for automatic).");
      return;
    }
    await savePresets(presets, Math.floor(parsed));
  };

  const removePreset = async (index: number) => {
    const updated = presets.filter((_, i) => i !== index);
    await savePresets(updated);
  };

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
        <h3 className="font-heading text-base font-bold text-foreground">
          Packaging Box Presets
        </h3>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        These are the real carton sizes you stock. At shipping, the system 3D-packs each
        order&apos;s items and picks the <strong>smallest preset they physically fit into</strong>,
        then sends that box&apos;s dimensions to the courier (couriers bill on volumetric weight =
        L × W × H ÷ 5000). If no preset fits — or none is configured — it falls back to a
        <strong> computed bounding box</strong> around the items with a small safety padding (+1 cm
        per side). Items marked <strong>&ldquo;Keep upright&rdquo;</strong> in the product editor are
        only rotated about their vertical axis so the packed box reflects how they really ship.
        Accuracy depends on each product variant having correct box dimensions set in the product
        editor.
      </p>

      {/* Existing Presets Table */}
      {presets.length > 0 && (
        <div className="overflow-x-auto border border-border/20 rounded-lg">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/20 bg-muted/30">
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  L × W × H (cm)
                </th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Volume (cm³)
                </th>
                <th className="px-4 py-2 text-left font-semibold text-muted-foreground">
                  Box weight (g)
                </th>
                <th className="px-4 py-2 text-center font-semibold text-muted-foreground">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {presets.map((preset, idx) => {
                const volume = preset.lengthCm * preset.widthCm * preset.heightCm;
                return (
                  <tr
                    key={idx}
                    className="border-b border-border/20 hover:bg-muted/20 transition-colors"
                  >
                    <td className="px-4 py-3 text-foreground font-medium">
                      {preset.name}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {preset.lengthCm} × {preset.widthCm} × {preset.heightCm}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {volume.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">
                      {preset.boxWeightGrams != null ? preset.boxWeightGrams : "auto"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => void removePreset(idx)}
                        disabled={saving || !canWrite}
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded text-sm transition-colors",
                          canWrite && !saving
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-muted-foreground opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add New Preset Form */}
      {canWrite && (
        <div className="pt-4 border-t border-border/20 flex flex-col gap-3">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
            Add New Box Preset
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <input
              className={inputClass}
              type="text"
              placeholder="Name (e.g., Small)"
              value={newPreset.name || ""}
              onChange={(e) =>
                setNewPreset({ ...newPreset, name: e.target.value })
              }
              disabled={saving}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="Length (cm)"
              value={newPreset.lengthCm || ""}
              onChange={(e) =>
                setNewPreset({
                  ...newPreset,
                  lengthCm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              disabled={saving}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="Width (cm)"
              value={newPreset.widthCm || ""}
              onChange={(e) =>
                setNewPreset({
                  ...newPreset,
                  widthCm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              disabled={saving}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="Height (cm)"
              value={newPreset.heightCm || ""}
              onChange={(e) =>
                setNewPreset({
                  ...newPreset,
                  heightCm: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              disabled={saving}
            />
            <input
              className={inputClass}
              type="number"
              min="1"
              placeholder="Box weight (g)"
              aria-label="Empty box weight in grams (optional)"
              value={newPreset.boxWeightGrams || ""}
              onChange={(e) =>
                setNewPreset({
                  ...newPreset,
                  boxWeightGrams: e.target.value ? Number(e.target.value) : undefined,
                })
              }
              disabled={saving}
            />
            <button
              onClick={() => void addPreset()}
              disabled={saving}
              className="h-10 rounded-md bg-zinc-900 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-60 flex items-center justify-center gap-1.5"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <strong>Box weight (g)</strong> is the weight of the empty carton plus tape and
            void fill — weigh a packed-but-empty box once and enter it here. It is optional:
            when blank, the system estimates it from the box&apos;s surface area.
          </p>
        </div>
      )}

      {/* Packaging weight override */}
      <div className="pt-4 border-t border-border/20 flex flex-col gap-3">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Packaging Weight
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Couriers weigh the <strong>sealed parcel</strong> — products plus carton, tape and
          void fill. This packaging weight is included in every rate quote and shipment
          booking. By default it is <strong>estimated automatically</strong> from the shipping
          box&apos;s surface area; set a flat gram value here to override the estimate for all
          boxes without their own box weight. Leave empty for automatic.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            className={cn(inputClass, "sm:max-w-56")}
            type="number"
            min="1"
            placeholder="Automatic (estimated)"
            aria-label="Flat packaging weight override in grams"
            value={packagingWeightInput}
            onChange={(e) => setPackagingWeightInput(e.target.value)}
            disabled={saving || !canWrite}
          />
          {canWrite && (
            <button
              onClick={() => void savePackagingWeight()}
              disabled={saving}
              className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-60"
            >
              Save packaging weight
            </button>
          )}
        </div>
      </div>

      {presets.length === 0 && !canWrite && (
        <p className="text-sm text-muted-foreground">No box presets configured.</p>
      )}
    </div>
  );
}
