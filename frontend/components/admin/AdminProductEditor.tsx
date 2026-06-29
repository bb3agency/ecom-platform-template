"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Link2,
  AlignLeft,
  List,
  ListOrdered,
  Quote,
  Image as ImageIcon,
  Maximize2,
  X,
  Plus,
  UploadCloud,
  Check,
  HelpCircle,
} from "lucide-react";
import { AdminRowActionsMenu } from "@/components/admin/AdminRowActionsMenu";
import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "@/contexts/admin-auth-context";
import { useAuthenticatedApi } from "@/hooks/use-authenticated-api";
import {
  buildAdminQuery,
  ensureArray,
  fetchAllPaginatedItems,
  type AdminCategoryListItem,
  type AdminCreateProductInput,
  type AdminProductDetail,
  type AdminProductImage,
  type AdminProductVariant,
  buildProductTaxAttributes,
  isValidProductHsnCode,
  resolveAdminProductHsnCode,
  type PaginatedResponse,
} from "@/lib/admin-api";
import { formatPaise } from "@/lib/admin-format";
import { getApiErrorMessage } from "@/lib/error-messages";
import { cn } from "@/lib/utils";
import { createIdempotencyKey } from "@/lib/idempotency";
import { notifyAdminDataChanged } from "@/lib/admin-data-refresh";
import { useAdminDataRefreshEffect } from "@/hooks/use-admin-data-refresh-effect";
import { ADMIN_PERMISSIONS, hasAdminPermission } from "@/lib/permissions";
import { uploadAdminProductImages } from "@/lib/admin-product-media";
import { useAdminFormValidation } from "@/hooks/use-admin-form-validation";
import { formatAdminValidationSummary } from "@/lib/admin-form-validation";
import { fetchPublicStoreConfigClient } from "@/lib/storefront-settings";
import { STOREFRONT_URL } from "@/lib/constants";
import { AdminCopyLinkButton } from "@/components/admin/AdminCopyLinkButton";
import { AdminTableScroll } from "@/components/admin/AdminTableScroll";
import {
  buildPrimaryVariantPricePatch,
  mergePrimaryVariantPrices,
  parseRupeesToPaise,
  primaryVariantPricingFromApi,
} from "@/lib/admin-product-pricing";
import {
  assertClientProductImageFile,
  MAX_PRODUCT_IMAGES,
  PRODUCT_IMAGE_ACCEPT,
  resolveProductImageUrl,
} from "@/lib/media-url";

const inputClass =
  "h-10 w-full rounded-md border border-border/50 bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900/20";
const textareaClass =
  "min-h-[96px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

interface VariantDraft {
  sku: string;
  name: string;
  pricePaise: string;
  compareAtPricePaise: string;
  weightGrams: string;
  packageLengthCm: string;
  packageWidthCm: string;
  packageHeightCm: string;
  keepUpright: boolean;
  initialQuantity: string;
  isActive: boolean;
}

interface ImageDraft {
  url: string;
  altText: string;
  sortOrder: string;
}

function normalizeProductDetail(
  detail: AdminProductDetail,
): AdminProductDetail {
  return {
    ...detail,
    tags: ensureArray(detail.tags),
    variants: ensureArray(detail.variants),
    images: ensureArray(detail.images),
  };
}

function emptyVariant(): VariantDraft {
  return {
    sku: "",
    name: "Default",
    pricePaise: "",
    compareAtPricePaise: "",
    weightGrams: "",
    packageLengthCm: "",
    packageWidthCm: "",
    packageHeightCm: "",
    keepUpright: false,
    initialQuantity: "",
    isActive: true,
  };
}

interface AdminProductEditorProps {
  productId?: string;
}

