import React, { useState } from "react";
import { Button } from "@heroui/react";
import { FaMicrosoft } from "react-icons/fa";

import { API_HOST } from "../config/settings";

/*
  Azure AD Sign-in Button Component
*/
function AzureLoginButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAzureLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_HOST}/api/azure/auth`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error("Failed to initiate Azure login");
      }

      const data = await response.json();

      if (data.authUrl) {
        // Redirect to Azure AD login page
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
        onPress={handleAzureLogin}
        isLoading={loading}
        fullWidth
        startContent={!loading && <FaMicrosoft size={18} />}
      >
        {loading ? "Redirecting..." : "Sign in with Microsoft"}
      </Button>
      {error && (
        <div className="text-danger text-sm mt-2">
          {error}
        </div>
      )}
    </>
  );
}

export default AzureLoginButton;
