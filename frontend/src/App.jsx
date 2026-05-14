import React, { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard.jsx";
import Users from "./pages/Users.jsx";
import Analytics from "./pages/Analytics.jsx";

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("cw-theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("cw-theme", theme);
  }, [theme]);

  return { theme, setTheme };
}

function ThemeToggle({ theme, setTheme }) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      className="themeFab"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <span className="themeFabIcon">{isDark ? "☀" : "☾"}</span>
    </button>
  );
}

function TopNav({ theme, setTheme }) {
  const linkClass = ({ isActive }) => (isActive ? "active" : "");
  return (
    <div className="nav">
      <div className="brand">🚿 Carwash</div>
      <NavLink className={linkClass} to="/">Dashboard</NavLink>
      <NavLink className={linkClass} to="/users">Users</NavLink>
      <NavLink className={linkClass} to="/analytics">Analytics</NavLink>
      <div style={{ flex: 1 }} />
      <ThemeToggle theme={theme} setTheme={setTheme} />
    </div>
  );
}

export default function App() {
  const { theme, setTheme } = useTheme();
  return (
    <BrowserRouter basename="/">
      <div className="container">
        <TopNav theme={theme} setTheme={setTheme} />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<Users />} />
          <Route path="/analytics" element={<Analytics />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
