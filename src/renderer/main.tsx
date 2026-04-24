import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles.css";

function hideBootSplash() {
  const splash = document.getElementById("boot-splash");
  if (splash) {
    splash.setAttribute("hidden", "true");
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

requestAnimationFrame(() => {
  requestAnimationFrame(hideBootSplash);
});
