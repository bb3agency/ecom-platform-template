export type InventoryListQuery = {
  page?: number;
  limit?: number;
};

export type UpdateInventoryInput = {
  quantity?: number;
  lowStockThreshold?: number;
};

export type BulkUpdateInventoryItem = {
  variantId: string;
  quantity?: number;
  lowStockThreshold?: number;
};

export type BulkUpdateInventoryInput = {
  updates: BulkUpdateInventoryItem[];
};

export type InventoryHistoryQuery = {
  page?: number;
  limit?: number;
};

