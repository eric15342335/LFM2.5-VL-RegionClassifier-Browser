import { MantineProvider } from "@mantine/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { accessibleCssVariablesResolver } from "./theme";
import "./styles/vendor";

const root = document.getElementById("root");

if (!root) throw new Error("Application root is missing");

createRoot(root).render(
  <StrictMode>
    <MantineProvider
      defaultColorScheme="dark"
      cssVariablesResolver={accessibleCssVariablesResolver}
    >
      <App />
    </MantineProvider>
  </StrictMode>
);
