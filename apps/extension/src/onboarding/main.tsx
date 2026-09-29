import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../ui/styles.css";
import { Onboarding } from "./Onboarding.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Onboarding />
  </StrictMode>,
);
