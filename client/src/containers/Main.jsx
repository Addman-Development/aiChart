import React, { useEffect, lazy, Suspense, useRef, useState } from "react";
import PropTypes from "prop-types";
import { connect, useDispatch, useSelector } from "react-redux";
import { Route, Routes, useLocation, useNavigate } from "react-router";
import { semanticColors } from "@heroui/theme";
import { Helmet } from "react-helmet-async";

import SuspenseLoader from "../components/SuspenseLoader";
import UserDashboard from "./UserDashboard/UserDashboard";

import {
  relog, areThereAnyUsers,
  selectUser,
} from "../slices/user";
import { getTeams, saveActiveTeam, selectTeam, selectTeams } from "../slices/team";
import { selectFeedbackModalOpen, hideFeedbackModal, selectAiModalOpen, hideAiModal, toggleAiModal } from "../slices/ui";
import { getProjectCharts } from "../slices/chart";
import { cleanErrors as cleanErrorsAction } from "../actions/error";
import { useTheme } from "../modules/ThemeContext";
import { IconContext } from "react-icons";
import ProjectDashboard from "./ProjectDashboard/ProjectDashboard";
import AddChart from "./AddChart/AddChart";
import ProjectSettings from "./ProjectSettings";
import Integrations from "./Integrations/Integrations";
import Dataset from "./Dataset/Dataset";
import ConnectionWizard from "./Connections/ConnectionWizard";
import { Toaster } from "react-hot-toast";
import ConnectionList from "./UserDashboard/ConnectionList";
import DatasetList from "./UserDashboard/DatasetList";
import DashboardList from "./UserDashboard/DashboardList";
import { getDatasets } from "../slices/dataset";
import { getTeamConnections } from "../slices/connection";
import SharedChart from "./SharedChart";
import Report from "./PublicDashboard/Report";
import { Button, Modal, ModalBody, ModalContent, ModalFooter } from "@heroui/react";

const ProjectBoard = lazy(() => import("./ProjectBoard/ProjectBoard"));
const Signup = lazy(() => import("./Signup"));
const Login = lazy(() => import("./Login"));
const ManageTeam = lazy(() => import("./Settings/ManageTeam"));
const UserInvite = lazy(() => import("./UserInvite"));
const ManageUser = lazy(() => import("./Settings/ManageUser"));
const PublicDashboard = lazy(() => import("./PublicDashboard/PublicDashboard"));
const PasswordReset = lazy(() => import("./PasswordReset"));
const EmbeddedChart = lazy(() => import("./EmbeddedChart"));
const KeycloakCallback = lazy(() => import("./KeycloakCallback"));
const Onboarding = lazy(() => import("./Onboarding"));
const ProjectRedirect = lazy(() => import("./ProjectRedirect"));
import FeedbackForm from "../components/FeedbackForm";
import ForcePasswordChange from "../components/ForcePasswordChange";
import canAccess from "../config/canAccess";
import AiModal from "./Ai/AiModal";
import Auth from "./Integrations/Auth/Auth";
import SlackCallback from "./Integrations/Auth/SlackCallback";
import Integration from "./Integrations/Integration/Integration";
import NoAccessPage from "../components/NoAccessPage";
import { SITE_HOST } from "../config/settings";

let _basePath = "/";
try {
  const { pathname } = new URL(SITE_HOST);
  if (pathname && pathname !== "/") {
    _basePath = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  }
} catch (e) { _basePath = "/"; }

function authenticatePage() {
  let path = window.location.pathname;
  if (_basePath !== "/" && path.startsWith(_basePath)) {
    path = path.slice(_basePath.length) || "/";
  }

  if (path === "/login") {
    return false;
  } else if (path === "/signup") {
    return false;
  } else if (path.indexOf("/b/") > -1) {
    return false;
  } else if (path.indexOf("/report/") > -1) {
    return false;
  } else if (path === "/passwordReset") {
    return false;
  } else if (path === "/invite") {
    return false;
  } else if (path === "/feedback") {
    return false;
  } else if (path === "/keycloak-callback") {
    return false;
  } else if (path.indexOf("embedded") > -1) {
    return false;
  } else if (path.indexOf("/share") > -1) {
    return false;
  }

  window.location.pathname = `${_basePath}/login`;
  return true;
}

