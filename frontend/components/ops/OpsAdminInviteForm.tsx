"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { z } from "zod";
import { OpsField } from "@/components/ops/ui/ops-ui";
import { Notice } from "@/components/ui/console";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetBody, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getApiErrorMessageWithHint } from "@/lib/error-messages";
import { ADMIN_PERMISSIONS } from "@/lib/permissions";
import { createAdminInviteClient } from "@/lib/ops-client-api";
import {
  baseSchema,
  defaultOrigin,
  fieldProps,
  type InviteFormProps,
} from "@/components/ops/ops-invite-form-utils";

const ALL_ADMIN_PERMISSIONS: string[] = Object.values(ADMIN_PERMISSIONS);
const READ_ONLY_PERMISSIONS = ALL_ADMIN_PERMISSIONS.filter((p) => p.endsWith(":read"));
const DEFAULT_PERMISSIONS = [
  ADMIN_PERMISSIONS.productsRead,
  ADMIN_PERMISSIONS.ordersRead,
  ADMIN_PERMISSIONS.inventoryRead,
  ADMIN_PERMISSIONS.settingsRead,
  ADMIN_PERMISSIONS.analyticsRead,
];

/** "orders:read" → area "orders", action "read". Grouped so the form reads as a matrix, not 25 loose boxes. */
const PERMISSION_GROUPS: Array<{ area: string; permissions: string[] }> = (() => {
  const groups = new Map<string, string[]>();
  for (const permission of ALL_ADMIN_PERMISSIONS) {
    const area = permission.split(":")[0] ?? permission;
    groups.set(area, [...(groups.get(area) ?? []), permission]);
  }
  return [...groups.entries()].map(([area, permissions]) => ({ area, permissions }));
})();

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function OpsAdminInviteForm({ onCreated, onCancel }: InviteFormProps) {
  const [permissions, setPermissions] = useState<string[]>(DEFAULT_PERMISSIONS);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof baseSchema>>({
    resolver: zodResolver(baseSchema),
    defaultValues: { name: "", email: "", setupBaseUrl: defaultOrigin() },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  function toggle(permission: string) {
    setPermissions((prev) => (prev.includes(permission) ? prev.filter((p) => p !== permission) : [...prev, permission]));
  }

  const onSubmit = form.handleSubmit(async (values) => {
    if (permissions.length === 0) {
      setSubmitError("Pick at least one permission.");
      return;
    }
    setSubmitError(null);
    try {
      const result = await createAdminInviteClient({
        name: values.name.trim(),
        email: values.email.trim(),
        setupBaseUrl: new URL(values.setupBaseUrl).origin,
        permissions,
      });
      onCreated(
        `Invite emailed to ${values.email.trim()} with ${result.permissions.length} permissions. The setup link expires ${new Date(result.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`,
      );
    } catch (err) {
      setSubmitError(getApiErrorMessageWithHint(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>Invite a merchant admin</SheetTitle>
        <SheetDescription>
          They set up their account at /admin/setup. Re-inviting a deactivated admin restores the same account.
        </SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-4">
        <OpsField label="Name" htmlFor="invite-admin-name" error={errors.name?.message}>
          <Input {...fieldProps("invite-admin-name", errors.name?.message)} autoComplete="off" {...form.register("name")} />
        </OpsField>
        <OpsField label="Email" htmlFor="invite-admin-email" error={errors.email?.message}>
          <Input {...fieldProps("invite-admin-email", errors.email?.message)} type="email" inputMode="email" autoComplete="off" {...form.register("email")} />
        </OpsField>
        <OpsField
          label="Site address"
          htmlFor="invite-admin-url"
          hint="Where the setup link points. Usually this site."
          error={errors.setupBaseUrl?.message}
        >
          <Input {...fieldProps("invite-admin-url", errors.setupBaseUrl?.message)} inputMode="url" {...form.register("setupBaseUrl")} />
        </OpsField>

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="text-sm font-medium text-foreground">Permissions</legend>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-muted-foreground tabular">{permissions.length} selected</span>
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setPermissions(READ_ONLY_PERMISSIONS)}>
              View only
            </Button>
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setPermissions(ALL_ADMIN_PERMISSIONS)}>
              Everything
            </Button>
            <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={() => setPermissions([])}>
              None
            </Button>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.area} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                <p className="w-28 shrink-0 text-sm font-medium text-foreground">{capitalize(group.area)}</p>
                <div className="flex min-w-0 flex-wrap gap-x-4 gap-y-1">
                  {group.permissions.map((permission) => {
                    const action = permission.split(":")[1] ?? permission;
                    return (
                      <label key={permission} className="flex min-h-9 cursor-pointer items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={permissions.includes(permission)}
                          onChange={() => toggle(permission)}
                          className="size-4 accent-primary"
                          aria-label={`${capitalize(group.area)}: ${action}`}
                        />
                        {capitalize(action)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        {submitError ? <Notice tone="danger">{submitError}</Notice> : null}
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          Send invite
        </Button>
      </SheetFooter>
    </form>
  );
}
