import React, { useState } from "react";
import { useDispatch } from "react-redux";
import {
  Button, Select, SelectItem, Spacer, Textarea,
} from "@heroui/react";

import { sendFeedback } from "../slices/user";
import {
  startKeycloakLogin, FEEDBACK_PENDING_KEY, FEEDBACK_REAUTH_ATTEMPTED_KEY,
} from "../modules/keycloakReauth";
import Container from "./Container";
import Row from "./Row";
import Text from "./Text";

const categories = [
  { key: "bug", label: "Bug — something isn't working" },
  { key: "idea", label: "Idea — a suggestion or feature request" },
  { key: "other", label: "Other" },
];

const MAX_MESSAGE_LENGTH = 4000;

function FeedbackForm() {
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");

  const dispatch = useDispatch();

  const _onSendFeedback = () => {
    if (!message.trim()) return;

    setLoading(true);
    setSuccess(false);
    setSubmitError(false);

    const payload = {
      category,
      message: message.trim(),
      pageUrl: window.location.href,
    };

    dispatch(sendFeedback(payload))
      .unwrap()
      .then(() => {
        setLoading(false);
        setSuccess(true);
        setMessage("");
        // A clean send clears any earlier re-auth marker.
        sessionStorage.removeItem(FEEDBACK_REAUTH_ATTEMPTED_KEY);
      })
      .catch(async (err) => {
        const alreadyTried = sessionStorage.getItem(FEEDBACK_REAUTH_ATTEMPTED_KEY) === "1";

        // If the platform couldn't validate our token, re-authenticate with
        // Keycloak (which re-seeds the server token cache) and resubmit on
        // return. Only do this once per session to avoid redirect loops.
        if (err?.reauthRequired && !alreadyTried) {
          try {
            sessionStorage.setItem(FEEDBACK_PENDING_KEY, JSON.stringify(payload));
            sessionStorage.setItem(FEEDBACK_REAUTH_ATTEMPTED_KEY, "1");
            await startKeycloakLogin(); // full-page redirect; we resume on return
            return;
          } catch (e) {
            sessionStorage.removeItem(FEEDBACK_PENDING_KEY);
          }
        }

        setLoading(false);
        setSubmitError(true);
      });
  };

  return (
    <Container>
      <Row>
        <Text size="h4">{"Feedback & Suggestions"}</Text>
      </Row>
      <Spacer y={1} />
      <Row>
        <Text>We would appreciate any feedback you may have</Text>
      </Row>
      <Spacer y={2} />
      <Row>
        <Select
          label="Category"
          labelPlacement="outside"
          variant="bordered"
          selectedKeys={[category]}
          onSelectionChange={(keys) => setCategory(keys.currentKey || "bug")}
          disallowEmptySelection
          fullWidth
        >
          {categories.map((c) => (
            <SelectItem key={c.key}>{c.label}</SelectItem>
          ))}
        </Select>
      </Row>
      <Spacer y={2} />
      <Row>
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          name="message"
          label="Your message"
          labelPlacement="outside"
          placeholder="Tell us what's on your mind"
          maxLength={MAX_MESSAGE_LENGTH}
          description={`${message.length}/${MAX_MESSAGE_LENGTH}`}
          minRows={4}
          fullWidth
          variant="bordered"
        />
      </Row>
      {(success || submitError) && <Spacer y={1} />}
      <Row>
        {success
          && <Text color="success">{"We received your feedback and will work on it. Thank you!"}</Text>}
        {submitError
          && <Text color="danger">{"Something went wrong. Please try again in a moment."}</Text>}
      </Row>
      <Spacer y={2} />
      <Row>
        <Button
          isDisabled={!message.trim()}
          onPress={() => _onSendFeedback()}
          color="primary"
          isLoading={loading}
        >
          Send feedback
        </Button>
      </Row>
    </Container>
  );
}

export default FeedbackForm;
