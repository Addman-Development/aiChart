import React, { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import {
  Button, Input, Spacer, Chip, Tabs, Tab, Divider, Switch, Select, SelectItem,
  Alert,
} from "@heroui/react";
import AceEditor from "react-ace";
import { useDispatch, useSelector } from "react-redux";
import { LuChevronRight, LuExternalLink } from "react-icons/lu";

import "ace-builds/src-min-noconflict/mode-json";
import "ace-builds/src-min-noconflict/theme-tomorrow";
import "ace-builds/src-min-noconflict/theme-one_dark";

import Container from "../../../components/Container";
import Row from "../../../components/Row";
import Text from "../../../components/Text";
import { useTheme } from "../../../modules/ThemeContext";
import { testRequest, getConnectionSchemas } from "../../../slices/connection";
import { selectTeam } from "../../../slices/team";

function MssqlConnectionForm(props) {
  const {
    editConnection = null, onComplete = () => {}, addError = false,
  } = props;

  const [loading, setLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [connection, setConnection] = useState({ type: "mssql" });
  const [errors, setErrors] = useState({});
  const [formStyle, setFormStyle] = useState("string");
  const [testResult, setTestResult] = useState(null);
  const [availableSchemas, setAvailableSchemas] = useState([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [schemasError, setSchemasError] = useState(null);

  const { isDark } = useTheme();
  const dispatch = useDispatch();
  const team = useSelector(selectTeam);
  const initRef = useRef(false);

  useEffect(() => {
    if (editConnection?.id && !initRef.current) {
      initRef.current = true;
      _init();
    }
  }, [editConnection]);

  const _init = () => {
    if (editConnection) {
      const newConnection = editConnection;

      if (!newConnection.connectionString && newConnection.host) {
        setFormStyle("form");
      }

      setConnection(newConnection);
    }
  };

  const _onLoadSchemas = async () => {
    setSchemasError(null);
    setSchemasLoading(true);
    try {
      const res = await dispatch(getConnectionSchemas({ team_id: team.id, connection }));
      if (Array.isArray(res.payload)) {
        setAvailableSchemas(res.payload);
        if (res.payload.length === 0) {
          setSchemasError("No selectable schemas found on this connection.");
        }
      } else {
        setSchemasError(res.error?.message || "Could not load schemas. Check the connection details and try again.");
      }
    } catch (e) {
      setSchemasError("Could not load schemas. Check the connection details and try again.");
    }
    setSchemasLoading(false);
  };

  const _onTestRequest = async (data) => {
    const newTestResult = {};

    const response = await dispatch(testRequest({ team_id: team.id, connection: data }));

    if (!response?.payload) {
      // The request itself failed (network / proxy-gateway / TLS) before any
      // response came back. Surface it instead of throwing on an undefined
      // payload, which would leave the spinner stuck with no message shown.
      newTestResult.status = "Failed";
      newTestResult.body = `Could not reach the server to run the test — the request failed before any response came back (likely a network, proxy/gateway, or TLS issue, not a database error).${response?.error?.message ? ` (${response.error.message})` : ""}`;
      setTestResult(newTestResult);
      return Promise.resolve(newTestResult);
    }

    newTestResult.status = response.payload.status;
    newTestResult.body = typeof response.payload.body === "object"
      ? JSON.stringify(response.payload.body, null, 2)
      : response.payload.body;

    setTestResult(newTestResult);

    return Promise.resolve(newTestResult);
  };

  const _onCreateConnection = (test = false) => {
    setErrors({});
    if (!connection.name || connection.name.length > 24) {
      setTimeout(() => {
        setErrors({ ...errors, name: "Please enter a name which is less than 24 characters" });
      }, 100);
      return;
    }
    if (formStyle === "form" && !connection.host) {
      setTimeout(() => {
        setErrors({ ...errors, host: "Please enter a host name or IP address for your database" });
      }, 100);
      return;
    }
    if (formStyle === "string" && !connection.connectionString) {
      setTimeout(() => {
        setErrors({ ...errors, connectionString: "Please enter a connection string first" });
      }, 100);
      return;
    }

    const newConnection = connection;
    // Clean the connection string if the form style is Form
    if (formStyle === "form") {
      newConnection.connectionString = "";
    }

    setConnection(newConnection);

    setTimeout(() => {
      if (test === true) {
        setTestLoading(true);
        _onTestRequest(newConnection)
          .then(() => setTestLoading(false))
          .catch(() => setTestLoading(false));
      } else {
        setLoading(true);
        onComplete(newConnection)
          .then(() => setLoading(false))
          .catch(() => setLoading(false));
      }
    }, 100);
  };

  const _onChangeEncrypt = (checked) => {
    setConnection({ ...connection, ssl: checked });
  };

  return (
    <div className="p-4 bg-content1 border-1 border-solid border-content3 rounded-lg">
      <div>
        <p className="font-bold">
          {!editConnection && "Add a new SQL Server connection"}
          {editConnection && `Edit ${editConnection.name}`}
        </p>
        <Spacer y={4} />
        <Row align="center">
          <Tabs
            aria-label="Connection options"
            selectedKey={formStyle}
            onSelectionChange={(selected) => setFormStyle(selected)}
          >
            <Tab key="string" value="string" title="Connection string" />
            <Tab key="form" value="form" title="Connection form" />
          </Tabs>
        </Row>
        <Spacer y={2} />

        {formStyle === "string" && (
          <>
            <Row align="center">
              <Input
                label="Name your connection"
                placeholder="Enter a name that you can recognise later"
                value={connection.name || ""}
                onChange={(e) => {
                  setConnection({ ...connection, name: e.target.value });
                }}
                color={errors.name ? "danger" : "default"}
                variant="bordered"
                fullWidth
              />
            </Row>
            {errors.name && (
              <Row className={"p-5"}>
                <Text small className={"text-danger"}>
                  {errors.name}
                </Text>
              </Row>
            )}
            <Spacer y={2} />
            <Row align="center">
              <Input
                label="Enter your SQL Server connection string"
                placeholder="Server=myserver.database.windows.net;Database=mydb;User Id=myuser;Password=mypassword;Encrypt=true"
                value={connection.connectionString || ""}
                onChange={(e) => {
                  setConnection({ ...connection, connectionString: e.target.value });
                }}
                description="Server=hostname;Database=dbname;User Id=username;Password=password;"
                variant="bordered"
                fullWidth
              />
            </Row>
            {errors.connectionString && (
              <Row className={"p-5"}>
                <Text small className="text-danger">
                  {errors.connectionString}
                </Text>
              </Row>
            )}
            <Spacer y={2} />
          </>
        )}

        {formStyle === "form" && (
          <Row>
            <div className="grid grid-cols-12 gap-2">
              <div className="sm:col-span-12 md:col-span-8">
                <Input
                  label="Name your connection"
                  placeholder="Enter a name that you can recognise later"
                  value={connection.name || ""}
                  onChange={(e) => {
                    setConnection({ ...connection, name: e.target.value });
                  }}
                  color={errors.name ? "danger" : "default"}
                  description={errors.name}
                  variant="bordered"
                  fullWidth
                />
              </div>

              <div className="sm:col-span-12 md:col-span-10">
                <Input
                  label="Hostname or IP address"
                  placeholder="myserver.database.windows.net"
                  value={connection.host || ""}
                  onChange={(e) => {
                    setConnection({ ...connection, host: e.target.value });
                  }}
                  color={errors.host ? "danger" : "default"}
                  description={errors.host}
                  variant="bordered"
                  fullWidth
                />
              </div>
              <div className="sm:col-span-12 md:col-span-2">
                <Input
                  label="Port"
                  placeholder="1433"
                  value={connection.port || ""}
                  onChange={(e) => {
                    setConnection({ ...connection, port: e.target.value });
                  }}
                  color={errors.port ? "danger" : "default"}
                  description={errors.port}
                  variant="bordered"
                  fullWidth
                />
              </div>

              <div className="sm:col-span-12 md:col-span-4">
                <Input
                  label="Database name"
                  value={connection.dbName || ""}
                  onChange={(e) => {
                    setConnection({ ...connection, dbName: e.target.value });
                  }}
                  color={errors.dbName ? "danger" : "default"}
                  description={errors.dbName}
                  variant="bordered"
                  fullWidth
                />
              </div>

              <div className="sm:col-span-12 md:col-span-4">
                <Input
                  label="Database username"
                  value={connection.username || ""}
                  onChange={(e) => {
                    setConnection({ ...connection, username: e.target.value });
                  }}
                  color={errors.username ? "danger" : "default"}
                  description={errors.username}
                  variant="bordered"
                  fullWidth
                />
              </div>

              <div className="sm:col-span-12 md:col-span-4">
                <Input
                  type="password"
                  label="Database password"
                  onChange={(e) => {
                    setConnection({ ...connection, password: e.target.value });
                  }}
                  color={errors.password ? "danger" : "default"}
                  description={errors.password}
                  variant="bordered"
                  fullWidth
                />
              </div>
            </div>
          </Row>
        )}
        <Spacer y={2} />
        <Row align="center">
          <Switch
            label="Encrypt"
            isSelected={connection.ssl || false}
            checked={connection.ssl || false}
            onChange={(e) => _onChangeEncrypt(e.target.checked)}
            size="sm"
          >
            {"Enable encryption (recommended for Azure SQL)"}
          </Switch>
        </Row>
        {connection.ssl && (
          <>
            <Spacer y={2} />
            <Alert
              color="default"
              variant="flat"
            >
              <span className="text-sm">
                {"Encryption will be enabled with TrustServerCertificate. For production use with self-signed certificates, ensure your server certificate is properly configured."}
              </span>
            </Alert>
          </>
        )}

        <Spacer y={4} />
        <div>
          <Row align="center">
            <LuChevronRight />
            <Spacer x={1} />
            <Text>{"For security reasons, connect to your SQL Server database with read-only credentials"}</Text>
          </Row>
        </div>

        <Spacer y={4} />
        <div>
          <div className="text-sm font-medium mb-1">{"Schemas"}</div>
          <div className="text-xs text-foreground-500 mb-2">
            {"Restrict which database schemas this connection exposes to the AI and the schema browser. Leave empty to include all non-system schemas."}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="bordered"
              size="sm"
              onClick={_onLoadSchemas}
              isLoading={schemasLoading}
            >
              {availableSchemas.length > 0 ? "Reload schemas" : "Load available schemas"}
            </Button>
            {availableSchemas.length > 0 && (
              <Select
                variant="bordered"
                label="Included schemas"
                size="sm"
                selectionMode="multiple"
                selectedKeys={new Set(connection.selectedSchemas || [])}
                onSelectionChange={(keys) => setConnection({ ...connection, selectedSchemas: Array.from(keys) })}
                className="flex-1 min-w-[240px]"
                aria-label="Select schemas to include"
              >
                {availableSchemas.map((s) => (
                  <SelectItem key={s} textValue={s}>{s}</SelectItem>
                ))}
              </Select>
            )}
          </div>
          {schemasError && (
            <div className="text-xs text-danger mt-1">{schemasError}</div>
          )}
          {connection.selectedSchemas?.length > 0 && (
            <div className="text-xs text-foreground-500 mt-1">
              {`Including ${connection.selectedSchemas.length} schema${connection.selectedSchemas.length > 1 ? "s" : ""}: ${connection.selectedSchemas.join(", ")}`}
            </div>
          )}
        </div>

        {addError && (
          <Row>
            <Container css={{ backgroundColor: "$red300", p: 10 }}>
              <Row>
                <Text h5>{"Server error while trying to save your connection"}</Text>
              </Row>
              <Row>
                <Text>Please try adding your connection again.</Text>
              </Row>
            </Container>
          </Row>
        )}

        <Spacer y={4} />
        <Row>
          <Button
            variant="ghost"
            auto
            onClick={() => _onCreateConnection(true)}
            isLoading={testLoading}
          >
            {"Test connection"}
          </Button>
          <Spacer x={1} />
          <Button
            isLoading={loading}
            onClick={_onCreateConnection}
            color="primary"
          >
            {"Save connection"}
          </Button>
        </Row>
      </div>

      {testResult && !testLoading && (
        <>
          <Spacer y={4} />
          <Divider />
          <Spacer y={4} />
          <div>
            <Row align="center">
              <Text>
                {"Test Result "}
                <Chip
                  type={testResult.status < 400 ? "success" : "danger"}
                >
                  {`Status code: ${testResult.status}`}
                </Chip>
              </Text>
            </Row>
            <Spacer y={4} />
            <AceEditor
              mode="json"
              theme={isDark ? "one_dark" : "tomorrow"}
              style={{ borderRadius: 10 }}
              height="150px"
              width="none"
              value={testResult.body || "Hello"}
              readOnly
              name="queryEditor"
              editorProps={{ $blockScrolling: true }}
            />
          </div>
        </>
      )}
    </div>
  );
}

MssqlConnectionForm.propTypes = {
  onComplete: PropTypes.func,
  editConnection: PropTypes.object,
  addError: PropTypes.bool,
};

export default MssqlConnectionForm;
