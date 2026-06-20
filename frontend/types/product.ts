export interface ProductImage {
  id: string;
  url: string;
  altText: string;
  sortOrder: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  isActive: boolean;
}

export interface ProductCategory {
  id: string;
  name: string;
  slug: string;
  imageUrl?: string | null;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: ProductCategory;
  rating: number;
  reviewCount: number;
  tags: string[];
  isFeatured: boolean;
  isActive: boolean;
  images: ProductImage[];
  variants: ProductVariant[];
  inStock: boolean;
}
