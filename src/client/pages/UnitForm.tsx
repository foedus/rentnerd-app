import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "react-aria-components";
import { useMatch, useNavigate, useParams } from "react-router";
import { UNIT_USES, createUnitSchema } from "../../shared/schemas";
import { AppForm, SelectInput, TextFieldInput, useAppForm, VersionConflictError } from "../components/forms";
import { NotFound } from "../components/Notices";
import { Page } from "../components/Page";
import {
  fetchOwnerChoices,
  fetchProperty,
  fetchUnit,
  saveUnit,
  StaleUnitError,
  UnitNotFoundError,
  PropertyNotFoundError,
  type UnitRecord,
} from "../properties-api";

export const USE_LOCKED_HINT = "Use can't be changed. To change it, archive this unit and add a new one.";

const initial = (u: UnitRecord | undefined) => ({
  label: u?.label ?? "",
  use: u?.use ?? "",
  bedrooms: u?.bedrooms ?? null,
  bathrooms: u?.bathrooms ?? null,
  squareFeet: u?.squareFeet ?? null,
  ownerOverrideId: u?.ownerOverrideId ?? "",
  notes: u?.notes ?? "",
});

function Fields({ propertyId, unit }: { propertyId: string; unit?: UnitRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const owners = useQuery({ queryKey: ["owner-choices"], queryFn: fetchOwnerChoices, gcTime: 0 });
  const form = useAppForm(createUnitSchema, initial(unit) as never);
  const cancel = () => navigate(unit ? `/units/${unit.id}` : `/properties/${propertyId}`);
  // An archived current override stays selectable so editing doesn't blank it.
  const ownerOptions = (owners.data ?? []).map((o) => ({ value: o.id, label: o.name }));
  const current = unit?.ownerOverrideId ? unit.owner : null;
  if (current && !ownerOptions.some((o) => o.value === current.id)) ownerOptions.push({ value: current.id, label: current.name });
  if (owners.isPending) return <p role="status">Loading…</p>;
  if (owners.isError) {
    return (
      <>
        <p role="alert">{owners.error.message}</p>
        <Button onPress={() => void owners.refetch()} className="mt-2 min-h-6 rounded border px-3 py-1">
          Try again
        </Button>
      </>
    );
  }
  return (
    <AppForm
      form={form}
      thing="Unit"
      submitLabel="Save unit"
      secondary={
        <Button onPress={cancel} className="min-h-6 rounded border px-4 py-1">
          Cancel
        </Button>
      }
      onReload={() => void queryClient.invalidateQueries({ queryKey: ["unit", unit?.id] })}
      save={async (values) => {
        const { use, ...rest } = values as Record<string, unknown>;
        let saved: UnitRecord;
        try {
          if (unit) {
            if (typeof unit.version !== "number") throw new Error("missing version");
            saved = await saveUnit(rest, { id: unit.id, version: unit.version });
          } else saved = await saveUnit({ ...rest, use }, { propertyId });
        } catch (err) {
          if (err instanceof StaleUnitError) throw new VersionConflictError();
          throw err;
        }
        await queryClient.invalidateQueries({ queryKey: ["unit"] });
        await queryClient.invalidateQueries({ queryKey: ["property-units"] });
        await queryClient.invalidateQueries({ queryKey: ["properties"] });
        await queryClient.invalidateQueries({ queryKey: ["property"] });
        navigate(`/units/${saved.id}`, { state: { saved: "Unit saved." } });
      }}
    >
      <TextFieldInput name="label" label="Unit label" required />
      {unit ? (
        <div role="group" aria-labelledby="unit-use-label" aria-describedby="unit-use-hint">
          <p id="unit-use-label" className="block">Use</p>
          <p className="font-semibold">{unit.use}</p>
          <p id="unit-use-hint" className="text-sm text-slate-700">{USE_LOCKED_HINT}</p>
        </div>
      ) : (
        <SelectInput name="use" label="Use" required options={UNIT_USES} />
      )}
      <TextFieldInput name="bedrooms" label="Bedrooms" numeric />
      <TextFieldInput name="bathrooms" label="Bathrooms" numeric decimal />
      <TextFieldInput name="squareFeet" label="Square feet" numeric />
      <SelectInput name="ownerOverrideId" label="Owner (if different from property)" options={ownerOptions} />
      <TextFieldInput name="notes" label="Notes" />
    </AppForm>
  );
}

/** /properties/:id/units/new and /units/:id/edit (§11.10). */
export function UnitForm() {
  const { id: paramId } = useParams();
  const editing = useMatch("/units/:id/edit") !== null;
  const unitId = editing ? paramId : undefined;
  const unit = useQuery({ queryKey: ["unit", unitId], queryFn: () => fetchUnit(unitId ?? ""), enabled: !!unitId, gcTime: 0 });
  const property = useQuery({ queryKey: ["property", paramId], queryFn: () => fetchProperty(paramId ?? ""), enabled: !editing, gcTime: 0 });
  const error = unit.error ?? property.error;
  if (error instanceof UnitNotFoundError || error instanceof PropertyNotFoundError) return <NotFound />;
  const title = editing ? "Edit unit" : "Add unit";
  const propertyId = editing ? unit.data?.propertyId : property.data?.id;
  return (
    <Page title={title}>
      <div className="max-w-xl">
        {(editing ? unit.isPending : property.isPending) && <p role="status">Loading…</p>}
        {error && <p role="alert">{error.message}</p>}
        {propertyId && (!editing || unit.data) && <Fields key={unit.data?.version ?? "new"} propertyId={propertyId} unit={unit.data} />}
      </div>
    </Page>
  );
}
