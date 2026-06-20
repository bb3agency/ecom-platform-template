import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  adminValidationFieldsToMap,
  collectRequiredFieldErrors,
  extractAdminValidationFields,
  formatAdminValidationSummary,
  normalizeAdminValidationFieldKey,
  processAdminFormSubmitError,
} from "@/lib/admin-form-validation";

describe("admin-form-validation", () => {
  it("normalizes JSON schema instance paths to form keys", () => {
    expect(normalizeAdminValidationFieldKey("/name")).toBe("name");
    expect(normalizeAdminValidationFieldKey("variants/0/sku")).toBe("sku");
    expect(normalizeAdminValidationFieldKey("variants/2/price")).toBe("price");
  });

  it("extracts validation fields from ApiError", () => {
    const error = new ApiError(
      "VALIDATION_ERROR",
      "Request validation failed",
      400,
      {
        fields: [
          { field: "name", rule: "minLength", message: "must NOT have fewer than 1 characters" },
          { field: "variants/0/sku", rule: "required", message: "must have required property 'sku'" },
        ],
      },
    );

    expect(extractAdminValidationFields(error)).toEqual([
      { field: "name", message: "must NOT have fewer than 1 characters", rule: "minLength" },
      { field: "sku", message: "must have required property 'sku'", rule: "required" },
    ]);
    expect(adminValidationFieldsToMap(extractAdminValidationFields(error))).toEqual({
      name: "must NOT have fewer than 1 characters",
      sku: "must have required property 'sku'",
    });
  });

  it("collects required field errors for client-side validation", () => {
    const errors = collectRequiredFieldErrors([
      { field: "name", label: "Name", isEmpty: () => true },
      { field: "slug", label: "Slug", isEmpty: () => false },
    ]);
    expect(errors).toEqual({ name: "Name is required." });
  });

  it("processes submit errors with field map for validation failures", () => {
    const error = new ApiError("VALIDATION_ERROR", "Request validation failed", 400, {
      fields: [{ field: "code", rule: "required", message: "Required" }],
    });
    const result = processAdminFormSubmitError(error);
    expect(result.message).toContain("highlighted fields");
    expect(result.message).toContain("Code: Required");
    expect(result.fieldErrors).toEqual({ code: "Required" });
  });

  it("builds a readable validation summary for multiple fields", () => {
    expect(
      formatAdminValidationSummary({
        categoryId: "Category is required.",
        slug: "URL slug is required.",
      }),
    ).toContain("Category");
    expect(
      formatAdminValidationSummary({
        categoryId: "Category is required.",
        slug: "URL slug is required.",
      }),
    ).toContain("URL slug");
  });
});
