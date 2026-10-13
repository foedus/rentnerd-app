import { Link } from "react-router";
import { Page } from "./Page";

export function NotFound() {
  return (
    <Page title="Page not found">
      <p>
        <Link to="/" className="inline-block min-h-6 underline">
          Go to dashboard
        </Link>
      </p>
    </Page>
  );
}

export function NoAccess() {
  return (
    <Page title="No access">
      <p>You don't have access to this page.</p>
    </Page>
  );
}
