import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "./toast";
import { useToastStore } from "@/stores/toast";

// Exercises the toast store through the public `toast` helper API (the surface components use).
describe("toast helper + store", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.getState().clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a success toast and auto-dismisses after ~3s", () => {
    const id = toast.success("Saved");
    expect(id).not.toBe("");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({ variant: "success", message: "Saved" });

    vi.advanceTimersByTime(3000);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("maps error/info/warning to the right variants", () => {
    toast.error("E");
    toast.info("I");
    toast.warning("W");
    const variants = useToastStore.getState().toasts.map((t) => t.variant);
    expect(variants).toEqual(["error", "info", "warning"]);
  });

  it("ignores blank messages", () => {
    expect(toast.success("   ")).toBe("");
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("collapses a duplicate identical message instead of stacking", () => {
    toast.error("Boom");
    toast.error("Boom");
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("caps visible toasts at 4, dropping the oldest", () => {
    for (let i = 0; i < 6; i++) toast.info(`m${i}`);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4);
    expect(toasts[0].message).toBe("m2");
    expect(toasts[3].message).toBe("m5");
  });

  it("respects a custom duration", () => {
    toast.success("Quick", { duration: 1000 });
    vi.advanceTimersByTime(999);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
