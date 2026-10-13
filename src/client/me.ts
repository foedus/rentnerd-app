import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "./api";

/** The Smoke user is read-only (SPEC §2), so write buttons are hidden for them; the server enforces it too. */
export function useCanWrite(): boolean {
  const { data } = useQuery({ queryKey: ["me"], queryFn: fetchMe });
  return !!data && data.role !== "smoke";
}
