import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { signOut, type Me } from "../api";
import { navPagesFor } from "../../shared/routes";

export function Layout({ me }: { me: Me }) {
  const [navOpen, setNavOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [signOutError, setSignOutError] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const firstRender = useRef(true);
  const [announcement, setAnnouncement] = useState("");

  // After a client-side navigation, move focus to <main> so keyboard and screen-reader users start at the new page.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById("main")?.focus();
    // Pages set their title in an effect; wait a tick so the new title is the one announced.
    const t = setTimeout(() => setAnnouncement(document.title), 0);
    return () => clearTimeout(t);
  }, [pathname]);

  const onMenuAction = async (key: React.Key) => {
    if (key === "account") return navigate("/account");
    try {
      await signOut();
    } catch {
      setSignOutError(true);
      return;
    }
    queryClient.clear();
    navigate("/login", { replace: true });
  };

  return (
    <div
      className="min-h-screen bg-slate-50 text-slate-900"
      onKeyDown={(e) => {
        if (e.key === "Escape" && navOpen) {
          setNavOpen(false);
          menuButton.current?.focus();
        }
      }}
    >
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="flex items-center justify-between gap-2 border-b bg-white px-4 py-2">
        <div className="flex items-center gap-3">
          <Button
            ref={menuButton}
            className="min-h-6 min-w-6 rounded border px-3 py-1 lg:hidden"
            aria-expanded={navOpen}
            aria-controls="site-nav"
            onPress={() => setNavOpen((o) => !o)}
          >
            Menu
          </Button>
          <Link to="/" className="inline-block min-h-6 text-lg font-bold">
            RentNerd
          </Link>
        </div>
        <MenuTrigger>
          <Button className="min-h-6 rounded border px-3 py-1">{me.name}</Button>
          <Popover className="rounded border bg-white shadow">
            <Menu aria-label="User menu" onAction={onMenuAction} className="p-1">
              <MenuItem id="account" className="min-h-6 cursor-default rounded px-3 py-1">
                Account settings
              </MenuItem>
              <MenuItem id="signout" className="min-h-6 cursor-default rounded px-3 py-1">
                Sign out
              </MenuItem>
            </Menu>
          </Popover>
        </MenuTrigger>
      </header>
      <div className="lg:flex">
        <nav
          id="site-nav"
          aria-label="Main"
          className={`${navOpen ? "block" : "hidden"} border-b bg-white p-2 lg:block lg:min-h-[calc(100vh-3rem)] lg:w-56 lg:border-r lg:border-b-0`}
        >
          <ul>
            {navPagesFor(me.role).map((p) => (
              <li key={p.path}>
                <NavLink
                  to={p.path}
                  end={p.path === "/"}
                  onClick={() => {
                    setNavOpen(false);
                  }}
                  className="block min-h-6 rounded px-3 py-1.5 aria-[current=page]:bg-slate-200 aria-[current=page]:font-semibold"
                >
                  {p.title}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div role="status" aria-live="polite" className="sr-only">
          {announcement}
        </div>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 focus:outline-none">
          {signOutError && <p role="alert">Something went wrong. Please try again.</p>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
