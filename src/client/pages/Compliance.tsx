import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Link, useSearchParams } from "react-router";
import { formatDate } from "../../shared/format";
import { UnauthenticatedError } from "../api";
import { Page } from "../components/Page";
import { DataTable, Pagination, type Column } from "../components/ui";
import { fetchDueList, fetchPropertyNames, type DueItemRecord } from "../compliance-api";
import { useCanWrite } from "../me";
import { fetchPeople } from "../properties-api";
import { linkClass } from "./Owners";
import { ItemTypes } from "./ItemTypes";
import { DialogShell, MarkDoneForm, reloadedItem, SetDueForm, type Draft } from "./PropertyCompliance";

const tabClass = "min-h-6 cursor-pointer border-b-2 border-transparent px-4 py-1 aria-selected:border-slate-900 aria-selected:font-semibold";
const smallButton = "min-h-6 rounded border px-3 py-1";
const STATUS_CHOICES = ["Overdue", "Due soon", "Upcoming", "Not scheduled", "Not applicable", "Completed"] as const;
const DEFAULT_STATUSES: readonly string[] = STATUS_CHOICES.slice(0, 3);
const DUE_KEY = ["compliance-due"] as const;
const selectClass = "mt-1 block min-h-6 max-w-full rounded border px-3 py-1";

type Action = { kind: "done" | "due"; item: DueItemRecord; draft?: Draft };

