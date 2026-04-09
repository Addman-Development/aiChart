import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import {
  Button, Spacer, Checkbox, Input, Accordion, Radio, AccordionItem, RadioGroup,
  Chip, Alert, Switch, Autocomplete, AutocompleteItem, Avatar,
} from "@heroui/react";
import _ from "lodash";
import { LuCheck, LuCopy, LuMail, LuUser, LuLock, LuUserPlus, LuUsers } from "react-icons/lu";

import { createTeamUser, getAvailableUsers, addExistingUserToTeam } from "../slices/team";
import { selectTeam } from "../slices/team";
import { selectProjects } from "../slices/project";

function CreateUserForm(props) {
  const [loading, setLoading] = useState(false);
  const [projectAccess, setProjectAccess] = useState([]);
  const [exportAllowed, setExportAllowed] = useState(false);
  const [role, setRole] = useState("teamAdmin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sendEmail, setSendEmail] = useState(true);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [passwordCopied, setPasswordCopied] = useState(false);

  // Existing user selection
  const [mode, setMode] = useState("existing"); // "existing" or "new"
  const [availableUsers, setAvailableUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);

  const { selectedProjects = null } = props;

  const team = useSelector(selectTeam);
  const projects = useSelector(selectProjects);
  const dispatch = useDispatch();

  useEffect(() => {
    if (selectedProjects?.length > 0) {
      setProjectAccess(selectedProjects);
    }
  }, [selectedProjects]);

  useEffect(() => {
    if (team?.id) {
      _fetchAvailableUsers();
    }
  }, [team?.id]);

  // Clear result when switching modes
  useEffect(() => {
    setResult(null);
    setError("");
    setSelectedUserId(null);
    setName("");
    setEmail("");
  }, [mode]);

  const _fetchAvailableUsers = () => {
    setLoadingUsers(true);
    dispatch(getAvailableUsers({ team_id: team.id }))
      .then((data) => {
        if (data.payload) {
          setAvailableUsers(data.payload);
        }
        setLoadingUsers(false);
      })
      .catch(() => setLoadingUsers(false));
  };

  const _onAddExistingUser = () => {
    if (!selectedUserId) {
      setError("Please select a user");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    dispatch(addExistingUserToTeam({
      team_id: team.id,
      userId: selectedUserId,
      role,
      projects: role !== "teamAdmin" ? projectAccess : [],
      canExport: role !== "teamAdmin" ? exportAllowed : true,
    }))
      .then((data) => {
        if (data.error) {
          throw new Error(data.error?.message || "Error adding user");
        }
        setResult({ ...data.payload, created: false });
        setSelectedUserId(null);
        setLoading(false);
        // Refresh the available users list
        _fetchAvailableUsers();
      })
      .catch((err) => {
        setError(err.message || "Error adding user");
        setLoading(false);
      });
  };

  const _onCreateUser = () => {
    if (!name.trim() || !email.trim()) {
      setError("Name and email are required");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    dispatch(createTeamUser({
      team_id: team.id,
      name: name.trim(),
      email: email.trim(),
      role,
      projects: role !== "teamAdmin" ? projectAccess : [],
      canExport: role !== "teamAdmin" ? exportAllowed : true,
      sendEmail,
    }))
      .then((data) => {
        if (data.error) {
          throw new Error(data.error?.message || "Error creating user");
        }
        setResult(data.payload);
        setLoading(false);
        setName("");
        setEmail("");
        // Refresh available users in case we need to switch back
        _fetchAvailableUsers();
      })
      .catch((err) => {
        setError(err.message || "Error creating user");
        setLoading(false);
      });
  };

  const _onChangeProjectAccess = (projectId) => {
    const newAccess = [].concat(projectAccess) || [];
    const isFound = _.indexOf(projectAccess, projectId);

    if (isFound === -1) {
      newAccess.push(projectId);
    } else {
      newAccess.splice(isFound, 1);
    }

    setProjectAccess(newAccess);
  };

  const _onCopyPassword = () => {
    if (result?.temporaryPassword) {
      navigator.clipboard.writeText(result.temporaryPassword);
      setPasswordCopied(true);
      setTimeout(() => setPasswordCopied(false), 2000);
    }
  };

  return (
    <div>
      <div className="text-lg font-semibold font-tw">Add a team member</div>
      <div className="text-sm text-gray-500">
        Add an existing user or create a new account for your team.
      </div>

      <Spacer y={4} />

      <div className="flex gap-2">
        <Button
          variant={mode === "existing" ? "solid" : "bordered"}
          color={mode === "existing" ? "primary" : "default"}
          onPress={() => setMode("existing")}
          size="sm"
          startContent={<LuUsers size={16} />}
        >
          Existing user
        </Button>
        <Button
          variant={mode === "new" ? "solid" : "bordered"}
          color={mode === "new" ? "primary" : "default"}
          onPress={() => setMode("new")}
          size="sm"
          startContent={<LuUserPlus size={16} />}
        >
          New user
        </Button>
      </div>

      <Spacer y={4} />

      {/* Existing user picker */}
      {mode === "existing" && (
        <div className="max-w-md">
          <Autocomplete
            label="Search for a user"
            placeholder="Type a name or email..."
            isLoading={loadingUsers}
            defaultItems={availableUsers}
            selectedKey={selectedUserId ? String(selectedUserId) : null}
            onSelectionChange={(key) => {
              setSelectedUserId(key ? parseInt(key, 10) : null);
              setError("");
            }}
            startContent={<LuUser />}
            variant="bordered"
          >
            {(user) => (
              <AutocompleteItem
                key={String(user.id)}
                textValue={`${user.name} ${user.email}`}
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    name={user.icon || user.name?.substring(0, 2)}
                    size="sm"
                    className="flex-shrink-0"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium">{user.name}</span>
                    <span className="text-xs text-default-400">{user.email}</span>
                  </div>
                </div>
              </AutocompleteItem>
            )}
          </Autocomplete>
          {availableUsers.length === 0 && !loadingUsers && (
            <p className="text-sm text-default-400 mt-2">
              No users available to add. All existing users are already in this team.
            </p>
          )}
        </div>
      )}

      {/* New user form */}
      {mode === "new" && (
        <div className="flex flex-col gap-4 max-w-md">
          <Input
            label="Full name"
            placeholder="Enter user's name"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(""); }}
            startContent={<LuUser />}
            variant="bordered"
          />
          <Input
            label="Email address"
            placeholder="Enter user's email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            startContent={<LuMail />}
            variant="bordered"
            type="email"
          />
        </div>
      )}

      {/* Role selection (shared between modes) */}
      {!selectedProjects && (
        <>
          <Spacer y={4} />
          <div className="font-bold">{"Select a role"}</div>
          <Spacer y={2} />
          <div>
            <RadioGroup size="sm" defaultValue="teamAdmin" value={role} onValueChange={(option) => setRole(option)}>
              <Radio
                value="teamAdmin"
                description={"Access to all projects, connections, datasets, but can't delete the team or interact with the team's billing"}
              >
                Team Admin
              </Radio>
              <Radio
                value="projectAdmin"
                description={"Can manage all charts and reports in the selected dashboards. Can also edit tagged datasets and queries."}
              >
                Client Admin
              </Radio>
              <Radio
                value="projectEditor"
                description={"Can view and edit all charts and reports in the selected dashboard. Can also edit tagged datasets but cannot edit data queries."}
              >
                Client Editor
              </Radio>
              <Radio
                value="projectViewer"
                description={"Can view all charts and reports in the selected dashboard"}
              >
                Client Viewer
              </Radio>
            </RadioGroup>
          </div>
          <Spacer y={4} />

          {role !== "teamAdmin" && (
            <div>
              <Accordion variant="bordered">
                <AccordionItem
                  title="Select dashboard access"
                  subtitle={projectAccess.length > 0 ? `${projectAccess.length} dashboard${projectAccess.length > 1 ? "s" : ""} selected` : "No dashboards selected yet"}
                >
                  <div className="grid grid-cols-12 gap-1 pb-4">
                    {projects && projects.filter((p) => !p.ghost).map((project) => (
                      <div className="col-span-12 sm:col-span-4" key={project.id}>
                        <Checkbox
                          isSelected={_.indexOf(projectAccess, project.id) > -1}
                          onChange={() => _onChangeProjectAccess(project.id)}
                        >
                          {project.name}
                        </Checkbox>
                      </div>
                    ))}
                  </div>
                </AccordionItem>
              </Accordion>
            </div>
          )}
        </>
      )}

      {role !== "teamAdmin" && (
        <>
          <Spacer y={4} />
          <Checkbox
            isSelected={exportAllowed}
            onValueChange={(isSelected) => setExportAllowed(isSelected)}
          >
            Allow data export
          </Checkbox>
        </>
      )}

      {/* Send email toggle (only for new users) */}
      {mode === "new" && (
        <>
          <Spacer y={4} />
          <Switch
            isSelected={sendEmail}
            onValueChange={setSendEmail}
            size="sm"
          >
            <span className="text-sm">Send invite email with login credentials</span>
          </Switch>
        </>
      )}

      <Spacer y={4} />

      {mode === "existing" ? (
        <Button
          isLoading={loading}
          onPress={_onAddExistingUser}
          color="primary"
          size="sm"
          startContent={<LuUserPlus />}
          isDisabled={!selectedUserId}
        >
          {loading ? "Adding..." : "Add to team"}
        </Button>
      ) : (
        <Button
          isLoading={loading}
          onPress={_onCreateUser}
          color="primary"
          size="sm"
          startContent={<LuUserPlus />}
        >
          {loading ? "Creating..." : "Create and add to team"}
        </Button>
      )}

      {error && (
        <>
          <Spacer y={2} />
          <Alert color="danger" variant="flat" title={error} />
        </>
      )}

      {result && (
        <>
          <Spacer y={4} />
          {result.created ? (
            <Alert
              color="success"
              variant="flat"
              title="User created and added to team"
              description={
                result.emailSent
                  ? "An email with login credentials has been sent to the user."
                  : "Share the temporary password below with the user."
              }
            />
          ) : (
            <Alert
              color="success"
              variant="flat"
              title="User added to team"
              description={`${result.user?.name || "The user"} has been added to this team.`}
            />
          )}

          {result.temporaryPassword && (
            <>
              <Spacer y={2} />
              <Input
                label="Temporary password (share with user)"
                value={result.temporaryPassword}
                readOnly
                variant="bordered"
                startContent={<LuLock />}
                endContent={(
                  <Button
                    color={passwordCopied ? "success" : "default"}
                    onPress={_onCopyPassword}
                    size="sm"
                    isIconOnly
                    variant="light"
                  >
                    {passwordCopied ? <LuCheck /> : <LuCopy />}
                  </Button>
                )}
                className="max-w-md"
              />
            </>
          )}

          <Spacer y={2} />
          <div className="flex flex-wrap items-center gap-1">
            <Chip color="warning" variant="flat" size="sm">
              {`${role} role`}
            </Chip>
            {role !== "teamAdmin" && (
              <>
                <Chip color="primary" variant="flat" size="sm">
                  {`Access to ${projectAccess.length} dashboard${projectAccess.length !== 1 ? "s" : ""}`}
                </Chip>
                <Chip color="success" variant="flat" size="sm">
                  {exportAllowed ? "Data export allowed" : "Data export not allowed"}
                </Chip>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

CreateUserForm.propTypes = {
  selectedProjects: PropTypes.array,
};

export default CreateUserForm;
