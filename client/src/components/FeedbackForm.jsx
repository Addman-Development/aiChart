import React, { useRef, useState } from "react";
import { useDispatch } from "react-redux";
import {
  Button, Image, Select, SelectItem, Spacer, Textarea,
} from "@heroui/react";
import { LuImagePlus, LuX } from "react-icons/lu";
import toast from "react-hot-toast";

import { sendFeedback } from "../slices/user";
import { hideFeedbackModal } from "../slices/ui";
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

// Mirrors the limits enforced by the server (api/FeedbackRoute.js).
const MAX_SCREENSHOTS = 3;
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];

function FeedbackForm() {
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  // Each entry: { file, previewUrl } so we can render a thumbnail and revoke it.
  const [screenshots, setScreenshots] = useState([]);

  const fileInputRef = useRef(null);
  const dispatch = useDispatch();

  const _onSelectFiles = (e) => {
    const incoming = Array.from(e.target.files || []);
    // Reset the input so picking the same file again still fires onChange.
    e.target.value = "";

    const accepted = [];
    for (const file of incoming) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        toast.error(`"${file.name}" isn't a supported image type.`);
        continue;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        toast.error(`"${file.name}" is larger than 5MB.`);
        continue;
      }
      accepted.push(file);
    }

    setScreenshots((prev) => {
      const room = MAX_SCREENSHOTS - prev.length;
      if (room <= 0) {
        toast.error(`You can attach at most ${MAX_SCREENSHOTS} screenshots.`);
        return prev;
      }
      if (accepted.length > room) {
        toast.error(`You can attach at most ${MAX_SCREENSHOTS} screenshots.`);
      }
      const next = accepted.slice(0, room).map((file) => ({
        file,
        previewUrl: URL.createObjectURL(file),
      }));
      return [...prev, ...next];
    });
  };

  const _removeScreenshot = (index) => {
    setScreenshots((prev) => {
      const target = prev[index];
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const _onSendFeedback = () => {
    if (!message.trim()) return;

    setLoading(true);
    setSuccess(false);
    setSubmitError(false);

    const files = screenshots.map((s) => s.file);
    const payload = {
      category,
      message: message.trim(),
      pageUrl: window.location.href,
    };

    dispatch(sendFeedback({ ...payload, screenshots: files }))
      .unwrap()
      .then(() => {
        setLoading(false);
        setSuccess(true);
        setMessage("");
        screenshots.forEach((s) => URL.revokeObjectURL(s.previewUrl));
        setScreenshots([]);
        // A clean send clears any earlier re-auth marker.
        sessionStorage.removeItem(FEEDBACK_REAUTH_ATTEMPTED_KEY);
        // Confirm and close the modal (no-op on the standalone /feedback page).
        toast.success("Thanks! Your feedback was sent.");
        dispatch(hideFeedbackModal());
      })
      .catch(async (err) => {
        const alreadyTried = sessionStorage.getItem(FEEDBACK_REAUTH_ATTEMPTED_KEY) === "1";

        // If the platform couldn't validate our token, re-authenticate with
        // Keycloak (which re-seeds the server token cache) and resubmit on
        // return. Only do this once per session to avoid redirect loops.
        // Screenshots can't survive the redirect (files aren't serializable),
        // so only the text payload is restored on return.
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
          minRows={8}
          fullWidth
          variant="bordered"
        />
      </Row>
      <Spacer y={2} />
      <Row align="center" className="gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          multiple
          className="hidden"
          onChange={_onSelectFiles}
        />
        <Button
          variant="bordered"
          startContent={<LuImagePlus />}
          onPress={() => fileInputRef.current?.click()}
          isDisabled={screenshots.length >= MAX_SCREENSHOTS}
        >
          Attach screenshots
        </Button>
        <Text size="sm" className="text-default-400">
          {`${screenshots.length}/${MAX_SCREENSHOTS} • PNG, JPEG, WebP, GIF up to 5MB`}
        </Text>
      </Row>
      {screenshots.length > 0 && (
        <>
          <Spacer y={2} />
          <Row wrap="wrap" className="gap-3">
            {screenshots.map((s, index) => (
              <div key={s.previewUrl} className="relative">
                <Image
                  src={s.previewUrl}
                  alt={s.file.name}
                  width={96}
                  height={96}
                  radius="sm"
                  className="object-cover w-24 h-24 border border-default-200"
                />
                <Button
                  isIconOnly
                  size="sm"
                  radius="full"
                  color="danger"
                  variant="solid"
                  aria-label={`Remove ${s.file.name}`}
                  className="absolute -top-2 -right-2 z-10 min-w-6 w-6 h-6"
                  onPress={() => _removeScreenshot(index)}
                >
                  <LuX size={14} />
                </Button>
              </div>
            ))}
          </Row>
        </>
      )}
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
