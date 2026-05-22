import { Avatar, Button, Card, CardBody, CardFooter, Checkbox, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Spacer, Tooltip } from "@heroui/react"
import React, { useEffect, useState } from "react"
import { LuCopy, LuDownload, LuEllipsis, LuInfo, LuPencilLine, LuPlug, LuPlus, LuSearch, LuShare2, LuTags, LuTrash, LuUsers } from "react-icons/lu"
import { useDispatch, useSelector } from "react-redux"
import { Link, useNavigate } from "react-router"
import { toast } from "react-hot-toast"

import { selectTeam, selectTeams } from "../../slices/team"
import canAccess from "../../config/canAccess"
import { selectUser } from "../../slices/user"
import connectionImages from "../../config/connectionImages"
import {
  duplicateConnection,
  getSharedConnections,
  getTeamConnections,
  importConnections,
  optInSharedConnection,
  optOutSharedConnection,
  removeConnection,
  saveConnection,
  selectConnections,
  selectSharedConnections,
} from "../../slices/connection"
import { useTheme } from "../../modules/ThemeContext"
import { selectProjects } from "../../slices/project"
import { selectDatasets } from "../../slices/dataset"
import { getAuthToken } from "../../modules/auth"
import { API_HOST } from "../../config/settings"

function ConnectionList() {
  const [connectionSearch, setConnectionSearch] = useState("");
  const [connectionToEdit, setConnectionToEdit] = useState(null);
  const [connectionToDelete, setConnectionToDelete] = useState(null);
  const [modifyingConnection, setModifyingConnection] = useState(false);
  const [deletingConnection, setDeletingConnection] = useState(false);
  const [deleteRelatedDatasets, setDeleteRelatedDatasets] = useState(false);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [viewingDuplicateModal, setViewingDuplicateModal] = useState(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importSourceTeam, setImportSourceTeam] = useState(null);
  const [importSourceConnections, setImportSourceConnections] = useState([]);
  const [importSelectedIds, setImportSelectedIds] = useState([]);
  const [importLoading, setImportLoading] = useState(false);
  const [importFetchingConnections, setImportFetchingConnections] = useState(false);

  const team = useSelector(selectTeam);
  const user = useSelector(selectUser);
  const teams = useSelector(selectTeams);
  const connections = useSelector(selectConnections);
  const sharedConnections = useSelector(selectSharedConnections);
  const projects = useSelector(selectProjects);
  const datasets = useSelector(selectDatasets);

  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { isDark } = useTheme();

  useEffect(() => {
    if (team?.id) {
      dispatch(getSharedConnections({ team_id: team.id }));
    }
  }, [team?.id]);

  const _availableSharedConnections = (sharedConnections || []).filter((c) => (
    !c.isOwner && !c.isOptedIn && team?.id && c.team_id !== team.id
  ));

  const _isOptedInShared = (connectionId) => {
    if (!team?.id) return false;
    const connection = (connections || []).find((c) => c.id === connectionId);
    if (!connection) return false;
    return connection.team_id !== team.id;
  };

  const _onOptIn = async (connection) => {
    try {
      await dispatch(optInSharedConnection({ team_id: team.id, connection_id: connection.id })).unwrap();
      await dispatch(getTeamConnections({ team_id: team.id }));
      toast.success(`"${connection.name}" added to ${team.name}`);
    } catch (e) {
      toast.error(e.message || "Failed to opt in");
    }
  };

  const _onOptOut = async (connection) => {
    try {
      await dispatch(optOutSharedConnection({ team_id: team.id, connection_id: connection.id })).unwrap();
      await dispatch(getTeamConnections({ team_id: team.id }));
      toast.success(`Removed "${connection.name}" from ${team.name}`);
    } catch (e) {
      toast.error(e.message || "Failed to opt out");
    }
  };

  const _canAccess = (role, teamRoles) => {
    return canAccess(role, user.id, teamRoles, user);
  };

  const _getFilteredConnections = () => {
    if (!connectionSearch) return connections || [];

    const filteredConnections = connections.filter((c) => {
      return c.name.toLowerCase().indexOf(connectionSearch.toLowerCase()) > -1;
    });

    return filteredConnections || [];
  };

  const _onEditConnectionTags = async () => {
    setModifyingConnection(true);

    const projectIds = connectionToEdit.project_ids || [];

    await dispatch(saveConnection({
      team_id: team.id,
      connection: { id: connectionToEdit.id, project_ids: projectIds },
    }));

    setModifyingConnection(false);
    setConnectionToEdit(null);
  };

  const _getConnectionTags = (projectIds) => {
    const tags = [];
    if (!projects || !projectIds) return tags;
    projectIds.forEach((projectId) => {
      const project = projects.find((p) => p.id === projectId);
      if (project) {
        tags.push(project.name);
      }
    });

    return tags;
  };

  const _onDeleteConnection = () => {
    setDeletingConnection(true);
    dispatch(removeConnection({
      team_id: team.id,
      connection_id: connectionToDelete.id,
      removeDatasets: deleteRelatedDatasets
    }))
      .then(() => {
        setDeletingConnection(false);
        setConnectionToDelete(null);
      })
      .catch(() => {
        setDeletingConnection(false);
      });
  };

  const _getRelatedDatasets = (connectionId) => {
    return datasets.filter((d) => d.DataRequests?.find((dr) => dr.connection_id === connectionId));
  };

  const _getOtherTeams = () => {
    if (!teams || !team) return [];
    return teams.filter((t) => {
      if (t.id === team.id) return false;
      const role = t.TeamRoles?.find((tr) => tr.user_id === user.id);
      return role && ["teamOwner", "teamAdmin"].includes(role.role);
    });
  };

  const _onSelectImportTeam = async (teamId) => {
    if (!teamId) {
      setImportSourceTeam(null);
      setImportSourceConnections([]);
      setImportSelectedIds([]);
      return;
    }

    setImportSourceTeam(teamId);
    setImportSelectedIds([]);
    setImportFetchingConnections(true);

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_HOST}/team/${teamId}/connections`, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setImportSourceConnections(data);
      } else {
        toast.error("Failed to fetch connections from the selected team");
        setImportSourceConnections([]);
      }
    } catch (e) {
      toast.error("Failed to fetch connections");
      setImportSourceConnections([]);
    }

    setImportFetchingConnections(false);
  };

  const _onToggleImportConnection = (connectionId) => {
    setImportSelectedIds((prev) =>
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    );
  };

  const _onImportConnections = async () => {
    if (importSelectedIds.length === 0) {
      toast.error("Please select at least one connection to import");
      return;
    }

    setImportLoading(true);
    try {
      const result = await dispatch(importConnections({
        team_id: team.id,
        source_team_id: importSourceTeam,
        connection_ids: importSelectedIds,
      }));

      if (result?.error) {
        toast.error("Failed to import connections");
      } else {
        toast.success(`Imported ${importSelectedIds.length} connection${importSelectedIds.length > 1 ? "s" : ""} successfully`);
        setImportModalOpen(false);
        setImportSourceTeam(null);
        setImportSourceConnections([]);
        setImportSelectedIds([]);
      }
    } catch (e) {
      toast.error("Failed to import connections");
    }
    setImportLoading(false);
  };

  const _onDuplicateConnection = (connection) => {
    if (!duplicateName) {
      toast.error("Please enter a name for the new connection");
      return;
    }

    setDuplicateLoading(true);
    dispatch(duplicateConnection({
      team_id: team.id,
      connection_id: connection.id,
      name: duplicateName,
    }))
      .then((response) => {
        if (response?.error) {
          toast.error("Failed to duplicate connection");
        }
        else {
          toast.success("Connection duplicated successfully");
        }

        setDuplicateLoading(false);
        setViewingDuplicateModal(null);
        setDuplicateName("");
      })
      .catch(() => {
        setDuplicateLoading(false);
        setViewingDuplicateModal(null);
        setDuplicateName("");
        toast.error("Failed to duplicate connection");
      });
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-row items-center justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-2xl font-semibold font-tw">
            Data connections
          </div>
          <div className="text-sm text-foreground-500">
            {"Connect your data sources to ADDMAN-SmartChart"}
          </div>
        </div>

        <div className="flex flex-row items-center gap-2">
          {_canAccess("teamAdmin", team.TeamRoles) && _getOtherTeams().length > 0 && (
            <Button
              variant="bordered"
              endContent={<LuDownload />}
              onPress={() => setImportModalOpen(true)}
              isDisabled={user.temporary}
            >
              Import connection
            </Button>
          )}
          {_canAccess("teamAdmin", team.TeamRoles) && (
            <Button
              color="primary"
              endContent={<LuPlus />}
              onPress={() => navigate("/connections/new")}
              isDisabled={user.temporary}
            >
              Create connection
            </Button>
          )}
        </div>
      </div>
      <Spacer y={2} />
      <div className={"flex flex-row items-center gap-4"}>
        <Input
          type="text"
          placeholder="Search connections"
          variant="bordered"
          endContent={<LuSearch />}
          className="max-w-[300px]"
          labelPlacement="outside"
          onChange={(e) => setConnectionSearch(e.target.value)}
        />
      </div>
      <Spacer y={4} />

      {_canAccess("teamAdmin", team.TeamRoles) && _availableSharedConnections.length > 0 && (
        <>
          <div className="flex flex-row items-center gap-2 mb-2">
            <LuShare2 size={16} className="text-foreground-500" />
            <div className="text-sm font-medium">Shared with you</div>
            <Tooltip content="Connections a global admin has marked available to all teams. Opt in to use them in this team.">
              <div className="text-foreground-400"><LuInfo size={14} /></div>
            </Tooltip>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            {_availableSharedConnections.map((connection) => (
              <Card
                key={`shared-${connection.id}`}
                shadow="none"
                className="border-1 border-dashed border-primary-200 p-4"
                fullWidth
              >
                <CardBody>
                  <div className="flex flex-row items-center justify-between">
                    <div className="flex flex-row items-center gap-2">
                      <Avatar src={connectionImages(isDark)[connection.subType]} />
                      <div className="text-lg font-semibold font-tw">{connection.name}</div>
                    </div>
                    <Chip size="sm" variant="flat" color="primary" radius="sm" startContent={<LuShare2 size={12} />}>
                      Shared
                    </Chip>
                  </div>
                </CardBody>
                <CardBody>
                  <div className="text-xs text-foreground-500 flex items-center gap-1">
                    <LuUsers size={12} />
                    {`${connection.optedInTeamIds?.length || 0} team${(connection.optedInTeamIds?.length || 0) === 1 ? "" : "s"} using this`}
                  </div>
                </CardBody>
                <CardFooter>
                  <Button color="primary" variant="flat" size="sm" fullWidth onPress={() => _onOptIn(connection)} startContent={<LuPlus />}>
                    Add to {team.name}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        </>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {_getFilteredConnections()?.map((connection) => (
          <div key={connection.id}>
            <Card
              shadow="none"
              isHoverable
              className="border-1 border-solid border-content3 p-4 h-full"
              fullWidth
            >
              <CardBody>
                <div className="flex flex-row items-center justify-between">
                  <div className="flex flex-row items-center gap-2">
                    <Avatar src={connectionImages(isDark)[connection.subType]} />
                    <Link to={`/connections/${connection.id}`} className="text-lg font-semibold text-foreground! font-tw cursor-pointer">{connection.name}</Link>
                  </div>
                  <div className="flex flex-row items-center gap-1">
                    {connection.shared && team?.id === connection.team_id && (
                      <Tooltip content="This connection is available to all teams.">
                        <Chip size="sm" variant="flat" color="primary" radius="sm" startContent={<LuShare2 size={12} />}>
                          Shared
                        </Chip>
                      </Tooltip>
                    )}
                    {_isOptedInShared(connection.id) && (
                      <Tooltip content="Shared by another team. Opt out to remove.">
                        <Chip size="sm" variant="flat" color="secondary" radius="sm" startContent={<LuShare2 size={12} />}>
                          Shared
                        </Chip>
                      </Tooltip>
                    )}
                    {_getRelatedDatasets(connection.id).length > 0 && (
                      <Tooltip content="Datasets are using this connection.">
                        <Chip size="sm" variant="flat" color="success" radius="sm">
                          Active
                        </Chip>
                      </Tooltip>
                    )}
                    {_getRelatedDatasets(connection.id).length === 0 && (
                      <Tooltip content="No datasets are using this connection yet.">
                        <Chip size="sm" variant="flat" color="danger" radius="sm">
                          Inactive
                        </Chip>
                      </Tooltip>
                    )}
                  </div>
                </div>
              </CardBody>
              <CardBody>
                <div className="flex flex-row items-center flex-wrap gap-1">
                  {_getConnectionTags(connection.project_ids).slice(0, 3).map((tag) => (
                    <Chip key={tag} size="sm" variant="flat" color="primary" radius="sm" className="cursor-pointer" onClick={() => setConnectionToEdit(connection)}>
                      {tag}
                    </Chip>
                  ))}
                  {_getConnectionTags(connection.project_ids).length > 3 && (
                    <span className="text-xs">{`+${_getConnectionTags(connection.project_ids).length - 3} more`}</span>
                  )}
                </div>
              </CardBody>
              <CardBody>
                <div className="flex flex-row items-center justify-between">
                  <span className="text-xs text-foreground-500">{`${_getRelatedDatasets(connection.id).length} datasets`}</span>
                  <span className="text-xs text-foreground-500">Created on {new Date(connection.createdAt).toLocaleDateString()}</span>
                </div>
              </CardBody>
              <CardFooter>
                <Button
                  variant="flat"
                  size="sm"
                  onPress={() => navigate(`/connections/${connection.id}`)}
                  fullWidth
                >
                  View connection
                </Button>
                <Spacer x={1} />
                <Dropdown>
                  <DropdownTrigger>
                    <Button
                      variant="flat"
                      size="sm"
                      fullWidth
                      isIconOnly
                    >
                      <LuEllipsis />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    variant="flat"
                    disabledKeys={_isOptedInShared(connection.id) ? ["edit", "tags", "delete"] : []}
                  >
                    <DropdownItem
                      key="edit"
                      onPress={() => navigate(`/connections/${connection.id}`)}
                      startContent={<LuPencilLine />}
                    >
                      Edit connection
                    </DropdownItem>
                    <DropdownItem
                      key="tags"
                      onPress={() => setConnectionToEdit(connection)}
                      startContent={<LuTags />}
                    >
                      Edit tags
                    </DropdownItem>
                    <DropdownItem
                      key="duplicate"
                      onPress={() => {
                        setViewingDuplicateModal(connection);
                        setDuplicateName(connection.name);
                      }}
                      startContent={<LuCopy />}
                    >
                      Duplicate connection
                    </DropdownItem>
                    {_isOptedInShared(connection.id) ? (
                      <DropdownItem
                        key="optout"
                        onPress={() => _onOptOut(connection)}
                        startContent={<LuTrash />}
                        color="danger"
                      >
                        Remove from team
                      </DropdownItem>
                    ) : (
                      <DropdownItem
                        key="delete"
                        onPress={() => setConnectionToDelete(connection)}
                        startContent={<LuTrash />}
                        color="danger"
                      >
                        Delete
                      </DropdownItem>
                    )}
                  </DropdownMenu>
                </Dropdown>
              </CardFooter>
            </Card>
          </div>
        ))}
      </div>

      {_getFilteredConnections()?.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-1">
          <LuPlug size={24} />
          <span className="text-foreground-500 text-sm">No connections found</span>
          <Spacer y={1} />
          {connections?.length === 0 && _canAccess("teamAdmin", team.TeamRoles) && (
            <Button
              color="primary"
              onPress={() => navigate("/connections/new")}
            >
              Create your first connection
            </Button>
          )}
        </div>
      )}

      <Spacer y={4} />
      <Modal isOpen={connectionToDelete?.id} onClose={() => setConnectionToDelete(null)}>
        <ModalContent>
          <ModalHeader>
            <div className="font-bold">Are you sure you want to delete this connection?</div>
          </ModalHeader>
          <ModalBody>
            <div>
              {"Just a heads-up that all the datasets and charts that use this connection will stop working. This action cannot be undone."}
            </div>
            {_getRelatedDatasets(connectionToDelete?.id).length === 0 && (
              <div className="flex flex-row items-center">
                <div className="italic">No related datasets found</div>
              </div>
            )}
            {_getRelatedDatasets(connectionToDelete?.id).length > 0 && (
              <div className="flex flex-row items-center">
                <div>Related datasets:</div>
              </div>
            )}
            <div className="flex flex-row flex-wrap items-center gap-1">
              {_getRelatedDatasets(connectionToDelete?.id).slice(0, 10).map((dataset) => (
                <Chip
                  key={dataset.id}
                  size="sm"
                  variant="flat"
                  color="primary"
                >
                  {dataset.legend}
                </Chip>
              ))}
              {_getRelatedDatasets(connectionToDelete?.id).length > 10 && (
                <span className="text-xs">{`+${_getRelatedDatasets(connectionToDelete?.id).length - 10} more`}</span>
              )}
            </div>
          </ModalBody>
          <ModalFooter className="justify-between">
            <Checkbox
              onChange={() => setDeleteRelatedDatasets(!deleteRelatedDatasets)}
              isSelected={deleteRelatedDatasets}
              size="sm"
            >
              Delete related datasets
            </Checkbox>
            <div className="flex flex-row items-center gap-1">
              <Button
                variant="bordered"
                onPress={() => setConnectionToDelete(null)}
                size="sm"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                color="danger"
                endContent={<LuTrash />}
                onPress={() => _onDeleteConnection()}
                isLoading={deletingConnection}
              >
                Delete
              </Button>
            </div>
          </ModalFooter>
        </ModalContent>
      </Modal>
      <Modal isOpen={!!connectionToEdit} onClose={() => setConnectionToEdit(null)} size="xl">
        <ModalContent>
          <ModalHeader>
            <div className="font-bold">Edit tags</div>
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-row flex-wrap items-center gap-2">
              {projects.filter((p) => !p.ghost).map((project) => (
                <Chip
                  key={project.id}
                  radius="sm"
                  variant={connectionToEdit?.project_ids?.includes(project.id) ? "solid" : "flat"}
                  color="primary"
                  className="cursor-pointer"
                  onClick={() => {
                    if (connectionToEdit?.project_ids?.includes(project.id)) {
                      setConnectionToEdit({ ...connectionToEdit, project_ids: connectionToEdit?.project_ids?.filter((p) => p !== project.id) });
                    }
                    else {
                      setConnectionToEdit({ ...connectionToEdit, project_ids: [...(connectionToEdit?.project_ids || []), project.id] });
                    }
                  }}
                >
                  {project.name}
                </Chip>
              ))}
            </div>
            <Spacer y={1} />
            <div className="flex gap-1 bg-content2 p-2 mb-2 rounded-lg text-foreground-500 text-sm">
              <div>
                <LuInfo />
              </div>
              {"Use tags to grant dashboard members access to these connections. Tagged connections can be used by members to create their own datasets within the associated dashboards."}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="bordered"
              onPress={() => setConnectionToEdit(null)}
            >
              Close
            </Button>
            <Button
              color="primary"
              onPress={() => _onEditConnectionTags()}
              isLoading={modifyingConnection}
            >
              Save
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={!!viewingDuplicateModal} onClose={() => setViewingDuplicateModal(null)}>
        <ModalContent>
          <ModalHeader>
            <div className="font-bold">Duplicate connection</div>
          </ModalHeader>
          <ModalBody>
            <Input
              placeholder="New connection name"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              variant="bordered"
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="bordered"
              onPress={() => setViewingDuplicateModal(null)}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={() => _onDuplicateConnection(viewingDuplicateModal)}
              isLoading={duplicateLoading}
            >
              Duplicate
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setImportSourceTeam(null);
          setImportSourceConnections([]);
          setImportSelectedIds([]);
        }}
        size="2xl"
      >
        <ModalContent>
          <ModalHeader>
            <div className="font-bold">Import connections from another team</div>
          </ModalHeader>
          <ModalBody>
            <Select
              label="Select a team"
              placeholder="Choose a team to import from"
              variant="bordered"
              selectedKeys={importSourceTeam ? [String(importSourceTeam)] : []}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                _onSelectImportTeam(selected ? Number(selected) : null);
              }}
            >
              {_getOtherTeams().map((t) => (
                <SelectItem key={String(t.id)}>
                  {t.name}
                </SelectItem>
              ))}
            </Select>
            {importFetchingConnections && (
              <div className="text-sm text-foreground-500 py-2">Loading connections...</div>
            )}
            {importSourceTeam && !importFetchingConnections && importSourceConnections.length === 0 && (
              <div className="text-sm text-foreground-500 py-2">No connections found in this team.</div>
            )}
            {importSourceConnections.length > 0 && (
              <div className="flex flex-col gap-2 mt-2">
                <div className="text-sm text-foreground-500">
                  Select the connections you want to import:
                </div>
                <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
                  {importSourceConnections.map((conn) => (
                    <div
                      key={conn.id}
                      className="flex flex-row items-center gap-2 p-2 rounded-lg hover:bg-content2 cursor-pointer"
                      onClick={() => _onToggleImportConnection(conn.id)}
                    >
                      <Checkbox
                        isSelected={importSelectedIds.includes(conn.id)}
                        onValueChange={() => _onToggleImportConnection(conn.id)}
                        size="sm"
                      />
                      <Avatar src={connectionImages(isDark)[conn.subType]} size="sm" />
                      <span className="text-sm font-medium">{conn.name}</span>
                      <Chip size="sm" variant="flat" radius="sm" className="ml-auto">
                        {conn.type}
                      </Chip>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {importSelectedIds.length > 0 && (
              <div className="flex gap-1 bg-content2 p-2 rounded-lg text-foreground-500 text-sm">
                <div>
                  <LuInfo />
                </div>
                {`${importSelectedIds.length} connection${importSelectedIds.length > 1 ? "s" : ""} will be copied into "${team.name}". Credentials are included.`}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="bordered"
              onPress={() => {
                setImportModalOpen(false);
                setImportSourceTeam(null);
                setImportSourceConnections([]);
                setImportSelectedIds([]);
              }}
            >
              Cancel
            </Button>
            <Button
              color="primary"
              onPress={_onImportConnections}
              isLoading={importLoading}
              isDisabled={importSelectedIds.length === 0}
              endContent={<LuDownload />}
            >
              {`Import${importSelectedIds.length > 0 ? ` (${importSelectedIds.length})` : ""}`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ConnectionList
