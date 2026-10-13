import { useQueryClient } from "@tanstack/react-query";
import { FormMessageError, TextFieldInput, AppForm, useAppForm } from "../components/forms";
import { changePassword, updateMyName, WrongCurrentPasswordError, type Me } from "../api";
import { Page } from "../components/Page";
import { changePasswordSchema, updateMeSchema } from "../../shared/schemas";

function Profile({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const form = useAppForm(updateMeSchema, { name: me.name });
  return (
    <section aria-labelledby="profile-heading" className="max-w-sm space-y-4">
      <h2 id="profile-heading" className="text-xl font-semibold">Profile</h2>
      <AppForm
        form={form}
        thing="Name"
        submitLabel="Save name"
        save={async ({ name }) => {
          const saved = await updateMyName(name);
          queryClient.setQueryData(["me"], saved);
          form.reset({ name: saved.name });
        }}
      >
        <TextFieldInput name="name" label="Name" required autoComplete="name" />
        <p>
          Email: <span>{me.email}</span>
        </p>
      </AppForm>
    </section>
  );
}

const emptyPasswords = { currentPassword: "", newPassword: "", confirmPassword: "" };

function ChangePassword() {
  const form = useAppForm(changePasswordSchema, emptyPasswords);
  return (
    <section aria-labelledby="password-heading" className="max-w-sm space-y-4">
      <h2 id="password-heading" className="text-xl font-semibold">Change password</h2>
      <AppForm
        form={form}
        thing="Password"
        successMessage="Password changed."
        submitLabel="Change password"
        save={async ({ currentPassword, newPassword }) => {
          try {
            await changePassword(currentPassword, newPassword);
          } catch (err) {
            if (err instanceof WrongCurrentPasswordError) throw new FormMessageError(err.message);
            throw err;
          }
          form.reset(emptyPasswords);
        }}
      >
        <TextFieldInput name="currentPassword" label="Current password" required type="password" autoComplete="current-password" />
        <TextFieldInput name="newPassword" label="New password" required type="password" autoComplete="new-password" />
        <TextFieldInput name="confirmPassword" label="Confirm new password" required type="password" autoComplete="new-password" />
      </AppForm>
    </section>
  );
}

export function Account({ me }: { me: Me }) {
  return (
    <Page title="Account settings">
      {me.role === "smoke" ? (
        <section aria-labelledby="profile-heading" className="space-y-2">
          <h2 id="profile-heading" className="text-xl font-semibold">Profile</h2>
          <p>Name: {me.name}</p>
          <p>Email: {me.email}</p>
        </section>
      ) : (
        <div className="space-y-8">
          <Profile me={me} />
          <ChangePassword />
        </div>
      )}
    </Page>
  );
}
