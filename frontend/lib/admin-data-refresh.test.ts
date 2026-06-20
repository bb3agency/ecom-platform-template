import { describe, expect, it, vi } from "vitest";
import {
  notifyAdminDataChanged,
  subscribeAdminDataRefresh,
} from "@/lib/admin-data-refresh";

describe("admin-data-refresh", () => {
  it("notifies listeners for a scope", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAdminDataRefresh("products", listener);

    notifyAdminDataChanged("products");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    notifyAdminDataChanged("products");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies multi-scope subscribers once per listener", () => {
    const listener = vi.fn();
    subscribeAdminDataRefresh(["products", "inventory"], listener);

    notifyAdminDataChanged(["products", "inventory"]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
