import { Navigate, Route, Routes } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import AdminLogin from "./pages/auth/AdminLogin";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";
import ProtectedAdminRoute from "./routes/ProtectedAdminRoute";
import AdminLayout from "./layouts/AdminLayout";
import DashboardOverview from "./pages/admin/DashboardOverview";
import TanksPage from "./pages/admin/TanksPage";
import TankDetailsPage from "./pages/admin/TankDetailsPage";
import SensorReadingsPage from "./pages/admin/SensorReadingsPage";
import MarketplacePage from "./pages/admin/MarketplacePage";
import MarketplaceOrdersPage from "./pages/admin/MarketplaceOrdersPage";
import AlertsPage from "./pages/admin/AlertsPage";
import ReportsPage from "./pages/admin/ReportsPage";
import SettingsPage from "./pages/admin/SettingsPage";
import PlaceholderPage from "./pages/admin/PlaceholderPage";

export default function App() {
  return (
    <Routes>
      {/* Public Pages */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AdminLogin />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      {/* Old/admin login redirect */}
      <Route path="/admin/login" element={<Navigate to="/login" replace />} />

      {/* Protected Dashboard Pages */}
      <Route element={<ProtectedAdminRoute />}>
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<DashboardOverview />} />

          <Route path="tanks" element={<TanksPage />} />
          <Route path="tanks/:tankId" element={<TankDetailsPage />} />

          <Route path="readings" element={<SensorReadingsPage />} />

          <Route path="marketplace" element={<MarketplacePage />} />
          <Route
            path="marketplace/:listingId"
            element={
              <PlaceholderPage
                title="Listing Details"
                description="This page will show full marketplace listing details, reservations, buyer/seller activity, and listing history."
              />
            }
          />

          <Route path="orders" element={<MarketplaceOrdersPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}