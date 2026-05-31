import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router";
import {
  Autocomplete, AutocompleteItem, Button, Card, CardBody, CardHeader,
  Input, Spinner, Tab, Tabs, Textarea,
} from "@heroui/react";
import _ from "lodash";

import cbLogoSmall from "../assets/logo_inverted.png";
import Row from "../components/Row";
import Text from "../components/Text";
import { API_HOST } from "../config/settings";
import { getAuthToken } from "../modules/auth";
import { createTeam, getTeams, saveActiveTeam, selectTeams } from "../slices/team";
import { logout, relog, selectUser } from "../slices/user";

const authHeaders = () => ({
  Accept: "application/json",
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAuthToken()}`,
});

function Onboarding() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const user = useSelector(selectUser);
  const teams = useSelector(selectTeams);

  useEffect(() => {
    if (!user?.id) dispatch(relog());
  }, [user?.id, dispatch]);

  useEffect(() => {
    if (teams && teams.length > 0) {
      navigate("/user", { replace: true });
    }
  }, [teams, navigate]);

  if (!user?.id) {
    return (
      <div className="pt-20 flex justify-center">
        <Spinner aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="pt-20">
      <Row justify="center" align="center">
        <Link to="/">
          <img src={cbLogoSmall} style={{ width: 70 }} alt="Edison logo" />
        </Link>
      </Row>
      <Row justify="center" align="center" className="mt-6">
        <Card className="max-w-[560px] w-full">
          <CardHeader className="flex-col items-start">
            <Text size="h4">Welcome, {user.name?.split(" ")[0] || "there"}</Text>
            <Text className="text-default-500 text-sm">
              You're signed in as {user.email}. Pick how you'd like to get started.
            </Text>
          </CardHeader>
          <CardBody>
            <Tabs aria-label="Onboarding choice" variant="underlined" color="primary" fullWidth>
              <Tab key="join" title="Join a team">
                <JoinTeamPanel />
              </Tab>
              <Tab key="create" title="Create your own team">
                <CreateTeamPanel
                  onCreated={async (team) => {
                    dispatch(saveActiveTeam(team));
                    await dispatch(getTeams());
                    navigate("/user", { replace: true });
                  }}
                />
              </Tab>
            </Tabs>

            <div className="mt-6 flex justify-end">
              <Button
                size="sm"
                variant="light"
                onPress={() => dispatch(logout())}
              >
                Sign out
              </Button>
            </div>
          </CardBody>
        </Card>
      </Row>
    </div>
  );
}

function JoinTeamPanel() {
  const [teams, setTeams] = useState([]);
  const [teamQuery, setTeamQuery] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const fetchTeams = useMemo(() => _.debounce((q, signal) => {
    const url = `${API_HOST}/api/access-requests/teams${q ? `?q=${encodeURIComponent(q)}` : ""}`;
    fetch(url, { headers: authHeaders(), signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTeams(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, 250), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchTeams(teamQuery, controller.signal);
    return () => controller.abort();
  }, [teamQuery, fetchTeams]);

  const onSubmit = async () => {
    setError("");
    if (!selectedTeamId) {
      setError("Please choose a team.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_HOST}/api/access-requests`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ teamId: selectedTeamId, reason: reason || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to submit your request.");
        setSubmitting(false);
        return;
      }
      setSubmitted({ duplicate: !!data.duplicate });
    } catch (e) {
      setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="py-4">
        <Text size="h5">
          {submitted.duplicate ? "We already have your request" : "Request sent"}
        </Text>
        <Text className="text-default-500 text-sm mt-2">
          A team owner has been notified. You'll get an email once your
          request is reviewed.
        </Text>
      </div>
    );
  }

  return (
    <div className="py-2">
      <Text className="text-default-600 text-sm">
        Search for the team you'd like to join. A team owner will review and
        approve your request.
      </Text>

      <div className="mt-4">
        <Autocomplete
          label="Team"
          placeholder="Search for a team"
          items={teams}
          inputValue={teamQuery}
          onInputChange={setTeamQuery}
          onSelectionChange={(key) => setSelectedTeamId(key ? Number(key) : null)}
          isRequired
          variant="bordered"
        >
          {(team) => (
            <AutocompleteItem key={team.id} textValue={team.name}>
              {team.name}
            </AutocompleteItem>
          )}
        </Autocomplete>
      </div>

      <div className="mt-4">
        <Textarea
          label="Reason (optional)"
          placeholder="Anything the team owner should know"
          value={reason}
          onValueChange={setReason}
          maxLength={2000}
          variant="bordered"
        />
      </div>

      {error && <div className="mt-3 text-danger text-sm">{error}</div>}

      <div className="mt-4 flex justify-end">
        <Button
          color="primary"
          onPress={onSubmit}
          isDisabled={submitting || !selectedTeamId}
          isLoading={submitting}
        >
          Send request
        </Button>
      </div>
    </div>
  );
}

function CreateTeamPanel({ onCreated }) {
  const dispatch = useDispatch();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const onSubmit = async () => {
    setError("");
    if (!name.trim()) {
      setError("Please give your team a name.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await dispatch(createTeam({ name: name.trim() }));
      if (result.error) throw new Error("create-failed");
      if (onCreated) await onCreated(result.payload);
    } catch (e) {
      setError("Couldn't create your team. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="py-2">
      <Text className="text-default-600 text-sm">
        Create a team to start building dashboards. You'll be the owner and
        can invite other people later.
      </Text>

      <div className="mt-4">
        <Input
          label="Team name"
          placeholder="e.g. Manufacturing Analytics"
          value={name}
          onValueChange={setName}
          maxLength={120}
          variant="bordered"
          isRequired
        />
      </div>

      {error && <div className="mt-3 text-danger text-sm">{error}</div>}

      <div className="mt-4 flex justify-end">
        <Button
          color="primary"
          onPress={onSubmit}
          isDisabled={submitting || !name.trim()}
          isLoading={submitting}
        >
          Create team
        </Button>
      </div>
    </div>
  );
}

export default Onboarding;
