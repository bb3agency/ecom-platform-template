import { z } from "zod";
import { normalizeOtpCodeInput } from "@/lib/otp-code";

export const emailSchema = z.string().email("Enter a valid email address");

export const phoneSchema = z
  .string()
  .min(10, "Enter a valid phone number")
  .max(15, "Enter a valid phone number");

export const otpSchema = z
  .string()
  .transform((value) => normalizeOtpCodeInput(value))
  .pipe(
    z
      .string()
      .length(6, "OTP must be 6 digits")
      .regex(/^\d{6}$/, "OTP must be numeric"),
  );

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be less than 128 characters");

export const sendOtpInputSchema = z.object({
  phone: phoneSchema,
  channel: z.enum(["sms", "whatsapp", "email"]).optional(),
  email: emailSchema.optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export const verifyOtpInputSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
});

export const signupPhoneInputSchema = z.object({
  phone: phoneSchema,
  otp: otpSchema,
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  email: emailSchema.optional(),
});

/** Used by login forms to check if a phone/email is registered before proceeding. */
export const checkIdentifierInputSchema = z.object({
  identifier: z.string().min(1, "Enter your mobile number or email").max(255),
});

/**
 * Password login: `identifier` accepts a mobile number OR email address.
 * The backend detects the type and looks up the user accordingly.
 */
export const emailLoginInputSchema = z.object({
  identifier: z
    .string()
    .min(1, "Enter your mobile number or email")
    .max(255, "Too long"),
  password: passwordSchema,
  turnstileToken: z.string().max(4096).optional(),
});

export const adminLoginInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  mfaCode: z
    .string()
    .min(6, "Authenticator code must be 6 digits")
    .max(8)
    .regex(/^\d{6,8}$/, "Authenticator code must be numeric")
    .optional(),
  turnstileToken: z.string().max(4096).optional(),
});

export const adminMfaCodeSchema = z
  .string()
  .min(6, "Authenticator code must be 6 digits")
  .max(8)
  .regex(/^\d{6,8}$/, "Authenticator code must be numeric");

export const forgotPasswordInputSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().max(4096).optional(),
});

export const resetPasswordInputSchema = z
  .object({
    token: z.string().min(1, "Reset token is required").max(255),
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const addCartItemInputSchema = z.object({
  variantId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(1000),
});

export const updateCartItemInputSchema = z.object({
  quantity: z.number().int().min(1).max(1000),
});
// emailRegisterInputSchema keeps phone as optional string.
// Empty string ("") passes validation and is stripped to undefined before the API call
// (see EmailRegisterForm handleSubmit). Non-empty values must be a valid phone number.
export const emailRegisterInputSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(100),
  lastName: z.string().min(1, "Last name is required").max(100),
  phone: z
    .string()
    .optional()
    .refine(
      (val) => !val || val.trim() === "" || val.trim().length >= 10,
      "Enter a valid phone number (at least 10 digits)"
    )
    .refine(
      (val) => !val || val.trim().length <= 15,
      "Enter a valid phone number"
    ),
  email: emailSchema,
  password: passwordSchema,
  turnstileToken: z.string().max(4096).optional(),
});
