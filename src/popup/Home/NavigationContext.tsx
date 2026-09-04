import { createContext, useContext, type ReactNode } from 'react';

/**
 * Every destination `Home` and its rows can send the user to. Each one maps
 * to a slot in PopupApp's `OverlayType` state machine — this context does not
 * add a new one, it just gives rows a way to ask for it directly instead of
 * being handed it as a prop.
 *
 * Before this, seven callbacks were threaded through `Home` untouched just to
 * reach `ProfileRow`, `MutesRow`, `RelaysRow`, `PqcCard`, and `SiteControls` —
 * a router API simulated with props, where every new destination meant
 * touching three files instead of two.
 */
export interface HomeNavigation {
  viewAllActivity: (domain: string | null) => void;
  managePermissions: (domain: string) => void;
  manageFilters: () => void;
  editProfile: () => void;
  openRelays: () => void;
  openPqc: () => void;
  openWallet: () => void;
}

const NavigationContext = createContext<HomeNavigation | null>(null);

export function NavigationProvider({ value, children }: { value: HomeNavigation; children: ReactNode }) {
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

// Every consumer of useNavigate renders inside Home, which PopupApp always
// wraps in a NavigationProvider — a missing provider here is a wiring bug to
// surface loudly, not a state worth rendering around.
export function useNavigate(): HomeNavigation {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error('useNavigate must be used within a NavigationProvider');
  return navigation;
}
