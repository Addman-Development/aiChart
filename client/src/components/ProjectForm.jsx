import React, { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import {
  Input, Button, Spacer, Modal, ModalHeader, ModalBody, ModalContent, Tabs, Tab,
} from "@heroui/react";
import { LuArrowRight } from "react-icons/lu";

import { createProject } from "../slices/project";
import { selectTeam } from "../slices/team";
import CustomTemplates from "../containers/Connections/CustomTemplates/CustomTemplates";
import Row from "./Row";
import Text from "./Text";
import { selectConnections } from "../slices/connection";

function ProjectForm(props) {
  const {
    onComplete = () => {},
    hideType = false,
    onClose,
    open,
  } = props;

  const [loading, setLoading] = useState(false);
  const [newProject, setNewProject] = useState({});
  const [error, setError] = useState("");
  const [activeMenu, setActiveMenu] = useState("empty");
  const [createdProject, setCreatedProject] = useState(null);
  const modalSize = useMemo(() => {
    if (activeMenu === "empty") return "xl";
    return "3xl";
  }, [activeMenu]);

  const team = useSelector(selectTeam);
  const connections = useSelector(selectConnections);

  const dispatch = useDispatch();

  const _onCreateProject = (noRedirect) => {
    setLoading(true);
    return dispatch(createProject({ data: newProject }))
      .then((project) => {
        setLoading(false);
        setNewProject({});
        setCreatedProject(project.payload);

        if (noRedirect) return project.payload;

        return onComplete(project.payload);
      })
      .catch((error) => {
        setLoading(false);
        setError(error);
      });
  };

  const _onCompleteTemplate = () => {
    setTimeout(() => {
      onComplete(createdProject, false);
    }, 1000);
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      closeButton
      size={modalSize}
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>
          <Text size="h3">Create a new dashboard</Text>
        </ModalHeader>
        <ModalBody>
          <form onSubmit={(e) => {
            e.preventDefault();
            _onCreateProject();
          }}>
            <div>
              <Spacer y={2} />
              {!hideType && (
                <Row align="center" justify="center">
                  <Tabs selectedKey={activeMenu} onSelectionChange={(key) => setActiveMenu(key)} fullWidth isDisabled={!newProject.name}>
                    <Tab key="empty" id="empty" title="Empty dashboard" />
                    <Tab key="template" id="template" title="Custom templates" />
                  </Tabs>
                </Row>
              )}
              <Spacer y={4} />
              <Row align="center">
                <Input
                  onChange={(e) => setNewProject({
                    ...newProject,
                    name: e.target.value,
                    team_id: team.id,
                  })}
                  label="Dashboard name"
                  placeholder="Enter a name for your dashboard"
                  fullWidth
                  size="lg"
                  variant="bordered"
                  autoFocus
                  value={newProject.name}
                  color="primary"
                />
              </Row>
              {error && (
                <Row>
                  <Text color="red">
                    {error}
                  </Text>
                </Row>
              )}
              <Spacer y={4} />
              {activeMenu === "empty" && (
                <>
                  <Spacer y={4} />
                  <Row align="center" justify="center">
                    <Button
                      isDisabled={!newProject.name}
                      onClick={() => _onCreateProject()}
                      endContent={<LuArrowRight />}
                      color="primary"
                      size="lg"
                      isLoading={loading}
                      fullWidth
                    >
                      {"Create"}
                    </Button>
                  </Row>
                </>
              )}
            </div>
          </form>

          {activeMenu === "template" && (
            <>
              <h3 className="font-semibold">{"Select a template"}</h3>
              <CustomTemplates
                teamId={team.id}
                projectId={createdProject && createdProject.id}
                connections={[]}
                onComplete={_onCompleteTemplate}
                onCreateProject={() => _onCreateProject(true)}
                isAdmin
              />
            </>
          )}
          <Spacer y={1} />
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

ProjectForm.propTypes = {
  onComplete: PropTypes.func,
  hideType: PropTypes.bool,
  onClose: PropTypes.func.isRequired,
  open: PropTypes.bool.isRequired,
};

export default ProjectForm;
