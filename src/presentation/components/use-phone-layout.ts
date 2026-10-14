"use client";

import { useSyncExternalStore } from "react";

const PHONE_QUERY = "(max-width: 639px)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
}

function getServerSnapshot() { return false; }

/** Presentation only. Financial forms remain mounted when the viewport changes. */
export function usePhoneLayout() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
