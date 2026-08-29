"use client";

import dynamic from "next/dynamic";

const LocalProductRuntime = dynamic(() =>
  import("./local-product-runtime.client").then((module) => module.LocalProductRuntime));

const ProductionApplicationRuntime = dynamic(() =>
  import("./production-application-runtime.client").then((module) => module.ProductionApplicationRuntime));

export function SelectedApplicationRuntime({
  children,
  composition,
}: Readonly<{
  children: React.ReactNode;
  composition: "appwrite" | "local";
}>) {
  return composition === "appwrite"
    ? <ProductionApplicationRuntime>{children}</ProductionApplicationRuntime>
    : <LocalProductRuntime>{children}</LocalProductRuntime>;
}
