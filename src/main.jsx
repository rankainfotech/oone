import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import LandingPage from "./LandingPage.jsx";
import AccountsApp from "./products/accounts/AccountsApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/products/mortgage/*" element={<App />} />
        <Route path="/products/accounts/*" element={<AccountsApp />} />
        {/* Convenience alias so old links / marketing "Log in" buttons still work */}
        <Route path="/login" element={<Navigate to="/products/mortgage" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
