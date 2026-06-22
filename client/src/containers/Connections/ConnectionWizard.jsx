import React, { useEffect, useRef, useState } from "react";
import { LuArrowLeft, LuBrainCircuit, LuChartArea, LuCompass, LuLayoutDashboard, LuPartyPopper, LuSearch, LuShare2 } from "react-icons/lu";
import { Button, Card, CardBody, CardFooter, CardHeader, Chip, Divider, Image, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Spacer, Switch, Tooltip } from "@heroui/react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate, useParams } from "react-router";
import toast from "react-hot-toast";
import { Link, useSearchParams } from "react-router";

import Segment from "../../components/Segment";
import availableConnections from "../../modules/availableConnections";
import connectionImages from "../../config/connectionImages";
import { useTheme } from "../../modules/ThemeContext";
import ApiConnectionForm from "./components/ApiConnectionForm";
import MongoConnectionForm from "./components/MongoConnectionForm";
import PostgresConnectionForm from "./components/PostgresConnectionForm";
import MssqlConnectionForm from "./components/MssqlConnectionForm";
import { addConnection, addFilesToConnection, getConnection, getTeamConnections, saveConnection, selectConnections } from "../../slices/connection";
import { selectTeam } from "../../slices/team";
import { showAiModal } from "../../slices/ui";
import canAccess from "../../config/canAccess";
import { selectUser } from "../../slices/user";

