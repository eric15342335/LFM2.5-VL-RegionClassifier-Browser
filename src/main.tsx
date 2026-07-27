import "@mantine/core/styles.css";
import "@mantine/dropzone/styles.css";
import "@mantine/notifications/styles.css";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./styles/workspace.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

createRoot(root).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="dark">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>
);
