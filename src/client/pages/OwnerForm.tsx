import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { useNavigate, useParams } from "react-router";
import { OWNER_TYPES, createOwnerSchema } from "../../shared/schemas";
import { AppForm, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { Page } from "../components/Page";
import { fetchOwner, saveOwner, StaleOwnerError, type OwnerRecord } from "../owners-api";

const blank = {
  name: "", ownerType: "", addressLine1: "", addressLine2: "", city: "", state: "", zip: "",
  email: "", phone: "", signatoryName: "", signatoryTitle: "", notes: "",
};

const initial = (o?: OwnerRecord) =>
  o
    ? {
        name: o.name, ownerType: o.ownerType, addressLine1: o.addressLine1, addressLine2: o.addressLine2 ?? "", city: o.city,
        state: o.state, zip: o.zip, email: o.email ?? "", phone: o.phone ?? "", signatoryName: o.signatoryName ?? "",
        signatoryTitle: o.signatoryTitle ?? "", notes: o.notes ?? "",
      }
    : blank;

function Fields({ owner }: { owner?: OwnerRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const form = useAppForm(createOwnerSchema, initial(owner) as never);
  const cancel = () => navigate(owner ? `/owners/${owner.id}` : "/owners");
  return (
    <AppForm
      form={form}
      thing="Owner"
      submitLabel="Save owner"
      secondary={
        <Button onPress={cancel} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => void queryClient.invalidateQueries({ queryKey: ["owner", owner?.id] })}
      save={async (values) => {
        let saved: OwnerRecord;
        try {
          saved = await saveOwner(values, owner && { id: owner.id, version: owner.version });
        } catch (err) {
          if (err instanceof StaleOwnerError) throw new VersionConflictError();
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["owners"] });
        await queryClient.invalidateQueries({ queryKey: ["owner"] });
        navigate(`/owners/${saved.id}`, { state: { saved: "Owner saved." } });
      }}
    >
      <TextFieldInput name="name" label="Owner name" required />
      <SelectInput name="ownerType" label="Owner type" options={OWNER_TYPES} required />
      <TextFieldInput name="addressLine1" label="Mailing address line 1" required autoComplete="address-line1" />
      <TextFieldInput name="addressLine2" label="Mailing address line 2" autoComplete="address-line2" />
      <TextFieldInput name="city" label="City" required autoComplete="address-level2" />
      <TextFieldInput name="state" label="State" required autoComplete="address-level1" hint="2-letter code, e.g. NY" />
      <TextFieldInput name="zip" label="ZIP code" required autoComplete="postal-code" />
      <TextFieldInput name="email" label="Email" type="email" autoComplete="off" />
      <TextFieldInput name="phone" label="Phone" type="tel" autoComplete="off" />
      <TextFieldInput name="signatoryName" label="Signatory name" hint="Printed on leases" />
      <TextFieldInput name="signatoryTitle" label="Signatory title" hint="e.g. Managing Member" />
      <TextFieldInput name="notes" label="Notes" />
    </AppForm>
  );
}

/** /owners/new and /owners/:id/edit. */
export function OwnerForm() {
  const { id } = useParams();
  const owner = useQuery({ queryKey: ["owner", id], queryFn: () => fetchOwner(id ?? ""), enabled: !!id, gcTime: 0 });
  if (!id) {
    return (
      <Page title="Add owner">
        <div className="max-w-xl">
          <Fields />
        </div>
      </Page>
    );
  }
  return (
    <Page title="Edit owner">
      <div className="max-w-xl">
        {owner.isPending && <p role="status">Loading…</p>}
        {owner.isError && <p role="alert">{owner.error.message}</p>}
        {owner.data && <Fields key={owner.data.version} owner={owner.data} />}
      </div>
    </Page>
  );
}
