import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { UNEXPECTED_MESSAGE } from "../../shared/form-messages";
import { Page } from "../components/Page";
import { ConfirmDialog, DataTable, ReasonButton, type Column } from "../components/ui";
import { useCanWrite } from "../me";
import {
  deleteOwner, fetchOwner, ownerAction, OwnerInUseError, type OwnerAction, type OwnerRecord, type PropertyLink,
} from "../owners-api";
import { linkClass } from "./Owners";

const IN_USE_DELETE = "Owners used by properties or units can only be archived";

const propertyColumns: Column<PropertyLink>[] = [
  {
    key: "name",
    header: "Property",
    cell: (p) => (
      <Link to={`/properties/${p.id}`} className={linkClass}>
        {p.name}
      </Link>
    ),
  },
];

function Details({ owner }: { owner: OwnerRecord }) {
  const rows: [string, string | null][] = [
    ["Owner type", owner.ownerType],
    ["Mailing address line 1", owner.addressLine1],
    ["Mailing address line 2", owner.addressLine2],
    ["City", owner.city],
    ["State", owner.state],
    ["ZIP code", owner.zip],
    ["Email", owner.email],
    ["Phone", owner.phone],
    ["Signatory name", owner.signatoryName],
    ["Signatory title", owner.signatoryTitle],
    ["Notes", owner.notes],
  ];
  return (
    <dl className="mb-6 grid max-w-xl grid-cols-[max-content_1fr] gap-x-6 gap-y-1">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-semibold">{term}</dt>
          <dd>{value || "–"}</dd>
        </div>
      ))}
    </dl>
  );
}

function OwnerView({ owner }: { owner: OwnerRecord }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canWrite = useCanWrite();
  const flash = (useLocation().state as { saved?: string } | null)?.saved ?? "";
  const outcome = useRef<HTMLDivElement>(null);
  const [notice, setNotice] = useState(flash);
  const [problem, setProblem] = useState("");
  const [blocking, setBlocking] = useState<PropertyLink[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["owner"] });
    await queryClient.invalidateQueries({ queryKey: ["owners"] });
  };
  const run = async (action: OwnerAction) => {
    setNotice("");
    setProblem("");
    setBlocking([]);
    try {
      await ownerAction(action, owner);
      setNotice(action === "archive" ? "Owner archived." : "Owner restored.");
    } catch (err) {
      if (err instanceof OwnerInUseError) {
        setProblem(err.message);
        setBlocking(err.properties);
      } else setProblem(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
    }
    await refresh();
    outcome.current?.focus();
  };
  const remove = async () => {
    try {
      await deleteOwner(owner.id);
    } catch (err) {
      setNotice("");
      setProblem(err instanceof Error ? err.message : UNEXPECTED_MESSAGE);
      outcome.current?.focus();
      return;
    }
    await refresh();
    navigate("/owners", { state: { saved: "Owner deleted." } });
  };
  const inUse = owner.properties.length > 0 || owner.referenced === true;
  return (
    <Page title={owner.name}>
      <div ref={outcome} tabIndex={-1} className="outline-none">
        <p role="status" className={notice ? "mb-2 text-green-800" : "sr-only"}>
          {notice}
        </p>
        {problem && (
          <div role="alert" className="mb-2 text-red-700">
            <p>{problem}</p>
            {blocking.length > 0 && (
              <ul>
                {blocking.map((p) => (
                  <li key={p.id}>
                    <Link to={`/properties/${p.id}`} className={linkClass}>
                      {p.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {owner.archivedAt && <p className="mb-2">This owner is archived.</p>}
      <Details owner={owner} />
      <h2 className="mb-2 text-xl font-semibold">Properties</h2>
      <div className="mb-6">
        <DataTable name="Properties" columns={propertyColumns} rows={owner.properties} rowKey={(p) => p.id} emptyMessage="No properties use this owner." />
      </div>
      {canWrite && (
        <div className="flex flex-wrap gap-2">
          <Button onPress={() => navigate(`/owners/${owner.id}/edit`)} className="min-h-6 rounded border px-4 py-1">
            Edit owner
          </Button>
          {owner.archivedAt ? (
            <Button onPress={() => void run("restore")} className="min-h-6 rounded border px-4 py-1">
              Restore owner
            </Button>
          ) : (
            <Button onPress={() => void run("archive")} className="min-h-6 rounded border px-4 py-1">
              Archive owner
            </Button>
          )}
          <ReasonButton onPress={() => setConfirmingDelete(true)} unavailableReason={inUse ? IN_USE_DELETE : undefined}>
            Delete owner
          </ReasonButton>
        </div>
      )}
      <ConfirmDialog
        isOpen={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete ${owner.name}? This can't be undone.`}
        confirmLabel="Delete"
        onConfirm={() => void remove()}
      />
    </Page>
  );
}

export function OwnerDetail() {
  const { id } = useParams();
  const owner = useQuery({ queryKey: ["owner", id], queryFn: () => fetchOwner(id ?? ""), gcTime: 0 });
  if (owner.isPending) return <Page title="Owner details"><p role="status">Loading…</p></Page>;
  if (owner.isError) {
    return (
      <Page title="Owner details">
        <p role="alert" tabIndex={-1} autoFocus className="outline-none">
          {owner.error.message}
        </p>
      </Page>
    );
  }
  return <OwnerView owner={owner.data} />;
}