function DueList() {
  const canWrite = useCanWrite();
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [statuses, setStatuses] = useState<readonly string[]>(DEFAULT_STATUSES);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState<Action | null>(null);
  const properties = useQuery({ queryKey: ["compliance-property-names"], queryFn: fetchPropertyNames });
  const people = useQuery({ queryKey: ["people"], queryFn: fetchPeople });
  const due = useQuery({
    queryKey: [...DUE_KEY, propertyId, responsibleUserId, statuses, page],
    queryFn: () => fetchDueList({ propertyId, responsibleUserId, statuses, page }),
    placeholderData: (previous) => previous,
    enabled: statuses.length > 0,
  });
  const signedOut = due.error instanceof UnauthenticatedError;
  useEffect(() => {
    if (signedOut) void queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [signedOut, queryClient]);
  /** After a version conflict: reopen the dialog on the latest version of the item, keeping what was typed. */
  async function restart(current: Action, draft: Draft) {
    const fresh = await reloadedItem<DueItemRecord>(queryClient, DUE_KEY, current.item.id);
    setAction(fresh ? { kind: current.kind, item: fresh, draft } : null);
  }
  const tableArea = useRef<HTMLDivElement>(null);
  const close = () => {
    setAction(null);
    // A saved item can leave the list (e.g. it becomes Not scheduled); keep keyboard users at the table instead of the page top.
    setTimeout(() => {
      if (document.activeElement === document.body || document.activeElement === null) tableArea.current?.querySelector<HTMLElement>("[role=region]")?.focus();
    }, 50);
  };
  const change = (set: (v: string) => void) => (e: { target: { value: string } }) => {
    set(e.target.value);
    setPage(1);
  };

  const columns: Column<DueItemRecord>[] = [
    {
      key: "property",
      header: "Property",
      cell: (i) => (
        <Link to={`/properties/${i.propertyId}`} className={linkClass}>
          {i.propertyName}
        </Link>
      ),
    },
    { key: "item", header: "Item", cell: (i) => i.type.name },
    { key: "due", header: "Due date", cell: (i) => (i.nextDueDate ? formatDate(i.nextDueDate) : "—") },
    { key: "status", header: "Status", cell: (i) => i.status },
    { key: "last", header: "Last completed", cell: (i) => (i.lastCompletedOn ? formatDate(i.lastCompletedOn) : "—") },
    { key: "responsible", header: "Responsible landlords", cell: (i) => i.responsible.map((r) => r.name).join(", ") || "—" },
    ...(canWrite
      ? [
          {
            key: "actions",
            header: "Actions",
            cell: (i: DueItemRecord) => (
              <div className="flex flex-wrap gap-2">
                <Button onPress={() => setAction({ kind: "done", item: i })} aria-label={`Mark done – ${i.type.name} – ${i.propertyName}`} className={smallButton}>
                  Mark done
                </Button>
                <Button onPress={() => setAction({ kind: "due", item: i })} aria-label={`Set due date – ${i.type.name} – ${i.propertyName}`} className={smallButton}>
                  Set due date
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="min-w-0 max-w-full">
          <label htmlFor="due-property" className="block">
            Property
          </label>
          <select id="due-property" value={propertyId} onChange={change(setPropertyId)} className={selectClass}>
            <option value="">All properties</option>
            {properties.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="due-landlord" className="block">
            Responsible landlord
          </label>
          <select id="due-landlord" value={responsibleUserId} onChange={change(setResponsibleUserId)} className={selectClass}>
            <option value="">All landlords</option>
            {people.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="flex flex-wrap gap-x-4">
          <legend>Status</legend>
          {STATUS_CHOICES.map((s) => (
            <label key={s} className="flex min-h-6 items-center gap-2">
              <input
                type="checkbox"
                checked={statuses.includes(s)}
                onChange={(e) => {
                  setStatuses(e.target.checked ? [...statuses, s] : statuses.filter((x) => x !== s));
                  setPage(1);
                }}
              />
              {s}
            </label>
          ))}
        </fieldset>
      </div>
      {due.isError && !signedOut && (
        <div>
          <p role="alert">{due.error.message}</p>
          <Button onPress={() => void due.refetch()} className={smallButton}>
            Try again
          </Button>
        </div>
      )}
      {due.isPending && statuses.length > 0 && <p role="status">Loading…</p>}
      <p role="status" className={statuses.length === 0 ? "" : "sr-only"}>
        {statuses.length === 0 ? "Choose at least one status." : ""}
      </p>
      {statuses.length > 0 && due.data && (
        <div ref={tableArea}>
          <DataTable name="Due list" columns={columns} rows={due.data.data} rowKey={(i) => i.id} emptyMessage="No compliance items match." />
          <Pagination page={due.data.page} pageSize={due.data.pageSize} total={due.data.total} onPageChange={setPage} />
        </div>
      )}
      {action?.kind === "done" && (
        <DialogShell title={`Mark done – ${action.item.type.name} – ${action.item.propertyName}`} onClose={close}>
          <MarkDoneForm key={`${action.item.id}-${action.item.version}`} refresh={DUE_KEY} item={action.item} draft={action.draft} onDone={close} onStale={(draft) => void restart(action, draft)} />
        </DialogShell>
      )}
      {action?.kind === "due" && (
        <DialogShell title={`Set due date – ${action.item.type.name} – ${action.item.propertyName}`} onClose={close}>
          <SetDueForm key={`${action.item.id}-${action.item.version}`} refresh={DUE_KEY} item={action.item} draft={action.draft} onDone={close} onStale={(draft) => void restart(action, draft)} />
        </DialogShell>
      )}
    </>
  );
}

/** Compliance (§11.18). */
export function Compliance() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab")?.toLowerCase() === "types" ? "types" : "due";
  return (
    <Page title="Compliance">
      <Tabs selectedKey={tab} onSelectionChange={(key) => setParams(key === "types" ? { tab: "types" } : {})}>
        <TabList aria-label="Compliance sections" className="mb-4 flex flex-wrap gap-2">
          <Tab id="due" className={tabClass}>
            Due list
          </Tab>
          <Tab id="types" className={tabClass}>
            Item types
          </Tab>
        </TabList>
        <TabPanel id="due">
          <DueList />
        </TabPanel>
        <TabPanel id="types">
          <ItemTypes />
        </TabPanel>
      </Tabs>
    </Page>
  );
}
