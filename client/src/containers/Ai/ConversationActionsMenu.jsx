import React from "react"
import PropTypes from "prop-types"
import { DropdownMenu, DropdownItem } from "@heroui/react"
import { LuPencil, LuGitFork, LuShare2, LuTrash2, LuArchive, LuArchiveRestore, LuStar, LuStarOff } from "react-icons/lu"

/**
 * The per-conversation action menu, shared by the landing list, the in-chat
 * sidebar and the conversation header so the three can't drift apart.
 *
 * Renders only the <DropdownMenu>; the caller supplies <Dropdown> and its
 * trigger, since the trigger button differs per location.
 */
function ConversationActionsMenu({
  conversation, isArchived = false, isStarred = false, onToggleStar, onRename, onFork, onShare,
  onArchive, onUnarchive, onRequestDelete,
}) {
  return (
    <DropdownMenu aria-label="Conversation actions">
      {/*
        Also reachable from the star on each list row, but the open conversation's
        header has no row — so the menu carries it too.
      */}
      {isStarred ? (
        <DropdownItem
          key="unstar_conversation"
          textValue="Remove star"
          onPress={() => onToggleStar(conversation.id, false)}
          startContent={<LuStarOff size={16} />}
        >
          Remove star
        </DropdownItem>
      ) : (
        <DropdownItem
          key="star_conversation"
          textValue="Star conversation"
          onPress={() => onToggleStar(conversation.id, true)}
          startContent={<LuStar size={16} />}
        >
          Star conversation
        </DropdownItem>
      )}
      <DropdownItem
        key="rename_conversation"
        textValue="Rename conversation"
        onPress={() => onRename(conversation)}
        startContent={<LuPencil size={16} />}
      >
        Rename conversation
      </DropdownItem>
      <DropdownItem
        key="fork_conversation"
        textValue="Fork conversation"
        onPress={() => onFork(conversation.id)}
        startContent={<LuGitFork size={16} />}
      >
        Fork conversation
      </DropdownItem>
      <DropdownItem
        key="share_conversation"
        textValue="Share with teammate"
        onPress={() => onShare(conversation.id)}
        startContent={<LuShare2 size={16} />}
      >
        Share with teammate
      </DropdownItem>
      {/*
        A ternary, never `{cond && <DropdownItem/>}`: a `false` child breaks the
        react-aria collection HeroUI builds from these.
      */}
      {isArchived ? (
        <DropdownItem
          key="unarchive_conversation"
          textValue="Unarchive conversation"
          onPress={() => onUnarchive(conversation.id)}
          startContent={<LuArchiveRestore size={16} />}
        >
          Unarchive conversation
        </DropdownItem>
      ) : (
        <DropdownItem
          key="archive_conversation"
          textValue="Archive conversation"
          onPress={() => onArchive(conversation.id)}
          startContent={<LuArchive size={16} />}
        >
          Archive conversation
        </DropdownItem>
      )}
      <DropdownItem
        key="delete_conversation"
        textValue="Delete conversation"
        onPress={() => onRequestDelete(conversation)}
        startContent={<LuTrash2 size={16} />}
        className="text-danger"
        color="danger"
      >
        Delete conversation
      </DropdownItem>
    </DropdownMenu>
  );
}

ConversationActionsMenu.propTypes = {
  conversation: PropTypes.object.isRequired,
  isArchived: PropTypes.bool,
  isStarred: PropTypes.bool,
  onToggleStar: PropTypes.func.isRequired,
  onRename: PropTypes.func.isRequired,
  onFork: PropTypes.func.isRequired,
  onShare: PropTypes.func.isRequired,
  onArchive: PropTypes.func.isRequired,
  onUnarchive: PropTypes.func.isRequired,
  onRequestDelete: PropTypes.func.isRequired,
};

export default ConversationActionsMenu;
