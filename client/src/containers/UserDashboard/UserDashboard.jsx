import React, { useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { connect, useDispatch, useSelector } from "react-redux";
import { Outlet, useNavigate } from "react-router";
import { useWindowSize } from "react-use";
import {
  Spacer, CircularProgress, Spinner,
} from "@heroui/react";

import { relog } from "../../slices/user";
import { cleanErrors as cleanErrorsAction } from "../../actions/error";
import { getProjects } from "../../slices/project";
import { getTeamConnections } from "../../slices/connection";
import Container from "../../components/Container";
import Row from "../../components/Row";
import Text from "../../components/Text";
import {
  selectTeam, selectTeams, selectTeamsLoading, selectTeamsFetched,
  getTeams, saveActiveTeam, getTeamMembers,
} from "../../slices/team";

import DashboardList from "./DashboardList";
import Sidebar from "../../components/Sidebar";
import { cn } from "../../modules/utils";
import TopNav from "../../components/TopNav";
import { selectSidebarCollapsed } from "../../slices/ui";
import { getDatasets } from "../../slices/dataset";

/*
  The user dashboard with all the teams and projects
*/
function UserDashboard(props) {
  const { cleanErrors } = props;
  const collapsed = useSelector(selectSidebarCollapsed);

  const team = useSelector(selectTeam);
  const teams = useSelector(selectTeams);
  const teamsLoading = useSelector(selectTeamsLoading);
  const teamsFetched = useSelector(selectTeamsFetched);

  const user = useSelector((state) => state.user);

  const teamsRef = useRef(null);
  const initRef = useRef(null);
  const { height } = useWindowSize();
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    cleanErrors();

    if (!initRef.current) {
      initRef.current = true;
      dispatch(relog())
        .then((data) => {
          if (data?.payload?.id) {
            return dispatch(getTeams());
          } else {
            throw new Error("No user");
          }
        })
        .catch(() => {
          navigate("/login");
        });
    }
  }, []);

  useEffect(() => {
    if (user.data.id && !user.loading) {
      _checkParameters();
    }
  }, [user.data.id, user.loading]);

  // Authenticated user with no team memberships → send them to the
  // onboarding page. teamsFetched gates the redirect so we only fire after
  // getTeams has actually returned (not on the initial empty-array state).
  useEffect(() => {
    if (user.data.id && teamsFetched && !teamsLoading && teams.length === 0) {
      navigate("/onboarding", { replace: true });
    }
  }, [user.data.id, teamsFetched, teamsLoading, teams.length]);

  const teamsLength = teams?.length || 0;
  useEffect(() => {
    if (teamsLength > 0 && !teamsRef.current) {
      teamsRef.current = true;
      // Pick the user's team: prefer localStorage, then the team they belong to.
      // getTeams() only returns teams the user has a role on, so every
      // entry is already scoped to their membership.
      const storageActiveTeam = window.localStorage.getItem("__cb_active_team");
      let selectedTeam;
      if (storageActiveTeam) {
        selectedTeam = teams.find((t) => `${t.id}` === `${storageActiveTeam}`);
      }
      if (!selectedTeam) {
        selectedTeam = teams.find((t) => t.TeamRoles?.find((tr) => tr.role === "teamOwner" && tr.user_id === user.data.id))
          || teams[0];
      }

      if (selectedTeam) {
        dispatch(saveActiveTeam(selectedTeam));
        dispatch(getTeamMembers({ team_id: selectedTeam.id }));
        dispatch(getDatasets({ team_id: selectedTeam.id }));

        const welcome = new URLSearchParams(window.location.search).get("welcome");
        if (welcome) {
          navigate(`/${selectedTeam?.id}/connection/new`);
        }
      }
    }
  }, [teamsLength]); // eslint-disable-line

  const teamId = team?.id;
  const teamLoadRef = useRef(null);
  useEffect(() => {
    if (teamId && teamId !== teamLoadRef.current) {
      teamLoadRef.current = teamId;
      dispatch(getTeamMembers({ team_id: teamId }));
      dispatch(getTeamConnections({ team_id: teamId }));
      dispatch(getProjects({ team_id: teamId }));
    }
  }, [teamId]);

  const _checkParameters = () => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("__cb_goto")) {
      const gotoPage = params.get("__cb_goto");
      window.localStorage.removeItem("__cb_goto");
      navigate(gotoPage);
    }
  };

  if (!user.data.id) {
    return (
      <div style={styles.container(height)}>
        <Container sm>
          <Row justify="center" align="center">
            <CircularProgress aria-label="Loading" size="xl" />
          </Row>
        </Container>
      </div>
    );
  }

  return (
    <div className="dashboard bg-content2">
      {team?.id && (
        <div>
          <Sidebar />

          <div
            className={cn(
              "min-h-[calc(100vh-64px)] transition-all duration-300",
              collapsed ? "ml-16" : "ml-64"
            )}
          >
            <TopNav />
            <div className="px-6 py-4">
              <Outlet />

              {window.location.pathname === "/user" && (
                <DashboardList />
              )}
            </div>
          </div>
        </div>
      )}

      <Spacer y={4} />

      {(teams && teams.length === 0 && teamsLoading) && (
        <div className="bg-content2 pt-10 mt-[-20px]">
          <div className="flex justify-center items-center">
            <Spinner variant="simple" aria-label="Loading" />
          </div>
          <Spacer y={1} />
          <div className="flex justify-center items-center">
            <Text size="lg" className={"text-gray-400"}>Loading your space...</Text>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: (height) => ({
    flex: 1,
    // backgroundColor: "#103751",
    minHeight: height,
  }),
};

UserDashboard.propTypes = {
  cleanErrors: PropTypes.func.isRequired,
};

const mapStateToProps = () => {
  return {
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    cleanErrors: () => dispatch(cleanErrorsAction()),
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(UserDashboard);
