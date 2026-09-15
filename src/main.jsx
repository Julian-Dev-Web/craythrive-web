import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles/global.css";
import "./styles/auth.css";
import "./styles/dashboard.css";
import "./styles/tanks.css";
import "./styles/readings.css";
import "./styles/marketplace.css";
import "./styles/orders.css";
import "./styles/alerts.css";
import "./styles/reports.css";
import "./styles/settings.css";
import "./styles/contact.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);