import React, { useEffect, useState, useRef } from "react"
import { useDebounce } from "react-use";
import { Modal, ModalContent, ModalBody, ModalHeader, ModalFooter, Avatar, Input, Button, Kbd, Popover, PopoverTrigger, PopoverContent, Code, Chip, Tooltip, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, CircularProgress, Listbox, ListboxItem } from "@heroui/react"
import { LuArrowRight, LuBrainCircuit, LuClock, LuMessageSquare, LuChevronDown, LuLoader, LuCoins, LuEllipsis, LuWrench, LuAtSign, LuLayoutGrid, LuPlug, LuDatabase, LuLayoutDashboard, LuCheck, LuX, LuThumbsUp, LuThumbsDown, LuRefreshCw, LuPlay, LuShare2, LuUsers, LuArchive, LuTrash2, LuStar } from "react-icons/lu"
import { useDispatch, useSelector } from "react-redux";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useParams, useNavigate, useLocation } from "react-router";

import { getAiConversation, getAiConversations, orchestrateAi, deleteAiConversation, renameAiConversation, getAiUsage, submitAiMessageFeedback, forkAiConversation, setAiConversationArchived, setAiConversationStarred, bulkUpdateAiConversations } from "../../api/ai";
import { selectTeam, selectTeamMembers, getTeamMembers } from "../../slices/team";
import { selectUser } from "../../slices/user";
import { getChart, moveChartToDashboard, runQuery, getProjectCharts } from "../../slices/chart";
import Chart from "../Chart/Chart";
import { selectProjects } from "../../slices/project";
import { selectConnections } from "../../slices/connection";
import { selectDatasetsNoDrafts } from "../../slices/dataset";
import { createNotification } from "../../slices/notification";
import isMac from "../../modules/isMac";
import socketClient from "../../modules/socketClient";
import { SITE_HOST } from "../../config/settings";
import useIsMobile from "../../modules/useIsMobile";
import { cn } from "../../modules/utils";
import { EDISON_PATH, parseContextFromPath } from "../../modules/edisonNav";
import ConversationActionsMenu from "./ConversationActionsMenu";
import ConversationList from "./ConversationList";
import { formatDate, formatTokens, CONVERSATIONS_PAGE_SIZE } from "./conversationUtils";

const components = {
  code: ({ children }) => {
    const formattedText = String(children).replace(/^`|`$/g, ""); // Strip backticks
    return formattedText;
  },
  li: ({ children, className }) => {
    // If this is a task list item, remove the bullet point and reduce padding
    if (className?.includes("task-list-item")) {
      return <li className={`${className} list-none -ml-6`}>{children}</li>;
    }
    return <li className={className}>{children}</li>;
  }
};

/**
 * The Edison AI chat, rendered as a full-viewport page at /edison.
 *
 * Routing contract:
 *   /edison                    -> resolves to the last active conversation
 *   /edison/:conversationId    -> that conversation
 *   /edison/new                -> a fresh, unsaved conversation
 */
