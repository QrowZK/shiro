import React from "react";
import ReactDOM from "react-dom/client";

import "./styles/styles.css";
import "./styles/app.css";
import App from "./App.jsx";

// NOTE: there is deliberately no global lucide interval here. The Icon
// component draws itself on mount, and src/ds/shiro.js replaces lucide's
// destructive createIcons with an in-place renderer. Re-adding a document-wide
// createIcons() call will reintroduce the blank-window crash.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
