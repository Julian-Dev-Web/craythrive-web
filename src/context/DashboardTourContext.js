import { createContext, useContext } from 'react';

export const DashboardTourContext = createContext(null);
export const useDashboardTour = () => useContext(DashboardTourContext);
