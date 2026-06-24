import React, { useState } from "react";
import { Button } from "@heroui/react";
import { FaKey } from "react-icons/fa";

import { API_HOST } from "../config/settings";

/*
  Keycloak / SSO sign-in button. Hits the server to start the OIDC dance
  (server sets the PKCE+state cookie and returns the authorization URL).
*/
function KeycloakLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleKeycloakLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_HOST}/keycloak/auth`, {
        method: "GET",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Keycloak login");
      }

      const data = await response.json();

      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        throw new Error("No auth URL returned from server");
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        color="default"
        variant="bordered"
        onPress={handleKeycloakLogin}
        isLoading={loading}
        fullWidth
        startContent={!loading && <FaKey size={16} />}
      >
        {loading ? "Redirecting..." : "Sign in with SSO"}
      </Button>
      {error && (
        <div className="text-danger text-sm mt-2">
          {error}
        </div>
      )}
    </>
  );
}

export default KeycloakLoginButton;
