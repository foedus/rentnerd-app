export type Role = "admin" | "landlord" | "smoke";

/** Who may open a page: everyone signed in, the Admin only, or anyone who can write (not the Smoke user). */
export type Access = "any" | "admin" | "write";

export interface PageDef {
  path: string;
  title: string;
  access: Access;
  /** Shown in the left navigation. */
  nav?: boolean;
}

export const pages: readonly PageDef[] = [
  { path: "/", title: "Dashboard", access: "any", nav: true },
  { path: "/properties", title: "Properties", access: "any", nav: true },
  { path: "/properties/new", title: "Add property", access: "write" },
  { path: "/properties/:id/edit", title: "Edit property", access: "write" },
  { path: "/properties/:id", title: "Property details", access: "any" },
  { path: "/properties/:id/units/new", title: "Add unit", access: "write" },
  { path: "/units/:id/edit", title: "Edit unit", access: "write" },
  { path: "/units/:id/leases/new", title: "New lease", access: "write" },
  { path: "/units/:id", title: "Unit details", access: "any" },
  { path: "/tenants", title: "Tenants", access: "any", nav: true },
  { path: "/tenants/new", title: "Add tenant", access: "write" },
  { path: "/tenants/:id", title: "Tenant details", access: "any" },
  { path: "/tenants/:id/edit", title: "Edit tenant", access: "write" },
  { path: "/owners", title: "Owners", access: "any", nav: true },
  { path: "/owners/new", title: "Add owner", access: "write" },
  { path: "/owners/:id", title: "Owner details", access: "any" },
  { path: "/owners/:id/edit", title: "Edit owner", access: "write" },
  { path: "/leases", title: "Leases", access: "any", nav: true },
  { path: "/leases/:id/edit", title: "Edit lease", access: "write" },
  { path: "/leases/:id/versions/:n", title: "Lease version", access: "any" },
  { path: "/leases/:id", title: "Lease details", access: "any" },
  { path: "/compliance", title: "Compliance", access: "any", nav: true },
  { path: "/investments", title: "Investments", access: "any", nav: true },
  { path: "/templates", title: "Templates", access: "any", nav: true },
  { path: "/templates/new", title: "New template", access: "write" },
  { path: "/templates/:id", title: "Template details", access: "any" },
  { path: "/help/templates", title: "Converting a Word lease", access: "any" },
  { path: "/import", title: "Import", access: "any", nav: true },
  { path: "/users", title: "Users", access: "admin", nav: true },
  { path: "/activity", title: "Activity log", access: "admin", nav: true },
  { path: "/account", title: "Account settings", access: "any" },
];

export function canAccess(access: Access, role: Role): boolean {
  if (access === "any") return true;
  if (access === "admin") return role === "admin";
  return role !== "smoke";
}

/** Navigation entries a role sees; the Smoke user can read every page, so only admin-only links are hidden. */
export function navPagesFor(role: Role): PageDef[] {
  return pages.filter((p) => p.nav && (p.access !== "admin" || role === "admin"));
}

/** The page a URL path belongs to; `:name` segments match any one segment and literal paths win over them. */
export function matchPage(pathname: string): PageDef | undefined {
  const path = pathname.replace(/\/+$/, "") || "/";
  const parts = path.split("/");
  const fits = (p: PageDef) => {
    const want = p.path.split("/");
    return want.length === parts.length && want.every((w, i) => w.startsWith(":") || w === parts[i]);
  };
  return pages.find((p) => p.path === path) ?? pages.find(fits);
}

export const documentTitle = (page: string) => `${page} – RentNerd`;
