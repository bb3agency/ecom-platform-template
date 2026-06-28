export type PublicCategoryListQuery = {
  search?: string;
};

export type ProductListQuery = {
  category?: string;
  search?: string;
  sku?: string;
  minPrice?: number;
  maxPrice?: number;
  tags?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'popularity';
  inStock?: boolean;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

export type CreateProductInput = {
  name: string;
  slug: string;
  description: string;
  categoryId: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  metaTitle?: string;
  metaDescription?: string;
  isFeatured?: boolean;
  isActive?: boolean;
  images?: Array<{
    url: string;
    altText: string;
    sortOrder: number;
  }>;
  variants?: Array<{
    sku: string;
    name: string;
    price: number;
    compareAtPrice?: number;
    weight?: number;
    packageLengthCm?: number;
    packageWidthCm?: number;
    packageHeightCm?: number;
    keepUpright?: boolean;
    quantity?: number;
    lowStockThreshold?: number;
    attributes?: Record<string, unknown>;
    isActive?: boolean;
  }>;
};

export type UpdateProductInput = Partial<CreateProductInput> & {
  isActive?: boolean;
};

export type CreateCategoryInput = {
  name: string;
  slug: string;
  parentId?: string;
  imageUrl?: string;
  isActive?: boolean;
};

export type UpdateCategoryInput = Partial<Omit<CreateCategoryInput, 'parentId' | 'imageUrl'>> & {
  parentId?: string | null;
  imageUrl?: string | null;
  isActive?: boolean;
};

export type AdminCategoryListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
};

export type ProductCsvImportInput = {
  csv: string;
};

export type CreateProductVariantInput = {
  sku: string;
  name: string;
  price: number;
  compareAtPrice?: number;
  weight?: number;
  packageLengthCm?: number;
  packageWidthCm?: number;
  packageHeightCm?: number;
  keepUpright?: boolean;
  quantity?: number;
  lowStockThreshold?: number;
  attributes?: Record<string, unknown>;
  isActive?: boolean;
};

export type UpdateProductVariantInput = Partial<CreateProductVariantInput>;

export type CreateProductImageInput = {
  url: string;
  altText: string;
  sortOrder: number;
};

export type ReorderProductImagesInput = {
  images: Array<{ id: string; sortOrder: number }>;
};

