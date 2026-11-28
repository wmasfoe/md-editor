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

/// Platform-specific formatting shortcuts shared by the editor and settings.
pub fn format_shortcuts(os: gpui_kit::OperatingSystem) -> [(InlineFormat, String); 4] {
    let modifier = if os == gpui_kit::OperatingSystem::Mac {
        "cmd"
    } else {
        "ctrl"
    };
    [
        (InlineFormat::Bold, format!("{modifier}-b")),
        (InlineFormat::Italic, format!("{modifier}-i")),
        (InlineFormat::Code, format!("{modifier}-e")),
        (InlineFormat::Strikethrough, format!("{modifier}-shift-x")),
    ]
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

/// Table structure operations a menu can ask for.
///
/// These mirror `editor-core`'s `table_edit` commands. Naming them here rather
/// than in the desktop layer keeps the menu vocabulary in one place: a new entry
/// point adds a variant instead of inventing its own action names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TableCommand {
    InsertRowAbove,
    InsertRowBelow,
    DeleteRow,
    InsertColumnLeft,
    InsertColumnRight,
    DeleteColumn,
    SetAlignment(AlignmentChoice),
}

/// Column alignment a menu can ask for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AlignmentChoice {
    Default,
    Left,
    Center,
    Right,
}

/// Commands the host's menus and shortcuts dispatch.
#[derive(Action, Clone, Copy, Debug, PartialEq, Eq)]
#[action(namespace = inkpoint_editor, no_json)]
pub enum HostCommand {
    ToggleOutline,
    FormatInline(InlineFormat),
    FormatBlock(BlockFormat),
    Table(TableCommand),
}