export function AdminProductEditor({ productId }: AdminProductEditorProps) {
  const isCreate = !productId;
  const router = useRouter();
  const api = useAuthenticatedApi();
  const { adminUser, accessToken } = useAdminAuth();
  const canWrite = hasAdminPermission(
    adminUser,
    ADMIN_PERMISSIONS.productsWrite,
  );

  const [loading, setLoading] = useState(!isCreate);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [uploadTick, setUploadTick] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gstInvoicingEnabled, setGstInvoicingEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPublicStoreConfigClient().then((config) => {
      if (!cancelled) {
        setGstInvoicingEnabled(config.gstInvoicingEnabled);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [categories, setCategories] = useState<AdminCategoryListItem[]>([]);
  const [product, setProduct] = useState<AdminProductDetail | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [shortDesc, setShortDesc] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState("10");
  const [editPrimaryPrice, setEditPrimaryPrice] = useState("");
  const [editPrimaryCompareAtPrice, setEditPrimaryCompareAtPrice] =
    useState("");
  const [editPrimaryWeight, setEditPrimaryWeight] = useState("");
  const [editPrimaryLength, setEditPrimaryLength] = useState("");
  const [editPrimaryWidth, setEditPrimaryWidth] = useState("");
  const [editPrimaryHeight, setEditPrimaryHeight] = useState("");
  const [editPrimaryKeepUpright, setEditPrimaryKeepUpright] = useState(false);
  const [status, setStatus] = useState("Draft");
  const [categoryId, setCategoryId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [isFeatured, setIsFeatured] = useState(false);
  const [gstRate, setGstRate] = useState("12");
  const [hsnCode, setHsnCode] = useState("");

  const [createVariants, setCreateVariants] = useState<VariantDraft[]>([
    emptyVariant(),
  ]);
  // Pairs of { file, previewUrl } for the create flow.
  // We upload to the real endpoint AFTER the product is created,
  // so blob: URLs never reach the database.
  const [createImageFiles, setCreateImageFiles] = useState<
    Array<{ file: File; previewUrl: string; altText: string }>
  >([]);

  const [newVariant, setNewVariant] = useState<VariantDraft>(emptyVariant());
  const [newImage, setNewImage] = useState<ImageDraft>({
    url: "",
    altText: "",
    sortOrder: "0",
  });

  const {
    clearFieldErrors,
    clearFieldError,
    fieldClassName,
    getFieldError,
    validateRequired,
    handleSubmitError,
    applyFieldErrors,
  } = useAdminFormValidation();

  const loadCategories = useCallback(async () => {
    const items = await fetchAllPaginatedItems<AdminCategoryListItem>(
      async (page, limit) =>
        api<PaginatedResponse<AdminCategoryListItem>>(
          `/admin/categories${buildAdminQuery({ page, limit, isActive: true })}`,
        ),
    );
    setCategories(items);
    if (isCreate && items.length > 0 && !categoryId) {
      setCategoryId(items[0].id);
    }
  }, [api, categoryId, isCreate]);

  const loadProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setError(null);
    try {
      const detail = await api<AdminProductDetail>(
        `/admin/products/${productId}`,
      );
      const normalized = normalizeProductDetail(detail);
      setProduct(normalized);
      setName(normalized.name);
      setSlug(normalized.slug);
      setSlugTouched(true);
      setDescription(normalized.description);
      // metaDescription maps to the shortDesc UI field
      setShortDesc(normalized.metaDescription ?? "");
      setCategoryId(normalized.category.id);
      setTagsText(normalized.tags.join(", "));
      setIsFeatured(normalized.isFeatured);
      setGstRate(String(normalized.attributes?.gstRate ?? 12));
      setHsnCode(resolveAdminProductHsnCode(normalized));
      // Map isActive → Status dropdown: true = "Active", false = "Draft"
      setStatus(normalized.isActive ? "Active" : "Draft");
      const primaryVariant = normalized.variants[0];
      if (primaryVariant) {
        const pricing = primaryVariantPricingFromApi(primaryVariant);
        setEditPrimaryPrice(pricing.priceRupees);
        setEditPrimaryCompareAtPrice(pricing.compareAtPriceRupees);
        setEditPrimaryWeight(
          primaryVariant.weight !== null
            ? String(primaryVariant.weight)
            : ""
        );
        setEditPrimaryLength(
          primaryVariant.packageLengthCm !== null
            ? String(primaryVariant.packageLengthCm)
            : ""
        );
        setEditPrimaryWidth(
          primaryVariant.packageWidthCm !== null
            ? String(primaryVariant.packageWidthCm)
            : ""
        );
        setEditPrimaryHeight(
          primaryVariant.packageHeightCm !== null
            ? String(primaryVariant.packageHeightCm)
            : ""
        );
        setEditPrimaryKeepUpright(primaryVariant.keepUpright === true);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [api, productId]);

  useEffect(() => {
    void loadCategories().catch((err) => setError(getApiErrorMessage(err)));
  }, [loadCategories]);

  // Ephemeral green-tick confirmation after a successful image upload (auto-hides after 2s).
  useEffect(() => {
    if (!uploadTick) return;
    const timer = setTimeout(() => setUploadTick(false), 2000);
    return () => clearTimeout(timer);
  }, [uploadTick]);

  useAdminDataRefreshEffect(() => {
    void loadCategories().catch((err) => setError(getApiErrorMessage(err)));
  }, "categories");

  useEffect(() => {
    if (!isCreate) {
      void loadProduct();
    }
  }, [isCreate, loadProduct]);

  useEffect(() => {
    if (isCreate && !slugTouched && name) {
      setSlug(slugify(name));
    }
  }, [isCreate, name, slugTouched]);

  async function saveCoreFields() {
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    clearFieldErrors();

    const requiredChecks = [
      { field: "name", label: "Product name", isEmpty: () => !name.trim() },
      {
        field: "description",
        label: "Description",
        isEmpty: () => !description.trim(),
      },
    ];

    if (isCreate) {
      requiredChecks.push(
        {
          field: "slug",
          label: "URL slug",
          isEmpty: () => !slug.trim(),
        },
        {
          field: "categoryId",
          label: "Category",
          isEmpty: () => !categoryId.trim(),
        },
        {
          field: "sku",
          label: "SKU",
          isEmpty: () => !createVariants[0]?.sku.trim(),
        },
        {
          field: "price",
          label: "Price",
          isEmpty: () => !createVariants[0]?.pricePaise.trim(),
        },
      );
    } else {
      requiredChecks.push({
        field: "price",
        label: "Price",
        isEmpty: () => !editPrimaryPrice.trim(),
      });
    }

    const requiredResult = validateRequired(requiredChecks);
    if (!requiredResult.valid) {
      setError(requiredResult.message);
      setSaving(false);
      return;
    }

    if (hsnCode.trim() && !isValidProductHsnCode(hsnCode)) {
      const hsnError = {
        hsnCode: "HSN must be numeric (1–15 digits).",
      };
      applyFieldErrors(hsnError);
      setError(formatAdminValidationSummary(hsnError));
      setSaving(false);
      return;
    }

    const tags = tagsText
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      if (isCreate) {
        const variants = createVariants
          .map((variant) => {
            const price = parseRupeesToPaise(variant.pricePaise);
            if (
              !variant.sku.trim() ||
              !variant.name.trim() ||
              price === undefined
            ) {
              return null;
            }
            const compareAtPrice = parseRupeesToPaise(
              variant.compareAtPricePaise,
            );
            const qtyStr = variant.initialQuantity.trim();
            const quantity =
              qtyStr !== "" &&
              Number.isFinite(Number(qtyStr)) &&
              Number(qtyStr) >= 0
                ? Math.floor(Number(qtyStr))
                : 0;
            const threshold = Number(lowStockThreshold);
            const wgStr = variant.weightGrams.trim();
            const weightGrams =
              wgStr !== "" && Number.isFinite(Number(wgStr)) && Number(wgStr) > 0
                ? Math.floor(Number(wgStr))
                : undefined;
            const lengthStr = variant.packageLengthCm.trim();
            const packageLengthCm =
              lengthStr !== "" && Number.isFinite(Number(lengthStr)) && Number(lengthStr) > 0
                ? Math.floor(Number(lengthStr))
                : undefined;
            const widthStr = variant.packageWidthCm.trim();
            const packageWidthCm =
              widthStr !== "" && Number.isFinite(Number(widthStr)) && Number(widthStr) > 0
                ? Math.floor(Number(widthStr))
                : undefined;
            const heightStr = variant.packageHeightCm.trim();
            const packageHeightCm =
              heightStr !== "" && Number.isFinite(Number(heightStr)) && Number(heightStr) > 0
                ? Math.floor(Number(heightStr))
                : undefined;
            return {
              sku: variant.sku.trim(),
              name: variant.name.trim(),
              price,
              ...(compareAtPrice !== undefined ? { compareAtPrice } : {}),
              ...(weightGrams !== undefined ? { weight: weightGrams } : {}),
              ...(packageLengthCm !== undefined ? { packageLengthCm } : {}),
              ...(packageWidthCm !== undefined ? { packageWidthCm } : {}),
              ...(packageHeightCm !== undefined ? { packageHeightCm } : {}),
              ...(variant.keepUpright ? { keepUpright: true } : {}),
              quantity,
              isActive: variant.isActive,
              ...(Number.isFinite(threshold) && threshold >= 0
                ? { lowStockThreshold: Math.floor(threshold) }
                : {}),
            };
          })
          .filter(
            (variant): variant is NonNullable<typeof variant> =>
              variant !== null,
          );

        if (variants.length === 0) {
          const variantErrors = {
            sku: "SKU is required.",
            price: "Price is required.",
            variants: "Add at least one variant with SKU, name, and price.",
          };
          applyFieldErrors(variantErrors);
          setError(formatAdminValidationSummary(variantErrors));
          setSaving(false);
          return;
        }

        const productIsActive = status === "Active";
        const payload: AdminCreateProductInput = {
          name: name.trim(),
          slug: slug.trim(),
          description: description.trim(),
          categoryId,
          tags,
          isFeatured,
          isActive: productIsActive,
          ...(shortDesc.trim() ? { metaDescription: shortDesc.trim() } : {}),
          ...buildProductTaxAttributes({
            gstInvoicingEnabled,
            gstRate,
            hsnCode,
          }),
          variants,
          // Images are uploaded separately after creation — never send blob: URLs here.
        };

        const created = await api<AdminProductDetail>("/admin/products", {
          method: "POST",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify(payload),
        });

        // Upload any pending image files to the newly-created product.
        if (createImageFiles.length > 0) {
          if (!accessToken) {
            setError(
              "Product created but image upload could not start (missing admin session). Add images from the edit page.",
            );
            notifyAdminDataChanged(["products", "inventory", "dashboard"]);
            router.push(`/admin/products/${created.id}`);
            return;
          }
          try {
            await uploadAdminProductImages(
              accessToken,
              created.id,
              createImageFiles.map((e) => e.file),
              { altText: created.name, sortOrder: 0 },
            );
          } catch (uploadErr) {
            // Product was created; images failed. Surface as a warning rather
            // than hiding the product. Admin can add images from the edit page.
            setError(
              `Product created but image upload failed: ${uploadErr instanceof Error ? uploadErr.message : "unknown error"}. You can add images from the edit page.`,
            );
            notifyAdminDataChanged(["products", "inventory", "dashboard"]);
            router.push(`/admin/products/${created.id}`);
            return;
          }
        }

        // Revoke all preview blob URLs to free memory.
        createImageFiles.forEach((e) => URL.revokeObjectURL(e.previewUrl));

        notifyAdminDataChanged(["products", "inventory", "dashboard"]);
        router.push(`/admin/products/${created.id}`);
        return;
      }

      if (!productId) return;
      const primaryVariant = product?.variants[0];
      const pricePatch = primaryVariant
        ? buildPrimaryVariantPricePatch(
            editPrimaryPrice,
            editPrimaryCompareAtPrice,
          )
        : null;
      if (pricePatch && !pricePatch.ok) {
        const priceError = { price: pricePatch.message };
        applyFieldErrors(priceError);
        setError(formatAdminValidationSummary(priceError));
        setSaving(false);
        return;
      }

      const productIsActive = status === "Active";
      const updated = await api<AdminProductDetail>(
        `/admin/products/${productId}`,
        {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim(),
            description: description.trim(),
            categoryId,
            tags,
            isFeatured,
            isActive: productIsActive,
            metaDescription: shortDesc.trim() || null,
            ...buildProductTaxAttributes({
              gstInvoicingEnabled,
              gstRate,
              hsnCode,
              existingAttributes: product?.attributes ?? null,
            }),
          }),
        },
      );
      let normalizedUpdated = normalizeProductDetail(updated);

      if (primaryVariant && pricePatch?.ok) {
        const wgStr = editPrimaryWeight.trim();
        const weightGrams =
          wgStr !== "" && Number.isFinite(Number(wgStr)) && Number(wgStr) > 0
            ? Math.floor(Number(wgStr))
            : null;
        const lengthStr = editPrimaryLength.trim();
        const packageLengthCm =
          lengthStr !== "" && Number.isFinite(Number(lengthStr)) && Number(lengthStr) > 0
            ? Math.floor(Number(lengthStr))
            : null;
        const widthStr = editPrimaryWidth.trim();
        const packageWidthCm =
          widthStr !== "" && Number.isFinite(Number(widthStr)) && Number(widthStr) > 0
            ? Math.floor(Number(widthStr))
            : null;
        const heightStr = editPrimaryHeight.trim();
        const packageHeightCm =
          heightStr !== "" && Number.isFinite(Number(heightStr)) && Number(heightStr) > 0
            ? Math.floor(Number(heightStr))
            : null;
        await api(`/admin/products/${productId}/variants/${primaryVariant.id}`, {
          method: "PATCH",
          idempotencyKey: createIdempotencyKey(),
          body: JSON.stringify({
            price: pricePatch.price,
            compareAtPrice: pricePatch.compareAtPrice,
            ...(weightGrams !== null ? { weight: weightGrams } : {}),
            packageLengthCm,
            packageWidthCm,
            packageHeightCm,
            keepUpright: editPrimaryKeepUpright,
          }),
        });
        normalizedUpdated = mergePrimaryVariantPrices(
          normalizedUpdated,
          primaryVariant.id,
          pricePatch.price,
          pricePatch.compareAtPrice,
        );
      }

      setProduct(normalizedUpdated);
      setSuccess("Product saved.");
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(handleSubmitError(err));
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct() {
    if (!canWrite || !productId) return;
    if (
      !window.confirm(
        "Deactivate this product? It will be hidden from the storefront but can be restored later.",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
      router.push("/admin/products");
    } catch (err) {
      setError(getApiErrorMessage(err));
      setSaving(false);
    }
  }

  async function restoreProduct() {
    if (!canWrite || !productId) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ isActive: true }),
      });
      setStatus("Active");
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function hardDeleteProduct() {
    if (!canWrite || !productId) return;
    if (
      !window.confirm(
        `Permanently delete "${name || "this product"}"? This cannot be undone and will remove all product data, variants, and images forever.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}/permanent`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
      router.push("/admin/products");
    } catch (err) {
      setError(getApiErrorMessage(err));
      setSaving(false);
    }
  }

  async function saveVariant(
    variant: AdminProductVariant,
    draft: VariantDraft,
  ) {
    if (!canWrite || !productId) return;
    const price = parseRupeesToPaise(draft.pricePaise);
    if (price === undefined) {
      setError("Variant price must be a non-negative number (rupees).");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const compareAtPrice = parseRupeesToPaise(draft.compareAtPricePaise);
      const wgStr = draft.weightGrams.trim();
      const weightGrams =
        wgStr !== "" && Number.isFinite(Number(wgStr)) && Number(wgStr) > 0
          ? Math.floor(Number(wgStr))
          : null;
      const lengthStr = draft.packageLengthCm.trim();
      const packageLengthCm =
        lengthStr !== "" && Number.isFinite(Number(lengthStr)) && Number(lengthStr) > 0
          ? Math.floor(Number(lengthStr))
          : null;
      const widthStr = draft.packageWidthCm.trim();
      const packageWidthCm =
        widthStr !== "" && Number.isFinite(Number(widthStr)) && Number(widthStr) > 0
          ? Math.floor(Number(widthStr))
          : null;
      const heightStr = draft.packageHeightCm.trim();
      const packageHeightCm =
        heightStr !== "" && Number.isFinite(Number(heightStr)) && Number(heightStr) > 0
          ? Math.floor(Number(heightStr))
          : null;
      await api(`/admin/products/${productId}/variants/${variant.id}`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          sku: draft.sku.trim(),
          name: draft.name.trim(),
          price,
          compareAtPrice: compareAtPrice ?? null,
          weight: weightGrams,
          packageLengthCm,
          packageWidthCm,
          packageHeightCm,
          keepUpright: draft.keepUpright,
          isActive: draft.isActive,
        }),
      });
      await loadProduct();
      setSuccess("Variant updated.");
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(handleSubmitError(err));
    } finally {
      setSaving(false);
    }
  }

  async function addVariant() {
    if (!canWrite || !productId) return;
    const price = parseRupeesToPaise(newVariant.pricePaise);
    if (
      !newVariant.sku.trim() ||
      !newVariant.name.trim() ||
      price === undefined
    ) {
      setError("New variant requires SKU, name, and price (rupees).");
      return;
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const compareAtPrice = parseRupeesToPaise(newVariant.compareAtPricePaise);
      const wgStr = newVariant.weightGrams.trim();
      const weightGrams =
        wgStr !== "" && Number.isFinite(Number(wgStr)) && Number(wgStr) > 0
          ? Math.floor(Number(wgStr))
          : undefined;
      const lengthStr = newVariant.packageLengthCm.trim();
      const packageLengthCm =
        lengthStr !== "" && Number.isFinite(Number(lengthStr)) && Number(lengthStr) > 0
          ? Math.floor(Number(lengthStr))
          : undefined;
      const widthStr = newVariant.packageWidthCm.trim();
      const packageWidthCm =
        widthStr !== "" && Number.isFinite(Number(widthStr)) && Number(widthStr) > 0
          ? Math.floor(Number(widthStr))
          : undefined;
      const heightStr = newVariant.packageHeightCm.trim();
      const packageHeightCm =
        heightStr !== "" && Number.isFinite(Number(heightStr)) && Number(heightStr) > 0
          ? Math.floor(Number(heightStr))
          : undefined;
      await api(`/admin/products/${productId}/variants`, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          sku: newVariant.sku.trim(),
          name: newVariant.name.trim(),
          price,
          ...(compareAtPrice !== undefined ? { compareAtPrice } : {}),
          ...(weightGrams !== undefined ? { weight: weightGrams } : {}),
          ...(packageLengthCm !== undefined ? { packageLengthCm } : {}),
          ...(packageWidthCm !== undefined ? { packageWidthCm } : {}),
          ...(packageHeightCm !== undefined ? { packageHeightCm } : {}),
          ...(newVariant.keepUpright ? { keepUpright: true } : {}),
          isActive: newVariant.isActive,
        }),
      });
      setNewVariant(emptyVariant());
      await loadProduct();
      setSuccess("Variant added.");
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(handleSubmitError(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeVariant(variantId: string) {
    if (!canWrite || !productId || !product) return;
    if (product.variants.length <= 1) {
      setError("Cannot delete the last variant of a product.");
      return;
    }
    if (!window.confirm("Delete this variant?")) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}/variants/${variantId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      await loadProduct();
      setSuccess("Variant deleted.");
      notifyAdminDataChanged(["products", "inventory", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function uploadImageFiles(files: File[], sortOrderOverride?: number) {
    if (!canWrite || !productId || !accessToken || files.length === 0) return;
    const existingCount = product?.images?.length ?? 0;
    if (existingCount >= MAX_PRODUCT_IMAGES) {
      setError(`A product can have at most ${MAX_PRODUCT_IMAGES} images.`);
      return;
    }
    const allowedCount = MAX_PRODUCT_IMAGES - existingCount;
    const filesToUpload =
      files.length > allowedCount ? files.slice(0, allowedCount) : files;
    if (files.length > allowedCount) {
      setError(
        `Only ${allowedCount} more image${allowedCount === 1 ? "" : "s"} can be added (max ${MAX_PRODUCT_IMAGES} per product).`,
      );
    }
    for (const file of filesToUpload) {
      const clientError = assertClientProductImageFile(file);
      if (clientError) {
        setError(clientError);
        return;
      }
    }
    const sortOrder =
      sortOrderOverride ??
      (Number.isFinite(Number(newImage.sortOrder))
        ? Number(newImage.sortOrder)
        : 0);
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await uploadAdminProductImages(accessToken, productId, filesToUpload, {
        altText: newImage.altText.trim() || name.trim() || filesToUpload[0]!.name,
        sortOrder,
      });
      setNewImage({ url: "", altText: "", sortOrder: "0" });
      await loadProduct();
      setSuccess(
        filesToUpload.length === 1
          ? "Image uploaded."
          : `${filesToUpload.length} images uploaded.`,
      );
      setUploadTick(true);
      notifyAdminDataChanged(["products", "dashboard"]);
    } catch (err) {
      setError(err instanceof Error ? err.message : getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function addImageByUrl() {
    if (!canWrite || !productId) return;
    if ((product?.images?.length ?? 0) >= MAX_PRODUCT_IMAGES) {
      setError(`A product can have at most ${MAX_PRODUCT_IMAGES} images.`);
      return;
    }
    if (
      !newImage.url.trim().startsWith("https://") &&
      !newImage.url.trim().startsWith("/api/v1/media/")
    ) {
      setError("Image URL must be https:// or a hosted /api/v1/media/ path.");
      return;
    }
    const sortOrder = Number(newImage.sortOrder);
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await api(`/admin/products/${productId}/images`, {
        method: "POST",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({
          url: newImage.url.trim(),
          altText: newImage.altText.trim() || name.trim(),
          sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
        }),
      });
      setNewImage({ url: "", altText: "", sortOrder: "0" });
      await loadProduct();
      setSuccess("Image added.");
      notifyAdminDataChanged(["products", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeImage(imageId: string) {
    if (!canWrite || !productId) return;
    if (!window.confirm("Remove this image?")) return;
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}/images/${imageId}`, {
        method: "DELETE",
        idempotencyKey: createIdempotencyKey(),
      });
      await loadProduct();
      setSuccess("Image removed.");
      notifyAdminDataChanged(["products", "dashboard"]);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function moveImage(image: AdminProductImage, direction: -1 | 1) {
    if (!canWrite || !productId || !product) return;
    const sorted = [...product.images].sort(
      (a, b) => a.sortOrder - b.sortOrder,
    );
    const index = sorted.findIndex((item) => item.id === image.id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;

    const reordered = [...sorted];
    const [removed] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, removed);
    const payload = reordered.map((item, order) => ({
      id: item.id,
      sortOrder: order,
    }));

    setSaving(true);
    setError(null);
    try {
      await api(`/admin/products/${productId}/images/reorder`, {
        method: "PATCH",
        idempotencyKey: createIdempotencyKey(),
        body: JSON.stringify({ images: payload }),
      });
      await loadProduct();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const handleCreateImageUpload = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (!event.target.files) return;
    const selected = Array.from(event.target.files);
    const remainingSlots = MAX_PRODUCT_IMAGES - createImageFiles.length;
    if (remainingSlots <= 0) {
      setError(`A product can have at most ${MAX_PRODUCT_IMAGES} images.`);
      event.target.value = "";
      return;
    }
    const capped = selected.slice(0, remainingSlots);
    if (selected.length > remainingSlots) {
      setError(
        `Only ${remainingSlots} more image${remainingSlots === 1 ? "" : "s"} can be added (max ${MAX_PRODUCT_IMAGES} per product).`,
      );
    }
    const newEntries = capped.map((file) => {
      const clientError = assertClientProductImageFile(file);
      if (clientError) {
        setError(clientError);
        return null;
      }
      return {
        file,
        previewUrl: URL.createObjectURL(file),
        altText: file.name.replace(/\.[^.]+$/, ""),
      };
    }).filter((e): e is NonNullable<typeof e> => e !== null);
    setCreateImageFiles((prev) => [...prev, ...newEntries]);
    // Reset input so the same file can be re-selected if removed
    event.target.value = "";
  };

  const updateFirstVariant = (key: keyof VariantDraft, value: string | boolean) => {
    const next = [...createVariants];
    if (next[0]) {
      next[0] = { ...next[0], [key]: value };
      setCreateVariants(next);
    }
    if (key === "sku") clearFieldError("sku");
    if (key === "pricePaise") clearFieldError("price");
  };

  const pricingSectionHasError = Boolean(
    getFieldError("price") || getFieldError("sku") || getFieldError("variants"),
  );

  // Find active category name
  const activeCategoryName =
    categories.find((c) => c.id === categoryId)?.name || "Not selected";

  const currentImageCount = isCreate
    ? createImageFiles.length
    : (product?.images?.length ?? 0);
  const atImageLimit = currentImageCount >= MAX_PRODUCT_IMAGES;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Breadcrumb & Header */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/admin/products" className="hover:text-foreground">
              Products
            </Link>
            <span>&gt;</span>
            <span className="font-medium text-foreground">
              {isCreate ? "Add New Product" : "Edit Product"}
            </span>
          </div>
          <h2 className="mt-1 font-heading text-xl font-bold text-foreground sm:text-2xl">
            {isCreate ? "Add New Product" : "Edit Product"}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isCreate
              ? "Fill in the details below to add a new product to your store."
              : `Manage details, pricing, and media for ${name || "this product"}.`}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:w-auto lg:justify-end">
          {!isCreate && canWrite && (
            <div className="flex gap-1">
              {status === "Active" ? (
                <button
                  type="button"
                  onClick={() => void deleteProduct()}
                  disabled={saving}
                  className="h-9 flex-1 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 sm:flex-none"
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void restoreProduct()}
                  disabled={saving}
                  className="h-9 flex-1 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 sm:flex-none"
                >
                  Restore
                </button>
              )}
              <AdminRowActionsMenu
                disabled={saving}
                triggerClassName="h-9 w-9 border border-border bg-background hover:bg-muted/50"
                onDeletePermanently={() => void hardDeleteProduct()}
              />
            </div>
          )}
          <Link href="/admin/products" className="flex-1 sm:flex-none">
            <button
              type="button"
              className="h-9 w-full rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground transition-colors hover:bg-muted/50"
            >
              Cancel
            </button>
          </Link>
          {canWrite ? (
            <button
              type="button"
              onClick={() => void saveCoreFields()}
              disabled={saving || loading}
              className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-60 sm:flex-none"
            >
              {saving ? "Saving…" : isCreate ? "Save Product" : "Save Changes"}
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Read-only</span>
          )}
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive font-medium">
          {error}
        </div>
      ) : null}

      {success ? (
        <div className="rounded-xl border border-zinc-300 bg-zinc-100 px-4 py-3 text-sm text-zinc-800 font-semibold flex items-center gap-2">
          <Check className="h-4 w-4" /> {success}
        </div>
      ) : null}

      {/* Ephemeral upload-success toast — green tick, auto-dismisses after 2s. */}
      {uploadTick ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800 shadow-lg animate-in fade-in slide-in-from-bottom-2"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600 text-white">
            <Check className="h-4 w-4" />
          </span>
          Image uploaded
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-[400px] w-full items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-900 border-t-transparent"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left Column - 2/3 Width */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            {/* Basic Information Section */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
              <h3 className="font-heading text-base font-bold text-foreground">
                Basic Information
              </h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label
                  data-admin-field-label="name"
                  className={cn(
                    "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                    getFieldError("name") && "rounded-md ring-2 ring-destructive/20",
                  )}
                >
                  Product Name <span className="text-rose-500">*</span>
                  <input
                    data-admin-field="name"
                    aria-invalid={Boolean(getFieldError("name"))}
                    className={fieldClassName("name", inputClass)}
                    placeholder="e.g. Chemical Free Bananas"
                    value={name}
                    onChange={(event) => {
                      clearFieldError("name");
                      setName(event.target.value);
                    }}
                    disabled={!canWrite}
                  />
                  {getFieldError("name") ? (
                    <span className="text-[11px] font-semibold normal-case text-destructive">
                      {getFieldError("name")}
                    </span>
                  ) : null}
                </label>

                <label
                  data-admin-field-label="sku"
                  className={cn(
                    "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                    getFieldError("sku") && "rounded-md ring-2 ring-destructive/20",
                  )}
                >
                  SKU <span className="text-rose-500">*</span>
                  <input
                    data-admin-field="sku"
                    aria-invalid={Boolean(getFieldError("sku"))}
                    className={cn(fieldClassName("sku", inputClass), "font-mono")}
                    placeholder="e.g. BAN-ORG-001"
                    value={
                      isCreate
                        ? createVariants[0]?.sku || ""
                        : product?.variants[0]?.sku || ""
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("sku", event.target.value);
                      }
                    }}
                    disabled={!isCreate || !canWrite}
                  />
                  {getFieldError("sku") ? (
                    <span className="text-[11px] font-semibold normal-case text-destructive">
                      {getFieldError("sku")}
                    </span>
                  ) : null}
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label
                  data-admin-field-label="categoryId"
                  className={cn(
                    "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                    getFieldError("categoryId") && "rounded-md ring-2 ring-destructive/20",
                  )}
                >
                  Category <span className="text-rose-500">*</span>
                  <select
                    data-admin-field="categoryId"
                    aria-invalid={Boolean(getFieldError("categoryId"))}
                    className={fieldClassName("categoryId", inputClass)}
                    value={categoryId}
                    onChange={(event) => {
                      clearFieldError("categoryId");
                      setCategoryId(event.target.value);
                    }}
                    disabled={!canWrite || categories.length === 0}
                  >
                    <option value="">
                      {categories.length === 0
                        ? "No categories available"
                        : "Select a category"}
                    </option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {categories.length === 0 ? (
                    <span className="text-[11px] font-semibold normal-case text-amber-700">
                      Categories could not be loaded. Ensure the backend is running
                      and refresh this page.
                    </span>
                  ) : null}
                  {getFieldError("categoryId") ? (
                    <span className="text-[11px] font-semibold normal-case text-destructive">
                      {getFieldError("categoryId")}
                    </span>
                  ) : null}
                </label>

                <label
                  data-admin-field-label="slug"
                  className={cn(
                    "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                    getFieldError("slug") && "rounded-md ring-2 ring-destructive/20",
                  )}
                >
                  URL Slug <span className="text-rose-500">*</span>
                  <input
                    data-admin-field="slug"
                    aria-invalid={Boolean(getFieldError("slug"))}
                    className={cn(fieldClassName("slug", inputClass), "font-mono")}
                    placeholder="e.g. chemical-free-bananas"
                    value={slug}
                    onChange={(event) => {
                      clearFieldError("slug");
                      setSlugTouched(true);
                      setSlug(event.target.value);
                    }}
                    disabled={!canWrite}
                  />
                  {getFieldError("slug") ? (
                    <span className="text-[11px] font-semibold normal-case text-destructive">
                      {getFieldError("slug")}
                    </span>
                  ) : null}
                </label>

                {/* Storefront link — only shown for existing products with a saved slug */}
                {!isCreate && slug ? (
                  <div className="grid gap-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Storefront Link
                    </span>
                    <AdminCopyLinkButton
                      url={`${STOREFRONT_URL}/products/${slug}`}
                    />
                  </div>
                ) : null}
              </div>

              <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Short Description
                <div className="relative">
                  <textarea
                    className={`${textareaClass} border-border/50 text-foreground resize-none pr-12`}
                    placeholder="A short description about the product..."
                    maxLength={500}
                    value={shortDesc}
                    onChange={(event) => setShortDesc(event.target.value)}
                    disabled={!canWrite}
                  />
                  <span className="absolute bottom-2.5 right-3 text-[10px] text-muted-foreground font-semibold">
                    {shortDesc.length}/160
                  </span>
                </div>
              </label>

              {gstInvoicingEnabled ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    GST Rate (%)
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className={inputClass}
                      value={gstRate}
                      onChange={(event) => setGstRate(event.target.value)}
                      disabled={!canWrite}
                    />
                  </label>
                </div>
              ) : null}

              <label
                data-admin-field-label="hsnCode"
                className={cn(
                  "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                  getFieldError("hsnCode") && "rounded-md ring-2 ring-destructive/20",
                )}
              >
                HSN Code
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={15}
                  placeholder="e.g. 0910 (required for Shiprocket)"
                  className={inputClass}
                  value={hsnCode}
                  onChange={(event) =>
                    setHsnCode(event.target.value.replace(/\D/g, ""))
                  }
                  disabled={!canWrite}
                />
              </label>

              <label
                data-admin-field-label="description"
                className={cn(
                  "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                  getFieldError("description") && "rounded-md ring-2 ring-destructive/20",
                )}
              >
                Description <span className="text-rose-500">*</span>
                <div
                  className={`rounded-lg border bg-background overflow-hidden ${
                    getFieldError("description")
                      ? "border-destructive ring-2 ring-destructive/25"
                      : "border-border/50"
                  }`}
                >
                  {/* Styled Editor Toolbar */}
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 bg-muted/20 px-2 py-1.5">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Bold"
                    >
                      <Bold className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Italic"
                    >
                      <Italic className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Underline"
                    >
                      <Underline className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Strikethrough"
                    >
                      <Strikethrough className="h-3.5 w-3.5" />
                    </button>
                    <div className="h-4 w-px bg-border/50 mx-1" />
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Align Left"
                    >
                      <AlignLeft className="h-3.5 w-3.5" />
                    </button>
                    <div className="h-4 w-px bg-border/50 mx-1" />
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Bullet List"
                    >
                      <List className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Numbered List"
                    >
                      <ListOrdered className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Quote"
                    >
                      <Quote className="h-3.5 w-3.5" />
                    </button>
                    <div className="h-4 w-px bg-border/50 mx-1" />
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Link"
                    >
                      <Link2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground"
                      title="Image"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-muted text-muted-foreground ml-auto"
                      title="Expand"
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="relative">
                    <textarea
                      data-admin-field="description"
                      aria-invalid={Boolean(getFieldError("description"))}
                      className="min-h-[140px] w-full border-none bg-transparent px-3 py-2.5 text-sm text-foreground focus:ring-0 resize-none pr-12"
                      placeholder="Write a detailed description about the product..."
                      maxLength={5000}
                      value={description}
                      onChange={(event) => {
                        clearFieldError("description");
                        setDescription(event.target.value);
                      }}
                      disabled={!canWrite}
                    />
                    <span className="absolute bottom-2.5 right-3 text-[10px] text-muted-foreground font-semibold">
                      {description.length}/5000
                    </span>
                  </div>
                </div>
                {getFieldError("description") ? (
                  <span className="text-[11px] font-semibold normal-case text-destructive">
                    {getFieldError("description")}
                  </span>
                ) : null}
              </label>
            </div>

            {/* Pricing & Inventory Section */}
            <div
              data-admin-field-label="variants"
              className={cn(
                "rounded-xl border bg-card p-5 shadow-sm flex flex-col gap-4",
                pricingSectionHasError
                  ? "border-destructive ring-2 ring-destructive/20"
                  : "border-border/40",
              )}
            >
              <h3 className="font-heading text-base font-bold text-foreground">
                Pricing & Inventory
              </h3>
              {getFieldError("variants") ? (
                <p className="text-xs font-medium text-destructive" role="alert">
                  {getFieldError("variants")}
                </p>
              ) : null}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <label
                  data-admin-field-label="price"
                  className={cn(
                    "grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider",
                    getFieldError("price") && "rounded-md ring-2 ring-destructive/20",
                  )}
                >
                  Price <span className="text-rose-500">*</span>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-muted-foreground font-medium text-sm">
                      ₹
                    </span>
                    <input
                      data-admin-field="price"
                      aria-invalid={Boolean(getFieldError("price"))}
                      className={cn(fieldClassName("price", inputClass), "pl-7")}
                      placeholder="0.00"
                      value={
                        isCreate
                          ? createVariants[0]?.pricePaise || ""
                          : editPrimaryPrice
                      }
                      onChange={(event) => {
                        if (isCreate) {
                          updateFirstVariant("pricePaise", event.target.value);
                        } else {
                          clearFieldError("price");
                          setEditPrimaryPrice(event.target.value);
                        }
                      }}
                      disabled={!canWrite}
                    />
                  </div>
                  {getFieldError("price") ? (
                    <span className="text-[11px] font-semibold normal-case text-destructive">
                      {getFieldError("price")}
                    </span>
                  ) : null}
                </label>

                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    Compare at Price
                    <span className="normal-case font-medium text-muted-foreground/70">(optional)</span>
                    <span title="Original price before discount. Leave blank if there is no discount; must be higher than the price.">
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </span>
                  </span>
                  <div className="relative flex items-center">
                    <span className="absolute left-3 text-muted-foreground font-medium text-sm">
                      ₹
                    </span>
                    <input
                      className={`${inputClass} border-border/50 text-foreground pl-7`}
                      placeholder="0.00"
                      value={
                        isCreate
                          ? createVariants[0]?.compareAtPricePaise || ""
                          : editPrimaryCompareAtPrice
                      }
                      onChange={(event) => {
                        if (isCreate) {
                          updateFirstVariant(
                            "compareAtPricePaise",
                            event.target.value,
                          );
                        } else {
                          setEditPrimaryCompareAtPrice(event.target.value);
                        }
                      }}
                      disabled={!canWrite}
                    />
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-center">
                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    Weight (g)
                    <span title="Weight in grams — required for shipping rate calculation.">
                      <HelpCircle className="h-3.5 w-3.5 text-muted-foreground/60 cursor-help" />
                    </span>
                  </span>
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="number"
                    min="1"
                    placeholder="e.g. 500"
                    value={
                      isCreate
                        ? createVariants[0]?.weightGrams || ""
                        : editPrimaryWeight
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("weightGrams", event.target.value);
                      } else {
                        setEditPrimaryWeight(event.target.value);
                      }
                    }}
                    disabled={!canWrite}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Box Length (cm)
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="number"
                    min="1"
                    placeholder="15"
                    value={
                      isCreate
                        ? createVariants[0]?.packageLengthCm || ""
                        : editPrimaryLength
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("packageLengthCm", event.target.value);
                      } else {
                        setEditPrimaryLength(event.target.value);
                      }
                    }}
                    disabled={!canWrite}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Box Width (cm)
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="number"
                    min="1"
                    placeholder="15"
                    value={
                      isCreate
                        ? createVariants[0]?.packageWidthCm || ""
                        : editPrimaryWidth
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("packageWidthCm", event.target.value);
                      } else {
                        setEditPrimaryWidth(event.target.value);
                      }
                    }}
                    disabled={!canWrite}
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Box Height (cm)
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="number"
                    min="1"
                    placeholder="10"
                    value={
                      isCreate
                        ? createVariants[0]?.packageHeightCm || ""
                        : editPrimaryHeight
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("packageHeightCm", event.target.value);
                      } else {
                        setEditPrimaryHeight(event.target.value);
                      }
                    }}
                    disabled={!canWrite}
                  />
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground uppercase tracking-wider sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border/50"
                    checked={
                      isCreate
                        ? createVariants[0]?.keepUpright ?? false
                        : editPrimaryKeepUpright
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant("keepUpright", event.target.checked);
                      } else {
                        setEditPrimaryKeepUpright(event.target.checked);
                      }
                    }}
                    disabled={!canWrite}
                  />
                  Keep upright (fragile / this-side-up)
                </label>
                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Stock Quantity <span className="text-rose-500">*</span>
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="text"
                    placeholder={!isCreate ? "Managed in Inventory" : "0"}
                    value={
                      isCreate ? createVariants[0]?.initialQuantity || "" : ""
                    }
                    onChange={(event) => {
                      if (isCreate) {
                        updateFirstVariant(
                          "initialQuantity",
                          event.target.value,
                        );
                      }
                    }}
                    disabled={!isCreate || !canWrite}
                  />
                </label>

                <label className="grid gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Low Stock Threshold
                  <input
                    className={`${inputClass} border-border/50 text-foreground`}
                    type="number"
                    min="0"
                    placeholder="10"
                    value={lowStockThreshold}
                    onChange={(event) =>
                      setLowStockThreshold(event.target.value)
                    }
                    disabled={!canWrite}
                  />
                </label>
              </div>
            </div>

            {/* Product Images Section */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
              <h3 className="font-heading text-base font-bold text-foreground">
                Product Images
              </h3>
              <p className="text-xs text-muted-foreground font-medium -mt-2">
                Upload high-quality images of your product. You can drag and
                drop or click to browse.
              </p>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {/* Upload Box Component */}
                <div className="relative flex flex-col items-center justify-center border-2 border-dashed border-border/60 hover:border-zinc-900/50 rounded-xl bg-muted/5 p-4 transition-colors cursor-pointer group text-center min-h-[120px]">
                  <input
                    type="file"
                    accept={PRODUCT_IMAGE_ACCEPT}
                    multiple
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    disabled={saving || atImageLimit}
                    onChange={(event) => {
                      if (isCreate) {
                        handleCreateImageUpload(event);
                      } else {
                        const selected = event.target.files
                          ? Array.from(event.target.files)
                          : [];
                        if (selected.length > 0)
                          void uploadImageFiles(selected);
                      }
                    }}
                  />
                  <UploadCloud className="h-6 w-6 text-muted-foreground group-hover:text-zinc-900 transition-colors mb-1.5" />
                  <span className="text-[10px] font-bold text-muted-foreground group-hover:text-zinc-800">
                    Drag & drop here
                  </span>
                  <span className="text-[9px] text-muted-foreground mt-0.5 font-medium">
                    or{" "}
                    <span className="text-zinc-900 underline font-semibold">
                      Browse Files
                    </span>
                  </span>
                </div>

                {/* Rendered Uploaded Images */}
                {isCreate
                  ? createImageFiles.map((entry, index) => (
                      <div
                        key={index}
                        className="relative aspect-square rounded-xl overflow-hidden border border-border/50 group"
                      >
                        <Image
                          src={entry.previewUrl}
                          alt={entry.altText}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                        {index === 0 && (
                          <span className="absolute top-2 left-2 bg-zinc-900 text-[9px] font-bold text-white px-2 py-0.5 rounded-full shadow-sm">
                            Primary
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            URL.revokeObjectURL(entry.previewUrl);
                            setCreateImageFiles((prev) =>
                              prev.filter((_, i) => i !== index),
                            );
                          }}
                          className="absolute top-2 right-2 h-5 w-5 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  : [...(product?.images || [])]
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((image, index) => (
                        <div
                          key={image.id}
                          className="relative aspect-square rounded-xl overflow-hidden border border-border/50 group"
                        >
                          <Image
                            src={resolveProductImageUrl(image.url)}
                            alt={image.altText}
                            fill
                            className="object-cover"
                          />
                          {index === 0 && (
                            <span className="absolute top-2 left-2 bg-zinc-900 text-[9px] font-bold text-white px-2 py-0.5 rounded-full shadow-sm z-10">
                              Primary
                            </span>
                          )}
                          {canWrite && (
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5 z-10">
                              <button
                                type="button"
                                onClick={() => void moveImage(image, -1)}
                                className="h-6 w-6 rounded bg-black/70 text-white flex items-center justify-center text-xs hover:bg-black/90 font-bold"
                                title="Move Left"
                              >
                                ←
                              </button>
                              <button
                                type="button"
                                onClick={() => void moveImage(image, 1)}
                                className="h-6 w-6 rounded bg-black/70 text-white flex items-center justify-center text-xs hover:bg-black/90 font-bold"
                                title="Move Right"
                              >
                                →
                              </button>
                              <button
                                type="button"
                                onClick={() => void removeImage(image.id)}
                                className="h-6 w-6 rounded bg-red-600 text-white flex items-center justify-center text-xs hover:bg-red-700"
                                title="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}

                {/* Add more placeholder dashed box */}
                {(isCreate
                  ? createImageFiles.length
                  : product?.images?.length || 0) > 0 && (
                  <div className="relative flex flex-col items-center justify-center border border-dashed border-border/60 rounded-xl bg-muted/5 hover:bg-muted/10 transition-colors text-center aspect-square cursor-pointer">
                    <input
                      type="file"
                      accept={PRODUCT_IMAGE_ACCEPT}
                      multiple
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      disabled={saving || atImageLimit}
                      onChange={(event) => {
                        if (isCreate) {
                          handleCreateImageUpload(event);
                        } else {
                          const selected = event.target.files
                            ? Array.from(event.target.files)
                            : [];
                          if (selected.length > 0)
                            void uploadImageFiles(selected);
                        }
                      }}
                    />
                    <Plus className="h-5 w-5 text-muted-foreground mb-1" />
                    <span className="text-[10px] font-bold text-muted-foreground">
                      Add more
                    </span>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground font-semibold mt-1 block">
                Upload up to {MAX_PRODUCT_IMAGES} images. Recommended size:
                1200x1200px. Max file size: 5MB each.
              </span>

              {canWrite && !isCreate && (
                <details className="text-xs font-semibold mt-2 text-muted-foreground cursor-pointer select-none">
                  <summary className="hover:text-foreground">
                    Or add external image via HTTPS URL
                  </summary>
                  <div className="mt-2.5 flex gap-2">
                    <input
                      className={`${inputClass} border-border/50 text-foreground text-xs flex-1`}
                      placeholder="https://example.com/banana.jpg"
                      value={newImage.url}
                      onChange={(e) =>
                        setNewImage({ ...newImage, url: e.target.value })
                      }
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void addImageByUrl()}
                      className="h-10 rounded-md border border-border bg-background px-4 text-xs font-bold text-foreground hover:bg-muted/50"
                    >
                      Add URL
                    </button>
                  </div>
                </details>
              )}
            </div>

            {/* Variants table for edit mode so we don't lose variant editing capability */}
            {!isCreate && product && (
              <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
                <h3 className="font-heading text-base font-bold text-foreground">
                  Manage All Product Variants
                </h3>
                <AdminTableScroll className="rounded-lg border border-border/50">
                  <table className="w-full min-w-[1180px] text-left text-sm">
                    <thead className="border-b border-border/40 bg-muted/20 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      <tr>
                        <th className="px-3 py-3">SKU</th>
                        <th className="px-3 py-3">Name</th>
                        <th className="px-3 py-3">Price (₹)</th>
                        <th className="px-3 py-3">Cmp. At (₹)</th>
                        <th className="px-3 py-3">Weight (g)</th>
                        <th className="px-3 py-3">L (cm)</th>
                        <th className="px-3 py-3">W (cm)</th>
                        <th className="px-3 py-3">H (cm)</th>
                        <th className="px-3 py-3">Upright</th>
                        <th className="px-3 py-3">Active</th>
                        <th className="px-3 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/20">
                      {product.variants.map((variant) => (
                        <VariantEditRow
                          key={variant.id}
                          variant={variant}
                          canWrite={canWrite}
                          saving={saving}
                          onSave={(draft) => void saveVariant(variant, draft)}
                          onDelete={() => void removeVariant(variant.id)}
                          canDelete={product.variants.length > 1}
                        />
                      ))}
                    </tbody>
                  </table>
                </AdminTableScroll>
                {canWrite ? (
                  <div className="mt-4 grid grid-cols-1 items-center gap-3 rounded-lg border border-dashed border-border/60 bg-muted/5 p-4 sm:grid-cols-2 md:grid-cols-6">
                    <input
                      className={`${inputClass} border-border/50 text-foreground font-mono`}
                      placeholder="New SKU"
                      value={newVariant.sku}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          sku: event.target.value,
                        })
                      }
                    />
                    <input
                      className={`${inputClass} border-border/50 text-foreground`}
                      placeholder="Variant Name"
                      value={newVariant.name}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          name: event.target.value,
                        })
                      }
                    />
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-muted-foreground font-medium text-sm">
                        ₹
                      </span>
                      <input
                        className={`${inputClass} border-border/50 text-foreground pl-7`}
                        placeholder="Price"
                        value={newVariant.pricePaise}
                        onChange={(event) =>
                          setNewVariant({
                            ...newVariant,
                            pricePaise: event.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-muted-foreground font-medium text-sm">
                        ₹
                      </span>
                      <input
                        className={`${inputClass} border-border/50 text-foreground pl-7`}
                        placeholder="Compare-at"
                        value={newVariant.compareAtPricePaise}
                        onChange={(event) =>
                          setNewVariant({
                            ...newVariant,
                            compareAtPricePaise: event.target.value,
                          })
                        }
                      />
                    </div>
                    <input
                      className={`${inputClass} border-border/50 text-foreground`}
                      type="number"
                      min="1"
                      placeholder="Weight (g)"
                      value={newVariant.weightGrams}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          weightGrams: event.target.value,
                        })
                      }
                    />
                    <input
                      className={`${inputClass} border-border/50 text-foreground`}
                      type="number"
                      min="1"
                      placeholder="Box Length (cm)"
                      value={newVariant.packageLengthCm}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          packageLengthCm: event.target.value,
                        })
                      }
                    />
                    <input
                      className={`${inputClass} border-border/50 text-foreground`}
                      type="number"
                      min="1"
                      placeholder="Box Width (cm)"
                      value={newVariant.packageWidthCm}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          packageWidthCm: event.target.value,
                        })
                      }
                    />
                    <input
                      className={`${inputClass} border-border/50 text-foreground`}
                      type="number"
                      min="1"
                      placeholder="Box Height (cm)"
                      value={newVariant.packageHeightCm}
                      onChange={(event) =>
                        setNewVariant({
                          ...newVariant,
                          packageHeightCm: event.target.value,
                        })
                      }
                    />
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border/50"
                        checked={newVariant.keepUpright}
                        onChange={(event) =>
                          setNewVariant({
                            ...newVariant,
                            keepUpright: event.target.checked,
                          })
                        }
                      />
                      Keep upright (fragile / this-side-up)
                    </label>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void addVariant()}
                      className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-60"
                    >
                      Add Variant
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          {/* Right Column - 1/3 Width */}
          <div className="flex flex-col gap-6 lg:col-span-1">
            {/* Publish Control Card */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border/20 pb-2.5">
                <h3 className="font-heading text-base font-bold text-foreground">
                  Publish
                </h3>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </div>

              <div className="flex flex-col gap-4 text-sm font-semibold">
                <label className="grid gap-1 text-muted-foreground">
                  Status
                  <select
                    className={`${inputClass} border-border/50 text-foreground mt-1.5 font-bold`}
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    disabled={!canWrite}
                  >
                    <option value="Draft">Draft</option>
                    <option value="Active">Active</option>
                  </select>
                </label>

                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Featured
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isFeatured}
                    onClick={() => setIsFeatured(!isFeatured)}
                    disabled={!canWrite}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isFeatured ? "bg-emerald-600" : "bg-muted-foreground/30"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        isFeatured ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Status helper banner */}
                <div
                  className={`rounded-xl border p-3 flex items-center gap-2 text-xs font-semibold ${
                    status === "Active"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-amber-50 border-amber-100 text-amber-700"
                  }`}
                >
                  <Check className="h-4 w-4 shrink-0" />
                  <span>
                    {status === "Active"
                      ? "Product is live and visible on the storefront"
                      : "Product is a draft and hidden from the storefront"}
                  </span>
                </div>
              </div>
            </div>

            {/* Product Live Preview Card */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
              <h3 className="font-heading text-base font-bold text-foreground">
                Product Preview
              </h3>

              <div className="rounded-xl border border-border/40 bg-background overflow-hidden shadow-sm flex items-center p-3 gap-4">
                <div className="relative h-20 w-20 shrink-0 rounded-lg overflow-hidden border border-border/40 bg-muted/10">
                  {isCreate ? (
                    createImageFiles[0]?.previewUrl ? (
                      <Image
                        src={createImageFiles[0].previewUrl}
                        alt={name}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                        No Image
                      </div>
                    )
                  ) : product?.images[0]?.url ? (
                    <Image
                      src={resolveProductImageUrl(product.images[0].url)}
                      alt={name}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground font-semibold">
                      No Image
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-semibold text-foreground text-sm truncate">
                    {name || "Banana Bunch"}
                  </h4>
                  <p className="font-bold text-zinc-900 text-sm mt-0.5">
                    ₹
                    {isCreate
                      ? createVariants[0]?.pricePaise
                        ? Number(createVariants[0].pricePaise).toFixed(2)
                        : "0.00"
                      : product?.variants[0]?.price
                        ? (product.variants[0].price / 100).toFixed(2)
                        : "0.00"}
                  </p>

                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-tight">
                    {shortDesc ||
                      description.slice(0, 100) ||
                      "No description yet."}
                  </p>
                </div>
              </div>
            </div>

            {/* Summary Information Card */}
            <div className="rounded-xl border border-border/40 bg-card p-5 shadow-sm flex flex-col gap-4">
              <h3 className="font-heading text-base font-bold text-foreground">
                Summary
              </h3>

              <div className="flex flex-col gap-3.5 text-xs font-bold text-muted-foreground">
                <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
                  <span>Status</span>
                  <span
                    className={`font-semibold ${
                      status === "Active"
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    {status}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
                  <span>Category</span>
                  <span className="text-foreground">{activeCategoryName}</span>
                </div>

                <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
                  <span>Featured</span>
                  <span
                    className={
                      isFeatured ? "text-emerald-600" : "text-foreground"
                    }
                  >
                    {isFeatured ? "Yes" : "No"}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
                  <span>Tags</span>
                  <span className="text-foreground truncate max-w-[160px]">
                    {tagsText || "—"}
                  </span>
                </div>

                <div className="flex items-center justify-between border-b border-border/10 pb-1.5">
                  <span>Variants</span>
                  <span className="text-foreground">
                    {isCreate
                      ? `${createVariants.length} draft`
                      : `${product?.variants.length ?? 0} variant${(product?.variants.length ?? 0) !== 1 ? "s" : ""}`}
                  </span>
                </div>

                <div className="flex items-center justify-between pb-0">
                  <span>Images</span>
                  <span className="text-foreground">
                    {isCreate
                      ? createImageFiles.length
                      : (product?.images.length ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VariantEditRow({
  variant,
  canWrite,
  saving,
  onSave,
  onDelete,
  canDelete,
}: {
  variant: AdminProductVariant;
  canWrite: boolean;
  saving: boolean;
  onSave: (draft: VariantDraft) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [draft, setDraft] = useState<VariantDraft>({
    sku: variant.sku,
    name: variant.name,
    pricePaise: String(variant.price / 100),
    compareAtPricePaise:
      variant.compareAtPrice !== null
        ? String(variant.compareAtPrice / 100)
        : "",
    weightGrams:
      variant.weight !== null ? String(variant.weight) : "",
    packageLengthCm:
      variant.packageLengthCm !== null ? String(variant.packageLengthCm) : "",
    packageWidthCm:
      variant.packageWidthCm !== null ? String(variant.packageWidthCm) : "",
    packageHeightCm:
      variant.packageHeightCm !== null ? String(variant.packageHeightCm) : "",
    keepUpright: variant.keepUpright === true,
    initialQuantity: "",
    isActive: variant.isActive,
  });

  useEffect(() => {
    setDraft({
      sku: variant.sku,
      name: variant.name,
      pricePaise: String(variant.price / 100),
      compareAtPricePaise:
        variant.compareAtPrice !== null
          ? String(variant.compareAtPrice / 100)
          : "",
      weightGrams:
        variant.weight !== null ? String(variant.weight) : "",
      packageLengthCm:
        variant.packageLengthCm !== null ? String(variant.packageLengthCm) : "",
      packageWidthCm:
        variant.packageWidthCm !== null ? String(variant.packageWidthCm) : "",
      packageHeightCm:
        variant.packageHeightCm !== null ? String(variant.packageHeightCm) : "",
      keepUpright: variant.keepUpright === true,
      initialQuantity: "",
      isActive: variant.isActive,
    });
  }, [variant]);

  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[110px]`}
          value={draft.sku}
          onChange={(event) => setDraft({ ...draft, sku: event.target.value })}
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[140px]`}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[104px]`}
          value={draft.pricePaise}
          onChange={(event) =>
            setDraft({ ...draft, pricePaise: event.target.value })
          }
          disabled={!canWrite}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {formatPaise(variant.price)}
        </p>
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[104px]`}
          value={draft.compareAtPricePaise}
          onChange={(event) =>
            setDraft({ ...draft, compareAtPricePaise: event.target.value })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[84px]`}
          type="number"
          min="1"
          placeholder="g"
          value={draft.weightGrams}
          onChange={(event) =>
            setDraft({ ...draft, weightGrams: event.target.value })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[68px]`}
          type="number"
          min="1"
          placeholder="L"
          value={draft.packageLengthCm}
          onChange={(event) =>
            setDraft({ ...draft, packageLengthCm: event.target.value })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[68px]`}
          type="number"
          min="1"
          placeholder="W"
          value={draft.packageWidthCm}
          onChange={(event) =>
            setDraft({ ...draft, packageWidthCm: event.target.value })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={`${inputClass} min-w-[68px]`}
          type="number"
          min="1"
          placeholder="H"
          value={draft.packageHeightCm}
          onChange={(event) =>
            setDraft({ ...draft, packageHeightCm: event.target.value })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          aria-label="Keep upright"
          checked={draft.keepUpright}
          onChange={(event) =>
            setDraft({ ...draft, keepUpright: event.target.checked })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(event) =>
            setDraft({ ...draft, isActive: event.target.checked })
          }
          disabled={!canWrite}
        />
      </td>
      <td className="px-3 py-2">
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="text-xs text-primary"
              disabled={saving}
              onClick={() => onSave(draft)}
            >
              Save
            </button>
            {canDelete ? (
              <button
                type="button"
                className="text-xs text-destructive"
                disabled={saving}
                onClick={onDelete}
              >
                Delete
              </button>
            ) : (
              <span className="text-xs text-muted-foreground">
                Last variant
              </span>
            )}
          </div>
        ) : null}
      </td>
    </tr>
  );
}
