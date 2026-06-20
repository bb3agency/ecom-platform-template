import { describe, expect, it } from "vitest";
import {
  clampReviewRating,
  formatReviewDate,
  formatReviewerInitials,
  formatReviewerName,
} from "@/lib/review-display";

describe("review-display", () => {
  it("formats privacy-friendly reviewer names", () => {
    expect(
      formatReviewerName({ firstName: "Priya", lastName: "Reddy" }),
    ).toBe("Priya R.");
    expect(formatReviewerName({ firstName: "Priya", lastName: "" })).toBe(
      "Priya",
    );
    expect(formatReviewerName({ firstName: "", lastName: "" })).toBe(
      "Verified customer",
    );
  });

  it("builds initials from display name", () => {
    expect(
      formatReviewerInitials({ firstName: "Priya", lastName: "Reddy" }),
    ).toBe("PR");
  });

  it("clamps ratings for star UI", () => {
    expect(clampReviewRating(6)).toBe(5);
    expect(clampReviewRating(0)).toBe(0);
    expect(clampReviewRating(4.6)).toBe(5);
  });

  it("formats review dates", () => {
    expect(formatReviewDate("2026-05-01T00:00:00.000Z")).toMatch(/2026/);
    expect(formatReviewDate("")).toBe("");
  });
});
