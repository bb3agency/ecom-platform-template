import { describe, expect, it, vi } from "vitest";
import { createMutationGate } from "@/lib/mutation-gate";

describe("createMutationGate", () => {
  it("runs only the first of two same-tick submits (double-click on Add note)", async () => {
    const gate = createMutationGate();
    const request = vi.fn(async () => "created");
    const [first, second] = await Promise.all([
      gate.run("note", request),
      gate.run("note", request),
    ]);
    expect(request).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ ok: true, value: "created" });
    expect(second).toEqual({ ok: false, reason: "busy" });
  });

  it("blocks a different action while one is in flight", async () => {
    const gate = createMutationGate();
    let release: () => void = () => undefined;
    const pending = gate.run("ban", () => new Promise<void>((resolve) => { release = resolve; }));
    const unban = vi.fn(async () => undefined);
    expect(await gate.run("unban", unban)).toEqual({ ok: false, reason: "busy" });
    expect(unban).not.toHaveBeenCalled();
    release();
    await pending;
  });

  it("frees the gate after a failure and reports the error", async () => {
    const gate = createMutationGate();
    const boom = new Error("429");
    const result = await gate.run("note", async () => { throw boom; });
    expect(result).toEqual({ ok: false, reason: "error", error: boom });
    expect(gate.active).toBeNull();
    expect((await gate.run("note", async () => 1)).ok).toBe(true);
  });

  it("notifies busy-state changes so the UI can disable its controls", async () => {
    const changes: Array<string | null> = [];
    const gate = createMutationGate((active) => changes.push(active));
    await gate.run("unban", async () => undefined);
    expect(changes).toEqual(["unban", null]);
  });
});
