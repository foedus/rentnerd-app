import { TOO_MANY, TooManyRequestsError, UnauthenticatedError } from "./api";
import type { Stats } from "../shared/stats";

interface LeaseRowBase {
  leaseId: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitLabel: string;
  tenants: string[];
  currentRentCents: number;
}

export interface DashboardRecord {
  asOf: string;
  summary: Stats & { yieldNote: string };
  byProperty: (Stats & {
    propertyId: string;
    name: string;
    propertyType: string;
  })[];
  leasesNeedingDecision: (LeaseRowBase & { endedOn: string })[];
  leasesEndingSoon: (LeaseRowBase & { endDate: string; daysLeft: number })[];
}

export async function fetchDashboard(): Promise<DashboardRecord> {
  const res = await fetch("/api/dashboard", {
    headers: { accept: "application/json" },
  });
  if (res.status === 401)
    throw new UnauthenticatedError("Something went wrong. Please try again."); // shown only if signing out fails; the page otherwise goes to sign-in
  if (res.status === 429) throw new TooManyRequestsError(TOO_MANY);
  if (!res.ok) throw new Error("Something went wrong. Please try again.");
  return (await res.json()) as DashboardRecord;
}
