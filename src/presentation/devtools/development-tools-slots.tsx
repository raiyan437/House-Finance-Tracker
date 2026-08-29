"use client";

import { createContext, useContext } from "react";

export interface DevelopmentToolsSlots {
  readonly desktop: (compact: boolean) => React.ReactNode;
  readonly mobile: React.ReactNode;
}

const DevelopmentToolsSlotsContext = createContext<DevelopmentToolsSlots | undefined>(undefined);

export function DevelopmentToolsSlotsProvider({
  children,
  value,
}: Readonly<{
  children: React.ReactNode;
  value?: DevelopmentToolsSlots;
}>) {
  return (
    <DevelopmentToolsSlotsContext.Provider value={value}>
      {children}
    </DevelopmentToolsSlotsContext.Provider>
  );
}

export function useDevelopmentToolsSlots(): DevelopmentToolsSlots | undefined {
  return useContext(DevelopmentToolsSlotsContext);
}
