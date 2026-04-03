import React, { createContext, useContext } from "react";
import featureFlags from "../utils/featureFlags";

type FeatureFlags = typeof featureFlags;

const FeatureFlagsContext = createContext<FeatureFlags>(featureFlags);

export const FeatureFlagsProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <FeatureFlagsContext.Provider value={featureFlags}>
    {children}
  </FeatureFlagsContext.Provider>
);

export const useFeatureFlags = () => useContext(FeatureFlagsContext);