function AiPage() {
  const [question, setQuestion] = useState("");
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSocketReady, setIsSocketReady] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
  const [streamingResponse, setStreamingResponse] = useState("");
  const [localMessages, setLocalMessages] = useState([]);
  const [teamUsage, setTeamUsage] = useState(null);
  const [createdCharts, setCreatedCharts] = useState([]);
  const [selectedContext, setSelectedContext] = useState({
    multiSelect: [], // entities selected via "@" button (multiple allowed)
    singleSelect: null // entity selected via quick reply (only one at a time)
  });
  const [contextSearch, setContextSearch] = useState("");
  const [isContextPopoverOpen, setIsContextPopoverOpen] = useState(false);
  const [isSecondContextPopoverOpen, setIsSecondContextPopoverOpen] = useState(false);
  const [renamingConversationId, setRenamingConversationId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [messageFeedback, setMessageFeedback] = useState({});
  const [shareModalConversationId, setShareModalConversationId] = useState(null);
  const [shareTargetUserId, setShareTargetUserId] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  // On phones the conversations list is an off-canvas drawer over the chat.
  const [showConvoSidebar, setShowConvoSidebar] = useState(false);
  // True until /edison (no id) has resolved to a conversation, so the chat pane
  // shows a spinner rather than briefly flashing the "new conversation" state.
  const [isResolvingRoute, setIsResolvingRoute] = useState(true);

  // --- conversation history: filters / search / pagination ---
  // Statuses is a set so Active and Archived can be shown together.
  const [conversationStatuses, setConversationStatuses] = useState(["active"]);
  const [starredOnly, setStarredOnly] = useState(false);
  const [conversationSearch, setConversationSearch] = useState(""); // raw input value
  const [conversationQuery, setConversationQuery] = useState(""); // debounced; drives the fetch
  const [conversationsTotal, setConversationsTotal] = useState(0);
  const [conversationCounts, setConversationCounts] = useState({
    active: 0, archived: 0, starred: 0,
  });
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);

  // --- bulk selection ---
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedConversationIds, setSelectedConversationIds] = useState(() => new Set());
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  // --- destructive-action confirmations ---
  const [conversationToDelete, setConversationToDelete] = useState(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);

  const params = useParams();
  const navigate = useNavigate();
  const team = useSelector(selectTeam);
  const user = useSelector(selectUser);
  const teamMembers = useSelector(selectTeamMembers);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dispatch = useDispatch();
  const isMobile = useIsMobile();

  // The conversation to show comes from the URL. "new" is the sentinel for a
  // fresh unsaved chat; undefined means "resolve the last active one".
  const routeConversationId = params?.conversationId;
  const isNewRoute = routeConversationId === "new";

  const location = useLocation();
  // Where the user came from, so Back can return there and context chips can be
  // pre-seeded. Captured once — later in-page navigations replace location.state.
  const originRef = useRef(location.state?.from || null);
  const originContext = useRef(parseContextFromPath(originRef.current)).current;

  const _onExit = () => {
    const target = originRef.current || "/";
    // Edison can create or update charts, so a dashboard we're returning to may
    // be stale. (This used to hang off the modal's onClose in Main.jsx.)
    const dashboardMatch = target.match(/\/dashboard\/(\d+)/);
    if (dashboardMatch) {
      dispatch(getProjectCharts({ project_id: dashboardMatch[1] }));
    }
    navigate(target);
  };

  // Whether the user is looking at this page. Async completion handlers use it
  // to decide between rendering the answer and raising a notification; unlike
  // the old modal this component unmounts when you navigate away, so the
  // cleanup below is what makes "I left the chat" observable to an in-flight
  // turn whose fetch closure outlives the unmount.
  const isOpenRef = useRef(true);
  useEffect(() => {
    isOpenRef.current = true;
    return () => { isOpenRef.current = false; };
  }, []);
  const fetchedChartsRef = useRef(new Set());
  // Mirror the current conversation into a ref so socket handlers (attached once
  // per open) can read the latest value without stale closures.
  const conversationRef = useRef(null);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  // Same mirroring trick for the list, so loadConversations() is safe to call
  // from socket handlers (registered once per open) without a stale closure.
  const conversationsRef = useRef([]);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  const listParamsRef = useRef({ statuses: ["active"], starred: false, query: "" });
  useEffect(() => {
    listParamsRef.current = {
      statuses: conversationStatuses, starred: starredOnly, query: conversationQuery,
    };
  }, [conversationStatuses, starredOnly, conversationQuery]);
  // Monotonic request id: only the newest list request may commit its result.
  // Guards against a slow search/tab response overwriting fresher data.
  const listRequestIdRef = useRef(0);
  // Whether the URL has been resolved into a conversation at least once. The
  // first resolution must not wipe the context chips seeded from the page the
  // user came from; later switches between conversations should start clean.
  const didInitialResolveRef = useRef(false);
  // Tracks the in-flight orchestration turn. Completion is driven by whichever
  // of (HTTP response | "ai-orchestration-complete" socket event) lands first;
  // the other becomes a no-op via the `done` flag.
  const turnRef = useRef(null);
  const projects = useSelector(selectProjects);
  const connections = useSelector(selectConnections);
  const datasets = useSelector(selectDatasetsNoDrafts);
  const contextEntities = [
    ...projects.map((p) => ({ ...p, entity_type: "project" })),
    ...connections.map((c) => ({ ...c, entity_type: "connection" })),
    ...datasets.map((d) => ({ ...d, entity_type: "dataset" })),
  ];

  // Filter context entities based on search
  const filteredContextEntities = contextEntities.filter((entity) => {
    if (!contextSearch.trim()) return true;

    const searchLower = contextSearch.toLowerCase();
    const name = entity.name?.toLowerCase() || "";
    const type = entity.type?.toLowerCase() || "";
    const legend = entity.legend?.toLowerCase() || "";

    return name.includes(searchLower) ||
           type.includes(searchLower) ||
           legend.includes(searchLower);
  });

  // Helper to get display label for context entity
  const getContextLabel = (entity) => {
    switch (entity.entity_type) {
      case "project":
        return `Project: ${entity.name}`;
      case "connection":
        return `Connection: ${entity.name} (${entity.type})`;
      case "dataset":
        return `Dataset: ${entity.legend || entity.name}`;
      default:
        return entity.name;
    }
  };

  const [movingChartId, setMovingChartId] = useState(null);
  // Track which temp charts have been added to dashboards (chartId -> targetProjectId)
  const [addedToDashboard, setAddedToDashboard] = useState({});

  const _onMoveChartToDashboard = async (chartId, sourceProjectId, targetProjectId) => {
    setMovingChartId(chartId);
    try {
      const result = await dispatch(moveChartToDashboard({
        project_id: sourceProjectId,
        chart_id: chartId,
        target_project_id: targetProjectId,
        team_id: team.id,
      })).unwrap();

      toast.success("Chart added to dashboard");

      // Track that this chart was added to a dashboard (original stays in ghost).
      // Store the cloned chart ID so we can verify the clone still exists later.
      setAddedToDashboard(prev => ({
        ...prev,
        [chartId]: {
          projectId: parseInt(targetProjectId, 10),
          clonedChartId: result.chart_id,
        }
      }));
    } catch (error) {
      toast.error(error.message || "Failed to add chart to dashboard");
    } finally {
      setMovingChartId(null);
    }
  };

  // On mount, verify that cloned charts still exist on their target dashboards.
  // If a clone was deleted (shelved back to ghost), its project_id will no
  // longer match — reset to "Add to Dashboard".
  useEffect(() => {
    const entries = Object.entries(addedToDashboard);
    if (entries.length === 0) return;

    const verify = async () => {
      const stale = [];

      for (const [ghostChartId, info] of entries) {
        try {
          const result = await dispatch(getChart({
            project_id: info.projectId,
            chart_id: info.clonedChartId,
          }));
          // If the clone was removed from the dashboard it gets shelved to
          // ghost, so its project_id no longer matches the target dashboard.
          if (!result?.payload || result.payload.project_id !== info.projectId) {
            stale.push(ghostChartId);
          }
        } catch {
          stale.push(ghostChartId);
        }
      }

      if (stale.length > 0) {
        setAddedToDashboard(prev => {
          const next = { ...prev };
          stale.forEach(id => delete next[id]);
          return next;
        });
      }
    };

    verify();
  }, []);

  // Fetch chart data for the AI chat.  Uses the ghost project as the
  // project_id in the API call because ghost projects bypass the per-project
  // access check, while findById only uses the chart ID.
  // When isUpdate is true, runs a fresh query (no cache) so the chart
  // preview reflects the latest config changes.
  const fetchChartData = async (chartId, projectId, { isUpdate = false } = {}) => {
    const ghostProject = projects.find((p) => p.ghost);
    const fetchProjectId = ghostProject?.id ?? projectId;

    let chartPayload;

    if (isUpdate) {
      // Run the query with getCache explicitly false to bypass both
      // server-side chart cache and data-request cache.
      const queryResult = await dispatch(runQuery({
        project_id: fetchProjectId,
        chart_id: chartId,
        getCache: false,
      }));
      chartPayload = queryResult?.payload;
    }

    if (!chartPayload) {
      // Fallback to a simple read (for creates, or if runQuery failed)
      const result = await dispatch(getChart({
        project_id: fetchProjectId,
        chart_id: chartId
      }));
      chartPayload = result?.payload;
    }

    if (chartPayload) {
      setCreatedCharts(prevCharts => {
        const existingIndex = prevCharts.findIndex(c => c.id === chartPayload.id);
        if (existingIndex >= 0) {
          const updatedCharts = [...prevCharts];
          updatedCharts[existingIndex] = chartPayload;
          return updatedCharts;
        }
        return [...prevCharts, chartPayload];
      });
      return chartPayload;
    }

    // Fetch failed — don't mark as deleted. The chart card will render
    // without a preview, which is better than incorrectly claiming "removed".
    return null;
  };

  // Extract updated chart IDs from an orchestration response's conversation
  // history so we can trigger an immediate refresh after the response arrives.
  const _getUpdatedChartIds = (conversationHistory) => {
    if (!conversationHistory) return [];
    return conversationHistory
      .filter(msg => msg.role === "tool" && msg.name === "update_chart")
      .map(msg => {
        try {
          const content = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
          if (content.chart_id) return { chartId: content.chart_id, projectId: content.project_id };
        } catch { /* ignore */ }
        return null;
      })
      .filter(Boolean);
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages, progressEvents]);

  // Fetch chart data for newly created charts
  useEffect(() => {
    const fetchNewCharts = async () => {
      const allMessages = [
        ...(conversation?.full_history || []),
        ...localMessages
      ];

      const chartMessages = allMessages
        .filter(msg => msg.role === "tool")
        .map(msg => {
          try {
            const content = JSON.parse(msg.content);
            if ((msg.name === "create_chart" || msg.name === "update_chart" || msg.name === "create_temporary_chart") && content.chart_id) {
              return {
                chartId: content.chart_id,
                projectId: content.project_id || content.ghost_project_id,
                isUpdate: msg.name === "update_chart",
                isTemporary: msg.name === "create_temporary_chart" || msg.name === "create_chart"
              };
            }
          } catch (e) {
            // Ignore parsing errors
          }
          return null;
        })
        .filter(Boolean);

      // Fetch charts that haven't been loaded yet (for both create and update, including temporary).
      // Updated charts are also refreshed directly in the response handlers
      // (_onAskAi) for immediate feedback; this loop handles the initial load
      // when opening a conversation that already contains chart messages.
      for (const { chartId, projectId, isUpdate } of chartMessages) {
        if (!fetchedChartsRef.current.has(chartId)) {
          fetchedChartsRef.current.add(chartId);
          await fetchChartData(chartId, projectId, { isUpdate });
        }
      }

      // Auto-populate addedToDashboard for create_chart results that were
      // auto-cloned to a dashboard (e.g. when the AI was told "add to Sales Dashboard").
      // This ensures the "Added to [Dashboard]" chip shows on conversation reload.
      const autoCloned = allMessages
        .filter(msg => msg.role === "tool" && (msg.name === "create_chart" || msg.name === "create_temporary_chart"))
        .map(msg => {
          try {
            const content = JSON.parse(msg.content);
            if (content.chart_id && content.dashboard_project_id && content.cloned_chart_id) {
              return {
                ghostChartId: content.chart_id,
                dashboardProjectId: content.dashboard_project_id,
                clonedChartId: content.cloned_chart_id,
              };
            }
          } catch { /* ignore */ }
          return null;
        })
        .filter(Boolean);

      if (autoCloned.length > 0) {
        setAddedToDashboard(prev => {
          const next = { ...prev };
          for (const { ghostChartId, dashboardProjectId, clonedChartId } of autoCloned) {
            if (!next[ghostChartId]) {
              next[ghostChartId] = {
                projectId: dashboardProjectId,
                clonedChartId,
              };
            }
          }
          return next;
        });
      }
    };

    fetchNewCharts();
  }, [conversation?.full_history, localMessages]);

  // Initialize Socket.IO connection
  useEffect(() => {
    if (!user?.id || !team?.id) return;

    let isMounted = true;

    const initSocket = async () => {
      try {
        await socketClient.connect(user.id, team.id);
        if (isMounted) {
          setIsSocketReady(true);
        }
      } catch (error) {
        console.error("Socket connection failed:", error);
        if (isMounted) {
          toast.error("Failed to establish real-time connection");
        }
      }
    };

    // Set up conversation-created listener
    const handleConversationCreated = (data) => {
      if (data?.conversationId) {
        socketClient.joinConversation(data.conversationId);
        setConversation(prev => prev ? { ...prev, id: data.conversationId, isTemporary: false } : null);
        // Put the real id in the URL so a refresh keeps this chat, and Back
        // doesn't land on the now-stale /edison/new.
        navigate(`${EDISON_PATH}/${data.conversationId}`, { replace: true, state: location.state });
        // A brand-new conversation is active, unstarred and unfiltered. If the
        // user has filters or a search on, reset them so their own new chat isn't
        // invisible — these setters trip the fetch effect, and are a no-op
        // re-render when the defaults are already in place.
        setConversationStatuses(["active"]);
        setStarredOnly(false);
        setConversationSearch("");
        setConversationQuery("");
        // Optimistic bump so the filter count is right before the next fetch lands.
        setConversationCounts(prev => ({ ...prev, active: prev.active + 1 }));
        // A fresh chat while mid-multi-select is incoherent.
        _exitSelectionMode();
      }
    };

    // Set up conversation-updated listener (e.g. title generated async)
    const handleConversationUpdated = (data) => {
      if (data?.conversationId && data?.title) {
        // Read from the mirror BEFORE the setter: React 18 StrictMode double-
        // invokes updaters, so a flag set inside one is not trustworthy.
        const isLoadedRow = conversationsRef.current.some(
          c => `${c.id}` === `${data.conversationId}`
        );
        setConversations(prev => prev.map(c =>
          c.id === data.conversationId ? { ...c, title: data.title } : c
        ));
        setConversation(prev =>
          prev?.id === data.conversationId ? { ...prev, title: data.title } : prev
        );
        // Not on the loaded page (filtered out, or not paged in yet). Only worth
        // a refetch when it's the conversation they're actually looking at, so
        // the generated title replaces "New Conversation" in the list too.
        if (!isLoadedRow && `${conversationRef.current?.id}` === `${data.conversationId}`) {
          _refreshConversationList().catch(() => {});
        }
      }
    };

    // Authoritative completion signal from the server: the answer is persisted
    // and the turn is done. Clears the spinner and refetches even if the long
    // orchestrate HTTP response never arrives — the fix for the chat getting
    // stuck on "computing" until a manual refresh.
    const handleOrchestrationComplete = (data) => {
      const turn = turnRef.current;
      if (!turn || turn.done) return; // no in-flight turn, or HTTP already settled it
      // Ignore completions that aren't for this client's current turn (another
      // tab's turn, or a delayed event from a previous turn in this tab).
      // Strict match (consistent with handleToken): ignore completions whose
      // turnId doesn't equal the active turn — including a null turnId from the
      // suggestion-action path, which must not finalize an unrelated real turn.
      if (data?.turnId !== turn.id) return;
      turn.done = true;
      const convId = data?.conversationId || turn.conversationId || conversationRef.current?.id;
      if (data?.error) {
        const msg = data?.errorMessage
          ? `Sorry, I encountered an error: ${data.errorMessage}`
          : "Sorry, I encountered an error finishing your request.";
        toast.error(data?.errorMessage || "Edison ran into an error finishing your request.");
        // Leave a persistent in-thread error bubble (matches the HTTP error path).
        setLocalMessages(prev => [...prev, { role: "assistant", content: msg, isError: true }]);
        setProgressEvents([]);
        setStreamingResponse("");
      } else {
        _finalizeTurnFromServer(convId, { adoptIfNew: true }).catch(() => {});
      }
      setIsLoading(false);
    };

    // Live assistant text deltas and turn-boundary resets, streamed to the
    // user's room. Registered here (not in the conversation-scoped effect) so it
    // is active before the client joins a brand-new conversation's room —
    // otherwise that conversation's first-turn answer wouldn't stream. Matched
    // to the active turn via turnRef so stale / other-turn deltas are ignored.
    const handleToken = (data) => {
      const turn = turnRef.current;
      if (!turn) return;
      // Strict match: only the active turn's deltas render (fail closed — a
      // missing/mismatched turnId is dropped rather than appended).
      if (data?.turnId !== turn.id) return;
      if (data?.reset) {
        setStreamingResponse("");
        return;
      }
      if (typeof data?.delta === "string") {
        setStreamingResponse(prev => prev + data.delta);
      }
    };

    initSocket();
    socketClient.on("conversation-created", handleConversationCreated);
    socketClient.on("conversation-updated", handleConversationUpdated);
    socketClient.on("ai-orchestration-complete", handleOrchestrationComplete);
    socketClient.on("ai-token", handleToken);

    return () => {
      isMounted = false;
      socketClient.off("conversation-created", handleConversationCreated);
      socketClient.off("conversation-updated", handleConversationUpdated);
      socketClient.off("ai-orchestration-complete", handleOrchestrationComplete);
      socketClient.off("ai-token", handleToken);
      // Note: We don't disconnect the socket here - it's a singleton that stays
      // connected. This allows seamless reconnection when the page remounts.
    };
  }, [user?.id, team?.id]);

  // Single source of fetching for the history list: mounting, the team
  // resolving, a tab switch or a settled search all refetch page 1.
  useEffect(() => {
    if (!team?.id) return;
    loadConversations({ reset: true });
  }, [team?.id, conversationStatuses, starredOnly, conversationQuery]);

  // Debounce the search box into the value that actually drives the fetch.
  // Trimmed so a trailing space isn't treated as a new query.
  useDebounce(() => {
    setConversationQuery(conversationSearch.trim());
  }, 300, [conversationSearch]);

  // Resolve the URL into the open conversation. The URL is the single source of
  // truth: clicking a row navigates, and this effect does the loading.
  useEffect(() => {
    if (!team?.id) return undefined;
    let cancelled = false;

    const resolveRoute = async () => {
      // /edison/new — a fresh, unsaved chat.
      if (isNewRoute) {
        _resetToNewConversation();
        setIsResolvingRoute(false);
        didInitialResolveRef.current = true;
        return;
      }

      // /edison/:conversationId — load it, unless it's already on screen (which
      // is the case right after we create one and rewrite the URL).
      if (routeConversationId) {
        setIsResolvingRoute(false);
        if (`${conversationRef.current?.id}` !== `${routeConversationId}`) {
          await _onSelectConversation(routeConversationId, {
            preserveContext: !didInitialResolveRef.current,
          });
        }
        didInitialResolveRef.current = true;
        return;
      }

      // /edison — auto-load the last active conversation. The list is ordered
      // by updatedAt DESC, so one row is all we need.
      try {
        const data = await getAiConversations(team.id, { limit: 1, offset: 0, archived: false });
        if (cancelled) return;
        const lastActive = data?.conversations?.[0];
        if (lastActive) {
          // replace: true so Back doesn't bounce through the bare /edison.
          navigate(`${EDISON_PATH}/${lastActive.id}`, { replace: true, state: location.state });
          return;
        }
        // Nothing to open (new user, or everything archived) — show the composer.
        _resetToNewConversation();
        didInitialResolveRef.current = true;
      } catch (error) {
        if (!cancelled) toast.error(error.message);
      } finally {
        if (!cancelled) setIsResolvingRoute(false);
      }
    };

    resolveRoute();
    return () => { cancelled = true; };
  }, [team?.id, routeConversationId]);

  // Row clicks and the New Conversation button both go through the URL.
  const _onNavigateToConversation = (conversationId) => {
    setShowConvoSidebar(false);
    if (`${conversationId}` === `${conversationRef.current?.id}`) return;
    navigate(`${EDISON_PATH}/${conversationId}`, { state: location.state });
  };

  const _onStartNewConversation = () => {
    setShowConvoSidebar(false);
    navigate(`${EDISON_PATH}/new`, { state: location.state });
  };

  // Seed context chips from wherever the user opened Edison from.
  //
  // This page has its own route, so it can't read the dashboard/dataset params
  // off the URL any more — the entry points pass the path they left behind in
  // navigation state instead (see openEdison in modules/edisonNav.js).
  useEffect(() => {
    const { projectId, chartId, connectionId, datasetId } = originContext;

    // De-duplicates inside the updater rather than against the effect's closure:
    // with [] deps, StrictMode's double-invoke would otherwise read a stale
    // multiSelect both times and append the same chip twice (duplicate React key).
    const addContext = (entity) => setSelectedContext((prev) => (
      prev.multiSelect.some((e) => e.id === entity.id && e.entity_type === entity.entity_type)
        ? prev
        : { ...prev, multiSelect: [...prev.multiSelect, entity] }
    ));

    if (projectId) {
      const project = projects.find(p => p.id === projectId);
      addContext({ id: projectId, entity_type: "project", label: `Project: ${project?.name}` });
    }
    if (chartId) {
      addContext({ id: chartId, entity_type: "chart", label: `Chart ID: ${chartId}` });
    }
    if (connectionId) {
      const connection = connections.find(c => c.id === connectionId);
      addContext({ id: connectionId, entity_type: "connection", label: `Connection: ${connection?.name} (${connection?.type})` });
    }
    if (datasetId) {
      const dataset = datasets.find(d => d.id === datasetId);
      addContext({ id: datasetId, entity_type: "dataset", label: `Dataset: ${dataset?.legend || dataset?.name}` });
    }
  }, []);

  // Join conversation room when conversation changes
  useEffect(() => {
    if (!isSocketReady || !conversation?.id) return;

    // Join the conversation room
    socketClient.joinConversation(conversation.id);

    // Listen for progress events
    const handleProgress = (data) => {
      setProgressEvents(prev => [...prev, {
        id: Date.now() + Math.random(),
        type: data.event,
        message: data.data?.message || "Processing...",
        timestamp: new Date(data.timestamp)
      }]);
    };

    socketClient.on("ai-progress", handleProgress);

    return () => {
      socketClient.off("ai-progress", handleProgress);
      socketClient.leaveConversation(conversation.id);
    };
  }, [isSocketReady, conversation?.id]);

  /**
   * Fetch a page of the history list.
   *
   * `reset` replaces the list (page 1); otherwise the next page is appended.
   * There is deliberately no `offset` state — it's derived from the current list
   * length, so an optimistic removal can never desync it from the server's
   * paging. The corollary is that every mutation must refetch rather than splice.
   *
   * `silent` skips the loading flag, for background refreshes that shouldn't
   * flash a skeleton over an already-populated list.
   */
  const loadConversations = async ({ reset = true, silent = false, limit } = {}) => {
    if (!team?.id) return;
    const requestId = listRequestIdRef.current + 1;
    listRequestIdRef.current = requestId;
    const { statuses, starred, query } = listParamsRef.current;
    const offset = reset ? 0 : conversationsRef.current.length;
    const pageSize = limit || CONVERSATIONS_PAGE_SIZE;

    if (reset) {
      if (!silent) setIsLoadingConversations(true);
    } else {
      setIsLoadingMoreConversations(true);
    }

    try {
      const data = await getAiConversations(team.id, {
        limit: pageSize,
        offset,
        statuses,
        starred,
        search: query,
      });
      // A newer tab switch / search / page request has been issued since this
      // one left — drop the response so it can't overwrite fresher data.
      if (requestId !== listRequestIdRef.current) return;

      const page = data.conversations || [];
      setConversations((prev) => {
        if (reset) return page;
        // Second belt against duplicate keys if page boundaries shifted.
        const seen = new Set(prev.map((c) => `${c.id}`));
        return [...prev, ...page.filter((c) => !seen.has(`${c.id}`))];
      });
      setConversationsTotal(data.total ?? page.length);
      setConversationCounts({
        active: data.activeCount ?? 0,
        archived: data.archivedCount ?? 0,
        starred: data.starredCount ?? 0,
      });
      // load usage in the background
      loadTeamUsage();
    } catch (error) {
      if (requestId !== listRequestIdRef.current) return;
      toast.error(error.message);
    } finally {
      // Guarded too, so a stale response can't clear a live spinner.
      if (requestId === listRequestIdRef.current) {
        setIsLoadingConversations(false);
        setIsLoadingMoreConversations(false);
      }
    }
  };

  /**
   * Refetch from offset 0 but keep as many rows as the user had already paged
   * in, so a background refresh (a finished turn, an archive, a delete) doesn't
   * collapse a deep list back to a single page.
   */
  const _refreshConversationList = () => loadConversations({
    reset: true,
    silent: true,
    limit: Math.max(CONVERSATIONS_PAGE_SIZE, conversationsRef.current.length),
  });

  const _onLoadMoreConversations = () => {
    if (isLoadingMoreConversations || isLoadingConversations) return;
    if (conversationsRef.current.length >= conversationsTotal) return;
    loadConversations({ reset: false });
  };

  const _exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedConversationIds(new Set());
  };

  // Shared by every filter change: the visible set is about to change, so drop
  // the current rows, any selection and any in-progress rename. The search term
  // is deliberately KEPT — "I searched X, is it archived?" is the main reason to
  // touch these filters.
  const _resetListForFilterChange = () => {
    setConversations([]);
    setConversationsTotal(0);
    _exitSelectionMode();
    _onCancelRename();
  };

  // Computed outside setState on purpose: this decides whether to reset the list
  // as a side effect, and StrictMode double-invokes updaters.
  const _onToggleConversationStatus = (status, checked) => {
    const next = checked
      ? [...new Set([...conversationStatuses, status])]
      : conversationStatuses.filter((s) => s !== status);

    // Never leave both unchecked: the server would silently fall back to
    // active-only and the dropdown would then disagree with the list.
    if (next.length === 0) return;

    // Stable order so the array identity only changes on a real edit (it's a
    // dependency of the fetch effect).
    const ordered = ["active", "archived"].filter((s) => next.includes(s));
    const unchanged = ordered.length === conversationStatuses.length
      && ordered.every((s, i) => s === conversationStatuses[i]);
    if (unchanged) return;

    _resetListForFilterChange();
    setConversationStatuses(ordered);
  };

  const _onToggleStarredOnly = (checked) => {
    if (checked === starredOnly) return;
    _resetListForFilterChange();
    setStarredOnly(checked);
  };

  const _onChangeConversationSearch = (value) => {
    setConversationSearch(value);
    _onCancelRename();
  };

  const _onToggleSelectConversation = (id) => {
    setSelectedConversationIds((prev) => {
      // Must be a new Set — mutating in place would not re-render.
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const _onToggleAllLoadedConversations = (checked) => {
    setSelectedConversationIds(checked ? new Set(conversations.map((c) => c.id)) : new Set());
  };

  const loadTeamUsage = async () => {
    try {
      const data = await getAiUsage(team.id);
      setTeamUsage(data);
    } catch (error) {
      toast.error(error.message);
    }
  };

  // When Edison finishes but the user has left the chat panel, surface an
  // in-app notification (bell + toast) and, when the tab is backgrounded and
  // permission was granted, a browser/OS notification.
  const _notifyAiComplete = (message, conversationId) => {
    if (isOpenRef.current) return; // panel is open — they'll see the answer
    const snippet = (message || "")
      .replace(/```cb-actions[\s\S]*?```/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/[#*_>`]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    if (team?.id) {
      // Persist server-side so it syncs to the user's other sessions/devices;
      // the socket echo + this thunk's result are de-duped by id in the slice.
      dispatch(createNotification({
        team_id: team.id,
        type: "ai",
        title: "Edison finished your request",
        message: snippet || "Your response is ready.",
        meta: { conversationId: conversationId || null },
      }));
    }
    toast.success("Edison finished your request");
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted"
        && typeof document !== "undefined" && document.hidden) {
        const notifOptions = { body: snippet || "Your response is ready." };
        // Only share a tag across the SAME conversation (so repeated answers in
        // one chat coalesce); distinct completions stay separate when there's no id.
        if (conversationId) notifOptions.tag = `edison-${conversationId}`;
        const n = new Notification("Edison finished your request", notifOptions);
        n.onclick = () => { try { window.focus(); } catch (err) { /* ignore */ } };
      }
    } catch (err) {
      // browser notifications are best-effort
    }
  };

  const _maybeRequestNotifyPermission = () => {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
      }
    } catch (err) {
      // ignore
    }
  };

  // Pull the freshly-persisted conversation from the server and settle the UI.
  // Shared by the HTTP response path and the socket completion safety net, so a
  // turn finishes correctly even if the long orchestrate HTTP response is lost.
  // Only swaps the displayed conversation when the user is still viewing it, so
  // a late completion can't hijack a conversation they've since navigated away from.
  const _finalizeTurnFromServer = async (conversationId, { adoptIfNew = false } = {}) => {
    if (!conversationId) return;
    const updated = await getAiConversation(conversationId, team.id);
    if (updated?.conversation) {
      const viewing = conversationRef.current?.id;
      // Swap in the displayed conversation when the user is still viewing this
      // exact one. Additionally, for this client's own just-finished turn
      // (adoptIfNew), adopt it when they're still on the temporary/new
      // conversation they submitted from — the "conversation-created" event that
      // normally assigns the real id may have been missed, which would otherwise
      // strand the answer on a never-updating temporary conversation. We never
      // hijack a *different* real conversation navigated to since: that fails
      // both checks because `viewing` is then a non-matching real id.
      const stillViewingThis = `${viewing}` === `${conversationId}`;
      const onNewConversation = adoptIfNew && !viewing;
      if (stillViewingThis || onNewConversation) {
        setConversation(updated.conversation);
        setLocalMessages([]);
        setProgressEvents([]);
        setStreamingResponse("");
        // Refresh updated charts in the background — never gate the spinner on them.
        const updatedCharts = _getUpdatedChartIds(updated.conversation.full_history);
        updatedCharts.forEach(({ chartId, projectId }) => {
          fetchedChartsRef.current.add(chartId);
          fetchChartData(chartId, projectId, { isUpdate: true });
        });
      }
    }
    // Depth-preserving so a finished turn doesn't collapse a deeply paged list.
    _refreshConversationList().catch(() => {});
  };

  const _onAskAi = async (e, overrideQuestion) => {
    if (e?.preventDefault) e.preventDefault();
    const sourceQuestion = typeof overrideQuestion === "string" ? overrideQuestion : question;
    // Allow submission if there's either a question or a selected context
    const hasContent = sourceQuestion.trim() || selectedContext.multiSelect.length > 0 || selectedContext.singleSelect;
    if (!hasContent || isLoading) return;

    // Ask once (on this user gesture) so we can post a browser notification if
    // the user leaves the tab while Edison is working.
    _maybeRequestNotifyPermission();

    // Prepare context object (only multiSelect goes to context)
    let context = null;
    if (selectedContext.multiSelect.length > 0) {
      context = selectedContext.multiSelect;
    }

    setIsLoading(true);
    setProgressEvents([]);
    setStreamingResponse("");

    // Build the text actually sent to the AI: the typed question plus any
    // selected quick-reply suggestion. The user bubble below shows this same
    // text, so a suggestion-only submit (no typed text) renders the user's
    // prompt instead of an empty bubble.
    let currentQuestion = sourceQuestion.trim();
    if (selectedContext.singleSelect) {
      currentQuestion += (currentQuestion ? "\n\n" : "") + selectedContext.singleSelect.label;
    }

    const userMessage = {
      role: "user",
      content: currentQuestion
    };
    setQuestion("");
    setSelectedContext({
      multiSelect: [],
      singleSelect: null
    });
    setContextSearch("");

    // Mark this turn in-flight so the HTTP response and the socket
    // "ai-orchestration-complete" event coordinate: whichever lands first
    // finalizes the turn; the other becomes a no-op via `done`.
    const myTurn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      conversationId: conversation?.id || null,
      done: false,
    };
    turnRef.current = myTurn;

    try {
      let response;

      if (!conversation || conversation.isTemporary) {
        // New conversation: show the user's message + a temporary conversation
        // immediately. The backend creates the real conversation and emits its
        // id via "conversation-created" (handled in the socket effect above).
        setLocalMessages([userMessage]);

        const tempConversation = {
          id: conversation?.id || null, // keep id if the socket already set it
          title: "New Conversation",
          full_history: [],
          createdAt: new Date().toISOString(),
          message_count: 1,
          isTemporary: true
        };
        setConversation(tempConversation);

        response = await orchestrateAi(team.id, currentQuestion, [], tempConversation.id, context, { clientTurnId: myTurn.id });
      } else {
        // Existing conversation: show the user's message immediately, then send
        // the latest history so the orchestrator has full context.
        setLocalMessages([userMessage]);

        const latestConversation = await getAiConversation(conversation.id, team.id);
        const conversationHistory = latestConversation?.conversation?.full_history || [];

        response = await orchestrateAi(team.id, currentQuestion, conversationHistory, conversation.id, context, { clientTurnId: myTurn.id });
      }

      // This turn is stale if the socket event already finalized it (done), or
      // the user navigated away / started another turn while we awaited
      // (turnRef no longer points at us). In either case, don't render/finalize.
      if (myTurn.done || turnRef.current !== myTurn) return;
      myTurn.done = true;

      if (!response || !response.orchestration || !response.orchestration.message) {
        throw new Error("Invalid response from AI");
      }

      const finishedConversationId = response.orchestration.aiConversationId
        || conversationRef.current?.id || conversation?.id;

      // Render the answer and stop the spinner immediately — the conversation /
      // chart refresh below must never keep the user stuck on "computing".
      setLocalMessages(prev => [...prev, {
        role: "assistant",
        content: response.orchestration.message,
      }]);
      _notifyAiComplete(response.orchestration.message, finishedConversationId);
      setIsLoading(false);

      // Settle canonical state (full_history + charts + sidebar) in the background.
      _finalizeTurnFromServer(finishedConversationId, { adoptIfNew: true }).catch(() => {});
    } catch (error) {
      if (myTurn.done) {
        // Already finalized by the socket completion event — ignore a late HTTP failure.
      } else if (error.name === "AbortError") {
        // The long request was aborted client-side after the deadline. The server
        // may still be finishing; the socket completion event will finalize it.
        // Meanwhile, try to recover an answer that was already persisted.
        let recovered = false;
        const convId = conversationRef.current?.id || conversation?.id;
        if (convId) {
          try {
            const latest = await getAiConversation(convId, team.id);
            const history = latest?.conversation?.full_history || [];
            if (history.length && history[history.length - 1].role === "assistant") {
              myTurn.done = true;
              // Settle via the shared finalizer so charts + sidebar refresh too.
              await _finalizeTurnFromServer(convId, { adoptIfNew: true });
              recovered = true;
            }
          } catch (e) { /* ignore — fall through to the notice */ }
        }
        if (!recovered) {
          // Leave the turn open so the socket completion event can still finalize it.
          setProgressEvents([]);
          toast("Edison is taking longer than usual — I'll update this as soon as it's ready.", { icon: "⏳" });
        }
      } else {
        myTurn.done = true;
        toast.error(error.message);
        const errorMessage = {
          role: "assistant",
          content: `Sorry, I encountered an error: ${error.message}`,
          isError: true
        };
        if (conversation) {
          setLocalMessages(prev => [...prev, errorMessage]);
        } else {
          // If conversation creation failed, go back to welcome screen
          setConversation(null);
          setLocalMessages([]);
        }
        setProgressEvents([]);
        setStreamingResponse("");
      }
    } finally {
      // Only act if this is still the active turn — a newer turn submitted after
      // we cleared the spinner early must keep its own loading state and slot.
      if (turnRef.current === myTurn) {
        setIsLoading(false);
        // Release the turn once settled; if we're still waiting on the socket
        // completion event (abort without recovery), keep it so that handler
        // can finalize the turn when it arrives.
        if (myTurn.done) {
          turnRef.current = null;
        }
      }
    }
  };

  const _onSelectConversation = async (conversationId, { preserveContext = false } = {}) => {
    // Reset state for clean viewing
    setShowConvoSidebar(false);
    setLocalMessages([]);
    setProgressEvents([]);
    setStreamingResponse("");
    // Abandon any in-flight turn so its late tokens/completion (delivered to the
    // always-joined user room) can't stream a stale bubble onto the conversation
    // we're switching to.
    turnRef.current = null;
    setCreatedCharts([]);
    setAddedToDashboard({});
    fetchedChartsRef.current.clear();
    // Switching conversations starts with a clean context, but the very first
    // load must keep the chips seeded from the page the user opened Edison from.
    if (!preserveContext) {
      setSelectedContext({
        multiSelect: [],
        singleSelect: null
      });
      setContextSearch("");
    }
    setIsLoading(true);
    
    try {
      const response = await getAiConversation(conversationId, team.id);
      if (response?.conversation) {
        setConversation(response.conversation);
      } else {
        toast.error("Failed to fetch conversation");
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Swap the chat pane for a fresh, unsaved conversation. Used whenever the
   * conversation being viewed goes away (single delete, bulk delete).
   */
  const _resetToNewConversation = () => {
    setConversation({
      title: "New Conversation",
      full_history: [],
      createdAt: new Date().toISOString(),
      message_count: 0,
      isTemporary: true,
    });
    setLocalMessages([]);
    setProgressEvents([]);
    setStreamingResponse("");
    // Abandon the in-flight turn so its late tokens/completion can't stream a
    // stale bubble onto the fresh conversation.
    turnRef.current = null;
    setCreatedCharts([]);
    fetchedChartsRef.current.clear();
  };

  // Delete is irreversible, so it goes through a confirmation modal rather than
  // firing straight off the dropdown item.
  const _onRequestDeleteConversation = (conv) => setConversationToDelete(conv);

  const _onDeleteConversation = async () => {
    const target = conversationToDelete;
    if (!target?.id) return;

    setIsDeletingConversation(true);
    try {
      await deleteAiConversation(target.id, team.id);
      toast.success("Conversation deleted");

      // Navigating rather than just resetting keeps the URL off the dead id, so
      // a refresh doesn't try to load a conversation that no longer exists.
      if (`${conversation?.id}` === `${target.id}`) {
        navigate(`${EDISON_PATH}/new`, { replace: true, state: location.state });
      }

      setConversationToDelete(null);
      await _refreshConversationList();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsDeletingConversation(false);
    }
  };

  // Archive is reversible in one click from a tab that's on screen, so it needs
  // no confirmation. The open conversation is deliberately NOT reset — it stays
  // fully usable and just gains an "Archived" chip.
  const _onSetConversationArchived = async (conversationId, archived) => {
    try {
      await setAiConversationArchived(conversationId, team.id, archived);
      toast.success(archived ? "Conversation archived" : "Conversation restored");
      setConversation((prev) => (
        `${prev?.id}` === `${conversationId}` ? { ...prev, archived } : prev
      ));
      await _refreshConversationList();
    } catch (error) {
      toast.error(error.message);
    }
  };

  /**
   * Star/unstar. Optimistic because the star is a direct-manipulation control and
   * should feel instant; the refresh behind it re-sorts so the row actually moves
   * to (or leaves) the pinned block at the top.
   */
  const _onToggleConversationStar = async (conversationId, starred) => {
    const patch = (list) => list.map((c) => (
      `${c.id}` === `${conversationId}` ? { ...c, starred } : c
    ));
    setConversations(patch);
    setConversation((prev) => (
      `${prev?.id}` === `${conversationId}` ? { ...prev, starred } : prev
    ));
    setConversationCounts((prev) => ({
      ...prev,
      starred: Math.max(0, prev.starred + (starred ? 1 : -1)),
    }));

    try {
      await setAiConversationStarred(conversationId, team.id, starred);
      await _refreshConversationList();
    } catch (error) {
      toast.error(error.message);
      // Roll the optimistic update back.
      setConversations((list) => list.map((c) => (
        `${c.id}` === `${conversationId}` ? { ...c, starred: !starred } : c
      )));
      setConversation((prev) => (
        `${prev?.id}` === `${conversationId}` ? { ...prev, starred: !starred } : prev
      ));
      setConversationCounts((prev) => ({
        ...prev,
        starred: Math.max(0, prev.starred + (starred ? -1 : 1)),
      }));
    }
  };

  const _onArchiveConversation = (conversationId) => (
    _onSetConversationArchived(conversationId, true)
  );

  const _onUnarchiveConversation = (conversationId) => (
    _onSetConversationArchived(conversationId, false)
  );

  const _runBulkConversationAction = async (action, verbPast) => {
    const ids = Array.from(selectedConversationIds);
    if (!ids.length) return;

    setIsBulkBusy(true);
    try {
      const result = await bulkUpdateAiConversations(team.id, ids, action);
      const affected = result?.affected ?? ids.length;
      const skipped = result?.skipped?.length || 0;
      if (skipped) {
        toast.success(`${verbPast} ${affected} of ${ids.length} conversations`);
      } else {
        toast.success(`${verbPast} ${affected} ${affected === 1 ? "conversation" : "conversations"}`);
      }

      const openId = conversationRef.current?.id;
      const hitOpen = openId && ids.some((id) => `${id}` === `${openId}`);
      if (action === "delete") {
        if (hitOpen) navigate(`${EDISON_PATH}/new`, { replace: true, state: location.state });
      } else if (hitOpen) {
        // Keep the open chat, just reflect its new archive state.
        setConversation((prev) => ({ ...prev, archived: action === "archive" }));
      }

      _exitSelectionMode();
      setBulkDeleteConfirmOpen(false);
      // Refetch rather than splice: offset is derived from list length, and the
      // totals plus both tab counts have all changed.
      await _refreshConversationList();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsBulkBusy(false);
    }
  };

  const _onBulkArchiveConversations = () => _runBulkConversationAction("archive", "Archived");
  const _onBulkUnarchiveConversations = () => _runBulkConversationAction("unarchive", "Restored");
  const _onBulkDeleteConversations = () => _runBulkConversationAction("delete", "Deleted");

  const _onStartRename = (conv) => {
    setRenamingConversationId(conv.id);
    setRenameValue(conv.title);
  };

  const _onCancelRename = () => {
    setRenamingConversationId(null);
    setRenameValue("");
  };

  const _onConfirmRename = async (conversationId) => {
    if (!renameValue.trim()) {
      _onCancelRename();
      return;
    }

    try {
      await renameAiConversation(conversationId, team.id, renameValue.trim());
      toast.success("Conversation renamed");

      // Update local state
      setConversations((prev) =>
        prev.map((c) => c.id === conversationId ? { ...c, title: renameValue.trim() } : c)
      );
      if (conversation?.id === conversationId) {
        setConversation((prev) => ({ ...prev, title: renameValue.trim() }));
      }

      _onCancelRename();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const _onSuggestionClick = async (suggestion) => {
    if (isLoading) return;

    // Check if this is a quick reply (set as context)
    if (suggestion.action === "reply") {
      // Set the suggestion as single-select context (toggle behavior)
      setSelectedContext(prev => ({
        ...prev,
        singleSelect: prev.singleSelect?.id === suggestion.id ? null : suggestion
      }));
      // Focus the input so user can add more text
      if (inputRef.current) {
        inputRef.current.focus();
      }
      return;
    }

    setIsLoading(true);
    setProgressEvents([]);

    try {
      // For non-reply actions, create a synthetic user message with action details
      const syntheticQuestion = `Please execute this action: ${JSON.stringify({
        action: suggestion.action,
        params: suggestion.params || {},
        label: suggestion.label
      })}`;

      // Add user message to local messages
      const userMessage = {
        role: "user",
        content: syntheticQuestion
      };
      setLocalMessages([userMessage]);

      // Create a temporary conversation if needed
      let currentConversationId = conversation?.id;
      if (!conversation || conversation.isTemporary) {
        const tempConversation = {
          id: conversation?.id || null,
          title: "Quick Action",
          full_history: [],
          createdAt: new Date().toISOString(),
          message_count: 1,
          isTemporary: true
        };
        setConversation(tempConversation);
        currentConversationId = tempConversation.id;
      }

      // Call orchestrate with the suggestion action
      const response = await orchestrateAi(
        team.id,
        syntheticQuestion,
        conversation?.full_history || [],
        currentConversationId,
        null // no context for suggestion actions
      );

      // Validate response structure
      if (!response || !response.orchestration || !response.orchestration.message) {
        throw new Error("Invalid response from AI");
      }

      // Add AI response to local messages
      const aiMessage = {
        role: "assistant",
        content: response.orchestration.message
      };
      setLocalMessages(prev => [...prev, aiMessage]);

      _notifyAiComplete(response.orchestration.message, response.orchestration.aiConversationId || conversation?.id);

      // Update conversation data in background. Fetched by id rather than by
      // searching the list, which used to cost two list requests and would only
      // work while the conversation happened to be on the loaded page.
      if (response.orchestration?.aiConversationId) {
        const newConversationId = response.orchestration.aiConversationId;
        _refreshConversationList().catch(() => {});
        const fullConversation = await getAiConversation(newConversationId, team.id);
        if (fullConversation?.conversation) {
          setConversation({
            ...fullConversation.conversation,
            id: newConversationId,
            isTemporary: false
          });
          setLocalMessages([]);
          setProgressEvents([]);
        }
      }

      // Clear progress events
      setProgressEvents([]);

    } catch (error) {
      toast.error(error.message);
      const errorMessage = {
        role: "assistant",
        content: `Sorry, I encountered an error executing that action: ${error.message}`,
        isError: true
      };

      if (conversation) {
        setLocalMessages(prev => [...prev, errorMessage]);
      } else {
        setConversation(null);
        setLocalMessages([]);
      }

      setProgressEvents([]);
    }

    setIsLoading(false);
  };

  const _onSubmitFeedback = async (messageId, feedback) => {
    if (!conversation?.id || !messageId) return;

    const currentFeedback = messageFeedback[messageId];
    // Toggle off if clicking the same feedback again
    const newFeedback = currentFeedback === feedback ? null : feedback;

    setMessageFeedback(prev => ({ ...prev, [messageId]: newFeedback }));

    try {
      await submitAiMessageFeedback(conversation.id, messageId, team.id, newFeedback);
    } catch (e) {
      // Revert on failure
      setMessageFeedback(prev => ({ ...prev, [messageId]: currentFeedback }));
      toast.error("Failed to submit feedback");
    }
  };

  const _onRegenerateResponse = () => {
    if (!conversation?.full_history || isLoading) return;

    // Find the last user message
    const lastUserMessage = [...conversation.full_history]
      .reverse()
      .find(msg => msg.role === "user");

    if (lastUserMessage) {
      _onAskAi(null, lastUserMessage.content);
    }
  };

  const _onContinueResponse = () => {
    if (isLoading) return;
    _onAskAi(null, "Continue");
  };

  // Initialize feedback state from conversation history
  useEffect(() => {
    if (conversation?.full_history) {
      const feedbackMap = {};
      conversation.full_history.forEach((msg) => {
        if (msg.id && msg.feedback) {
          feedbackMap[msg.id] = msg.feedback;
        }
      });
      setMessageFeedback(prev => ({ ...prev, ...feedbackMap }));
    }
  }, [conversation?.full_history]);

  // Fetch team members (for sharing)
  useEffect(() => {
    if (team?.id && (!teamMembers || teamMembers.length === 0)) {
      dispatch(getTeamMembers({ team_id: team.id }));
    }
  }, [team?.id]);

  const _onForkConversation = async (conversationId) => {
    try {
      const result = await forkAiConversation(conversationId, team.id);
      toast.success("Conversation forked");
      // The fork lands in Active; if the user is on the Archived tab they won't
      // see the new row, but it's opened for them immediately below anyway.
      await _refreshConversationList();
      _onSelectConversation(result.id);
    } catch (e) {
      toast.error(e.message || "Failed to fork conversation");
    }
  };

  const _onShareConversation = async () => {
    if (!shareModalConversationId || !shareTargetUserId) return;

    setShareLoading(true);
    try {
      await forkAiConversation(shareModalConversationId, team.id, shareTargetUserId);
      const targetMember = teamMembers.find(m => m.id === shareTargetUserId);
      toast.success(`Chat shared with ${targetMember?.name || "teammate"}`);
      setShareModalConversationId(null);
      setShareTargetUserId(null);
    } catch (e) {
      toast.error(e.message || "Failed to share conversation");
    }
    setShareLoading(false);
  };

  const _renderMessageActions = (message, isLastAssistantMessage) => {
    if (!message.id && !isLastAssistantMessage) return null;

    const feedback = message.id ? messageFeedback[message.id] : null;

    return (
      <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        {message.id && (
          <>
            <Tooltip content={feedback === "positive" ? "Remove rating" : "Good response"}>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => _onSubmitFeedback(message.id, "positive")}
                className={feedback === "positive" ? "text-success" : "text-foreground-400"}
              >
                <LuThumbsUp size={14} />
              </Button>
            </Tooltip>
            <Tooltip content={feedback === "negative" ? "Remove rating" : "Bad response"}>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={() => _onSubmitFeedback(message.id, "negative")}
                className={feedback === "negative" ? "text-danger" : "text-foreground-400"}
              >
                <LuThumbsDown size={14} />
              </Button>
            </Tooltip>
          </>
        )}
        {isLastAssistantMessage && (
          <>
            <Tooltip content="Regenerate response">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={_onRegenerateResponse}
                isDisabled={isLoading}
                className="text-foreground-400"
              >
                <LuRefreshCw size={14} />
              </Button>
            </Tooltip>
            <Tooltip content="Continue">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                onPress={_onContinueResponse}
                isDisabled={isLoading}
                className="text-foreground-400"
              >
                <LuPlay size={14} />
              </Button>
            </Tooltip>
          </>
        )}
      </div>
    );
  };

  const _parseMessage = (message) => {
    // Check if message is a tool call
    if (message.tool_calls && message.tool_calls.length > 0) {
      return {
        type: "tool_call",
        tools: message.tool_calls.map(tc => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments)
        }))
      };
    }

    // Check if message is a tool result
    if (message.role === "tool") {
      const content = JSON.parse(message.content);

      // Check if this is a chart creation or update result
      if ((message.name === "create_chart" || message.name === "update_chart" || message.name === "create_temporary_chart") && content.chart_id) {
        // All AI-created charts are temporary (ghost project) — users add to dashboards interactively
        const isTemporary = message.name !== "update_chart";
        return {
          type: message.name === "update_chart" ? "chart_updated" : "chart_temporary",
          chartId: content.chart_id,
          chartName: content.name,
          chartType: content.type,
          projectId: content.project_id || content.ghost_project_id,
          dashboardUrl: content.dashboard_url,
          chartUrl: content.chart_url,
          isTemporary,
          content: content
        };
      }

      return {
        type: "tool_result",
        name: message.name,
        content: content
      };
    }

    // Check for cb-actions suggestions block
    if (message.role === "assistant" && message.content) {
      // Try multiple patterns to handle cases where AI forgets proper formatting
      let cbActionsMatch = null;
      let suggestionsData = null;

      // First try the proper fenced code block format
      cbActionsMatch = message.content.match(/```cb-actions\s*\n([\s\S]*?)\n```/);
      if (cbActionsMatch) {
        try {
          suggestionsData = JSON.parse(cbActionsMatch[1]);
        } catch (e) {
          // Try parsing without the code block wrapper
        }
      }

      // If that didn't work, try parsing cb-actions directly (fallback for when AI forgets backticks)
      if (!suggestionsData) {
        const directMatch = message.content.match(/cb-actions\s*(\{[\s\S]*?\})/);
        if (directMatch) {
          try {
            suggestionsData = JSON.parse(directMatch[1]);
          } catch (e) {
            // Invalid JSON, continue to next fallback
          }
        }
      }

      // If we successfully parsed suggestions data, process it
      if (suggestionsData && suggestionsData.version === 1 && Array.isArray(suggestionsData.suggestions)) {
        // Remove the cb-actions block from content (try both formats)
        let content = message.content
          .replace(/```cb-actions\s*\n[\s\S]*?\n```/, "")
          .replace(/cb-actions\s*\{[\s\S]*?\}/, "")
          .trim();

        // Remove title if it starts with "# "
        if (content && content.startsWith("# ")) {
          const lines = content.split("\n");
          if (lines.length > 1) {
            content = lines.slice(1).join("\n").trim();
          } else {
            content = "";
          }
        }

        return {
          type: "message_with_suggestions",
          content: content,
          suggestions: suggestionsData.suggestions
        };
      }
    }

    // Regular message
    let content = message.content;
    // Remove title if it starts with "# "
    if (content && content.startsWith("# ")) {
      const lines = content.split("\n");
      if (lines.length > 1) {
        content = lines.slice(1).join("\n").trim();
      } else {
        content = "";
      }
    }

    return {
      type: "message",
      content: content
    };
  };

  const _groupMessages = (messages) => {
    const groups = [];
    let currentGroup = null;
    // Each chartId gets at most one dedicated card. Subsequent updates to the
    // same chart fold into the assistant's "Operations performed" block — the
    // earlier card auto-refreshes from createdCharts, so a second card would
    // just duplicate the same visual.
    const shownChartIds = new Set();

    const isChartCard = (parsed) => parsed.type === "chart_updated" || parsed.type === "chart_temporary";

    messages.forEach((message) => {
      const parsed = _parseMessage(message);

      if (message.role === "user") {
        groups.push({
          type: "user",
          messages: [message]
        });
        currentGroup = null;
      } else if (isChartCard(parsed) && !shownChartIds.has(parsed.chartId)) {
        shownChartIds.add(parsed.chartId);
        groups.push({
          type: parsed.type,
          messages: [message]
        });
        currentGroup = null;
      } else if (message.role === "assistant" || message.role === "tool") {
        // Group consecutive assistant and tool messages, including chart tool
        // results whose chartId was already rendered above.
        if (!currentGroup || currentGroup.type !== "assistant") {
          currentGroup = {
            type: "assistant",
            messages: []
          };
          groups.push(currentGroup);
        }
        currentGroup.messages.push(message);
      }
    });

    return groups;
  };

  const _renderMessage = (message, index, { isLastAssistantMessage = false } = {}) => {
    const parsed = _parseMessage(message);

    // User messages - right aligned
    if (message.role === "user") {
      return (
        <div key={index} className="flex justify-end mb-4 px-4">
          <div className="max-w-[70%] bg-primary text-primary-foreground px-4 py-3 rounded-lg">
            <div className="text-sm whitespace-pre-wrap">{message.content}</div>
          </div>
        </div>
      );
    }

    // Tool calls - centered with compact display
    if (parsed.type === "tool_call") {
      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Avatar
                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                  size="sm"
                  color="primary"
                />
                <span className="text-sm font-medium">AI is working...</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {parsed.tools.map((tool, idx) => (
                  <Popover key={idx} placement="bottom" className="max-w-md" aria-label="Tool call arguments">
                    <PopoverTrigger>
                      <Chip
                        variant="flat"
                        color="primary"
                        size="sm"
                        endContent={<LuChevronDown size={14} />}
                        className="cursor-pointer"
                      >
                        Tool: {tool.name}
                      </Chip>
                    </PopoverTrigger>
                    <PopoverContent className="max-w-md">
                      <div className="p-2">
                        <div className="text-xs font-semibold mb-2">Arguments:</div>
                        <Code className="text-xs whitespace-pre-wrap">
                          {JSON.stringify(tool.args, null, 2)}
                        </Code>
                      </div>
                    </PopoverContent>
                  </Popover>
                ))}
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Tool results - centered with compact display
    if (parsed.type === "tool_result") {
      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className="bg-success-50 border border-success-200 px-4 py-3 rounded-lg">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <Chip variant="flat" color="success" size="sm">
                  Result: {parsed.name}
                </Chip>
              </div>
              <Popover placement="bottom" aria-label="Tool result">
                <PopoverTrigger>
                  <Button size="sm" variant="flat" endContent={<LuChevronDown size={14} />}>
                    View result
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="max-w-2xl">
                  <div className="p-2">
                    <Code className="text-xs whitespace-pre-wrap">
                      {JSON.stringify(parsed.content, null, 2)}
                    </Code>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>
      );
    }

    // Chart updated messages — show the updated chart with a refresh indicator
    if (parsed.type === "chart_updated" && createdCharts?.length > 0) {
      const chartData = createdCharts.find((c) => c.id === parsed.chartId);

      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className="px-3 py-3 sm:px-6 sm:py-4 rounded-lg border border-warning-200">
              <div className="flex items-start gap-3">
                <Avatar
                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                  size="sm"
                  color="warning"
                />
                <div className="w-full min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-medium">Chart Updated</span>
                    <Chip size="sm" variant="flat" color="warning">
                      {parsed.chartName}
                    </Chip>
                  </div>
                  {chartData ? (
                    <div className="w-full overflow-auto h-[300px]" style={{ contain: "inline-size" }}>
                      <Chart
                        chart={chartData}
                        isPublic={false}
                        showExport={false}
                      />
                    </div>
                  ) : (
                    <div className="border border-warning-200 rounded-lg p-8">
                      <CircularProgress aria-label="Loading chart" />
                      <div className="text-sm mt-2">Loading chart...</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Temporary chart messages — check the chart's *live* project to determine
    // whether it's still in the ghost project or has been placed on a dashboard.
    // Charts removed from dashboards are shelved back to ghost, so they
    // reappear here with the "Add to Dashboard" button.
    if (parsed.type === "chart_temporary" && createdCharts?.length > 0) {
      const chartData = createdCharts.find((c) => c.id === parsed.chartId);
      const nonGhostProjects = projects.filter((p) => !p.ghost);
      const addedInfo = addedToDashboard[parsed.chartId];
      const addedProjectId = addedInfo?.projectId;
      const chartAlreadyMoved = !!addedProjectId;

      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className={`px-3 py-3 sm:px-6 sm:py-4 rounded-lg border ${
              chartAlreadyMoved ? "border-success-200" : "border-primary-200 bg-primary-50/50"
            }`}>
              <div className="flex items-start gap-3">
                <Avatar
                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                  size="sm"
                  color={chartAlreadyMoved ? "success" : "primary"}
                />
                <div className="w-full min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {chartAlreadyMoved ? "Chart Added" : "Temporary Chart Preview"}
                    </span>
                    <Chip
                      size="sm"
                      variant="flat"
                      color={chartAlreadyMoved ? "success" : "primary"}
                    >
                      {parsed.chartName}
                    </Chip>
                    {chartAlreadyMoved ? (
                      <Chip
                        size="sm"
                        variant="flat"
                        color="success"
                        className="ml-auto"
                      >
                        Added to {nonGhostProjects.find((p) => p.id === addedProjectId)?.name}
                      </Chip>
                    ) : (
                      <Chip
                        size="sm"
                        variant="flat"
                        color="default"
                        className="ml-auto"
                      >
                        Not saved to dashboard
                      </Chip>
                    )}
                  </div>
                  {chartData ? (
                    <div className="w-full overflow-auto h-[300px]" style={{ contain: "inline-size" }}>
                      <Chart
                        chart={chartData}
                        isPublic={false}
                        showExport={false}
                      />
                    </div>
                  ) : (
                    <div className="border border-primary-200 rounded-lg p-8">
                      <CircularProgress aria-label="Loading chart" />
                      <div className="text-sm mt-2">Loading chart...</div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mt-3">
                    {!chartAlreadyMoved ? (
                      <Dropdown aria-label="Select a dashboard">
                        <DropdownTrigger>
                          <Button
                            size="sm"
                            color="primary"
                            variant="flat"
                            startContent={<LuLayoutDashboard size={14} />}
                            endContent={<LuChevronDown size={14} />}
                            isLoading={movingChartId === parsed.chartId}
                          >
                            Add to Dashboard
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label="Select a dashboard"
                          onAction={(key) => {
                            _onMoveChartToDashboard(
                              parsed.chartId,
                              parsed.projectId,
                              key
                            );
                          }}
                        >
                          {nonGhostProjects.map((project) => (
                            <DropdownItem key={project.id} textValue={project.name}>
                              {project.name}
                            </DropdownItem>
                          ))}
                        </DropdownMenu>
                      </Dropdown>
                    ) : (
                      <>
                        <a href={`${SITE_HOST}/dashboard/${addedProjectId}`} target="_blank" rel="noopener noreferrer">
                          <Button
                            size="sm"
                            variant="flat"
                            color="primary"
                            className="pointer-events-none"
                          >
                            View on Dashboard
                          </Button>
                        </a>
                        <Button
                          size="sm"
                          variant="flat"
                          onPress={() => {
                            setAddedToDashboard(prev => {
                              const next = { ...prev };
                              delete next[parsed.chartId];
                              return next;
                            });
                          }}
                        >
                          Add to Another Dashboard
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Assistant messages with suggestions - centered, taking most space
    if (message.role === "assistant" && parsed.type === "message_with_suggestions") {
      const isError = message.isError;
      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4 group">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className={`px-3 py-3 sm:px-6 sm:py-4 rounded-lg ${
              isError
                ? "bg-danger-50 border border-danger-200"
                : ""
            }`}>
              <div className="flex items-start gap-3">
                <Avatar
                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                  size="sm"
                  color={isError ? "danger" : "primary"}
                />
                <div className="flex-1">
                  {parsed.content && (
                    <div className={`text-sm prose prose-xs md:prose-sm dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs prose-a:text-primary prose-a:hover:text-primary-400 prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-2 prose-blockquote:italic prose-strong:font-bold prose-em:italic prose-pre:bg-content2 prose-pre:text-foreground prose-pre:p-2 prose-pre:rounded-sm prose-img:rounded-sm prose-img:mx-auto max-w-none p-1 leading-tight [&>p]:mb-4 *:my-2 ${
                      isError ? "text-danger" : "text-foreground"
                    }`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                        {parsed.content}
                      </ReactMarkdown>
                    </div>
                  )}
                  {parsed.suggestions && parsed.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      {parsed.suggestions.map((suggestion) => (
                        <Chip
                          key={suggestion.id}
                          variant="flat"
                          color="secondary"
                          size="sm"
                          className='cursor-pointer hover:bg-secondary-200 transition-colors'
                          onClick={() => _onSuggestionClick(suggestion)}
                          isDisabled={isLoading}
                        >
                          {suggestion.label}
                        </Chip>
                      ))}
                    </div>
                  )}
                  {_renderMessageActions(message, isLastAssistantMessage)}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Assistant messages - centered, taking most space
    if (message.role === "assistant" && parsed.type === "message") {
      const isError = message.isError;
      return (
        <div key={index} className="flex justify-center mb-4 px-2 sm:px-4 group">
          <div className="w-full max-w-full sm:max-w-[90%]">
            <div className={`px-3 py-3 sm:px-6 sm:py-4 rounded-lg ${
              isError
                ? "bg-danger-50 border border-danger-200"
                : ""
            }`}>
              <div className="flex items-start gap-3">
                <Avatar
                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                  size="sm"
                  color={isError ? "danger" : "primary"}
                />
                <div className="flex-1">
                  <div className={`text-sm prose prose-xs md:prose-lg dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs prose-a:text-primary prose-a:hover:text-primary-400 prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-2 prose-blockquote:italic prose-strong:font-bold prose-em:italic prose-pre:bg-content2 prose-pre:text-foreground prose-pre:p-2 prose-pre:rounded-sm prose-img:rounded-sm prose-img:mx-auto max-w-none p-1 leading-tight [&>p]:mb-4 *:my-2 ${
                    isError ? "text-danger" : "text-foreground"
                  }`}>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={components}
                    >
                      {parsed.content}
                    </ReactMarkdown>
                  </div>
                  {_renderMessageActions(message, isLastAssistantMessage)}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  const _renderGroupedMessages = (group, groupIndex, { isLastAssistantGroup = false } = {}) => {
    if (group.type === "user") {
      // Render user message
      return _renderMessage(group.messages[0], `group-${groupIndex}-user`);
    }

    if (group.type === "chart_updated" || group.type === "chart_temporary") {
      // Render chart creation/update/temporary message
      return _renderMessage(group.messages[0], `group-${groupIndex}-chart`);
    }

    // Group assistant messages - collect all operations and final message
    const operations = [];
    let finalMessage = null;
    let suggestions = null;

    group.messages.forEach((message) => {
      const parsed = _parseMessage(message);

      if (parsed.type === "tool_call") {
        parsed.tools.forEach((tool) => {
          operations.push({
            type: "call",
            name: tool.name,
            data: tool.args
          });
        });
      } else if (parsed.type === "tool_result") {
        operations.push({
          type: "result",
          name: parsed.name,
          data: parsed.content
        });
      } else if (parsed.type === "message_with_suggestions") {
        finalMessage = {
          ...message,
          content: parsed.content // Use the parsed content with title removed
        };
        suggestions = parsed.suggestions;
      } else if (parsed.type === "message") {
        finalMessage = {
          ...message,
          content: parsed.content // Use the parsed content with title removed
        };
      }
    });

    // Find the assistant message in the group that has an ID (for feedback)
    const assistantMsg = group.messages.find(m => m.role === "assistant" && m.id) || finalMessage || {};

    // Render grouped assistant messages
    return (
      <div key={`group-${groupIndex}`} className="flex justify-center mb-4 px-2 sm:px-4 group">
        <div className="w-full max-w-full sm:max-w-[90%]">
          <div className="px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex items-start gap-3">
              <Avatar
                className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                size="sm"
                color="primary"
              />
              <div className="flex-1">
                {operations.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-medium text-foreground-500 mb-2">Operations performed:</div>
                    <div className="space-y-1">
                      {operations.map((op, idx) => (
                        <Popover key={idx} placement="bottom" aria-label="Tool call arguments">
                          <PopoverTrigger>
                            <div className="text-xs text-gray-500 cursor-pointer hover:underline flex items-center gap-1">
                              <span><LuWrench size={12} /></span>
                              <span className="font-medium">
                                {op.type === "call" ? "Called" : "Got result from"}: {op.name}
                              </span>
                              <LuChevronDown size={14} className="opacity-60" />
                            </div>
                          </PopoverTrigger>
                          <PopoverContent className="max-w-2xl">
                            <div className="p-2">
                              <div className="text-xs font-semibold mb-2">
                                {op.type === "call" ? "Arguments:" : "Result:"}
                              </div>
                              <Code className="text-xs whitespace-pre-wrap max-h-96 overflow-auto">
                                {JSON.stringify(op.data, null, 2)}
                              </Code>
                            </div>
                          </PopoverContent>
                        </Popover>
                      ))}
                    </div>
                  </div>
                )}
                {finalMessage && (
                  <div className="prose prose-xs md:prose-sm dark:prose-invert prose-headings:font-bold prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg prose-h4:text-base prose-h5:text-sm prose-h6:text-xs prose-a:text-primary prose-a:hover:text-primary-400 prose-blockquote:border-l-2 prose-blockquote:border-primary prose-blockquote:pl-2 prose-blockquote:italic prose-strong:font-bold prose-em:italic prose-pre:bg-content2 prose-pre:text-foreground prose-pre:p-2 prose-pre:rounded-sm prose-img:rounded-sm prose-img:mx-auto max-w-none p-1 leading-tight [&>p]:mb-4 *:my-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                      {finalMessage.content}
                    </ReactMarkdown>
                  </div>
                )}
                {operations.length > 0
                  && (!finalMessage || !finalMessage.content || !finalMessage.content.trim())
                  && (!suggestions || suggestions.length === 0) && (
                  <div className="text-sm text-foreground-500 italic p-1">
                    Edison finished working but didn&apos;t return a written answer — it may have hit its step limit or repeated errors. Try rephrasing your question, or use Continue to pick up from here.
                  </div>
                )}
                {suggestions && suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {suggestions.map((suggestion) => (
                      <Chip
                        key={suggestion.id}
                        variant="flat"
                        color="secondary"
                        size="sm"
                        className='cursor-pointer hover:bg-secondary-200 transition-colors'
                        onClick={() => _onSuggestionClick(suggestion)}
                        isDisabled={isLoading}
                      >
                        {suggestion.label}
                      </Chip>
                    ))}
                  </div>
                )}
                {_renderMessageActions(assistantMsg, isLastAssistantGroup)}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Live assistant answer being streamed token-by-token. Rendered as plain text
  // (no markdown re-parse per token) with a blinking caret; the fully rendered,
  // persisted message replaces it once the turn finalizes. streamingResponse is
  // cleared on every turn-end / view-change path, so it never lingers as stale
  // text — and keeping it visible until finalize swaps in the persisted answer
  // avoids a blank flash during the finalize round-trip.
  const _renderStreamingResponse = () => {
    if (!streamingResponse) return null;
    // Mirror _parseMessage's cleanup so the live text matches the final render:
    // strip a cb-actions suggestions block (including a partial one still
    // streaming in at the end) and a leading "# title" line, which the persisted
    // render removes. Otherwise the bubble briefly shows raw JSON / markdown.
    let text = streamingResponse
      .replace(/```cb-actions[\s\S]*$/, "")
      .replace(/cb-actions\s*\{[\s\S]*$/, "");
    if (text.startsWith("# ")) {
      const nl = text.indexOf("\n");
      text = nl === -1 ? "" : text.slice(nl + 1);
    }
    text = text.replace(/^\s+/, "");
    if (!text) return null;

    return (
      <div className="flex justify-center mb-4 px-2 sm:px-4">
        <div className="w-full max-w-full sm:max-w-[90%]">
          <div className="px-3 py-3 sm:px-6 sm:py-4">
            <div className="flex items-start gap-3">
              <Avatar
                className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                size="sm"
                color="primary"
              />
              <div className="flex-1">
                <div className="text-sm whitespace-pre-wrap">
                  {text}
                  <span className="inline-block w-[2px] h-4 align-middle ml-0.5 bg-foreground-500 animate-pulse" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const _renderProgressEvents = () => {
    if (progressEvents.length === 0) return null;

    return (
      <div className="flex justify-center mb-4 px-2 sm:px-4">
        <div className="w-full max-w-full sm:max-w-[90%]">
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <Avatar
                className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                size="sm"
                color="primary"
              />
              <LuLoader size={16} className="animate-spin" />
              <span className="text-sm">Working...</span>
            </div>
            <div className="space-y-1">
              {progressEvents.map((event) => (
                <div key={event.id} className="text-xs text-primary-700 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    event.type === "processing" ? "bg-blue-500" :
                    event.type === "connection" ? "bg-green-500" :
                    event.type === "analysis" ? "bg-yellow-500" :
                    event.type === "query_generation" ? "bg-purple-500" :
                    event.type === "execution" ? "bg-orange-500" :
                    event.type === "visualization" ? "bg-pink-500" :
                    "bg-gray-500"
                  }`} />
                  {event.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Built once and shared by both ConversationList instances (landing accordion
  // and in-chat sidebar) so the two can never show a different filtered page.
  const conversationListState = {
    statuses: conversationStatuses,
    starredOnly,
    search: conversationSearch,
    activeCount: conversationCounts.active,
    archivedCount: conversationCounts.archived,
    starredCount: conversationCounts.starred,
    total: conversationsTotal,
    isLoading: isLoadingConversations,
    isLoadingMore: isLoadingMoreConversations,
    // Covers the debounce window too, not just the request, so the spinner
    // appears the moment the user types.
    isSearching: conversationSearch.trim() !== conversationQuery || isLoadingConversations,
    hasMore: conversations.length < conversationsTotal,
    onToggleStatus: _onToggleConversationStatus,
    onToggleStarredOnly: _onToggleStarredOnly,
    onSearchChange: _onChangeConversationSearch,
    onLoadMore: _onLoadMoreConversations,
  };

  const conversationSelection = {
    mode: selectionMode,
    ids: selectedConversationIds,
    isBusy: isBulkBusy,
    onToggleMode: () => (selectionMode ? _exitSelectionMode() : setSelectionMode(true)),
    onToggle: _onToggleSelectConversation,
    onToggleAllLoaded: _onToggleAllLoadedConversations,
    onBulkArchive: _onBulkArchiveConversations,
    onBulkUnarchive: _onBulkUnarchiveConversations,
    onRequestBulkDelete: () => setBulkDeleteConfirmOpen(true),
  };

  const conversationRowActions = {
    onSelect: _onNavigateToConversation,
    onStartRename: _onStartRename,
    onCancelRename: _onCancelRename,
    onConfirmRename: _onConfirmRename,
    onRenameValueChange: setRenameValue,
    renamingConversationId,
    renameValue,
    onFork: _onForkConversation,
    onShare: setShareModalConversationId,
    onArchive: _onArchiveConversation,
    onUnarchive: _onUnarchiveConversation,
    onToggleStar: _onToggleConversationStar,
    onRequestDelete: _onRequestDeleteConversation,
  };

  return (
    <>
    {/*
      Full-viewport chat. Deliberately not a modal: this is a route (/edison), so
      it owns the whole window and has its own exit control. fixed + inset-0
      rather than h-screen so mobile browser chrome can't push the composer off
      the bottom.
    */}
    <div className="fixed inset-0 z-40 flex flex-col bg-background">
      <div className="flex flex-row h-full min-h-0 relative">
              <div className={cn(
                "flex-none w-60",
                // On phones the list slides in over the chat instead of stealing width.
                isMobile && "absolute inset-y-0 left-0 z-30 w-[85%] max-w-[18rem] transition-transform duration-300",
                isMobile && (showConvoSidebar ? "translate-x-0 shadow-2xl" : "-translate-x-full")
              )}>
                <div className="flex flex-col relative h-full bg-content2">
                  {/* Search + filter dropdown sit at the top; New Conversation
                      now lives in the sticky footer with the token total. */}
                  <div className="w-full pt-3 border-r border-divider" />
                  <ConversationList
                    conversations={conversations}
                    activeConversationId={conversation?.id}
                    listState={conversationListState}
                    selection={conversationSelection}
                    rowActions={conversationRowActions}
                    onNewConversation={_onStartNewConversation}
                    footer={(
                      <Tooltip
                        content={<div className="flex flex-col gap-1">
                          <div className="text-xs text-foreground-500">Total tokens used: {formatTokens(teamUsage?.total?.total_tokens || 0)}</div>
                          <div className="text-xs text-foreground-500">Total API calls: {teamUsage?.total?.api_calls || 0}</div>
                          <div className="text-xs text-foreground-500">Total models used: {teamUsage?.byModel?.length || 0}</div>
                        </div>}
                      >
                        <div className="flex flex-row items-center justify-center gap-2 cursor-help">
                          <div><LuCoins size={14} /></div>
                          <div className="text-xs text-foreground-500">{formatTokens(teamUsage?.total?.total_tokens || 0)}</div>
                        </div>
                      </Tooltip>
                    )}
                  />
                </div>
              </div>
              {isMobile && showConvoSidebar && (
                <div
                  className="absolute inset-0 z-20 bg-black/40"
                  onClick={() => { setShowConvoSidebar(false); _exitSelectionMode(); }}
                  aria-hidden="true"
                />
              )}
              <div className="relative flex-1 min-w-0 flex flex-col min-h-0">
                <div className="flex-none py-4 border-b border-divider">
                  <div className="flex flex-row gap-3 pl-4 pr-4 items-start">
                    {isMobile && (
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        aria-label="Conversations"
                        onPress={() => setShowConvoSidebar(true)}
                      >
                        <LuMessageSquare size={18} />
                      </Button>
                    )}
                    <Avatar
                      className="shrink-0 aspect-square" icon={<LuBrainCircuit size={24} className="text-background" />}
                      color="primary"
                    />
                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                      <div className="flex flex-row items-center gap-2">
                        {conversation?.id && renamingConversationId === conversation.id ? (
                          <div className="flex flex-row items-center gap-1 flex-1">
                            <Input
                              size="sm"
                              value={renameValue}
                              onValueChange={setRenameValue}
                              autoFocus
                              classNames={{ inputWrapper: "h-8" }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") _onConfirmRename(conversation.id);
                                if (e.key === "Escape") _onCancelRename();
                              }}
                            />
                            <Button isIconOnly size="sm" variant="light" color="success" onPress={() => _onConfirmRename(conversation.id)}>
                              <LuCheck size={14} />
                            </Button>
                            <Button isIconOnly size="sm" variant="light" color="danger" onPress={_onCancelRename}>
                              <LuX size={14} />
                            </Button>
                          </div>
                        ) : (
                          <>
                            {conversation?.starred && (
                              <LuStar size={14} className="shrink-0 text-warning" fill="currentColor" />
                            )}
                            <div className="text-md text-foreground font-medium truncate">
                              {conversation?.title || "Edison AI"}
                            </div>
                            {conversation?.archived && (
                              <Chip
                                size="sm"
                                variant="flat"
                                radius="sm"
                                startContent={<LuArchive size={11} />}
                              >
                                Archived
                              </Chip>
                            )}
                            {/* A conversation with no id is unsaved, so rename /
                                fork / share / delete have nothing to act on. */}
                            {conversation?.id && (
                              <Dropdown>
                                <DropdownTrigger>
                                  <Button isIconOnly size="sm" variant="light">
                                    <LuEllipsis size={16} />
                                  </Button>
                                </DropdownTrigger>
                                <ConversationActionsMenu
                                  conversation={conversation}
                                  isArchived={!!conversation.archived}
                                  isStarred={!!conversation.starred}
                                  onToggleStar={_onToggleConversationStar}
                                  onRename={_onStartRename}
                                  onFork={_onForkConversation}
                                  onShare={setShareModalConversationId}
                                  onArchive={_onArchiveConversation}
                                  onUnarchive={_onUnarchiveConversation}
                                  onRequestDelete={_onRequestDeleteConversation}
                                />
                              </Dropdown>
                            )}
                          </>
                        )}
                      </div>
                      <div className="flex flex-row items-center gap-3 text-xs text-foreground-500">
                        {conversation?.createdAt && (
                          <div className="flex items-center gap-1">
                            <LuClock size={12} />
                            <span>{formatDate(conversation.createdAt)}</span>
                          </div>
                        )}
                        {conversation?.message_count > 0 && (
                          <div className="flex items-center gap-1">
                            <LuMessageSquare size={12} />
                            <span>{conversation.message_count} {conversation.message_count === 1 ? "message" : "messages"}</span>
                          </div>
                        )}
                        {conversation?.total_tokens > 0 && (
                          <Tooltip content={`${conversation.total_tokens.toLocaleString()} tokens used`}>
                            <div className="flex items-center gap-1 cursor-help">
                              <LuCoins size={12} />
                              <span>{formatTokens(conversation.total_tokens)}</span>
                            </div>
                          </Tooltip>
                        )}
                      </div>
                    </div>
                    {/* Exit control — this page owns the viewport, so it needs its
                        own way back to wherever the user came from. */}
                    <Tooltip content="Close Edison">
                      <Button
                        isIconOnly
                        size="sm"
                        variant="light"
                        aria-label="Close Edison"
                        className="shrink-0 min-w-11 h-11 sm:min-w-8 sm:h-8"
                        onPress={_onExit}
                      >
                        <LuX size={18} />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-4">
                  {conversation?.full_history?.length > 0 ? (
                    <>
                      {(() => {
                        // Show grouped view for all conversations
                        const groups = _groupMessages(conversation.full_history);
                        // Find the last group that contains an assistant message
                        const lastAssistantGroupIndex = groups.reduce((lastIdx, group, idx) => {
                          if (group.type === "assistant" || group.messages?.some(m => m.role === "assistant")) {
                            return idx;
                          }
                          return lastIdx;
                        }, -1);
                        return groups.map((group, index) => _renderGroupedMessages(group, index, {
                          isLastAssistantGroup: index === lastAssistantGroupIndex,
                        }));
                      })()}
                      {localMessages.filter(m => m.role === "user").map((m, i) => (
                        <div key={`local-user-${i}`} className="flex justify-end mb-4 px-4">
                          <div className="max-w-[70%] bg-primary text-primary-foreground px-4 py-3 rounded-lg">
                            <div className="text-sm whitespace-pre-wrap">{m.content}</div>
                          </div>
                        </div>
                      ))}
                      {_renderProgressEvents()}
                      {_renderStreamingResponse()}
                      {isLoading && progressEvents.length === 0 && !streamingResponse && (
                        <div className="flex justify-center mb-4 px-2 sm:px-4">
                          <div className="w-full max-w-full sm:max-w-[90%]">
                            <div className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Avatar
                                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                                  size="sm"
                                  color="primary"
                                />
                                <LuLoader size={16} className="animate-spin" />
                                <span className="text-sm">Thinking...</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </>
                  ) : (localMessages.length > 0 || progressEvents.length > 0) ? (
                    <>
                      {localMessages.length > 0 && (
                        <div className="flex justify-end mb-4 px-4">
                          <div className="max-w-[70%] bg-primary text-primary-foreground px-4 py-3 rounded-lg">
                            <div className="text-sm whitespace-pre-wrap">{localMessages[0].content}</div>
                          </div>
                        </div>
                      )}
                      {_renderProgressEvents()}
                      {_renderStreamingResponse()}
                      {isLoading && progressEvents.length === 0 && !streamingResponse && (
                        <div className="flex justify-center mb-4 px-2 sm:px-4">
                          <div className="w-full max-w-full sm:max-w-[90%]">
                            <div className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Avatar
                                  className="shrink-0 aspect-square" icon={<LuBrainCircuit size={16} className="text-background" />}
                                  size="sm"
                                  color="primary"
                                />
                                <LuLoader size={16} className="animate-spin" />
                                <span className="text-sm">Thinking...</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                      <div ref={messagesEndRef} />
                    </>
                  ) : (isLoading || isResolvingRoute) ? (
                    <div className="flex justify-center items-center h-full">
                      <div className="flex items-center gap-2">
                        <LuLoader size={24} className="animate-spin text-primary" />
                        <span className="text-sm text-foreground-500">Loading conversation...</span>
                      </div>
                    </div>
                  ) : (
                    /*
                      Empty chat — the greeting and starter prompts that used to
                      live on the separate landing screen. The composer below is
                      shared, so there's no second input to keep in sync.
                    */
                    <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
                      <Avatar
                        className="shrink-0 aspect-square"
                        icon={<LuBrainCircuit size={24} className="text-background" />}
                        size="lg"
                        color="primary"
                      />
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex flex-row items-center gap-2">
                          <div className="font-tw font-medium text-lg">Edison AI</div>
                          <Chip color="primary" variant="flat" size="sm" radius="sm" className="shadow-sm">
                            Beta
                          </Chip>
                        </div>
                        <div className="text-sm text-foreground-500">Ask me anything about your data</div>
                      </div>
                      <div className="flex flex-row items-center gap-1 flex-wrap justify-center">
                        <Chip
                          variant="flat"
                          size="sm"
                          onClick={() => setQuestion("What can you do?")}
                          className="cursor-pointer"
                        >
                          What can you do?
                        </Chip>
                        <Chip
                          variant="flat"
                          size="sm"
                          onClick={() => setQuestion("How many users I have in my database?")}
                          className="cursor-pointer"
                        >
                          How many users I have in my database?
                        </Chip>
                      </div>
                      <div className="flex flex-row items-center gap-1 text-xs text-foreground-400">
                        <Kbd keys={isMac() ? ["command"] : ["ctrl"]}>K</Kbd>
                        <span>opens Edison from anywhere</span>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-none p-4 border-t border-divider bg-background z-10">
                  <form onSubmit={_onAskAi} id="ai-conversation-form">
                    {(selectedContext.multiSelect.length > 0 || selectedContext.singleSelect) && (
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {selectedContext.multiSelect.map((entity) => (
                          <Chip
                            key={`${entity.entity_type}-${entity.id}`}
                            color="primary"
                            variant="flat"
                            size="sm"
                            onClose={() => {
                              setSelectedContext(prev => ({
                                ...prev,
                                multiSelect: prev.multiSelect.filter(e => !(e.id === entity.id && e.entity_type === entity.entity_type))
                              }));
                            }}
                          >
                            {entity.label}
                          </Chip>
                        ))}
                        {selectedContext.singleSelect && (
                          <Chip
                            color="secondary"
                            variant="flat"
                            size="sm"
                            onClose={() => {
                              setSelectedContext(prev => ({
                                ...prev,
                                singleSelect: null
                              }));
                            }}
                          >
                            {selectedContext.singleSelect.label}
                          </Chip>
                        )}
                        <span className="text-xs text-foreground-500">+ add more details</span>
                      </div>
                    )}
                    <div className="flex flex-row gap-2 items-center">
                      <Popover placement="top-start" isOpen={isSecondContextPopoverOpen} onOpenChange={setIsSecondContextPopoverOpen}>
                        <PopoverTrigger>
                          <Button
                            variant="light"
                            isDisabled={isLoading}
                            isIconOnly
                          >
                            <LuAtSign size={18} />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-80">
                          <div className="p-2 w-full">
                            <div className="text-xs text-foreground-500 mb-2">
                              Context helps our AI to understand your intentions better.
                            </div>
                            <Input
                              placeholder="Search projects, connections, datasets..."
                              value={contextSearch}
                              onChange={(e) => setContextSearch(e.target.value)}
                              variant="bordered"
                              size="sm"
                              className="mb-2"
                              autoFocus
                            />
                            <div className="max-h-64 overflow-y-auto w-full">
                              <Listbox emptyContent="No entities found" className="w-full">
                                {filteredContextEntities.map((entity) => {
                                  const isSelected = selectedContext.multiSelect.some(e => e.id === entity.id && e.entity_type === entity.entity_type);
                                  return (
                                    <ListboxItem
                                      key={`${entity.entity_type}-${entity.id}`}
                                      textValue={getContextLabel(entity)}
                                      startContent={
                                        entity.entity_type === "project" ? <LuLayoutGrid size={16} /> :
                                          entity.entity_type === "connection" ? <LuPlug size={16} /> :
                                            entity.entity_type === "dataset" ? <LuDatabase size={16} /> : null
                                      }
                                      endContent={isSelected ? <div className="w-2 h-2 bg-primary rounded-full" /> : null}
                                      className={isSelected ? "bg-primary-50" : ""}
                                      onPress={() => {
                                        setSelectedContext(prev => {
                                          const newEntity = {
                                            ...entity,
                                            label: getContextLabel(entity)
                                          };
                                          const isAlreadySelected = prev.multiSelect.some(e => e.id === entity.id && e.entity_type === entity.entity_type);
                                          if (isAlreadySelected) {
                                            // Remove if already selected (toggle behavior for multi-select)
                                            return {
                                              ...prev,
                                              multiSelect: prev.multiSelect.filter(e => !(e.id === entity.id && e.entity_type === entity.entity_type))
                                            };
                                          } else {
                                            // Add if not selected
                                            return {
                                              ...prev,
                                              multiSelect: [...prev.multiSelect, newEntity]
                                            };
                                          }
                                        });
                                        setContextSearch("");
                                      }}
                                    >
                                      <div className="flex flex-col">
                                        <span className="text-sm">{entity.name || entity.legend}</span>
                                        <span className="text-xs text-foreground-500">
                                          {entity.entity_type === "project" ? "Project" :
                                            entity.entity_type === "connection" ? `Connection (${entity.type})` :
                                              "Dataset"}
                                        </span>
                                      </div>
                                    </ListboxItem>
                                  )
                                })}
                              </Listbox>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                      <Input
                        ref={inputRef}
                        placeholder="Ask me anything about your data..."
                        value={question}
                        onChange={(e) => {
                          const value = e.target.value;
                          setQuestion(value);
                          // Open context popover when "@" is typed
                          if (value.endsWith("@") && !isSecondContextPopoverOpen) {
                            setIsSecondContextPopoverOpen(true);
                          }
                        }}
                        disabled={isLoading}
                        endContent={<Kbd keys={["enter"]} />}
                      />
                      <Button
                        type="submit"
                        isIconOnly
                        color="primary"
                        isDisabled={(!question.trim() && selectedContext.multiSelect.length === 0 && !selectedContext.singleSelect) || isLoading}
                      >
                        <LuArrowRight />
                      </Button>
                    </div>
                  </form>
                </div>
              </div>
            </div>
    </div>

    <Modal
      isOpen={!!shareModalConversationId}
      onClose={() => {
        setShareModalConversationId(null);
        setShareTargetUserId(null);
      }}
      size="md"
    >
      <ModalContent>
        <ModalHeader>
          <div className="font-bold">Share conversation with a teammate</div>
        </ModalHeader>
        <ModalBody>
          <div className="text-sm text-foreground-500 mb-2">
            This will create an independent copy of the conversation for your teammate. They can continue the chat on their own without affecting your original.
          </div>
          <div className="flex flex-col gap-1 max-h-[300px] overflow-y-auto">
            {teamMembers
              .filter(m => m.id !== user.id)
              .map((member) => (
                <div
                  key={member.id}
                  className={`flex flex-row items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    shareTargetUserId === member.id
                      ? "bg-primary-50 border border-primary-200"
                      : "hover:bg-content2"
                  }`}
                  onClick={() => setShareTargetUserId(member.id)}
                >
                  <Avatar
                    name={member.name}
                    size="sm"
                    showFallback
                    fallback={<LuUsers size={14} />}
                    className="shrink-0 aspect-square"
                  />
                  <div className="flex flex-col flex-1">
                    <span className="text-sm font-medium">{member.name}</span>
                    <span className="text-xs text-foreground-500">{member.email}</span>
                  </div>
                  {shareTargetUserId === member.id && (
                    <LuCheck size={16} className="text-primary" />
                  )}
                </div>
              ))}
            {teamMembers.filter(m => m.id !== user.id).length === 0 && (
              <div className="text-sm text-foreground-500 py-4 text-center">
                No other team members found.
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="bordered"
            onPress={() => {
              setShareModalConversationId(null);
              setShareTargetUserId(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={_onShareConversation}
            isLoading={shareLoading}
            isDisabled={!shareTargetUserId}
            endContent={<LuShare2 size={14} />}
          >
            Share
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>

    {/* Single delete confirmation. Delete is a hard, unrecoverable delete, so it
        no longer fires straight from the dropdown item. */}
    <Modal
      isOpen={!!conversationToDelete}
      onClose={() => setConversationToDelete(null)}
      size="md"
    >
      <ModalContent>
        <ModalHeader>
          <div className="font-bold">Are you sure you want to delete this conversation?</div>
        </ModalHeader>
        <ModalBody>
          <div>
            {`"${conversationToDelete?.title || "This conversation"}" and all of its messages will be permanently removed. This action cannot be undone.`}
          </div>
          <div className="text-sm text-foreground-500">
            {"If you just want it out of the way, archive it instead — you can restore it any time."}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onPress={() => setConversationToDelete(null)} auto>
            Cancel
          </Button>
          {/* Offers the reversible path at the exact moment of hesitation. */}
          {!conversationToDelete?.archived && (
            <Button
              auto
              variant="flat"
              startContent={<LuArchive size={14} />}
              onPress={() => {
                const target = conversationToDelete;
                setConversationToDelete(null);
                _onArchiveConversation(target.id);
              }}
            >
              Archive instead
            </Button>
          )}
          <Button
            auto
            color="danger"
            endContent={<LuTrash2 size={14} />}
            isLoading={isDeletingConversation}
            onPress={() => _onDeleteConversation()}
          >
            Delete
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>

    {/* Bulk delete confirmation — kept separate from the single-delete modal so
        neither has to guess which mode it's in. */}
    <Modal
      isOpen={bulkDeleteConfirmOpen}
      onClose={() => setBulkDeleteConfirmOpen(false)}
      size="md"
    >
      <ModalContent>
        <ModalHeader>
          <div className="font-bold">
            {`Delete ${selectedConversationIds.size} ${selectedConversationIds.size === 1 ? "conversation" : "conversations"}?`}
          </div>
        </ModalHeader>
        <ModalBody>
          <div>
            {"These conversations and all of their messages will be permanently removed. This action cannot be undone."}
          </div>
          <div className="text-sm text-foreground-500">
            {"Archiving hides conversations without deleting them."}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="bordered" onPress={() => setBulkDeleteConfirmOpen(false)} auto>
            Cancel
          </Button>
          <Button
            auto
            color="danger"
            endContent={<LuTrash2 size={14} />}
            isLoading={isBulkBusy}
            onPress={_onBulkDeleteConversations}
          >
            {`Delete ${selectedConversationIds.size}`}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
    </>
  )
}

export default AiPage
