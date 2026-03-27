import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import {
  Button, Input, Spacer, Link, Card, Tabs, Tab, CardBody, Image, CardFooter, Divider,
} from "@heroui/react";
import { useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import { LuArrowLeft, LuArrowRight } from "react-icons/lu";

import CustomTemplates from "../../Connections/CustomTemplates/CustomTemplates";
import canAccess from "../../../config/canAccess";
import Container from "../../../components/Container";
import Text from "../../../components/Text";
import Row from "../../../components/Row";
import { selectTeam } from "../../../slices/team";
import { selectUser } from "../../../slices/user";

function ChartDescription(props) {
  const {
    name = "", onChange, onCreate, teamId, projectId, connections, templates,
  } = props;

  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formType, setFormType] = useState("");
  const [selectedMenu, setSelectedMenu] = useState("emptyChart");

  const navigate = useNavigate();
  const params = useParams();
  const team = useSelector(selectTeam);
  const user = useSelector(selectUser);

  useEffect(() => {
    if (!name) _populateName();
  }, []);

  const _onNameChange = (e) => {
    onChange(e.target.value);
  };

  const _onCreatePressed = () => {
    if (!name) {
      setError(true);
      return;
    }
    setLoading(true);
    onCreate()
      .then(() => setLoading(false))
      .catch(() => setLoading(false));
  };

  const _onCompleteTemplate = () => {
    navigate(`/${teamId}/${projectId}/dashboard`);
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const _populateName = () => {
    const names = [
      "Awesome", "Majestic", "Spectacular", "Superb", "Grandiose", "Charty", "Breathtaking", "Awe-inspiring",
      "Chartiful", "Beautiful", "Super", "Formidable", "Stunning", "Astonishing", "Magnificent",
    ];
    onChange(`${names[Math.floor(Math.random() * names.length)]} chart`);
  };

  const _canAccess = (role) => {
    return canAccess(role, user.id, team.TeamRoles, user);
  };

  return (
    <Container className={"bg-content1 rounded-lg p-4 border-1 border-solid border-content3"}>
      <Row align="center" wrap="wrap">
        <Tabs selectedKey={selectedMenu} onSelectionChange={(key) => setSelectedMenu(key)}>
          <Tab key="emptyChart" title="Create from scratch" />
          <Tab key="customTemplates" title="Custom templates" isDisabled={!_canAccess("teamAdmin")} />
        </Tabs>
      </Row>
      <Spacer y={4} />
      {!formType && (
        <>
          {selectedMenu === "emptyChart" && (
            <>
              <Row align="center">
                <Text size="h3">
                  {"What are you brewing today?"}
                </Text>
              </Row>
              <Row align="center">
                <Text>
                  {"Write a short summary of your visualization"}
                </Text>
              </Row>
              <Spacer y={2} />
              <Row align="center">
                <form
                  id="create-chart"
                  onSubmit={(e) => {
                    e.preventDefault();
                    _onCreatePressed();
                  }}
                  style={{ width: "100%" }}
                >
                  <Input
                    placeholder="'User growth in the last month'"
                    color={error ? "danger" : "primary"}
                    description={error}
                    value={name}
                    onChange={_onNameChange}
                    size="lg"
                    fullWidth
                    autoFocus
                    variant="bordered"
                  />
                </form>
              </Row>
              <Spacer y={1} />
              <Row align="center">
                <Link
                  onClick={_populateName}
                >
                  <Text className={"text-primary"}>{"Can't think of something?"}</Text>
                </Link>
              </Row>

              <Spacer y={4} />
              <Row align="center">
                <Button
                  isDisabled={!name}
                  isLoading={loading}
                  type="submit"
                  onPress={_onCreatePressed}
                  form="create-chart"
                  color="primary"
                  size="lg"
                  endContent={<LuArrowRight />}
                >
                  Start editing
                </Button>
              </Row>
            </>
          )}
          {selectedMenu === "customTemplates" && (
            <Row align="center">
              <CustomTemplates
                templates={templates.data}
                loading={templates.loading}
                teamId={team?.id}
                projectId={params.projectId}
                connections={connections}
                onComplete={_onCompleteTemplate}
                isAdmin={canAccess("teamAdmin", user.id, team.TeamRoles, user)}
              />
            </Row>
          )}
        </>
      )}

      {formType && (
        <>
          <Row align={"start"} justify={"start"}>
            <Button
              variant="flat"
              onPress={() => setFormType("")}
              startContent={<LuArrowLeft />}
              size="small"
            >
              Back
            </Button>
          </Row>

          <Spacer y={2} />
          <Divider />
          <Spacer y={4} />
        </>
      )}

    </Container>
  );
}

ChartDescription.propTypes = {
  name: PropTypes.string,
  onChange: PropTypes.func.isRequired,
  onCreate: PropTypes.func.isRequired,
  teamId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  projectId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  connections: PropTypes.array.isRequired,
  templates: PropTypes.array.isRequired,
};

export default ChartDescription;
