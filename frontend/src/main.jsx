// src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./index.css";
import "./styles/BackupTheme.css";
import "./theme.css"; // ORA Navigator design system — imported last so its tokens win
import "./theme-ora.css"; // ORA component look (navy rail, bubbles, spinner) — overrides legacy CSS


ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
