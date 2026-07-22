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
  parentId?: string | null;
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
  /**
   * Merchant-fulfilled local delivery ONLY — never handed to a courier, so this product can
   * only be delivered to pincodes on the store's local-delivery whitelist. A cart mixing these
   * with ordinary products is split into two orders at checkout.
   */
  isLocalDeliveryOnly?: boolean;
  isActive: boolean;
  images: ProductImage[];
  variants: ProductVariant[];
  inStock: boolean;
}
