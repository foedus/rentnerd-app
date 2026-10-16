import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { useNavigate } from "react-router";
import { formatDate } from "../../shared/format";
import { z } from "zod";
import { END_REASONS, endLeaseSchema, markMonthToMonthSchema } from "../../shared/schemas";
import { TooManyRequestsError } from "../api";
import { AppForm, MoneyFieldInput, SelectInput, TextFieldInput, useAppForm } from "../components/forms";
import { ConfirmDialog } from "../components/ui";
import { deleteLease, endLease, markMonthToMonth, type LeaseDetailRecord } from "../leases-api";
import { DialogShell } from "./PropertyCompliance";

const monthToMonthForm = markMonthToMonthSchema.omit({ version: true }).extend({ monthToMonthRentCents: z.number({ error: "Enter an amount." }).int().min(1, "Enter an amount above 0.").max(1_000_000_000_000, "Enter a smaller amount.") });
const endForm = endLeaseSchema.omit({ version: true });

function MonthToMonthDialog({ lease, onClose }: { lease: LeaseDetailRecord; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(monthToMonthForm, { monthToMonthRentCents: lease.lastRentCents } as never);
  return (
    <DialogShell title={`Mark this lease month-to-month after ${formatDate(lease.effectiveEndDate)}?`} onClose={onClose}>
      <AppForm
        form={form}
        thing="Lease"
        idPrefix="month-to-month-"
        submitLabel="Mark month-to-month"
        secondary={<Button onPress={onClose} className="min-h-6 rounded border px-4 py-1">Cancel</Button>}
        onReload={() => void queryClient.invalidateQueries({ queryKey: ["lease", lease.id] }).then(onClose)}
        save={async (values) => {
          await markMonthToMonth(lease.id, lease.version, values.monthToMonthRentCents);
          await queryClient.invalidateQueries();
          onClose();
        }}
      >
        <MoneyFieldInput name="monthToMonthRentCents" label="Month-to-month monthly rent" required />
      </AppForm>
    </DialogShell>
  );
}

function EndLeaseDialog({ lease, onClose }: { lease: LeaseDetailRecord; onClose: () => void }) {
  const queryClient = useQueryClient();
  const form = useAppForm(endForm, { moveOutDate: "", endReason: "" } as never);
  return (
    <DialogShell title="End lease" onClose={onClose}>
      <AppForm
        form={form}
        thing="Lease"
        idPrefix="end-lease-"
        submitLabel="End lease"
        secondary={<Button onPress={onClose} className="min-h-6 rounded border px-4 py-1">Cancel</Button>}
        onReload={() => void queryClient.invalidateQueries({ queryKey: ["lease", lease.id] }).then(onClose)}
        save={async (values) => {
          await endLease(lease.id, lease.version, values.moveOutDate, values.endReason);
          await queryClient.invalidateQueries();
          onClose();
        }}
      >
        <TextFieldInput name="moveOutDate" label="Move-out date" type="date" required />
        <SelectInput name="endReason" label="Reason" options={[...END_REASONS]} required />
      </AppForm>
    </DialogShell>
  );
}

/** Mark month-to-month, End lease and Delete lease with the visibility rules of §11.13. */
export function LeaseActions({ lease }: { lease: LeaseDetailRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<"mtm" | "end" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const open_ = (which: "mtm" | "end" | "delete") => {
    opener.current = document.activeElement as HTMLElement | null;
    setOpen(which);
  };
  const canMarkMonthToMonth = (lease.status === "active" || lease.status === "needs_decision") && !lease.monthToMonth;
  const canEnd = lease.status !== "ended" && lease.status !== "ended_superseded" && lease.status !== "upcoming";
  const close = () => {
    setOpen(null);
    // The opener may be gone after the action (e.g. End lease), so focus falls back to the first remaining action.
    requestAnimationFrame(() => {
      const back = opener.current;
      (back && back.isConnected ? back : group.current?.querySelector("button"))?.focus();
    });
  };
  const btn = "min-h-6 rounded border px-4 py-1";
  return (
    <>
      <div ref={group} className="contents">
        {canMarkMonthToMonth && <Button onPress={() => open_("mtm")} className={btn}>Mark month-to-month</Button>}
        {canEnd && <Button onPress={() => open_("end")} className={btn}>End lease</Button>}
        <Button onPress={() => open_("delete")} className={btn}>Delete lease</Button>
      </div>
      {error && <p role="alert" className="w-full text-red-700">{error}</p>}
      {open === "mtm" && <MonthToMonthDialog lease={lease} onClose={close} />}
      {open === "end" && <EndLeaseDialog lease={lease} onClose={close} />}
      <ConfirmDialog
        isOpen={open === "delete"}
        onOpenChange={(o) => !o && close()}
        title="Delete lease"
        confirmLabel="Delete lease"
        onConfirm={() => {
          setError(null);
          deleteLease(lease.id)
            .then(async () => {
              navigate(`/units/${lease.unitId}`);
              void queryClient.invalidateQueries();
            })
            .catch((err: unknown) => setError(err instanceof TooManyRequestsError ? err.message : "Something went wrong. Please try again."));
        }}
      >
        <p>Delete this lease, its extensions and all generated PDFs? This cannot be undone.</p>
      </ConfirmDialog>
    </>
  );
}
