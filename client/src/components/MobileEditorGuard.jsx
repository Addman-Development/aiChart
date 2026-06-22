import React, { useState } from "react";
import PropTypes from "prop-types";
import { Button, Card, CardBody } from "@heroui/react";
import { LuMonitorSmartphone } from "react-icons/lu";
import { useNavigate } from "react-router";

import useIsMobile from "../modules/useIsMobile";

const OVERRIDE_KEY = "smartchart_editor_mobile_override";

// Reads the session override that lets a phone user opt into the heavy editors.
const getInitialOverride = () => {
  try {
    return window.localStorage.getItem(OVERRIDE_KEY) === "true";
  } catch (error) {
    return false;
  }
};

// Gates the chart editor, dataset builder and connection wizard on phones.
// Editing is out of scope on small screens, so unless the user explicitly opts
// in we show a graceful notice with an escape hatch instead of mounting the
// heavy editor. The opt-in persists for the session via localStorage.
function MobileEditorGuard(props) {
  const { children } = props;

  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [override, setOverride] = useState(getInitialOverride);

  const _onContinue = () => {
    try {
      window.localStorage.setItem(OVERRIDE_KEY, "true");
    } catch (error) {
      // Ignore write failures (e.g. storage disabled); still allow this session.
    }
    setOverride(true);
  };

  if (isMobile && !override) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <Card className="max-w-sm w-full">
          <CardBody className="flex flex-col items-center text-center gap-3 py-6">
            <LuMonitorSmartphone size={48} className="text-foreground-700" />
            <h1 className="text-lg font-tw font-bold">
              Editing works best on a larger screen
            </h1>
            <p className="text-sm text-default-500">
              This editor is designed for desktop. Open it on a computer for the
              full experience, or continue anyway on this device.
            </p>
            <div className="flex flex-col gap-2 w-full mt-2">
              <Button
                color="primary"
                fullWidth
                onPress={() => navigate("/")}
              >
                Return to dashboard
              </Button>
              <Button
                variant="light"
                fullWidth
                onPress={_onContinue}
              >
                Continue anyway
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return children;
}

MobileEditorGuard.propTypes = {
  children: PropTypes.node.isRequired,
};

export default MobileEditorGuard;
