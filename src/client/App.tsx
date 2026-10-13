import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { canAccess, matchPage, pages } from "../shared/routes";
import { fetchMe, type Me, TooManyRequestsError, UnauthenticatedError } from "./api";
import { Layout } from "./components/Layout";
import { NoAccess, NotFound } from "./components/Notices";
import { Page } from "./components/Page";
import { Account } from "./pages/Account";
import { AcceptInvite } from "./pages/AcceptInvite";
import { ForgotPassword } from "./pages/ForgotPassword";
import { OwnerDetail } from "./pages/OwnerDetail";
import { OwnerForm } from "./pages/OwnerForm";
import { Owners } from "./pages/Owners";
import { Properties } from "./pages/Properties";
import { PropertyForm } from "./pages/PropertyForm";
import { PropertyDetail } from "./pages/PropertyDetail";
import { Login } from "./pages/Login";
import { ResetPassword } from "./pages/ResetPassword";
import { UnitDetail } from "./pages/UnitDetail";
import { UnitForm } from "./pages/UnitForm";
import { Users } from "./pages/Users";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

function pageElement(path: string, title: string, me: Me) {
  if (path === "/users") return <Users />;
  if (path === "/owners") return <Owners />;
  if (path === "/owners/new") return <OwnerForm />;
  if (path === "/owners/:id") return <OwnerDetail />;
  if (path === "/owners/:id/edit") return <OwnerForm />;
  if (path === "/properties") return <Properties />;
  if (path === "/properties/:id") return <PropertyDetail />;
  if (path === "/properties/new" || path === "/properties/:id/edit") return <PropertyForm />;
  if (path === "/units/:id") return <UnitDetail />;
  if (path === "/properties/:id/units/new" || path === "/units/:id/edit") return <UnitForm />;
  if (path === "/account") return <Account me={me} />;
  return <Page title={title} />;
}

function Shell() {
  const location = useLocation();
  const { data: me, error, isPending, refetch } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  if (isPending) {
    return (
      <main>
        <Page title={matchPage(location.pathname)?.title ?? "Loading"}>
          <p role="status">Loading…</p>
        </Page>
      </main>
    );
  }
  if (error instanceof UnauthenticatedError) {
    // Addresses that aren't pages at all (e.g. /verify-email) are "not found" for everyone, signed in or not.
    const path = location.pathname.replace(/\/+$/, "") || "/";
    if (!matchPage(path)) {
      return (
        <main className="mx-auto max-w-sm p-4">
          <NotFound />
        </main>
      );
    }
    const next = location.pathname + location.search + location.hash;
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (!me) {
    return (
      <main>
        <Page title="Something went wrong">
          <p role="alert">
            {error instanceof TooManyRequestsError ? error.message : "Something went wrong. Please try again."}
          </p>
          <button type="button" className="mt-2 min-h-6 rounded border px-3 py-1" onClick={() => void refetch()}>
            Try again
          </button>
        </Page>
      </main>
    );
  }

  return (
    <Routes>
      <Route element={<Layout me={me} />}>
        {pages.map((p) => (
          <Route
            key={p.path}
            path={p.path}
            element={canAccess(p.access, me.role) ? pageElement(p.path, p.title, me) : <NoAccess />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

/** React Router's splat route can't match a path containing a line break; strip those so the normal pages (or "Page not found") show. */
function StripLineBreaks({ children }: { children: ReactNode }) {
  const { pathname, search, hash } = useLocation();
  const lineBreak = /%0[ad]|[\r\n]/gi;
  if (lineBreak.test(pathname)) return <Navigate to={pathname.replace(lineBreak, "") + search + hash} replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <StripLineBreaks>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </StripLineBreaks>
    </QueryClientProvider>
  );
}
