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
import { createOpsInviteClient } from "@/lib/ops-client-api";
import {
  defaultOrigin,
  fieldProps,
  operatorSchema,
  type InviteFormProps,
} from "@/components/ops/ops-invite-form-utils";

export function OpsOperatorInviteForm({ onCreated, onCancel }: InviteFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof operatorSchema>>({
    resolver: zodResolver(operatorSchema),
    defaultValues: { name: "", email: "", setupBaseUrl: defaultOrigin(), ipAllowlist: "" },
    mode: "onTouched",
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const result = await createOpsInviteClient({
        name: values.name.trim(),
        email: values.email.trim(),
        setupBaseUrl: new URL(values.setupBaseUrl).origin,
        ipAllowlist: (values.ipAllowlist ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      });
      onCreated(
        `Invite emailed to ${values.email.trim()}. The setup link expires ${new Date(result.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`,
      );
    } catch (err) {
      setSubmitError(getApiErrorMessageWithHint(err));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
      <SheetHeader>
        <SheetTitle>Invite an operator</SheetTitle>
        <SheetDescription>They get full ops access (view and change) once they accept. The link works for 10 minutes.</SheetDescription>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-4">
        <OpsField label="Name" htmlFor="invite-op-name" error={errors.name?.message}>
          <Input {...fieldProps("invite-op-name", errors.name?.message)} autoComplete="off" {...form.register("name")} />
        </OpsField>
        <OpsField label="Email" htmlFor="invite-op-email" error={errors.email?.message}>
          <Input {...fieldProps("invite-op-email", errors.email?.message)} type="email" inputMode="email" autoComplete="off" {...form.register("email")} />
        </OpsField>
        <OpsField
          label="Site address"
          htmlFor="invite-op-url"
          hint="Where the setup link points. Usually this site."
          error={errors.setupBaseUrl?.message}
        >
          <Input {...fieldProps("invite-op-url", errors.setupBaseUrl?.message)} inputMode="url" {...form.register("setupBaseUrl")} />
        </OpsField>
        <OpsField
          label="Allowed IP ranges"
          htmlFor="invite-op-ip"
          optional
          hint="Comma-separated CIDRs, e.g. 203.0.113.10/32. Leave empty to allow any network."
        >
          <Input id="invite-op-ip" className="font-mono" {...form.register("ipAllowlist")} />
        </OpsField>
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