function ConnectionWizard() {
  const [connectionSearch, setConnectionSearch] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [completionModal, setCompletionModal] = useState(false);
  const [newConnection, setNewConnection] = useState(null);
  const [connectionToEdit, setConnectionToEdit] = useState(null);

  const { isDark } = useTheme();
  const initRef = useRef(null);
  const bottomRef = useRef(null);
  const paramsInitRef = useRef(null);
  const fetchConnectionRef = useRef(null);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useParams();

  const connections = useSelector(selectConnections);
  const user = useSelector(selectUser);
  const team = useSelector(selectTeam);

  useEffect(() => {
    if (team?.id && !initRef.current) {
      initRef.current = true;
      dispatch(getTeamConnections({ team_id: team.id }));
    }
  }, [team]);

  useEffect(() => {
    if (selectedType) {
      bottomRef?.current?.scrollIntoView({
        behavior: "smooth",
        block: "end",
        inline: "nearest",
      });
    }
  }, [selectedType]);

  useEffect(() => {
    if (params.connectionId && params.connectionId !== "new" && team?.id && !paramsInitRef.current) {
      paramsInitRef.current = true;
      dispatch(getConnection({ team_id: team.id, connection_id: params.connectionId }))
        .then((res) => {
          if (res?.payload) {
            setConnectionToEdit(res.payload);
          }
        });
    }
  }, [params, team]);

  useEffect(() => {
    if (searchParams.get("type")) {
      setSelectedType(searchParams.get("type"));
    }
  }, [searchParams]);

  useEffect(() => {
    if (connectionToEdit && !fetchConnectionRef.current) {
      fetchConnectionRef.current = true;
      setNewConnection({ ...connectionToEdit });
      setSelectedType(connectionToEdit.type);
    }
  }, [connectionToEdit]);

  const _filteredConnections = availableConnections.filter((conn) => {
    if (connectionSearch) {
      return conn.name.toLowerCase().includes(connectionSearch.toLowerCase());
    }
    return true;
  });

  const _onAddNewConnection = (data, files) => {
    if (params.connectionId !== "new") {
      return dispatch(saveConnection({ team_id: team.id, connection: data }))
        .then(async () => {
          if (files) {
            await dispatch(addFilesToConnection({ team_id: team.id, connection_id: params.connectionId, files }));
          }

          toast.success("Connection saved successfully");
          return true;
        })
        .catch(() => {
          return false;
        });
    }

    return dispatch(addConnection({
        team_id: team.id,
        connection: { ...data, team_id: team.id }
      }))
      .then(async (createdConnection) => {
        if (createdConnection.error) {
          return false;
        }

        if (files) {
          dispatch(addFilesToConnection({ team_id: team.id, connection_id: createdConnection.payload.id, files }));
        }

        setCompletionModal(true);
        setSelectedType("");

        navigate(`/connections/${createdConnection.payload.id}`);
        const resp = await dispatch(getConnection({ team_id: team.id, connection_id: createdConnection.payload.id }));
        setConnectionToEdit(resp.payload);

        return true;
      })
      .catch(() => {
        return false;
      });
  };

  const _canAccess = (role, teamRoles) => {
    return canAccess(role, user.id, teamRoles, user);
  };

  const _onAskAi = async () => {
    setCompletionModal(false);
    setTimeout(() => {
      dispatch(showAiModal())
    }, 100);
  };

  if (!_canAccess("teamAdmin", team.TeamRoles)) {
    return (
      <div>
        <div className="flex flex-col items-center justify-center h-screen">
          <span className="text-xl text-secondary font-semibold">{"You don't have access to this page"}</span>
          <Spacer y={2} />
          <Button
            color="primary"
            onPress={() => navigate("/")}
          >
            Return to dashboard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col">
        <div>
          <Spacer y={2} />

          {!newConnection && (
            <>
              <div className="flex flex-row items-center gap-2">
                <span className="text-xl text-secondary font-semibold">Step 1:</span>
                <span className="text-xl font-semibold">Select your datasource type</span>
              </div>
              <Spacer y={4} />
              <Segment>
                <div className="flex flex-row justify-between items-center flex-wrap gap-2">
                  <Input
                    endContent={<LuSearch />}
                    placeholder="Search..."
                    variant="bordered"
                    labelPlacement="outside"
                    className="max-w-[300px]"
                    onChange={(e) => setConnectionSearch(e.target.value)}
                  />
                </div>
                <Spacer y={4} />
                <div className="grid grid-cols-12 gap-4">
                  {_filteredConnections.map((conn) => (
                    <div key={conn.name} className="col-span-12 sm:col-span-6 lg:col-span-6 xl:col-span-3">
                      <Card
                        shadow="none"
                        isPressable
                        className={`w-full h-full ${selectedType === conn.type ? "border-3 border-primary" : "border-3 border-content3"}`}
                        onPress={() => setSelectedType(conn.type)}
                      >
                        <CardBody className="overflow-visible p-4 max-w-sm flex flex-row items-center justify-center">
                          <Image
                            radius="lg"
                            alt={conn.name}
                            className="h-[80px]"
                            src={connectionImages(isDark)[conn.type]}
                          />
                        </CardBody>
                        <CardFooter className="justify-center flex flex-col gap-1">
                          {conn.ai && (
                            <Tooltip content="You can use AI to ask questions about your data">
                              <Chip radius="sm" color="secondary" variant="flat" size="sm" startContent={<LuBrainCircuit size={14} />}>
                                {"AI-powered"}
                              </Chip>
                            </Tooltip>
                          )}
                          <span className="text-sm font-semibold">{conn.name}</span>
                        </CardFooter>
                      </Card>
                    </div>
                  ))}
                  {_filteredConnections.length === 0 && (
                    <div className="col-span-12">
                      <p className="text-center text-gray-500">No connections found</p>
                    </div>
                  )}
                </div>
              </Segment>

              <Spacer y={8} />
              {selectedType && (
                <div className="flex flex-row items-center gap-2">
                  <span className="text-xl text-secondary font-semibold">Step 2:</span>
                  <span className="text-xl font-semibold">Connect to your data source</span>
                </div>
              )}
            </>
          )}

          {newConnection && (
            <div className="flex flex-row items-center gap-2">
              <Link to="/connections" className="text-xl font-semibold">
                <LuArrowLeft size={24} className="text-foreground" />
              </Link>
              <span className="text-xl font-semibold">Edit your connection</span>
            </div>
          )}

          {newConnection && newConnection.id && user?.admin && (
            <>
              <Spacer y={2} />
              <Card shadow="none" className="border-1 border-divider">
                <CardBody>
                  <div className="flex flex-row items-center justify-between gap-4">
                    <div className="flex flex-row items-start gap-3">
                      <LuShare2 size={20} className="mt-0.5 text-primary" />
                      <div className="flex flex-col">
                        <div className="text-sm font-semibold">Available to all teams</div>
                        <div className="text-xs text-foreground-500">
                          When on, this connection appears in every team's "Shared with you" panel.
                          Other teams can opt in to use it without exposing the credentials.
                        </div>
                      </div>
                    </div>
                    <Switch
                      isSelected={!!newConnection.shared}
                      onValueChange={async (val) => {
                        const previous = !!newConnection.shared;
                        setNewConnection({ ...newConnection, shared: val });
                        const result = await dispatch(saveConnection({
                          team_id: team.id,
                          connection: { id: newConnection.id, shared: val },
                        }));
                        if (result?.error) {
                          setNewConnection({ ...newConnection, shared: previous });
                          toast.error("Failed to update sharing");
                        } else {
                          toast.success(val ? "Connection shared with all teams" : "Connection is no longer shared");
                        }
                      }}
                    />
                  </div>
                </CardBody>
              </Card>
            </>
          )}

          <Spacer y={4} />

          {selectedType === "api" && (
            <ApiConnectionForm
              onComplete={_onAddNewConnection}
              editConnection={newConnection}
            />
          )}
          {selectedType === "mongodb" && (
            <MongoConnectionForm
              onComplete={_onAddNewConnection}
              editConnection={newConnection}
            />
          )}
          {selectedType === "postgres" && (
            <PostgresConnectionForm
              onComplete={_onAddNewConnection}
              editConnection={newConnection}
            />
          )}
          {selectedType === "mssql" && (
            <MssqlConnectionForm
              onComplete={_onAddNewConnection}
              editConnection={newConnection}
            />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      <Modal
        isOpen={completionModal}
        backdrop="blur"
        onClose={() => setCompletionModal(false)}
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex flex-row items-center gap-2">
            <LuPartyPopper className="text-success" size={24} />
            <span className="font-semibold">Your connection was saved!</span>
          </ModalHeader>
          <ModalBody>
            {connections.length > 1 && (
              <div>What would you like to do next?</div>
            )}
            {connections.length < 2 && (
              <div>Create your first dataset to start visualizing your data</div>
            )}
          </ModalBody>
          <ModalFooter className="flex flex-col gap-2">
            <div className="flex flex-row gap-2">
              {connections.length > 1 && (
                <Button
                  variant="flat"
                  fullWidth
                  onPress={() => navigate("/")}
                  startContent={<LuLayoutDashboard />}
                >
                  Return to dashboard
                </Button>
              )}
              <Button
                color="primary"
                fullWidth
                onPress={() => navigate("/datasets/new")}
                startContent={<LuChartArea />}
              >
                Create dataset
              </Button>
            </div>
            {_canAccess("teamAdmin", team?.TeamRoles) && (
              <>
                <div className="flex flex-row gap-2 py-2">
                  <Divider />
                </div>
                <Button
                  color="primary"
                  variant="flat"
                  fullWidth
                  onPress={() => _onAskAi()}
                  startContent={<LuBrainCircuit />}
                >
                  Create with AI
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

export default ConnectionWizard
