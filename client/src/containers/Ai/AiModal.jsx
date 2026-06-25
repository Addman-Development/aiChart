import React, { useEffect, useState, useRef } from "react"
import PropTypes from "prop-types"
import { Modal, ModalContent, ModalBody, ModalHeader, ModalFooter, Avatar, Spacer, Input, Button, Accordion, AccordionItem, Divider, Kbd, Popover, PopoverTrigger, PopoverContent, Code, Chip, Tooltip, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, CircularProgress, Listbox, ListboxItem } from "@heroui/react"
import { LuArrowRight, LuBrainCircuit, LuClock, LuMessageSquare, LuPlus, LuChevronDown, LuLoader, LuTrash2, LuCoins, LuEllipsis, LuWrench, LuAtSign, LuLayoutGrid, LuPlug, LuDatabase, LuSlack, LuLayoutDashboard, LuPencil, LuCheck, LuX, LuThumbsUp, LuThumbsDown, LuRefreshCw, LuPlay, LuGitFork, LuShare2, LuUsers } from "react-icons/lu"
import { useDispatch, useSelector } from "react-redux";
import toast from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useParams } from "react-router";

import { getAiConversation, getAiConversations, orchestrateAi, deleteAiConversation, renameAiConversation, getAiUsage, submitAiMessageFeedback, forkAiConversation } from "../../api/ai";
import { selectTeam, selectTeamMembers, getTeamMembers } from "../../slices/team";
import { selectUser } from "../../slices/user";
import { getChart, moveChartToDashboard, runQuery } from "../../slices/chart";
import Chart from "../Chart/Chart";
import { selectProjects } from "../../slices/project";
import { selectConnections } from "../../slices/connection";
import { selectDatasetsNoDrafts } from "../../slices/dataset";
import { createNotification } from "../../slices/notification";
import { selectAiPendingConversationId, setAiPendingConversationId } from "../../slices/ui";
import isMac from "../../modules/isMac";
import socketClient from "../../modules/socketClient";
import { SITE_HOST } from "../../config/settings";
import useIsMobile from "../../modules/useIsMobile";
import { cn } from "../../modules/utils";

function formatDate(date) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatTokens(tokens) {
  if (!tokens || tokens === 0) return "0";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toString();
}

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

