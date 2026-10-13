import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { canAccess, pages } from "../shared/routes";
import { fetchMe, UnauthenticatedError } from "./api";
import { Layout } from "./components/Layout";
import { NoAccess, NotFound } from "./components/Notices";
import { Page } from "./components/Page";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

/** Placeholder until the sign-in screen arrives; keeps signed-out visitors off protected pages. */
function LoginPlaceholder() {
  return <Page title="Sign in" />;
}

function Shell() {
  const location = useLocation();
  const { data: me, error, isPending } = useQuery({ queryKey: ["me"], queryFn: fetchMe });

  if (isPending) return <p role="status">Loading…</p>;
  if (error instanceof UnauthenticatedError) {
    const next = location.pathname + location.search;
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (!me) {
    return (
      <main>
        <Page title="Something went wrong">
          <p role="alert">Something went wrong. Please try again.</p>
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
            element={canAccess(p.access, me.role) ? <Page title={p.title} /> : <NoAccess />}
          />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Routes>
        <Route path="/login" element={<LoginPlaceholder />} />
        <Route path="/*" element={<Shell />} />
      </Routes>
    </QueryClientProvider>
  );
}
