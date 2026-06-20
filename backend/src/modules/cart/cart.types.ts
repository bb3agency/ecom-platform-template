import { CouponType } from '@prisma/client';

export type AddCartItemInput = {
  variantId: string;
  quantity: number;
};

export type UpdateCartItemInput = {
  quantity: number;
};

export type ApplyCouponInput = {
  code: string;
};

export type CheckPincodeInput = {
  pincode: string;
};

export type DeliveryRatesQuery = {
  pincode: string;
};

export type CartCouponSummary = {
  id: string;
  code: string;
  type: CouponType;
  value: number;
};

