import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { appConfig } from "./lib/generated/application-config";
import { queryClient } from "./query-client";
import { router } from "./router";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";

document.title = appConfig.brand.productName;

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error(
    `${appConfig.brand.productName} could not find the application root element.`,
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} context={{ queryClient }} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
