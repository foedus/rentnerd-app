import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { useWatch } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { TENANT_TYPES, createTenantSchema } from "../../shared/schemas";
import { AppForm, FormMessageError, RadioGroupInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { fetchTenant, saveTenant, StaleTenantError, type TenantRecord } from "../tenants-api";

const NOT_FOUND = "Tenant not found.";

const blank = { tenantType: "", firstName: "", lastName: "", businessName: "", contactPerson: "", email: "", phone: "", notes: "" };

const initial = (t?: TenantRecord) =>
  t
    ? {
        tenantType: t.tenantType, firstName: t.firstName ?? "", lastName: t.lastName ?? "", businessName: t.businessName ?? "",
        contactPerson: t.contactPerson ?? "", email: t.email ?? "", phone: t.phone ?? "", notes: t.notes ?? "",
      }
    : blank;

function TenantFields({ tenant }: { tenant?: TenantRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useAppForm(createTenantSchema, initial(tenant) as never);
  const type = useWatch({ control: form.control, name: "tenantType" }) as string;
  return (
    <AppForm
      form={form}
      thing="Tenant"
      submitLabel="Save tenant"
      secondary={
        <Button onPress={() => navigate(tenant ? `/tenants/${tenant.id}` : "/tenants")} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => void queryClient.invalidateQueries({ queryKey: ["tenant", tenant?.id] })}
      save={async (values) => {
        let saved: TenantRecord;
        try {
          saved = await saveTenant(values as Record<string, unknown>, tenant && { id: tenant.id, version: tenant.version });
        } catch (err) {
          if (err instanceof StaleTenantError) throw new VersionConflictError();
          if (err instanceof Error && err.message === NOT_FOUND) throw new FormMessageError(NOT_FOUND);
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["tenants"] });
        await queryClient.invalidateQueries({ queryKey: ["tenant"] });
        navigate(`/tenants/${saved.id}`, { state: { saved: "Tenant saved." } });
      }}
    >
      <RadioGroupInput name="tenantType" legend="Tenant type" options={TENANT_TYPES} required />
      {type === "Individual" && (
        <>
          <TextFieldInput name="firstName" label="First name" required autoComplete="off" />
          <TextFieldInput name="lastName" label="Last name" required autoComplete="off" />
        </>
      )}
      {type === "Business" && (
        <>
          <TextFieldInput name="businessName" label="Business name" required autoComplete="off" />
          <TextFieldInput name="contactPerson" label="Contact person" required autoComplete="off" />
        </>
      )}
      <TextFieldInput name="email" label="Email" type="email" autoComplete="off" />
      <TextFieldInput name="phone" label="Phone" type="tel" autoComplete="off" />
      <TextFieldInput name="notes" label="Notes" />
    </AppForm>
  );
}

/** /tenants/new and /tenants/:id/edit. */
export function TenantForm() {
  const { id } = useParams();
  const tenant = useQuery({ queryKey: ["tenant", id], queryFn: () => fetchTenant(id ?? ""), enabled: !!id, gcTime: 0 });
  if (!id) {
    return (
      <Page title="Add tenant">
        <div className="max-w-xl">
          <TenantFields />
        </div>
      </Page>
    );
  }
  return (
    <Page title="Edit tenant">
      <div className="max-w-xl">
        {tenant.isPending && <p role="status">Loading…</p>}
        {tenant.isError && <p role="alert">{tenant.error.message}</p>}
        {tenant.data && <TenantFields key={tenant.data.version} tenant={tenant.data} />}
      </div>
    </Page>
  );
}
