import React from "react"
import PropTypes from "prop-types"
import { Button, Input, Dropdown, DropdownTrigger, Checkbox, Chip } from "@heroui/react"
import { LuSlack, LuMessageSquare, LuClock, LuEllipsis, LuCheck, LuX, LuArchive, LuStar } from "react-icons/lu"

import { cn } from "../../modules/utils";
import ConversationActionsMenu from "./ConversationActionsMenu";
import { formatDate } from "./conversationUtils";

function ConversationListItem({
  conversation,
  isActive = false,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  onToggleStar,
  isRenaming = false,
  renameValue = "",
  onRenameValueChange,
  onConfirmRename,
  onCancelRename,
  onSelect,
  onStartRename,
  onFork,
  onShare,
  onArchive,
  onUnarchive,
  onRequestDelete,
}) {
  const isArchived = !!conversation.archived;
  const isStarred = !!conversation.starred;

  // In selection mode the whole row toggles selection instead of navigating, so
  // a near-miss can't throw the user out of the list they're managing.
  const handleRowClick = selectionMode
    ? () => onToggleSelect(conversation.id)
    : () => onSelect(conversation.id);

  const meta = (
    <div className="flex items-center gap-1">
      <LuClock size={10} />
      <span className="truncate">{formatDate(conversation.createdAt)}</span>
    </div>
  );

  return (
    <div
      className={cn(
        "flex flex-row gap-2 cursor-pointer rounded-lg transition-colors group relative px-2 py-2",
        isSelected && "bg-primary-50 ring-1 ring-primary-200",
        !isSelected && isActive && "bg-background shadow-sm",
        !isSelected && !isActive && "hover:bg-background/50",
      )}
      onClick={handleRowClick}
    >
      {selectionMode && (
        <Checkbox
          size="sm"
          isSelected={isSelected}
          onValueChange={() => onToggleSelect(conversation.id)}
          aria-label={`Select ${conversation.title}`}
          // The row handler already toggles; stop this from undoing it.
          onClick={(e) => e.stopPropagation()}
          classNames={{ base: "m-0 p-0 shrink-0 max-w-none", wrapper: "mr-0" }}
        />
      )}

      {/*
        Star slot. The width is always reserved so hovering a row can't shift the
        title sideways: filled when starred, outline on hover, invisible otherwise.
      */}
      {!selectionMode && (
        <button
          type="button"
          aria-label={isStarred ? `Unstar ${conversation.title}` : `Star ${conversation.title}`}
          aria-pressed={isStarred}
          className={cn(
            "shrink-0 pt-1 transition-opacity outline-none focus-visible:opacity-100",
            isStarred
              ? "text-warning opacity-100"
              : "text-foreground-400 opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(conversation.id, !isStarred);
          }}
        >
          <LuStar size={13} fill={isStarred ? "currentColor" : "none"} />
        </button>
      )}

      <div className="pt-1">
        {conversation.source === "slack"
          ? <LuSlack size={14} />
          : <LuMessageSquare size={14} />}
      </div>

      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {isRenaming && !selectionMode ? (
          <div className="flex flex-row items-center gap-1 pr-6" onClick={(e) => e.stopPropagation()}>
            <Input
              size="sm"
              value={renameValue}
              onValueChange={onRenameValueChange}
              autoFocus
              classNames={{ inputWrapper: "h-7" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirmRename(conversation.id);
                if (e.key === "Escape") onCancelRename();
              }}
            />
            <Button isIconOnly size="sm" variant="light" color="success" onPress={() => onConfirmRename(conversation.id)}>
              <LuCheck size={14} />
            </Button>
            <Button isIconOnly size="sm" variant="light" color="danger" onPress={onCancelRename}>
              <LuX size={14} />
            </Button>
          </div>
        ) : (
          <div className="flex flex-row items-center gap-1 min-w-0">
            <div className="text-sm text-foreground truncate pr-6">{conversation.title}</div>
            {isArchived && (
              <Chip
                size="sm"
                variant="flat"
                radius="sm"
                classNames={{ base: "h-4 shrink-0 px-1", content: "text-[10px] px-0.5" }}
                startContent={<LuArchive size={10} />}
              >
                Archived
              </Chip>
            )}
          </div>
        )}
        {meta}
      </div>

      {/* No nested interactive controls while the whole row is a toggle target. */}
      {!selectionMode && (
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Dropdown>
            <DropdownTrigger>
              <Button isIconOnly size="sm" variant="light">
                <LuEllipsis size={16} />
              </Button>
            </DropdownTrigger>
            <ConversationActionsMenu
              conversation={conversation}
              isArchived={isArchived}
              isStarred={isStarred}
              onToggleStar={onToggleStar}
              onRename={onStartRename}
              onFork={onFork}
              onShare={onShare}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              onRequestDelete={onRequestDelete}
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
}

ConversationListItem.propTypes = {
  conversation: PropTypes.object.isRequired,
  isActive: PropTypes.bool,
  selectionMode: PropTypes.bool,
  isSelected: PropTypes.bool,
  onToggleSelect: PropTypes.func.isRequired,
  onToggleStar: PropTypes.func.isRequired,
  isRenaming: PropTypes.bool,
  renameValue: PropTypes.string,
  onRenameValueChange: PropTypes.func.isRequired,
  onConfirmRename: PropTypes.func.isRequired,
  onCancelRename: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  onStartRename: PropTypes.func.isRequired,
  onFork: PropTypes.func.isRequired,
  onShare: PropTypes.func.isRequired,
  onArchive: PropTypes.func.isRequired,
  onUnarchive: PropTypes.func.isRequired,
  onRequestDelete: PropTypes.func.isRequired,
};

export default ConversationListItem;
