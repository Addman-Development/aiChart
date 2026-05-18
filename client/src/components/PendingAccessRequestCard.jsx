import React, { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { useDispatch, useSelector } from "react-redux";
import {
  Accordion, AccordionItem, Button, Card, CardBody, CardHeader, Checkbox, Chip,
  Divider, Radio, RadioGroup, Spacer, Spinner,
} from "@heroui/react";
import _ from "lodash";

import { API_HOST } from "../config/settings";
import { getAuthToken } from "../modules/auth";
import { getTeam, selectTeam } from "../slices/team";
import { selectProjects } from "../slices/project";
import Text from "./Text";

function PendingAccessRequestCard(props) {
  const { requestId, onResolved } = props;

  const dispatch = useDispatch();
  const team = useSelector(selectTeam);
  const projects = useSelector(selectProjects);

  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [role, setRole] = useState("teamAdmin");
  const [projectAccess, setProjectAccess] = useState([]);
  const [exportAllowed, setExportAllowed] = useState(false);

  const [acting, setActing] = useState(false);
  const [actionError, setActionError] = useState("");

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${getAuthToken()}`,
  }), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");

    fetch(`${API_HOST}/api/access-requests/${requestId}`, { headers: authHeaders })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Failed to load request");
        return body;
      })
      .then((data) => {
        if (cancelled) return;
        setRequest(data);

        if (data.requested_team_id && data.requested_team_id !== team?.id) {
          dispatch(getTeam(data.requested_team_id));
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const _onToggleProject = (projectId) => {
    const next = [...projectAccess];
    const idx = _.indexOf(next, projectId);
    if (idx === -1) next.push(projectId);
    else next.splice(idx, 1);
    setProjectAccess(next);
  };

  const _resolve = async (action) => {
    setActing(true);
    setActionError("");
    try {
      const body = action === "approve"
        ? { role, projects: projectAccess, canExport: exportAllowed }
        : {};

      const res = await fetch(`${API_HOST}/api/access-requests/${requestId}/${action}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Failed to ${action} request`);

      if (onResolved) onResolved(action);
    } catch (err) {
      setActionError(err.message);
    } finally {
      setActing(false);
    }
  };

  if (loading) {
    return (
      <Card className="mb-4">
        <CardBody>
          <Spinner size="sm" />
        </CardBody>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card className="mb-4">
        <CardBody>
          <Text className="text-danger">{loadError}</Text>
        </CardBody>
      </Card>
    );
  }

  if (!request) return null;

  if (request.status !== "pending") {
    return (
      <Card className="mb-4">
        <CardBody>
          <Text>
            This access request has already been
            {" "}
            <Chip size="sm" color={request.status === "approved" ? "success" : "default"}>
              {request.status}
            </Chip>
            .
          </Text>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <div>
          <Text size="h5">Access request</Text>
          <Text className="text-sm text-default-500">
            {(request.name || request.email)} would like to join {request.Team?.name || "this team"}
          </Text>
        </div>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-12 gap-2 text-sm">
          <div className="col-span-12 sm:col-span-3 text-default-500">Email</div>
          <div className="col-span-12 sm:col-span-9">{request.email}</div>
          {request.name && (
            <>
              <div className="col-span-12 sm:col-span-3 text-default-500">Name</div>
              <div className="col-span-12 sm:col-span-9">{request.name}</div>
            </>
          )}
          {request.reason && (
            <>
              <div className="col-span-12 sm:col-span-3 text-default-500">Reason</div>
              <div className="col-span-12 sm:col-span-9 whitespace-pre-wrap">{request.reason}</div>
            </>
          )}
        </div>

        <Divider className="my-4" />

        <div className="font-bold">Select a role</div>
        <Spacer y={2} />
        <RadioGroup size="sm" value={role} onValueChange={setRole}>
          <Radio value="teamAdmin" description="Access to all projects, connections, datasets.">Team Admin</Radio>
          <Radio value="projectAdmin" description="Can manage charts and reports in selected dashboards.">Client Admin</Radio>
          <Radio value="projectEditor" description="Can view and edit charts in selected dashboards.">Client Editor</Radio>
          <Radio value="projectViewer" description="Can view charts in selected dashboards.">Client Viewer</Radio>
        </RadioGroup>

        {role !== "teamAdmin" && projects && projects.length > 0 && (
          <>
            <Spacer y={3} />
            <Accordion variant="bordered">
              <AccordionItem
                title="Select dashboard access"
                subtitle={projectAccess.length > 0 ? `${projectAccess.length} selected` : "None selected"}
              >
                <div className="grid grid-cols-12 gap-1 pb-2">
                  {projects.filter((p) => !p.ghost).map((p) => (
                    <div key={p.id} className="col-span-12 sm:col-span-4">
                      <Checkbox
                        isSelected={_.indexOf(projectAccess, p.id) > -1}
                        onChange={() => _onToggleProject(p.id)}
                      >
                        {p.name}
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </AccordionItem>
            </Accordion>
          </>
        )}

        {role !== "teamAdmin" && (
          <>
            <Spacer y={3} />
            <Checkbox
              isSelected={exportAllowed}
              onValueChange={setExportAllowed}
            >
              Allow data export
            </Checkbox>
          </>
        )}

        {actionError && (
          <div className="mt-3 text-danger text-sm">{actionError}</div>
        )}

        <Spacer y={4} />
        <div className="flex gap-2 justify-end">
          <Button
            variant="flat"
            color="danger"
            onPress={() => _resolve("reject")}
            isDisabled={acting}
          >
            Reject
          </Button>
          <Button
            color="primary"
            onPress={() => _resolve("approve")}
            isLoading={acting}
          >
            Approve and add to team
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

PendingAccessRequestCard.propTypes = {
  requestId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  onResolved: PropTypes.func,
};

export default PendingAccessRequestCard;
