import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";
import "./styles/player.css";
import "./styles/auth.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container missing");

createRoot(container).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
