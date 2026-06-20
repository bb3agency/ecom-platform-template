export interface ReviewAuthorDisplay {
  firstName: string;
  lastName: string;
}

/** Clamp API rating to 1–5 for star rendering. */
export function clampReviewRating(rating: number): number {
  if (!Number.isFinite(rating)) return 0;
  return Math.min(5, Math.max(0, Math.round(rating)));
}

/** Privacy-friendly display name for public review cards. */
export function formatReviewerName(author: ReviewAuthorDisplay): string {
  const first = author.firstName?.trim() ?? "";
  const lastInitial = author.lastName?.trim().charAt(0);
  if (first && lastInitial) {
    return `${first} ${lastInitial}.`;
  }
  return first || "Verified customer";
}

export function formatReviewerInitials(author: ReviewAuthorDisplay): string {
  const name = formatReviewerName(author);
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function formatReviewDate(
  iso: string,
  locale = "en-IN",
): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(locale, {
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}
