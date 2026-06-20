"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  fetchPublicStoreConfigClient,
  type PublicStoreConfig,
} from "@/lib/storefront-settings";

const StoreConfigContext = createContext<PublicStoreConfig | null>(null);

export function StoreConfigProvider({
  config: initialConfig,
  children,
}: {
  config: PublicStoreConfig;
  children: ReactNode;
}) {
  const [config, setConfig] = useState(initialConfig);

  useEffect(() => {
    setConfig(initialConfig);
  }, [initialConfig]);

  useEffect(() => {
    let cancelled = false;

    async function refreshStoreConfig() {
      const next = await fetchPublicStoreConfigClient();
      if (!cancelled && next.configAvailable) {
        setConfig(next);
      }
    }

    void refreshStoreConfig();

    const onFocus = () => {
      void refreshStoreConfig();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <StoreConfigContext.Provider value={config}>{children}</StoreConfigContext.Provider>
  );
}

/** Runtime storefront settings from GET /store/config (preferred over build-time env flags). */
export function useStoreConfig(): PublicStoreConfig {
  const config = useContext(StoreConfigContext);
  if (!config) {
    throw new Error("useStoreConfig must be used within StoreConfigProvider");
  }
  return config;
}
