//! The command vocabulary the host's menus and shortcuts speak.
//!
//! These are host actions, not editor operations: a menu item names what the
//! user asked for, and the host decides whether the current editor implements
//! it. `editor-typeset::EditorCommand` is the other half — the formatting
//! commands an editor actually executes — and the host maps one to the other.

use gpui_kit::Action;

/// Inline formats a menu can ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineFormat {
    Bold,
    Italic,
    Strikethrough,
    Code,
}

/// Block formats a menu can ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BlockFormat {
    Heading(u8),
    Quote,
    UnorderedList,
    OrderedList,
    TaskList,
}

/// Commands the host's menus and shortcuts dispatch.
///
/// The view-mode entries are kept because the menu still names them; a host that
/// renders and edits at once maps them to nothing.
#[derive(Action, Clone, Copy, Debug, PartialEq, Eq)]
#[action(namespace = inkpoint_editor, no_json)]
pub enum HostCommand {
    ShowSource,
    ShowBlockEditor,
    ShowSplitPreview,
    ToggleSourceMode,
    ToggleOutline,
    FormatInline(InlineFormat),
    FormatBlock(BlockFormat),
}
