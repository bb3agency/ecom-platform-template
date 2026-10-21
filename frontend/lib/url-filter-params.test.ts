import { describe, expect, it } from "vitest";

import { readFilterParam, writeFilterParam } from "./url-filter-params";

describe("readFilterParam", () => {
  it("reads a present value", () => {
    expect(readFilterParam("?status=CONFIRMED", "status", "")).toBe("CONFIRMED");
  });

  it("falls back when missing or empty", () => {
    expect(readFilterParam("", "status", "all")).toBe("all");
    expect(readFilterParam("?status=", "status", "all")).toBe("all");
  });

  it("rejects values outside the allow-list (no arbitrary input reaches the API)", () => {
    expect(readFilterParam("?status=DROP_TABLE", "status", "", ["CONFIRMED", "DELIVERED"])).toBe("");
    expect(readFilterParam("?status=DELIVERED", "status", "", ["CONFIRMED", "DELIVERED"])).toBe("DELIVERED");
  });
});

describe("writeFilterParam", () => {
  const base = "http://localhost:3101/admin/orders?page=2#top";

  it("sets a value and keeps other params and the hash", () => {
    expect(writeFilterParam(base, "status", "CONFIRMED", "")).toBe("/admin/orders?page=2&status=CONFIRMED#top");
  });

  it("drops the param when it equals the default", () => {
    expect(writeFilterParam("http://x/admin/orders?status=CONFIRMED", "status", "", "")).toBe("/admin/orders");
    expect(writeFilterParam("http://x/admin/orders?sort=newest", "sort", "newest", "newest")).toBe("/admin/orders");
  });
});
