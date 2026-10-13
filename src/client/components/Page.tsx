import { useEffect, type ReactNode } from "react";
import { documentTitle } from "../../shared/routes";

/** Sets the unique document title and renders the page's single h1. */
export function Page({ title, children }: { title: string; children?: ReactNode }) {
  useEffect(() => {
    document.title = documentTitle(title);
  }, [title]);
  return (
    <>
      <h1 className="mb-4 break-words text-2xl font-semibold">{title}</h1>
      {children}
    </>
  );
}
