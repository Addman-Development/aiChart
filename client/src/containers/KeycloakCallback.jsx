import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useDispatch } from "react-redux";
import { Spinner } from "@heroui/react";
import cookie from "react-cookies";
import moment from "moment";

import { relog } from "../slices/user";
import { tokenKey } from "../modules/auth";
import Row from "../components/Row";
import Text from "../components/Text";

const expires = moment().add(1, "month").toDate();

/*
  Keycloak OIDC Callback Handler. The server has already done the code
  exchange and redirected us here with a signed app token in the URL.
*/
function KeycloakCallback() {
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Processing your login...");
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    const handleCallback = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const token = params.get("token");
        const error = params.get("error");
        const errorMessage = params.get("message");
        const isNewUser = params.get("new") === "true";
        const isLinked = params.get("linked") === "true";

        if (error) {
          setStatus("error");
          setMessage(getErrorMessage(error, errorMessage));
          return;
        }

        if (!token) {
          setStatus("error");
          setMessage("No authentication token received. Please try again.");
          return;
        }

        cookie.remove(tokenKey, { path: "/" });
        cookie.save(tokenKey, token, { expires, path: "/" });

        await dispatch(relog());

        setStatus("success");
        if (isNewUser) {
          setMessage("Account created successfully! Redirecting...");
        } else if (isLinked) {
          setMessage("Keycloak account linked successfully! Redirecting...");
        } else {
          setMessage("Login successful! Redirecting...");
        }

        setTimeout(() => {
          navigate("/");
        }, 1500);
      } catch (err) {
        setStatus("error");
        setMessage("Failed to complete login. Please try again.");
        console.error("Keycloak callback error:", err);
      }
    };

    handleCallback();
  }, [dispatch, navigate]);

  const getErrorMessage = (error, message) => {
    const errorMessages = {
      keycloak_not_configured: "Single sign-on is not configured. Please contact your administrator.",
      keycloak_auth_failed: `Authentication failed: ${message || "Unknown error"}`,
      no_authorization_code: "No authorization code received from the identity provider.",
      no_email_from_keycloak: "Could not retrieve your email from Keycloak. Please ensure your account has an email address.",
      email_already_linked: "This email is already linked to another Keycloak account.",
      keycloak_callback_failed: `Login failed: ${message || "Unknown error"}`,
      keycloak_state_missing: "Your login session expired. Please try signing in again.",
      keycloak_state_invalid: "Your login session is invalid. Please try signing in again.",
      keycloak_state_mismatch: "Login could not be verified. Please try signing in again.",
      token_generation_failed: "Failed to generate authentication token. Please try again.",
    };

    return errorMessages[error] || `An error occurred: ${message || error}`;
  };

  const handleReturnToLogin = () => {
    navigate("/login");
  };

  return (
    <div className="h-screen flex items-center justify-center bg-content1">
      <div className="max-w-md w-full p-8 bg-content2 rounded-lg shadow-lg">
        <Row align="center" justify="center" className="mb-4">
          {status === "loading" && <Spinner size="lg" />}
          {status === "success" && (
            <div className="text-success text-6xl">✓</div>
          )}
          {status === "error" && (
            <div className="text-danger text-6xl">✕</div>
          )}
        </Row>

        <Row align="center" justify="center" className="mb-4">
          <Text size="h4" className="text-center">
            {status === "loading" && "Processing..."}
            {status === "success" && "Success!"}
            {status === "error" && "Login Failed"}
          </Text>
        </Row>

        <Row align="center" justify="center">
          <Text className="text-center text-default-600">
            {message}
          </Text>
        </Row>

        {status === "error" && (
          <Row align="center" justify="center" className="mt-6">
            <button
              type="button"
              onClick={handleReturnToLogin}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-600"
            >
              Return to Login
            </button>
          </Row>
        )}
      </div>
    </div>
  );
}

export default KeycloakCallback;
