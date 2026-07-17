import { createContext, useContext } from 'react';

export const MenuContext = createContext<() => void>(() => {});
export const useMenu = () => useContext(MenuContext);
