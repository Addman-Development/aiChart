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
  Azure OAuth Callback Handler
*/
function AzureCallback() {
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

        // Save token to cookie
        cookie.remove(tokenKey, { path: "/" });
        cookie.save(tokenKey, token, { expires, path: "/" });

        // Fetch user data
        await dispatch(relog());

        setStatus("success");
        if (isNewUser) {
          setMessage("Account created successfully! Redirecting...");
        } else if (isLinked) {
          setMessage("Microsoft account linked successfully! Redirecting...");
        } else {
          setMessage("Login successful! Redirecting...");
        }

        // Redirect to dashboard after a short delay
        setTimeout(() => {
          navigate("/");
        }, 1500);
      } catch (err) {
        setStatus("error");
        setMessage("Failed to complete login. Please try again.");
        console.error("Azure callback error:", err);
      }
    };

    handleCallback();
  }, [dispatch, navigate]);

  const getErrorMessage = (error, message) => {
    const errorMessages = {
      azure_not_configured: "Azure authentication is not configured. Please contact your administrator.",
      azure_auth_failed: `Authentication failed: ${message || "Unknown error"}`,
      no_authorization_code: "No authorization code received from Microsoft.",
      no_email_from_azure: "Could not retrieve your email from Microsoft. Please ensure your account has an email address.",
      email_already_linked: "This email is already linked to another Microsoft account.",
      azure_callback_failed: `Login failed: ${message || "Unknown error"}`,
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

export default AzureCallback;
