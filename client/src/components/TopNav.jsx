import React, { useEffect, useState } from "react"
import { useDispatch, useSelector } from "react-redux"
import { TbBrandDiscord } from "react-icons/tb";
import { useNavigate, useLocation, useParams } from "react-router";
import { LuBell, LuBook, LuBookOpenText, LuBrainCircuit, LuFileCode2, LuGithub, LuHeartHandshake, LuMenu, LuPanelLeftClose, LuPanelLeftOpen, LuSmile, LuSquareKanban } from "react-icons/lu";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Breadcrumbs, BreadcrumbItem, Popover, PopoverTrigger, PopoverContent, Badge } from "@heroui/react";

import { selectSidebarCollapsed, showFeedbackModal, toggleAiModal, toggleSidebar, toggleMobileSidebar, showAiModal, setAiPendingConversationId } from "../slices/ui";
import {
  selectNotifications, selectUnreadCount, getNotifications,
  markNotificationRead, markAllNotificationsRead, clearNotifications,
  notificationReceived, notificationUpdated, notificationDeleted,
  notificationsReadAll, notificationsCleared,
} from "../slices/notification";
import socketClient from "../modules/socketClient";
import { syncSubscription } from "../modules/pushNotifications";
import { cn } from "../modules/utils";
import useIsMobile from "../modules/useIsMobile";
import canAccess from "../config/canAccess";
import { selectUser } from "../slices/user";
import { selectTeam } from "../slices/team";
import { selectProject } from "../slices/project";
import { selectChart } from "../slices/chart";
import { selectIntegrations } from "../slices/integration";

