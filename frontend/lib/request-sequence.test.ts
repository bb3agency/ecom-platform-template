import { describe, expect, it } from "vitest";
import { createRequestSequence } from "@/lib/request-sequence";

describe("createRequestSequence", () => {
  it("treats only the most recent ticket as current", () => {
    const seq = createRequestSequence();
    const first = seq.begin();
    const second = seq.begin();
    expect(seq.isLatest(first)).toBe(false);
    expect(seq.isLatest(second)).toBe(true);
  });

  it("drops an older response that resolves after a newer one", async () => {
    const seq = createRequestSequence();
    const shown: string[] = [];
    const load = async (label: string, delayMs: number) => {
      const ticket = seq.begin();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (seq.isLatest(ticket)) shown.push(label);
    };
    // Page 3 of the new filter is slow; page 1 (after the reset) is fast.
    await Promise.all([load("page-3", 30), load("page-1", 5)]);
    expect(shown).toEqual(["page-1"]);
  });

  it("keeps separate sequences independent", () => {
    const a = createRequestSequence();
    const b = createRequestSequence();
    const ticketA = a.begin();
    b.begin();
    b.begin();
    expect(a.isLatest(ticketA)).toBe(true);
  });
});
