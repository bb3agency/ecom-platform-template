export type UserRole = "CUSTOMER" | "ADMIN" | string;

export interface User {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  isVerified: boolean;
  role?: UserRole;
  permissions?: string[];
}

export interface AuthSession {
  accessToken: string;
  user: User;
  permissions?: string[];
}
