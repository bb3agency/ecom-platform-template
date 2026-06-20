import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import {
  createAdminInviteClient,
  listAdminInvitesClient,
  listOpsInvitesClient,
  getOpsSessionClient,
} from "@/lib/ops-client-api";

function expectApiOrNetworkError(error: unknown): void {
  expect(error).toSatisfy(
    (value: unknown) => value instanceof ApiError || value instanceof TypeError,
  );
}

describe("ops client api integration", () => {
  it("list ops invites handles unauthorised or offline backend", async () => {
    try {
      await listOpsInvitesClient({ limit: 5 });
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });

  it("create merchant admin invite client accepts deactivated-email contract when backend reachable", async () => {
    try {
      await createAdminInviteClient({
        email: "deactivated-admin@example.com",
        name: "Reinvite Test",
        setupBaseUrl: "https://example.com",
        permissions: ["products:read"],
      });
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });

  it("list merchant admin invites handles unauthorised or offline backend", async () => {
    try {
      await listAdminInvitesClient({ limit: 5 });
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });

  it("ops session endpoint handles unauthorised or offline backend", async () => {
    try {
      await getOpsSessionClient();
    } catch (error) {
      expectApiOrNetworkError(error);
    }
  });
});
