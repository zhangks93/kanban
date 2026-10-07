import { createContext, useContext } from 'react';
import type { User, Workspace } from '@work/shared';
export const AppContext = createContext<{
  me: User;
  workspaces: Workspace[];
  workspace?: Workspace;
  notify: (message: string) => void;
}>({ me: {} as User, workspaces: [], notify: () => {} });
export const useApp = () => useContext(AppContext);
