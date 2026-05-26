import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type ActiveHousehold } from "./api";

interface HouseholdState {
  loading: boolean;
  household: ActiveHousehold | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const HouseholdContext = createContext<HouseholdState | null>(null);

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [household, setHousehold] = useState<ActiveHousehold | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await api.myHousehold();
      setHousehold(res.household);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <HouseholdContext.Provider value={{ loading, household, error, refresh }}>
      {children}
    </HouseholdContext.Provider>
  );
}

export function useHousehold(): HouseholdState {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error("useHousehold must be used within HouseholdProvider");
  return ctx;
}
