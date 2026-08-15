/**
 * Profile fields a customer may set with nothing but an access token.
 * `email`/`phone` are NOT here by design (pentest F-1) — they are login and
 * recovery identifiers and require the verified change flow.
 */
export type UpdateProfileInput = {
  firstName?: string;
  lastName?: string;
};

export type RequestIdentifierChangeInput = {
  type: 'email' | 'phone';
  /** New value, or null to remove a mobile number. */
  newValue: string | null;
};

export type VerifyIdentifierChangeInput = {
  type: 'email' | 'phone';
  /** Code sent to the identifier already on the account. */
  currentOtp: string;
  /** Code sent to the new value; omitted when removing an identifier. */
  newOtp?: string;
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

