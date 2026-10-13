import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  Button,
  Dialog,
  Heading,
  Modal,
  ModalOverlay,
} from "react-aria-components";
import {
  FormProvider,
  type UseFormReturn,
  type FieldValues,
} from "react-hook-form";
import {
  DuplicateUserError,
  FieldErrorsError,
  fetchUsers,
  inviteLandlord,
  userAction,
} from "../api";
import { TooManyRequestsError } from "../api";
import { ErrorSummary, useAppForm, TextFieldInput } from "../components/forms";
import { Page } from "../components/Page";
import {
  ConfirmDialog,
  DataTable,
  Pagination,
  type Column,
} from "../components/ui";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { formatDateTime } from "../../shared/format";
import { inviteLandlordSchema } from "../../shared/schemas";
import {
  roleLabel,
  rowActions,
  userStatusLabel,
  type RowAction,
  type UserRow,
} from "../../shared/users";

const ACTION_LABELS: Record<RowAction, string> = {
  resend: "Resend invitation",
  revoke: "Revoke invitation",
  deactivate: "Deactivate",
  reactivate: "Reactivate",
};
const DONE_MESSAGES: Record<RowAction, string> = {
  resend: "Invitation sent.",
  revoke: "Invitation revoked.",
  deactivate: "User deactivated.",
  reactivate: "User reactivated.",
};

const deactivateText = (name: string) =>
  `Deactivate ${name}? They will be signed out and can't sign in. They'll be removed as a responsible landlord; properties left with no responsible landlord will be assigned to you.`;

function buildColumns(
  onAction: (action: RowAction, u: UserRow) => void,
): Column<UserRow>[] {
  return [
    { key: "name", header: "Name", cell: (u) => u.name },
    { key: "email", header: "Email", cell: (u) => u.email },
    { key: "role", header: "Role", cell: (u) => roleLabel(u.role) },
    { key: "status", header: "Status", cell: (u) => userStatusLabel(u) },
    {
      key: "last",
      header: "Last sign-in",
      cell: (u) => (u.lastSignInAt ? formatDateTime(u.lastSignInAt) : "Never"),
    },
    {
      key: "actions",
      header: "Actions",
      cell: (u) => (
        <div className="flex flex-wrap gap-2">
          {rowActions(u).map((a) => (
            <Button
              key={a}
              onPress={() => onAction(a, u)}
              className="min-h-6 rounded border px-3 py-1"
            >
              {ACTION_LABELS[a]}
            </Button>
          ))}
        </div>
      ),
    },
  ];
}

function InviteDialog({
  isOpen,
  onOpenChange,
  onInvited,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const form = useAppForm(inviteLandlordSchema, { name: "", email: "" });
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = form.handleSubmit(async ({ name, email }) => {
    setBusy(true);
    setFailure("");
    try {
      await inviteLandlord(name, email);
      form.reset();
      onOpenChange(false);
      onInvited();
    } catch (err) {
      if (err instanceof DuplicateUserError) {
        form.setError("email", { message: err.message });
      } else if (err instanceof FieldErrorsError) {
        for (const [field, message] of Object.entries(err.fields)) {
          if (field === "name" || field === "email")
            form.setError(field, { message });
        }
      } else
        setFailure(
          err instanceof TooManyRequestsError
            ? err.message
            : UNEXPECTED_MESSAGE,
        );
    } finally {
      setBusy(false);
    }
  });
  const changeOpen = (open: boolean) => {
    if (!open) {
      form.reset();
      setFailure("");
    }
    onOpenChange(open);
  };
  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={changeOpen}
      isDismissable
      className="fixed inset-0 z-50 grid place-items-center bg-black/40"
    >
      <Modal className="w-full max-w-md rounded bg-white p-6 shadow-lg">
        <Dialog className="space-y-4 outline-none">
          <Heading slot="title" className="text-lg font-semibold">
            Invite landlord
          </Heading>
          <FormProvider {...(form as unknown as UseFormReturn<FieldValues>)}>
            <form
              noValidate
              onSubmit={(e) => void submit(e)}
              className="space-y-4"
            >
              <ErrorSummary />
              <TextFieldInput
                name="name"
                label="Name"
                required
                autoComplete="off"
              />
              <TextFieldInput
                name="email"
                label="Email"
                required
                type="email"
                autoComplete="off"
              />
              {failure && (
                <p role="alert" className="text-red-700">
                  {failure}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  onPress={() => changeOpen(false)}
                  className="min-h-6 rounded border px-4 py-1"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  isDisabled={busy}
                  className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white"
                >
                  Send invitation
                </Button>
              </div>
            </form>
          </FormProvider>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function Users() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [inviting, setInviting] = useState(false);
  const [confirming, setConfirming] = useState<UserRow | null>(null);
  const outcome = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const users = useQuery({
    queryKey: ["users", page],
    queryFn: () => fetchUsers(page),
  });
  const run = async (action: RowAction, u: UserRow) => {
    setNotice("");
    setProblem("");
    try {
      await userAction(
        action,
        action === "resend" || action === "revoke"
          ? (u.invitation?.id ?? "")
          : u.id,
      );
      setNotice(DONE_MESSAGES[action]);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
    }
    await queryClient.invalidateQueries({ queryKey: ["users"] });
    // The clicked button may be gone (Deactivate becomes Reactivate), so keep keyboard focus on the outcome message.
    outcome.current?.focus();
  };
  const onAction = (action: RowAction, u: UserRow) =>
    action === "deactivate" ? setConfirming(u) : void run(action, u);
  const columns = buildColumns(onAction);
  return (
    <Page title="Users">
      <div className="mb-4">
        <Button
          onPress={() => setInviting(true)}
          className="min-h-6 rounded bg-slate-900 px-4 py-1 text-white"
        >
          Invite landlord
        </Button>
      </div>
      <div ref={outcome} tabIndex={-1} className="outline-none">
        <p role="status" className={notice ? "mb-2" : "sr-only"}>
          {notice}
        </p>
        {problem && (
          <p role="alert" className="mb-2 text-red-700">
            {problem}
          </p>
        )}
      </div>
      {users.isPending && <p role="status">Loading…</p>}
      {users.isError && (
        <p role="alert">
          {users.error instanceof Error
            ? users.error.message
            : UNEXPECTED_MESSAGE}
        </p>
      )}
      {users.data && (
        <>
          <DataTable
            name="Users"
            columns={columns}
            rows={users.data.data}
            rowKey={(u) => u.id}
            emptyMessage="No users yet."
          />
          <Pagination
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onPageChange={setPage}
          />
        </>
      )}
      <ConfirmDialog
        isOpen={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming ? deactivateText(confirming.name) : ""}
        confirmLabel="Deactivate"
        onConfirm={() => confirming && void run("deactivate", confirming)}
      />
      <InviteDialog
        isOpen={inviting}
        onOpenChange={setInviting}
        onInvited={() =>
          void queryClient.invalidateQueries({ queryKey: ["users"] })
        }
      />
    </Page>
  );
}
