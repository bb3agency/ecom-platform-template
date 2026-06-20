"use client";

import { useCallback, useState } from "react";
import {
  adminInputClassName,
  collectRequiredFieldErrors,
  formatAdminValidationSummary,
  processAdminFormSubmitError,
  scrollToFirstAdminFieldError,
  type AdminFieldErrors,
  type AdminRequiredFieldCheck,
} from "@/lib/admin-form-validation";

export function useAdminFormValidation() {
  const [fieldErrors, setFieldErrors] = useState<AdminFieldErrors>({});

  const clearFieldErrors = useCallback(() => {
    setFieldErrors({});
  }, []);

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  const applyFieldErrors = useCallback((errors: AdminFieldErrors) => {
    setFieldErrors(errors);
    scrollToFirstAdminFieldError(Object.keys(errors));
  }, []);

  const hasFieldError = useCallback(
    (field: string) => Boolean(fieldErrors[field]),
    [fieldErrors],
  );

  const getFieldError = useCallback(
    (field: string) => fieldErrors[field],
    [fieldErrors],
  );

  const fieldClassName = useCallback(
    (field: string, baseClass: string) =>
      adminInputClassName(baseClass, Boolean(fieldErrors[field])),
    [fieldErrors],
  );

  const validateRequired = useCallback(
    (checks: AdminRequiredFieldCheck[]) => {
      const errors = collectRequiredFieldErrors(checks);
      if (Object.keys(errors).length === 0) {
        return { valid: true as const };
      }
      applyFieldErrors(errors);
      return {
        valid: false as const,
        message: formatAdminValidationSummary(errors),
      };
    },
    [applyFieldErrors],
  );

  const handleSubmitError = useCallback(
    (error: unknown) => {
      const { message, fieldErrors: nextErrors } =
        processAdminFormSubmitError(error);
      if (Object.keys(nextErrors).length > 0) {
        applyFieldErrors(nextErrors);
      }
      return message;
    },
    [applyFieldErrors],
  );

  const showValidationBanner = useCallback(
    (errors: AdminFieldErrors) => {
      applyFieldErrors(errors);
      return formatAdminValidationSummary(errors);
    },
    [applyFieldErrors],
  );

  return {
    fieldErrors,
    clearFieldErrors,
    clearFieldError,
    applyFieldErrors,
    hasFieldError,
    getFieldError,
    fieldClassName,
    validateRequired,
    handleSubmitError,
    showValidationBanner,
  };
}