function TopNav() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();

  const collapsed = useSelector(selectSidebarCollapsed);
  const isMobile = useIsMobile();
  const user = useSelector(selectUser);
  const team = useSelector(selectTeam);
  const project = useSelector(selectProject);
  const chart = useSelector((state) => selectChart(state, params.chartId));
  const connection = useSelector((state) => state.connection.data.find((c) => `${c.id}` === `${params.connectionId}`));
  const dataset = useSelector((state) => state.dataset.data.find((d) => `${d.id}` === `${params.datasetId}`));
  const integrations = useSelector(selectIntegrations);
  const notifications = useSelector(selectNotifications);
  const unreadCount = useSelector(selectUnreadCount);
  const [notifOpen, setNotifOpen] = useState(false);

  const _formatNotifTime = (iso) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const _onNotificationClick = (n) => {
    if (!n.read && team?.id) {
      dispatch(markNotificationRead({ team_id: team.id, id: n.id }));
    }
    setNotifOpen(false);
    if (n.type === "ai") {
      if (n.meta?.conversationId) {
        dispatch(setAiPendingConversationId(n.meta.conversationId));
      }
      dispatch(showAiModal());
    }
  };

  // Load this team's notifications and subscribe to real-time updates so the
  // bell stays in sync across the user's sessions/devices.
  useEffect(() => {
    if (!user?.id || !team?.id) return undefined;

    dispatch(getNotifications({ team_id: team.id }));
    socketClient.connect(user.id, team.id).catch(() => {});

    const onCreated = (n) => dispatch(notificationReceived(n));
    const onUpdated = (n) => dispatch(notificationUpdated(n));
    const onDeleted = (p) => dispatch(notificationDeleted(p));
    const onReadAll = (p) => dispatch(notificationsReadAll(p));
    const onCleared = (p) => dispatch(notificationsCleared(p));
    // Resync via REST on (re)connect so a session that was briefly offline
    // catches any events it missed while disconnected.
    const onReconnect = () => dispatch(getNotifications({ team_id: team.id }));

    socketClient.on("notification-created", onCreated);
    socketClient.on("notification-updated", onUpdated);
    socketClient.on("notification-deleted", onDeleted);
    socketClient.on("notifications-read-all", onReadAll);
    socketClient.on("notifications-cleared", onCleared);
    socketClient.on("connect", onReconnect);

    return () => {
      socketClient.off("notification-created", onCreated);
      socketClient.off("notification-updated", onUpdated);
      socketClient.off("notification-deleted", onDeleted);
      socketClient.off("notifications-read-all", onReadAll);
      socketClient.off("notifications-cleared", onCleared);
      socketClient.off("connect", onReconnect);
    };
  }, [user?.id, team?.id]);

  // Keep this device's push subscription fresh once the user is logged in and
  // hasn't disabled push. Silent — only (re)subscribes if OS permission was
  // already granted; granting on a new device happens via the settings toggle.
  useEffect(() => {
    if (user?.id && user?.pushNotificationsEnabled !== false) {
      syncSubscription();
    }
  }, [user?.id, user?.pushNotificationsEnabled]);

  // When the user clicks an OS push notification, the service worker focuses the
  // app and posts us the payload — mirror the in-app bell click so an "ai"
  // notification deep-links back to its conversation.
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
    const onSwMessage = (event) => {
      const msg = event.data;
      if (!msg || msg.type !== "push-notification-click") return;
      const data = msg.data || {};
      if (data.type === "ai") {
        if (data.conversationId) dispatch(setAiPendingConversationId(data.conversationId));
        dispatch(showAiModal());
      }
    };
    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, [dispatch]);

  useEffect(() => {
    try {
      const newHwConfig = {
        selector: ".changelog-trigger", // CSS selector where to inject the badge
        // trigger: ".changelog-trigger",
        account: "JVODWy",
      }
      Headway.init(newHwConfig);
    } catch (e) {
      // ---
    }
  }, []);

  const _canAccess = (role, teamData) => {
    if (teamData) {
      return canAccess(role, user.id, teamData.TeamRoles, user);
    }
    return canAccess(role, user.id, team.TeamRoles, user);
  };

  const isOnDashboard = () => {
    return location.pathname.startsWith("/dashboard/");
  };

  const isOnConnections = () => {
    return location.pathname.startsWith("/connections");
  };

  const isOnDatasets = () => {
    return location.pathname.startsWith("/datasets");
  };

  const isOnIntegrations = () => {
    return location.pathname.startsWith("/integrations");
  };

  const _onDropdownAction = (key) => {
    switch (key) {
      case "discord": {
        window.open("https://discord.gg/KwGEbFk", "_blank");
        break;
      }
      case "tutorials": {
        window.open("#", "_blank");
        break;
      }
      case "documentation": {
        window.open("#", "_blank");
        break;
      }
      case "github": {
        window.open("#", "_blank");
        break;
      }
      case "feedback": {
        dispatch(showFeedbackModal());
        break;
      }
      case "profile": {
        navigate("/user/profile");
        break;
      }
      case "roadmap": {
        window.open("#", "_blank");
        break;
      }
      case "api": {
        window.open("#", "_blank");
        break;
      }
      default: {
        break;
      }
    }
  }

  return (
    <div className="w-full bg-content1 border-b border-divider p-2 sticky top-0 z-50">
      <div className="flex flex-row items-center justify-between flex-wrap gap-2">
        <div className="flex flex-row items-center gap-3 min-w-0">
          {isMobile ? (
            <Button isIconOnly variant="light" color="default" aria-label="Open menu" onPress={() => dispatch(toggleMobileSidebar())}>
              <LuMenu size={20} className="text-foreground" />
            </Button>
          ) : collapsed ? (
            <Button isIconOnly variant="light" color="default" onPress={() => dispatch(toggleSidebar())}>
              <LuPanelLeftOpen size={18} className="text-foreground" />
            </Button>
          ) : (
            <Button isIconOnly variant="light" color="default" onPress={() => dispatch(toggleSidebar())}>
              <LuPanelLeftClose size={18} className="text-foreground" />
            </Button>
          )}

          {isOnDashboard() && project?.name && (
            <Breadcrumbs>
              <BreadcrumbItem onPress={() => navigate("/")}>
                Dashboards
              </BreadcrumbItem>
              <BreadcrumbItem onPress={() => navigate(`/dashboard/${params.projectId}`)} isCurrent={!params.chartId}>{project.name}</BreadcrumbItem>
              {params.chartId && (
                <BreadcrumbItem isCurrent={true}>{chart?.name}</BreadcrumbItem>
              )}
            </Breadcrumbs>
          )}

          {isOnConnections() && (
            <Breadcrumbs>
              <BreadcrumbItem onPress={() => navigate("/connections")}>
                Connections
              </BreadcrumbItem>
              {connection?.name && (
                <BreadcrumbItem isCurrent={true}>{connection?.name}</BreadcrumbItem>
              )}
              {params.connectionId === "new" && (
                <BreadcrumbItem isCurrent={true}>New connection</BreadcrumbItem>
              )}
            </Breadcrumbs>
          )}
          {isOnDatasets() && (
            <Breadcrumbs>
              <BreadcrumbItem onPress={() => navigate("/datasets")}>
                Datasets
              </BreadcrumbItem>
              {dataset?.legend && (
                <BreadcrumbItem isCurrent={true}>{dataset?.legend}</BreadcrumbItem>
              )}
              {params.datasetId === "new" && (
                <BreadcrumbItem isCurrent={true}>New dataset</BreadcrumbItem>
              )}
            </Breadcrumbs>
          )}
          {isOnIntegrations() && (
            <Breadcrumbs>
              <BreadcrumbItem onPress={() => navigate("/integrations")}>
                Integrations
              </BreadcrumbItem>
              {params.integrationId && (
                <BreadcrumbItem isCurrent={true}>{integrations?.find((i) => i.id === params.integrationId)?.name}</BreadcrumbItem>
              )}
            </Breadcrumbs>
          )}
        </div>
        <div className="flex flex-row items-center gap-4">
          {_canAccess("teamAdmin", team) && (
            <Button
              variant="solid"
              onPress={() => dispatch(toggleAiModal())}
              startContent={<LuBrainCircuit size={18} />}
              size="sm"
              className="hidden sm:inline-flex from-primary-300 via-violet-200 to-secondary-300 dark:from-primary-500 dark:via-violet-500 dark:to-secondary-500 bg-linear-to-tr hover:bg-linear-to-br transition-all duration-300 shadow-md"
            >
              Ask Edison AI
            </Button>
          )}

          {/* <Dropdown aria-label="Select a help option">
            <DropdownTrigger>
              <Button
                variant="light"
                disableRipple
                className="p-0 bg-transparent data-[hover=true]:bg-transparent"
                startContent={<LuHeartHandshake size={18} />}
                radius="sm"
              >
                Resources
              </Button>
            </DropdownTrigger>
            <DropdownMenu variant="faded" onAction={(key) => _onDropdownAction(key)}>
              <DropdownItem startContent={<TbBrandDiscord />} key="discord" textValue="Join our Discord">
                {"Join our Discord"}
              </DropdownItem>
              <DropdownItem startContent={<LuSquareKanban />} key="roadmap" textValue="Roadmap">
                {"Roadmap"}
              </DropdownItem>
              <DropdownItem startContent={<LuBook />} key="tutorials" textValue="Blog tutorials">
                {"Blog tutorials"}
              </DropdownItem>
              <DropdownItem startContent={<LuBookOpenText />} key="documentation" textValue="Documentation">
                {"Documentation"}
              </DropdownItem>
              <DropdownItem startContent={<LuFileCode2 />} key="api" textValue="API Reference">
                {"API Reference"}
              </DropdownItem>
              <DropdownItem startContent={<LuGithub />} key="github" textValue="GitHub">
                {"GitHub"}
              </DropdownItem>
              <DropdownItem startContent={<LuSmile />} key="feedback" textValue="Feedback">
                {"Feedback"}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown> */}

          <Popover placement="bottom-end" isOpen={notifOpen} onOpenChange={setNotifOpen}>
            <PopoverTrigger>
              <Button
                isIconOnly
                variant="light"
                className="mr-2"
                aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                title="Notifications"
                size="sm"
              >
                <Badge
                  color="danger"
                  size="sm"
                  shape="circle"
                  content={unreadCount > 9 ? "9+" : unreadCount}
                  isInvisible={unreadCount === 0}
                >
                  <LuBell size={18} className="text-foreground" />
                </Badge>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[300px] max-w-[92vw]" aria-label="Notifications">
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-divider w-full">
                <span className="text-sm font-medium text-foreground">Notifications</span>
                {notifications.length > 0 && (
                  <div className="flex items-center">
                    {unreadCount > 0 && (
                      <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs" onPress={() => team?.id && dispatch(markAllNotificationsRead({ team_id: team.id }))}>
                        Mark all read
                      </Button>
                    )}
                    <Button size="sm" variant="light" className="h-7 min-w-0 px-2 text-xs" onPress={() => team?.id && dispatch(clearNotifications({ team_id: team.id }))}>
                      Clear
                    </Button>
                  </div>
                )}
              </div>
              {notifications.length === 0 ? (
                <div role="status" className="px-4 py-6 text-center text-xs text-foreground-500 w-full">
                  No new notifications
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto w-full">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => _onNotificationClick(n)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left border-b border-divider last:border-b-0 hover:bg-content2 transition-colors",
                        !n.read && "bg-primary-50/40"
                      )}
                    >
                      <div className="flex items-center gap-2 w-full min-w-0">
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                        <span className="text-sm font-medium text-foreground truncate">{n.title}</span>
                      </div>
                      {n.message && (
                        <span className="text-xs text-foreground-500 line-clamp-2">{n.message}</span>
                      )}
                      <span className="text-[10px] text-foreground-400">{_formatNotifTime(n.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  )
}

export default TopNav
