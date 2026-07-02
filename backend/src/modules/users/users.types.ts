export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
  email?: string;
  /** New login mobile number, or `null` to remove it (guarded — see UsersService.patchMe). */
  phone?: string | null;
};

export type CreateAddressInput = {
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  isDefault?: boolean;
};

export type UpdateAddressInput = Partial<CreateAddressInput>;

export type AddressListQuery = {
  page?: number;
  limit?: number;
};

export type OrderListQuery = {
  page?: number;
  limit?: number;
};

export type AdminUsersListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  banned?: boolean;
  from?: string;
  to?: string;
};

export type AdminCustomerOrdersQuery = {
  page?: number;
  limit?: number;
};