function Main(props) {
  const { cleanErrors } = props;

  const user = useSelector(selectUser);
  const team = useSelector(selectTeam);
  const teams = useSelector(selectTeams);
  const feedbackModal = useSelector(selectFeedbackModalOpen);
  const aiModalOpen = useSelector(selectAiModalOpen);
  const teamsRef = useRef(null);
  const [signupAllowed, setSignupAllowed] = useState(false);

  const { isDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const { pathname } = useLocation();

  useEffect(() => {
    if (isDark) {
      document.body.classList.add("dark");
      document.body.classList.remove("light");
    } else {
      document.body.classList.add("light");
      document.body.classList.remove("dark");
    }
  }, [isDark]);

  useEffect(() => {
    cleanErrors();
    if (!location.pathname.match(/\/chart\/\d+\/embedded/g)) {
      dispatch(relog())
        .then((data) => {
          if (data.payload?.id) {
            return dispatch(getTeams());
          }

          if (authenticatePage()) {
            window.location.pathname = "/login";
          }

          return null;
        })
        .then(() => {});

      dispatch(areThereAnyUsers())
        .then((anyUsers) => {
          const hasUsers = anyUsers?.payload?.areThereAnyUsers;
          const restricted = anyUsers?.payload?.signupRestricted;
          const params = new URLSearchParams(window.location.search);
          const hasInviteToken = params.has("inviteToken") || params.has("token");

          if (!hasUsers) {
            setSignupAllowed(true);
            if (pathname === "/login" || pathname === "/") {
              navigate("/signup");
            }
          } else if (!restricted || hasInviteToken) {
            setSignupAllowed(true);
          } else {
            setSignupAllowed(false);
            if (pathname === "/signup") {
              navigate("/login");
            }
          }
        });
    }

    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        dispatch(toggleAiModal());
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const teamsLength = teams?.length || 0;
  useEffect(() => {
    if (teamsLength > 0 && !teamsRef.current) {
      teamsRef.current = true;

      const storageActiveTeam = window.localStorage.getItem("__cb_active_team");
      let selectedTeam;
      if (storageActiveTeam) {
        selectedTeam = teams.find((t) => `${t.id}` === `${storageActiveTeam}`);
      }
      if (!selectedTeam) {
        selectedTeam = teams.find((t) => t.TeamRoles?.find((tr) => tr.role === "teamOwner" && tr.user_id === user.id))
          || teams[0];
      }

      if (selectedTeam) {
        dispatch(saveActiveTeam(selectedTeam));
        dispatch(getTeamConnections({ team_id: selectedTeam.id }));
        dispatch(getDatasets({ team_id: selectedTeam.id }));
      }
    }
  }, [teamsLength]); // eslint-disable-line

  return (
    <IconContext.Provider value={{ className: "react-icons", size: 20, style: { opacity: 0.8 } }}>
      <div style={styles.container}>
        <Helmet>
          {isDark && (
            <style type="text/css">
              {`
                .rdrDateRangePickerWrapper, .rdrDefinedRangesWrapper, .rdrStaticRanges .rdrStaticRange,
                .rdrDateDisplayWrapper, .rdrMonthAndYearWrapper, .rdrMonths, .rdrDefinedRangesWrapper
                {
                  background-color: ${semanticColors.dark.content1.DEFAULT};
                  background: ${semanticColors.dark.content1.DEFAULT};
                }

                .rdrStaticRange:hover, .rdrStaticRangeLabel:hover {
                  background: ${semanticColors.dark.content2.DEFAULT};
                }

                .rdrInputRange span {
                  color: ${semanticColors.dark.default[800]};
                }

                .rdrDay span {
                  color: ${semanticColors.dark.default[800]};
                }

                .rdrMonthPicker select, .rdrYearPicker select {
                  color: ${semanticColors.dark.default[800]};
                }

                .rdrDateInput, .rdrInputRangeInput {
                  background-color: ${semanticColors.dark.content3.DEFAULT};
                  color: ${semanticColors.dark.default[800]};
                }
              `}
            </style>
          )}
        </Helmet>
        <div>
          <Suspense fallback={<SuspenseLoader />}>
            <Routes>
              <Route path="/" element={<UserDashboard />}>
                <Route index element={<DashboardList />} />
                <Route path="connections" element={<ConnectionList />} />
                <Route path="connections/:connectionId" element={<ConnectionWizard />} />
                <Route path="datasets" element={<DatasetList />} />
                <Route path="datasets/:datasetId" element={<Dataset />} />
                {canAccess("teamAdmin", user.id, team?.TeamRoles, user) ? (
                  <>
                    <Route path="integrations" element={<Integrations />} />
                    <Route path="integrations/auth/:integrationType" element={<Auth />} />
                    <Route path="integrations/auth/slack/callback" element={<SlackCallback />} />
                    <Route path="integrations/:integrationId" element={<Integration />} />
                  </>
                ) : (
                  <>
                    <Route path="integrations" element={<NoAccessPage />} />
                    <Route path="integrations/auth/:integrationType" element={<NoAccessPage />} />
                    <Route path="integrations/auth/slack/callback" element={<NoAccessPage />} />
                    <Route path="integrations/:integrationId" element={<NoAccessPage />} />
                  </>
                )}
                <Route path="settings/*" element={<ManageTeam />} />
                <Route path="dashboard" element={<ProjectBoard />}>
                  <Route path=":projectId" element={<ProjectDashboard />} />
                  <Route path=":projectId/chart" element={<AddChart />} />
                  <Route path=":projectId/chart/:chartId/edit" element={<AddChart />} />
                  <Route path=":projectId/settings" element={<ProjectSettings />} />
                </Route>
              </Route>
              <Route exact path="/b/:brewName" element={<PublicDashboard />} />
              <Route path="/report/:brewName" element={<Report />} />
              <Route path="/report/:brewName/edit" element={<Report editMode />} />
              <Route
                exact
                path="/feedback"
                element={(
                  <div className={"container mx-auto pt-unit-lg max-w-[600px]"}>
                    <FeedbackForm />
                  </div>
                )}
              />
              {signupAllowed && (
                <Route exact path="/signup" element={<Signup />} />
              )}
              <Route exact path="/keycloak-callback" element={<KeycloakCallback />} />
              <Route exact path="/onboarding" element={<Onboarding />} />
              <Route exact path="/login" element={<Login />} />
              <Route exact path="/user" element={<UserDashboard />} />
              <Route exact path="/user/profile" element={<ManageUser />} />
              <Route exact path="/edit" element={<ManageUser />} />
              <Route exact path="/passwordReset" element={<PasswordReset />} />
              <Route
                exact
                path="/project/:projectId"
                element={<ProjectRedirect />}
              />

              <Route
                exact
                path="/chart/:chartId/embedded"
                element={<EmbeddedChart />}
              />
              <Route
                exact
                path="/chart/:share_string/share"
                element={<SharedChart />}
              />

              <Route exact path="/invite" element={<UserInvite />} />
            </Routes>
          </Suspense>
        </div>
      </div>

      <Modal
        isOpen={feedbackModal}
        onClose={() => dispatch(hideFeedbackModal())}
      >
        <ModalContent>
          <ModalBody>
            <FeedbackForm />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              color="warning"
              onPress={() => dispatch(hideFeedbackModal())}
            >
              Cancel
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {canAccess("teamAdmin", user.id, team?.TeamRoles, user) && (
        <AiModal isOpen={aiModalOpen} onClose={() => {
          dispatch(hideAiModal());
          const dashboardMatch = pathname.match(/\/dashboard\/(\d+)/);
          if (dashboardMatch) {
            dispatch(getProjectCharts({ project_id: dashboardMatch[1] }));
          }
        }} />
      )}

      <ForcePasswordChange />

      <Toaster
        position="top-center"
        reverseOrder={false}
        toastOptions={{
          duration: 2500,
          style: {
            borderRadius: "8px",
            background: isDark ? "#333" : "#fff",
            color: isDark ? "#fff" : "#000",
          },
        }}
      />
    </IconContext.Provider>
  );
}

const styles = {
  container: {
    flex: 1,
  },
};

Main.propTypes = {
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

export default connect(mapStateToProps, mapDispatchToProps)(Main);
