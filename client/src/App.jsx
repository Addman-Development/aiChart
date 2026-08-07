import React from "react";
import { Provider } from "react-redux";
import {
  createBrowserRouter, RouterProvider,
} from "react-router";
import { configureStore } from "@reduxjs/toolkit";
import { HeroUIProvider } from "@heroui/react";
import { HelmetProvider } from "react-helmet-async";

import Main from "./containers/Main";
import reducer from "./reducers";
import { ThemeProvider } from "./modules/ThemeContext";
import ErrorBoundary from "./components/ErrorBoundary";
import ErrorPage from "./components/ErrorPage";

const store = configureStore({
  reducer,
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Main />,
    errorElement: <ErrorPage />,
    children: [
      {
        path: "user",
        children: [{
          path: "profile",
        }]
      },
      {
        path: "edit",
      },
      {
        path: "dashboards",
      },
      {
        path: "connections",
      },
      {
        path: "connections/:connectionId",
      },
      {
        path: "datasets",
      },
      {
        path: "datasets/:datasetId",
      },
      {
        path: "integrations",
        children: [
          {
            path: "auth/:integrationType",
          },
          {
            path: "auth/:integrationType/callback",
          },
          {
            path: ":integrationId",
          }
        ],
      },
      {
        path: "settings",
        children: [
          {
            path: "profile"
          },
          {
            path: "team",
          },
          {
            path: "members",
          },
          {
            path: "api-keys",
          },
        ],
      },
      {
        path: "dashboard/:projectId",
        children: [
          {
            path: "chart",
          },
          {
            path: "chart/:chartId/edit",
          },
        ]
      },
      {
        path: "chart/:chartId/embedded",
      },
      {
        path: "chart/:share_string/share",
      },
      {
        path: "invite",
      },
      {
        path: "edison",
      },
      {
        path: "edison/:conversationId",
      },
      {
        path: "b/:brewName",
      },
      {
        path: "report/:brewName",
      },
      {
        path: "report/:brewName/edit",
      },
      {
        path: "login",
      },
      {
        path: "signup",
      },
      {
        path: "google-auth",
      },
      {
        path: "keycloak-callback",
      },
      {
        path: "onboarding",
      },
      {
        path: "passwordReset"
      },
      {
        path: "feedback",
      },
    ],
  },
]);

export default function App() {
  return (
    <Provider store={store}>
      <HelmetProvider>
        <ThemeProvider>
          <HeroUIProvider locale="en-GB">
            <ErrorBoundary>
              <RouterProvider router={router} />
            </ErrorBoundary>
          </HeroUIProvider>
        </ThemeProvider>
      </HelmetProvider>
    </Provider>
  );
}
