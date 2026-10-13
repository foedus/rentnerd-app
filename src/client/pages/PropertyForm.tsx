import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useNavigate, useParams } from "react-router";
import { UNIT_USES, createPropertyWithUnitSchema } from "../../shared/schemas";
import {
  AppForm,
  CheckboxGroupInput,
  CheckboxInput,
  MoneyFieldInput,
  SelectInput,
  TextFieldInput,
  useAppForm,
  VersionConflictError,
} from "../components/forms";
import { Page } from "../components/Page";
import { fetchMe } from "../api";
import {
  fetchOwnerChoices,
  fetchPeople,
  fetchProperty,
  saveProperty,
  StalePropertyError,
  type PropertyRecord,
} from "../properties-api";
import { OwnerFields } from "./OwnerForm";

const blank = {
  name: "", street: "", city: "", state: "", zip: "", inNyc: true, bbl: "", yearBuilt: null, ownerId: "",
  responsibleUserIds: [] as string[], purchasePriceCents: null, purchaseDate: "", notes: "",
};

const initial = (p: PropertyRecord | undefined, me: string) =>
  p
    ? {
        name: p.name, street: p.street, city: p.city, state: p.state, zip: p.zip, inNyc: p.inNyc ?? true, bbl: p.bbl ?? "",
        yearBuilt: p.yearBuilt ?? null, ownerId: p.ownerId ?? p.owner?.id ?? "", responsibleUserIds: p.responsibleUserIds ?? p.responsible.map((r) => r.id),
        purchasePriceCents: p.purchasePriceCents ?? null, purchaseDate: p.purchaseDate ?? "", notes: p.notes ?? "",
      }
    : { ...blank, responsibleUserIds: [me] };

function requireVersion(p: PropertyRecord): number {
  if (typeof p.version !== "number") throw new Error("Something went wrong. Please try again.");
  return p.version;
}

