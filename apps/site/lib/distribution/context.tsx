"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_DISTRIBUTION_DOMAIN, resolveDistributionDomain } from "../site-links";

interface DistributionContextValue {
  domain: string;
  url: string;
  releasesPortalUrl: string;
}

const DistributionContext = createContext<DistributionContextValue>({
  domain: DEFAULT_DISTRIBUTION_DOMAIN,
  url: `https://${DEFAULT_DISTRIBUTION_DOMAIN}`,
  releasesPortalUrl: `https://${DEFAULT_DISTRIBUTION_DOMAIN}`,
});

export interface DistributionProviderProps {
  initialDomain?: string;
  children: ReactNode;
}

export function DistributionProvider({
  initialDomain = DEFAULT_DISTRIBUTION_DOMAIN,
  children,
}: DistributionProviderProps) {
  const [domain, setDomain] = useState<string>(initialDomain);

  // 客户端挂载后按当前实际 window.location.hostname 校准域名（例如从 editor.jiaqi.im 映射到 download.jiaqi.im）
  useEffect(() => {
    if (typeof window !== "undefined") {
      const clientDomain = resolveDistributionDomain(window.location.hostname);
      setDomain(clientDomain);
    }
  }, []);

  const url = `https://${domain}`;
  const releasesPortalUrl = url;

  return (
    <DistributionContext.Provider value={{ domain, url, releasesPortalUrl }}>
      {children}
    </DistributionContext.Provider>
  );
}

export function useDistribution(): DistributionContextValue {
  return useContext(DistributionContext);
}
