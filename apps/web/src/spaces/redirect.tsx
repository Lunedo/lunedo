import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export function Redirect({ to, search = {} }: { to: string; search?: Record<string, unknown> }) {
  const navigate = useNavigate();
  const latest = useRef({ navigate, search });
  latest.current = { navigate, search };
  const searchKey = JSON.stringify(search);
  useEffect(() => {
    const hash = globalThis.location.hash.slice(1);
    void latest.current.navigate({
      to,
      search: JSON.parse(searchKey) as Record<string, unknown>,
      ...(hash ? { hash } : {}),
      replace: true,
    });
  }, [to, searchKey]);
  return null;
}
