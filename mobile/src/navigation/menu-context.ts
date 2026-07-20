import { createContext, useContext } from 'react';

export type DrawerSide = 'left' | 'right';

export const MenuContext = createContext<(side?: DrawerSide) => void>(() => {});
export const useMenu = () => useContext(MenuContext);
