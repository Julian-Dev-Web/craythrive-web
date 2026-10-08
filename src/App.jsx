import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";

import LandingPage from "./pages/LandingPage";

import AdminLogin from "./pages/auth/AdminLogin";
import ForgotPassword from "./pages/auth/ForgotPassword";
import ResetPassword from "./pages/auth/ResetPassword";

import ProtectedAdminRoute from "./routes/ProtectedAdminRoute";

import AdminLayout from "./layouts/AdminLayout";

import DashboardOverview from "./pages/admin/DashboardOverview";

import TanksPage from "./pages/admin/TanksPage";
import TankDetailsPage from "./pages/admin/TankDetailsPage";
import AddTankPage from "./pages/admin/AddTankPage";

import SensorReadingsPage from "./pages/admin/SensorReadingsPage";

import MarketplacePage from "./pages/admin/MarketplacePage";

import MarketplaceOrdersPage from "./pages/admin/MarketplaceOrdersPage";

import SellerProfilePage from "./pages/admin/SellerProfilePage";

import AddMarketplaceListingPage from "./pages/admin/AddMarketplaceListingPage";

import MarketplaceListingDetailsPage from "./pages/admin/MarketplaceListingDetailsPage";

import EditMarketplaceListingPage from "./pages/admin/EditMarketplaceListingPage";

import AlertsPage from "./pages/admin/AlertsPage";

import ReportsPage from "./pages/admin/ReportsPage";

import SettingsPage from "./pages/admin/SettingsPage";

export default function App() {
  return (
    <Routes>

      {/* ===============================================
          PUBLIC
      ================================================ */}

      <Route
        path="/"
        element={
          <LandingPage />
        }
      />

      <Route
        path="/login"
        element={
          <AdminLogin />
        }
      />

      <Route
        path="/forgot-password"
        element={
          <ForgotPassword />
        }
      />

      <Route
        path="/reset-password"
        element={
          <ResetPassword />
        }
      />

      <Route
        path="/admin/login"
        element={
          <Navigate
            to="/login"
            replace
          />
        }
      />

      {/* ===============================================
          PROTECTED
      ================================================ */}

      <Route
        element={
          <ProtectedAdminRoute />
        }
      >
        <Route
          path="/admin"
          element={
            <AdminLayout />
          }
        >

          {/* DASHBOARD */}

          <Route
            index
            element={
              <DashboardOverview />
            }
          />

          {/* TANKS */}

          <Route
            path="tanks"
            element={
              <TanksPage />
            }
          />

          <Route
            path="tanks/add"
            element={<AddTankPage />}
          />

          <Route
            path="tanks/:tankId/edit"
            element={<AddTankPage />}
          />

          <Route
            path="tanks/:tankId"
            element={
              <TankDetailsPage />
            }
          />

          {/* READINGS */}

          <Route
            path="readings"
            element={
              <SensorReadingsPage />
            }
          />

          {/* ===========================================
              MARKETPLACE
          ============================================ */}

          <Route
            path="marketplace"
            element={
              <MarketplacePage />
            }
          />

          {/* SELL PRODUCT */}

          <Route
            path="marketplace/sell"
            element={
              <AddMarketplaceListingPage />
            }
          />

          {/* SELLER PROFILE */}

          <Route
            path="marketplace/seller-profile"
            element={
              <SellerProfilePage />
            }
          />

          {/* EDIT PRODUCT */}

          <Route
            path="marketplace/:listingId/edit"
            element={
              <EditMarketplaceListingPage />
            }
          />

          {/* PRODUCT DETAILS */}

          <Route
            path="marketplace/:listingId"
            element={
              <MarketplaceListingDetailsPage />
            }
          />

          {/* ORDERS */}

          <Route
            path="orders"
            element={
              <MarketplaceOrdersPage />
            }
          />

          {/* ALERTS */}

          <Route
            path="alerts"
            element={
              <AlertsPage />
            }
          />

          {/* REPORTS */}

          <Route
            path="reports"
            element={
              <ReportsPage />
            }
          />

          {/* SETTINGS */}

          <Route
            path="settings"
            element={
              <SettingsPage />
            }
          />

        </Route>
      </Route>

      {/* ===============================================
          FALLBACK
      ================================================ */}

      <Route
        path="*"
        element={
          <Navigate
            to="/"
            replace
          />
        }
      />

    </Routes>
  );
}