function Fields({ property, me }: { property?: PropertyRecord; me: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const owners = useQuery({ queryKey: ["owner-choices"], queryFn: fetchOwnerChoices, gcTime: 0 });
  const people = useQuery({ queryKey: ["people"], queryFn: fetchPeople });
  const form = useAppForm(createPropertyWithUnitSchema, initial(property, me) as never);
  const [single, setSingle] = useState(false);
  const [addingOwner, setAddingOwner] = useState(false);
  const [newOwner, setNewOwner] = useState("");
  // Select the owner added in the dialog once the select has its option.
  useEffect(() => {
    if (newOwner && owners.data?.some((o) => o.id === newOwner)) {
      form.setValue("ownerId", newOwner, { shouldDirty: true });
      form.clearErrors("ownerId");
      setNewOwner("");
    }
  }, [newOwner, owners.data, form]);
  const cancel = () => navigate(property ? `/properties/${property.id}` : "/properties");
  // An archived current owner stays selectable so editing doesn't blank it.
  const ownerOptions = (owners.data ?? []).map((o) => ({ value: o.id, label: o.name }));
  if (property?.owner && !ownerOptions.some((o) => o.value === property.owner?.id)) ownerOptions.push({ value: property.owner.id, label: property.owner.name });
  if (owners.isPending || people.isPending) return <p role="status">Loading…</p>;
  if (owners.isError || people.isError) {
    return (
      <>
        <p role="alert">{(owners.error ?? people.error)?.message}</p>
        <Button
          onPress={() => {
            void owners.refetch();
            void people.refetch();
          }}
          className="mt-2 min-h-6 rounded border px-3 py-1"
        >
          Try again
        </Button>
      </>
    );
  }
  return (
    <>
      <AppForm
        form={form}
        thing="Property"
        submitLabel="Save property"
        secondary={
          <Button onPress={cancel} className="min-h-6 rounded border px-4 py-1">
            Cancel
          </Button>
        }
        onReload={() => void queryClient.invalidateQueries({ queryKey: ["property", property?.id] })}
        save={async (values) => {
          const { singleUnitUse, ...rest } = values as Record<string, unknown>;
          let saved: PropertyRecord;
          try {
            saved = await saveProperty(property ? rest : { ...rest, ...(single ? { singleUnitUse } : {}) }, property && { id: property.id, version: requireVersion(property) });
          } catch (err) {
            if (err instanceof StalePropertyError) throw new VersionConflictError();
            throw err;
          }
          await queryClient.invalidateQueries({ queryKey: ["properties"] });
          await queryClient.invalidateQueries({ queryKey: ["property"] });
          navigate(`/properties/${saved.id}`, { state: { saved: "Property saved." } });
        }}
      >
        <TextFieldInput name="name" label="Property name" required />
        <TextFieldInput name="street" label="Street address" required autoComplete="address-line1" />
        <TextFieldInput name="city" label="City" required autoComplete="address-level2" />
        <TextFieldInput name="state" label="State" required autoComplete="address-level1" hint="2-letter code, e.g. NY" />
        <TextFieldInput name="zip" label="ZIP code" required autoComplete="postal-code" />
        <CheckboxInput name="inNyc" label="Located in New York City" />
        <TextFieldInput name="bbl" label="Borough-Block-Lot (BBL)" hint="10 digits" />
        <TextFieldInput name="yearBuilt" label="Year built" numeric />
        <div>
          <SelectInput name="ownerId" label="Owner" required options={ownerOptions} />
          <Button onPress={() => setAddingOwner(true)} className="mt-1 min-h-6 rounded px-1 text-blue-800 underline">
            Add owner
          </Button>
        </div>
        <CheckboxGroupInput
          name="responsibleUserIds"
          legend="Responsible landlords"
          required
          choices={people.data.map((p) => ({ id: p.id, label: `${p.name} (${p.email})` }))}
        />
        <MoneyFieldInput name="purchasePriceCents" label="Purchase price" />
        <TextFieldInput name="purchaseDate" label="Purchase date" type="date" />
        <TextFieldInput name="notes" label="Notes" />
        {!property && (
          <>
            <CheckboxInput
              name="singleUnit"
              label="Single-unit property"
              onChange={(checked) => {
                setSingle(checked);
                form.setValue("singleUnitUse" as never, (checked ? "" : undefined) as never);
                form.clearErrors("singleUnitUse" as never);
              }}
            />
            {single && <SelectInput name="singleUnitUse" label="Use" required options={UNIT_USES} />}
          </>
        )}
      </AppForm>
      <ModalOverlay isOpen={addingOwner} onOpenChange={setAddingOwner} className="fixed inset-0 z-50 grid place-items-center bg-black/40">
        <Modal className="max-h-[90vh] w-full max-w-xl overflow-auto rounded bg-white p-6 shadow-lg">
          <Dialog aria-label="Add owner" className="space-y-4 outline-none">
            <Heading slot="title" className="text-lg font-semibold">
              Add owner
            </Heading>
            <OwnerFields
              idPrefix="owner-dialog-"
              onCancel={() => setAddingOwner(false)}
              onSaved={async (saved) => {
                await owners.refetch();
                setNewOwner(saved.id);
                setAddingOwner(false);
              }}
            />
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

/** /properties/new and /properties/:id/edit (§11.8). */
export function PropertyForm() {
  const { id } = useParams();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  const property = useQuery({ queryKey: ["property", id], queryFn: () => fetchProperty(id ?? ""), enabled: !!id, gcTime: 0 });
  const title = id ? "Edit property" : "Add property";
  return (
    <Page title={title}>
      <div className="max-w-xl">
        {(me.isPending || (id && property.isPending)) && <p role="status">Loading…</p>}
        {property.isError && <p role="alert">{property.error.message}</p>}
        {me.data && (!id || property.data) && <Fields key={property.data?.version ?? "new"} property={property.data} me={me.data.id} />}
      </div>
    </Page>
  );
}