function AiModal({ isOpen, onClose }) {
  const [question, setQuestion] = useState("");
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSocketReady, setIsSocketReady] = useState(false);
  const [progressEvents, setProgressEvents] = useState([]);
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
  // On phones the conversations list is an off-canvas drawer inside the modal.
  const [showConvoSidebar, setShowConvoSidebar] = useState(false);

  const params = useParams();
  const team = useSelector(selectTeam);
  const user = useSelector(selectUser);
  const teamMembers = useSelector(selectTeamMembers);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const dispatch = useDispatch();
  const isMobile = useIsMobile();
  const aiPendingConversationId = useSelector(selectAiPendingConversationId);
  // Track the live "is the panel open?" value for async completion handlers,
  // since _onAskAi captures `isOpen` at call time.
  const isOpenRef = useRef(isOpen);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  const fetchedChartsRef = useRef(new Set());
  // Mirror the current conversation into a ref so socket handlers (attached once
  // per open) can read the latest value without stale closures.
  const conversationRef = useRef(null);
  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  // Tracks the in-flight orchestration turn. Completion is driven by whichever
  // of (HTTP response | "ai-orchestration-complete" socket event) lands first;
  // the other becomes a no-op via the `done` flag.
  const turnRef = useRef(null);
  // The modal component stays mounted across open/close, so when it closes,
  // abandon any in-flight turn and clear the spinner — otherwise a stale
  // completion could surface against a fresh reopen.
  useEffect(() => {
    if (!isOpen) {
      turnRef.current = null;
      setIsLoading(false);
    }
  }, [isOpen]);
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

  // When the modal opens, verify that cloned charts still exist on their
  // target dashboards. If a clone was deleted (shelved back to ghost),
  // its project_id will no longer match — reset to "Add to Dashboard".
  useEffect(() => {
    if (!isOpen) return;

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
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!isOpen || !user?.id || !team?.id) return;

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
      }
    };

    // Set up conversation-updated listener (e.g. title generated async)
    const handleConversationUpdated = (data) => {
      if (data?.conversationId && data?.title) {
        setConversations(prev => prev.map(c =>
          c.id === data.conversationId ? { ...c, title: data.title } : c
        ));
        setConversation(prev =>
          prev?.id === data.conversationId ? { ...prev, title: data.title } : prev
        );
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
      if (data?.turnId != null && data.turnId !== turn.id) return;
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
      } else {
        _finalizeTurnFromServer(convId).catch(() => {});
      }
      setIsLoading(false);
    };

    initSocket();
    socketClient.on("conversation-created", handleConversationCreated);
    socketClient.on("conversation-updated", handleConversationUpdated);
    socketClient.on("ai-orchestration-complete", handleOrchestrationComplete);

    return () => {
      isMounted = false;
      socketClient.off("conversation-created", handleConversationCreated);
      socketClient.off("conversation-updated", handleConversationUpdated);
      socketClient.off("ai-orchestration-complete", handleOrchestrationComplete);
      // Note: We don't disconnect the socket here - it's a singleton that stays connected
      // This allows seamless reconnection when modal reopens
    };
  }, [isOpen, user?.id, team?.id]);

  // Load conversations when modal opens
  useEffect(() => {
    if (isOpen) {
      loadConversations();
      // check the route params and add project and chart id to the context
      const projectId = parseInt(params?.projectId, 10);
      const chartId = parseInt(params?.chartId, 10);
      const connectionId = parseInt(params?.connectionId, 10);
      const datasetId = parseInt(params?.datasetId, 10);

      if (projectId && selectedContext?.multiSelect?.find(e => e.id === projectId) === undefined) {
        const project = projects.find(p => p.id === projectId);
        const projectLabel = `Project: ${project?.name}`;
        setSelectedContext(prev => ({ ...prev, multiSelect: [...prev.multiSelect, { id: projectId, entity_type: "project", label: projectLabel }] }));
      }
      if (chartId && selectedContext?.multiSelect?.find(e => e.id === chartId) === undefined) {
        const chartLabel = `Chart ID: ${chartId}`;
        setSelectedContext(prev => ({ ...prev, multiSelect: [...prev.multiSelect, { id: chartId, entity_type: "chart", label: chartLabel }] }));
      }
      if (connectionId && selectedContext?.multiSelect?.find(e => e.id === connectionId) === undefined) {
        const connection = connections.find(c => c.id === connectionId);
        const connectionLabel = `Connection: ${connection?.name} (${connection?.type})`;
        setSelectedContext(prev => ({ ...prev, multiSelect: [...prev.multiSelect, { id: connectionId, entity_type: "connection", label: connectionLabel }] }));
      }
      if (datasetId && selectedContext?.multiSelect?.find(e => e.id === datasetId) === undefined) {
        const dataset = datasets.find(d => d.id === datasetId);
        const datasetLabel = `Dataset: ${dataset?.legend || dataset?.name}`;
        setSelectedContext(prev => ({ ...prev, multiSelect: [...prev.multiSelect, { id: datasetId, entity_type: "dataset", label: datasetLabel }] }));
      }
    }
  }, [isOpen]);

  // Deep-link: when a notification opens the modal straight to a conversation.
  useEffect(() => {
    if (isOpen && aiPendingConversationId) {
      _onSelectConversation(aiPendingConversationId);
      dispatch(setAiPendingConversationId(null));
    }
  }, [isOpen, aiPendingConversationId]);

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

  const loadConversations = async () => {
    try {
      const data = await getAiConversations(team.id);
      setConversations(data.conversations);
      // load usage in the background
      loadTeamUsage();
    } catch (error) {
      toast.error(error.message);
    }
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
  const _finalizeTurnFromServer = async (conversationId) => {
    if (!conversationId) return;
    const updated = await getAiConversation(conversationId, team.id);
    if (updated?.conversation) {
      const viewing = conversationRef.current?.id;
      // Only swap the displayed conversation when the user is still viewing this
      // exact one — never adopt it onto a blank/New Conversation screen or a
      // conversation they've navigated to since.
      if (`${viewing}` === `${conversationId}`) {
        setConversation(updated.conversation);
        setLocalMessages([]);
        setProgressEvents([]);
        // Refresh updated charts in the background — never gate the spinner on them.
        const updatedCharts = _getUpdatedChartIds(updated.conversation.full_history);
        updatedCharts.forEach(({ chartId, projectId }) => {
          fetchedChartsRef.current.add(chartId);
          fetchChartData(chartId, projectId, { isUpdate: true });
        });
      }
    }
    loadConversations();
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

    const userMessage = {
      role: "user",
      content: sourceQuestion.trim()
    };

    // Prepare context object (only multiSelect goes to context)
    let context = null;
    if (selectedContext.multiSelect.length > 0) {
      context = selectedContext.multiSelect;
    }

    setIsLoading(true);
    setProgressEvents([]);
    let currentQuestion = sourceQuestion.trim();

    // Append singleSelect to the question text
    if (selectedContext.singleSelect) {
      currentQuestion += (currentQuestion ? "\n\n" : "") + selectedContext.singleSelect.label;
    }
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
      _finalizeTurnFromServer(finishedConversationId).catch(() => {});
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
              await _finalizeTurnFromServer(convId);
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

  const _onSelectConversation = async (conversationId) => {
    // Reset state for clean viewing
    setShowConvoSidebar(false);
    setLocalMessages([]);
    setProgressEvents([]);
    setCreatedCharts([]);
    setAddedToDashboard({});
    fetchedChartsRef.current.clear();
    setSelectedContext({
      multiSelect: [],
      singleSelect: null
    });
    setContextSearch("");
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

  const _onDeleteConversation = async (conversationId) => {
    try {
      await deleteAiConversation(conversationId, team.id);
      toast.success("Conversation deleted");

      // If we deleted the current conversation, reset to a fresh chat (stay in chat view)
      if (conversation?.id === conversationId) {
        setConversation({
          title: "New Conversation",
          full_history: [],
          createdAt: new Date().toISOString(),
          message_count: 0,
          isTemporary: true,
        });
        setLocalMessages([]);
        setProgressEvents([]);
        setCreatedCharts([]);
        fetchedChartsRef.current.clear();
      }

      // Reload conversations list
      await loadConversations();
    } catch (error) {
      toast.error(error.message);
    }
  };

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

      // Update conversation data in background
      if (response.orchestration?.aiConversationId) {
        await loadConversations();
        const updatedConversations = await getAiConversations(team.id);
        const newConversation = updatedConversations.conversations.find(
          c => c.id === response.orchestration.aiConversationId
        );
        if (newConversation) {
          const fullConversation = await getAiConversation(newConversation.id, team.id);
          if (fullConversation?.conversation) {
            setConversation({
              ...fullConversation.conversation,
              id: newConversation.id,
              isTemporary: false
            });
            setLocalMessages([]);
            setProgressEvents([]);
          }
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

  // Fetch team members when modal opens (for sharing)
  useEffect(() => {
    if (isOpen && team?.id && (!teamMembers || teamMembers.length === 0)) {
      dispatch(getTeamMembers({ team_id: team.id }));
    }
  }, [isOpen, team?.id]);

  const _onForkConversation = async (conversationId) => {
    try {
      const result = await forkAiConversation(conversationId, team.id);
      toast.success("Conversation forked");
      await loadConversations();
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

  return (
    <>
    <Modal
      classNames={{
        wrapper: conversation ? (isMobile ? "!overflow-hidden" : "p-4 !overflow-hidden") : "",
        base: conversation
          ? (isMobile
            ? "!h-full !max-h-full !m-0 !rounded-none !overflow-hidden"
            : "border-1 border-divider !h-[calc(100vh-2rem)] !max-h-[calc(100vh-2rem)] !my-0 !overflow-hidden")
          : "border-1 border-divider",
        body: conversation ? "!p-0 !overflow-hidden !flex-1 !min-h-0" : "",
      }}
      backdrop="blur"
      isOpen={isOpen}
      onClose={onClose}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      hideCloseButton
      size={conversation ? (isMobile ? "full" : "6xl") : "xl"}
      scrollBehavior={conversation ? "normal" : "inside"}
    >
      <ModalContent>{(closeModal) => (<>
        <button
          type="button"
          aria-label="Close"
          onClick={() => onClose()}
          className="absolute top-1 right-1 z-50 p-2 text-foreground-500 rounded-full hover:bg-default-100 active:bg-default-200 outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          <LuX size={18} />
        </button>
        {!conversation && (
          <ModalBody className="pt-8">
            <div className="flex flex-col gap-2 items-center justify-center">
              <Avatar
                className="shrink-0 aspect-square" icon={<LuBrainCircuit size={24} className="text-background" />}
                size="lg"
                color="primary"
              />
              <div className="flex flex-col items-center justify-center">
                <div className="flex flex-row items-center gap-2">
                  <div className="font-tw font-medium text-lg">Edison AI</div>
                  <Chip color="primary" variant="flat" size="sm" radius="sm" className="shadow-sm">
                    Beta
                  </Chip>
                </div>
                <div className="text-sm text-foreground-500">Ask me anything about your data</div>
                <div className="flex flex-row items-center gap-1 mt-2">
                  <Kbd keys={isMac() ? ["command"] : ["ctrl"]}>K</Kbd>
                </div>
              </div>
            </div>
            <Spacer y={2} />
            <form onSubmit={_onAskAi} id="ai-form">
              <Input
                placeholder="Ask me a question"
                value={question}
                onChange={(e) => {
                  const value = e.target.value;
                  setQuestion(value);
                  // Open context popover when "@" is typed
                  if (value.endsWith("@") && !isContextPopoverOpen) {
                    setIsContextPopoverOpen(true);
                  }
                }}
                variant="bordered"
                endContent={
                  <Button type="submit" isIconOnly isDisabled={(!question.trim() && selectedContext.multiSelect.length === 0 && !selectedContext.singleSelect)} color="primary" onPress={() => setQuestion(question + " ")} size="sm">
                    <LuArrowRight size={18} />
                  </Button>
                }
              />
              <div className="flex flex-row items-center gap-1 flex-wrap mt-2">
                <Chip
                  variant="flat"
                  size="sm"
                  onClick={() => {
                    setQuestion("What can you do?");
                  }}
                  className="cursor-pointer"
                >
                  What can you do?
                </Chip>
                <Chip
                  variant="flat"
                  size="sm"
                  onClick={() => {
                    setQuestion("How many users I have in my database?");
                  }}
                  className="cursor-pointer"
                >
                  How many users I have in my database?
                </Chip>
              </div>
            </form>
            <div className="flex flex-row items-center gap-1 flex-wrap">
              <Popover placement="bottom" isOpen={isContextPopoverOpen} onOpenChange={setIsContextPopoverOpen}>
                <PopoverTrigger>
                  <Button
                    variant="light"
                    size="sm"
                    startContent={selectedContext.multiSelect.length > 0 ? null : <LuAtSign size={16} />}
                    isDisabled={isLoading}
                    isIconOnly={selectedContext.multiSelect.length > 0}
                  >
                    {selectedContext.multiSelect.length > 0 ? <LuAtSign size={16} /> : "Add extra context"}
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
                        )})}
                      </Listbox>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {(selectedContext.multiSelect.length > 0 || selectedContext.singleSelect) && (
                <>
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
                </>
              )}
            </div>
            <Divider />
            <Accordion variant="light">
              <AccordionItem
                key="previous_conversations"
                title={`Previous Conversations (${conversations.length})`}
                classNames={{ title: "text-sm font-medium" }}
              >
                <div className="flex flex-col gap-2 max-h-[250px] overflow-y-auto">
                  {conversations.map((conv) => (
                    <div
                      key={conv.id}
                      className="flex flex-row gap-2 cursor-pointer p-2 rounded-lg hover:bg-content2 transition-colors group"
                      onClick={() => _onSelectConversation(conv.id)}
                    >
                      <div className="pt-1">
                        {conv.source === "slack" ? <LuSlack size={16} /> : <LuMessageSquare size={16} />}
                      </div>
                      <div className="flex flex-col gap-1 flex-1">
                        {renamingConversationId === conv.id ? (
                          <div className="flex flex-row items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <Input
                              size="sm"
                              value={renameValue}
                              onValueChange={setRenameValue}
                              autoFocus
                              classNames={{ inputWrapper: "h-7" }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") _onConfirmRename(conv.id);
                                if (e.key === "Escape") _onCancelRename();
                              }}
                            />
                            <Button isIconOnly size="sm" variant="light" color="success" onPress={() => _onConfirmRename(conv.id)}>
                              <LuCheck size={14} />
                            </Button>
                            <Button isIconOnly size="sm" variant="light" color="danger" onPress={_onCancelRename}>
                              <LuX size={14} />
                            </Button>
                          </div>
                        ) : (
                          <div className="text-sm text-foreground font-medium">{conv.title}</div>
                        )}
                        <div className="flex flex-row items-center gap-3 text-xs text-foreground-500">
                          <div className="flex items-center gap-1">
                            <LuClock size={12} />
                            <span>{formatDate(conv.createdAt)}</span>
                          </div>
                          {conv.total_tokens > 0 && (
                            <div className="flex items-center gap-1">
                              <LuCoins size={12} />
                              <span>{formatTokens(conv.total_tokens)} tokens</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <Dropdown>
                          <DropdownTrigger>
                            <Button isIconOnly size="sm" variant="light">
                              <LuEllipsis size={16} />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu>
                            <DropdownItem key="rename_conversation" onPress={() => _onStartRename(conv)} startContent={<LuPencil size={16} />}>
                              Rename conversation
                            </DropdownItem>
                            <DropdownItem key="fork_conversation" onPress={() => _onForkConversation(conv.id)} startContent={<LuGitFork size={16} />}>
                              Fork conversation
                            </DropdownItem>
                            <DropdownItem key="share_conversation" onPress={() => setShareModalConversationId(conv.id)} startContent={<LuShare2 size={16} />}>
                              Share with teammate
                            </DropdownItem>
                            <DropdownItem key="delete_conversation" onPress={() => _onDeleteConversation(conv.id)} startContent={<LuTrash2 size={16} />} className="text-danger" color="danger">
                              Delete conversation
                            </DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>
                    </div>
                  ))}
                </div>
              </AccordionItem>
            </Accordion>

            <Divider />
            <div className="text-xs text-foreground-500 mb-2">
              <span className="font-medium">Note:</span> We are still in beta. Some features may not work as expected. Please let us know if you encounter any issues or have any feedback at <a href="#" className="text-primary-500 hover:text-primary-600">our support team</a>
            </div>
          </ModalBody>
        )}

        {conversation && (
          <ModalBody>
            <div className="flex flex-row h-full min-h-0 relative">
              <div className={cn(
                "flex-none w-60",
                // On phones the list slides in over the chat instead of stealing width.
                isMobile && "absolute inset-y-0 left-0 z-30 w-[85%] max-w-[18rem] transition-transform duration-300",
                isMobile && (showConvoSidebar ? "translate-x-0 shadow-2xl" : "-translate-x-full")
              )}>
                <div className="flex flex-col relative h-full bg-content2 rounded-tl-2xl rounded-bl-2xl">
                  <div className="w-full px-4 pt-4 border-r border-divider rounded-tl-2xl">
                    <Button
                      color="primary"
                      startContent={<LuPlus size={18} />}
                      onPress={() => {
                        setShowConvoSidebar(false);
                        setConversation(null);
                        setLocalMessages([]);
                        setProgressEvents([]);
                        setCreatedCharts([]);
                        fetchedChartsRef.current.clear();
                        // Abandon any in-flight turn so its late completion can't
                        // hijack the fresh blank screen.
                        turnRef.current = null;
                        setIsLoading(false);
                        setSelectedContext({
                          multiSelect: [],
                          singleSelect: null
                        });
                        setContextSearch("");
                      }}
                      fullWidth
                    >
                      New Conversation
                    </Button>
                    <Spacer y={4} />
                    <Divider />
                  </div>
                  <div className="flex flex-col flex-1 min-h-0 gap-2 px-2 overflow-y-auto border-r border-divider py-4 pb-16">
                    {conversations.map((c) => (
                      <div
                        key={c.id}
                        className={`flex flex-row gap-2 cursor-pointer px-2 py-2 rounded-lg transition-colors group relative ${c.id === conversation.id ? "bg-background shadow-sm" : "hover:bg-background/50"}`}
                        onClick={() => _onSelectConversation(c.id)}
                      >
                        <div className="pt-1">
                          {c.source === "slack" ? <LuSlack size={14} /> : <LuMessageSquare size={14} />}
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                          {renamingConversationId === c.id ? (
                            <div className="flex flex-row items-center gap-1 pr-6" onClick={(e) => e.stopPropagation()}>
                              <Input
                                size="sm"
                                value={renameValue}
                                onValueChange={setRenameValue}
                                autoFocus
                                classNames={{ inputWrapper: "h-7" }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") _onConfirmRename(c.id);
                                  if (e.key === "Escape") _onCancelRename();
                                }}
                              />
                              <Button isIconOnly size="sm" variant="light" color="success" onPress={() => _onConfirmRename(c.id)}>
                                <LuCheck size={14} />
                              </Button>
                              <Button isIconOnly size="sm" variant="light" color="danger" onPress={_onCancelRename}>
                                <LuX size={14} />
                              </Button>
                            </div>
                          ) : (
                            <div className="text-sm text-foreground truncate pr-6">{c.title}</div>
                          )}
                          <div className="flex flex-col gap-1">
                            <div className="text-xs text-foreground-500 flex items-center gap-1">
                              <LuClock size={10} />
                              <span className="truncate">{formatDate(c.createdAt)}</span>
                            </div>
                            {c.total_tokens > 0 && (
                              <div className="text-xs text-foreground-500 flex items-center gap-1">
                                <LuCoins size={10} />
                                <span>{formatTokens(c.total_tokens)}</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Dropdown>
                            <DropdownTrigger>
                              <Button isIconOnly size="sm" variant="light">
                                <LuEllipsis size={16} />
                              </Button>
                            </DropdownTrigger>
                            <DropdownMenu>
                              <DropdownItem key="rename_conversation" onPress={() => _onStartRename(c)} startContent={<LuPencil size={16} />}>
                                Rename conversation
                              </DropdownItem>
                              <DropdownItem key="fork_conversation" onPress={() => _onForkConversation(c.id)} startContent={<LuGitFork size={16} />}>
                                Fork conversation
                              </DropdownItem>
                              <DropdownItem key="share_conversation" onPress={() => setShareModalConversationId(c.id)} startContent={<LuShare2 size={16} />}>
                                Share with teammate
                              </DropdownItem>
                              <DropdownItem key="delete_conversation" onPress={() => _onDeleteConversation(c.id)} startContent={<LuTrash2 size={16} />} className="text-danger" color="danger">
                                Delete conversation
                              </DropdownItem>
                            </DropdownMenu>
                          </Dropdown>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-4 border-r border-t border-divider bg-content2 rounded-bl-2xl">
                    <Tooltip
                      content={<div className="flex flex-col gap-1">
                        <div className="text-xs text-foreground-500">Total tokens used: {formatTokens(teamUsage?.total?.total_tokens || 0)}</div>
                        <div className="text-xs text-foreground-500">Total API calls: {teamUsage?.total?.api_calls || 0}</div>
                        <div className="text-xs text-foreground-500">Total models used: {teamUsage?.byModel?.length || 0}</div>
                      </div>}
                    >
                      <div className="flex flex-row items-center justify-center gap-2 cursor-help">
                        <div><LuCoins size={14} /></div>
                        <div className="text-sm text-foreground-500">{formatTokens(teamUsage?.total?.total_tokens || 0)}</div>
                      </div>
                    </Tooltip>
                  </div>
                </div>
              </div>
              {isMobile && showConvoSidebar && (
                <div
                  className="absolute inset-0 z-20 bg-black/40"
                  onClick={() => setShowConvoSidebar(false)}
                  aria-hidden="true"
                />
              )}
              <div className="relative flex-1 min-w-0 flex flex-col min-h-0 rounded-lg">
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
                    <div className="flex flex-col gap-1 flex-1">
                      <div className="flex flex-row items-center gap-2">
                        {renamingConversationId === conversation.id ? (
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
                            <div className="text-md text-foreground font-medium">{conversation.title}</div>
                            <Dropdown>
                              <DropdownTrigger>
                                <Button isIconOnly size="sm" variant="light">
                                  <LuEllipsis size={16} />
                                </Button>
                              </DropdownTrigger>
                              <DropdownMenu>
                                <DropdownItem key="rename_conversation" onPress={() => _onStartRename(conversation)} startContent={<LuPencil size={16} />}>
                                  Rename conversation
                                </DropdownItem>
                                <DropdownItem key="fork_conversation" onPress={() => _onForkConversation(conversation.id)} startContent={<LuGitFork size={16} />}>
                                  Fork conversation
                                </DropdownItem>
                                <DropdownItem key="share_conversation" onPress={() => setShareModalConversationId(conversation.id)} startContent={<LuShare2 size={16} />}>
                                  Share with teammate
                                </DropdownItem>
                                <DropdownItem key="delete_conversation" onPress={() => _onDeleteConversation(conversation.id)} startContent={<LuTrash2 size={16} />} className="text-danger" color="danger">
                                  Delete conversation
                                </DropdownItem>
                              </DropdownMenu>
                            </Dropdown>
                          </>
                        )}
                      </div>
                      <div className="flex flex-row items-center gap-3 text-xs text-foreground-500">
                        <div className="flex items-center gap-1">
                          <LuClock size={12} />
                          <span>{formatDate(conversation.createdAt)}</span>
                        </div>
                        {conversation.message_count > 0 && (
                          <div className="flex items-center gap-1">
                            <LuMessageSquare size={12} />
                            <span>{conversation.message_count} {conversation.message_count === 1 ? "message" : "messages"}</span>
                          </div>
                        )}
                        {conversation.total_tokens > 0 && (
                          <Tooltip content={`${conversation.total_tokens.toLocaleString()} tokens used`}>
                            <div className="flex items-center gap-1 cursor-help">
                              <LuCoins size={12} />
                              <span>{formatTokens(conversation.total_tokens)}</span>
                            </div>
                          </Tooltip>
                        )}
                      </div>
                    </div>
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
                      {isLoading && progressEvents.length === 0 && (
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
                      {isLoading && progressEvents.length === 0 && (
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
                  ) : isLoading ? (
                    <div className="flex justify-center items-center h-full">
                      <div className="flex items-center gap-2">
                        <LuLoader size={24} className="animate-spin text-primary" />
                        <span className="text-sm text-foreground-500">Loading conversation...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-foreground-500 text-sm">No messages yet</div>
                    </div>
                  )}
                </div>
                <div className="flex-none p-4 border-t border-divider bg-background z-10 rounded-b-2xl">
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
          </ModalBody>
        )}
      </>)}</ModalContent>
    </Modal>

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
    </>
  )
}

AiModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired
}

export default AiModal
