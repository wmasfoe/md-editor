use std::sync::{Arc, LazyLock};

use crate::{APP_NAME, appearance::Palette};

use super::{
    CloseDocument, ContinueWithLocalAi, FileAction, NewDocument, OpenDocument, OpenFolder, SaveAs,
    SaveDocument, SidebarTab, Workspace,
};
use gpui_kit::{
    assets::IconName,
    component::{
        Disableable, Icon, Sizable, TitleBar,
        button::{Button, ButtonCustomVariant, ButtonVariants},
        list::ListItem,
        tree::tree,
    },
    prelude::FluentBuilder as _,
    *,
};
use inkpoint_editor_core::{BlockKind, MarkdownDocument, SourceBlock};
use inkpoint_editor_gpui::{BlockFormat, HostCommand, InlineFormat};

const TITLE_BAR_HEIGHT: Pixels = px(36.);
const SIDEBAR_FOOTER_HEIGHT: Pixels = px(38.);

static WELCOME_LOGO: LazyLock<Arc<Image>> = LazyLock::new(|| {
    Arc::new(Image::from_bytes(
        ImageFormat::Png,
        include_bytes!("../../assets/welcome-logo.png").to_vec(),
    ))
});

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum DocumentMetricKind {
    #[default]
    Words,
    Lines,
    Characters,
}

pub(super) struct OutlineEntry {
    line: usize,
    level: u8,
    title: String,
}

fn icon_button(
    id: &'static str,
    icon: IconName,
    label: &'static str,
    palette: Palette,
    cx: &App,
) -> Button {
    Button::new(id)
        .custom(
            ButtonCustomVariant::new(cx)
                .foreground(palette.muted)
                .hover(palette.hover)
                .active(palette.active),
        )
        .small()
        .size(px(28.))
        .rounded(px(6.))
        .icon(icon)
        .accessibility_label(label)
        .tooltip(label)
}

fn open_folder_button(id: &'static str, cx: &mut Context<Workspace>) -> Button {
    Button::new(id)
        .ghost()
        .small()
        .h(px(32.))
        .label("Open Folder…")
        .on_click(cx.listener(|this, _, window, cx| this.open_folder(window, cx)))
}

impl Workspace {
    fn title_bar(
        &self,
        sidebar_width: Option<Pixels>,
        palette: Palette,
        window: &Window,
        cx: &mut Context<Self>,
    ) -> TitleBar {
        let title = if self.has_active_document {
            self.document_name().into_owned()
        } else {
            APP_NAME.into()
        };
        let dirty = self.has_active_document && self.dirty(cx);
        let metric_button = self.has_active_document.then(|| {
            let markdown = self.editor.read(cx).markdown();
            let metrics = inkpoint_editor_core::calculate_document_metrics(markdown);
            let label = match self.metric_kind {
                DocumentMetricKind::Words => format!("{} 词", metrics.words),
                DocumentMetricKind::Lines => format!("{} 行", metrics.lines),
                DocumentMetricKind::Characters => format!("{} 字符", metrics.characters),
            };
            Button::new("document-metric")
                .custom(
                    ButtonCustomVariant::new(cx)
                        .foreground(palette.muted)
                        .hover(palette.hover)
                        .active(palette.active),
                )
                .small()
                .h(px(24.))
                .rounded(px(6.))
                .px_2()
                .text_size(px(12.))
                .label(label)
                .tooltip("点击切换统计维度（词数 / 行数 / 字符数）")
                .on_click(cx.listener(|this, _, _, cx| {
                    this.metric_kind = match this.metric_kind {
                        DocumentMetricKind::Words => DocumentMetricKind::Lines,
                        DocumentMetricKind::Lines => DocumentMetricKind::Characters,
                        DocumentMetricKind::Characters => DocumentMetricKind::Words,
                    };
                    cx.notify();
                }))
        });
        let controls_width = if self.has_active_document {
            px(180.)
        } else {
            px(88.)
        };
        let sidebar_toggle = icon_button(
            "sidebar-toggle",
            if self.sidebar_visible {
                IconName::PanelLeftClose
            } else {
                IconName::PanelLeftOpen
            },
            if self.sidebar_visible {
                "Hide sidebar"
            } else {
                "Show sidebar"
            },
            palette,
            cx,
        )
        .on_click(cx.listener(|this, _, _, cx| {
            this.sidebar_visible = !this.sidebar_visible;
            cx.notify();
        }));
        let mode = (self.has_active_document && !self.sidebar_visible)
            .then(|| self.mode_button(palette, cx));
        let settings = (!self.sidebar_visible).then(|| Self::settings_button(palette, cx));

        TitleBar::new()
            .h(TITLE_BAR_HEIGHT)
            .pl_0()
            .bg(if self.sidebar_visible {
                palette.sidebar
            } else {
                palette.surface
            })
            .border_color(palette.border)
            .on_close_window(cx.listener(|this, _, window, cx| {
                this.file_action(FileAction::Close, window, cx);
            }))
            .child(
                div()
                    .flex()
                    .size_full()
                    .when_some(sidebar_width, |bar, width| {
                        // Keep the divider aligned with the sidebar even with the kit's fullscreen inset.
                        let fullscreen_inset = if window.is_fullscreen() {
                            window.rem_size() * 0.75
                        } else {
                            px(0.)
                        };
                        bar.child(
                            div()
                                .w(width - fullscreen_inset)
                                .h_full()
                                .flex_shrink_0()
                                .border_r_1()
                                .border_color(palette.border)
                                .bg(palette.sidebar),
                        )
                    })
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .items_center()
                            .bg(palette.surface)
                            .gap_2()
                            .px_2()
                            .child(div().w(controls_width).flex_shrink_0())
                            .child(
                                div()
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .justify_center()
                                    .items_center()
                                    .gap_2()
                                    .text_size(px(13.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(palette.text)
                                    .when(self.has_active_document, |title| {
                                        title.child(
                                            Icon::new(IconName::FileText)
                                                .size(px(14.))
                                                .text_color(palette.muted),
                                        )
                                    })
                                    .child(div().truncate().child(title))
                                    .when(dirty, |title| {
                                        title.child(div().text_color(palette.muted).child("*"))
                                    }),
                            )
                            .child(
                                div()
                                    .w(controls_width)
                                    .flex_shrink_0()
                                    .flex()
                                    .items_center()
                                    .justify_end()
                                    .gap_1()
                                    .children(metric_button)
                                    .children(mode)
                                    .children(settings)
                                    .child(sidebar_toggle),
                            ),
                    ),
            )
    }

    fn settings_button(palette: Palette, cx: &App) -> Button {
        icon_button(
            "open-settings",
            IconName::Settings,
            "Settings…",
            palette,
            cx,
        )
        .on_click(|_, _, cx| crate::settings::open(cx))
    }

    fn mode_button(&self, palette: Palette, cx: &mut Context<Self>) -> Button {
        let source_mode = self.editor.read(cx).source_mode();
        let (icon, label, mode) = if source_mode {
            (
                IconName::FileCode,
                "Switch to Rendered Markdown",
                "Markdown Source",
            )
        } else {
            (IconName::BookOpen, "Switch to Markdown Source", "Typeset")
        };

        let button = icon_button("editor-mode-toggle", icon, label, palette, cx).on_click(
            cx.listener(|this, _, window, cx| {
                this.editor.update(cx, |editor, cx| {
                    editor.toggle_source_mode(cx);
                    editor.focus(window, cx);
                });
            }),
        );
        if self.sidebar_visible {
            // The expanded sidebar has room to display the current mode.
            button.w_auto().px_2().label(mode)
        } else {
            button
        }
    }

    fn sidebar(&mut self, width: Pixels, palette: Palette, cx: &mut Context<Self>) -> AnyElement {
        let files = self.sidebar_tab == SidebarTab::Files;
        let (title, icon, switch_to) = if files {
            ("Files", IconName::Folder, "Show document outline")
        } else {
            ("Outline", IconName::Menu, "Show files")
        };
        let switch_tab = icon_button("sidebar-tab", icon, switch_to, palette, cx).on_click(
            cx.listener(move |this, _, _, cx| {
                this.sidebar_tab = if files {
                    SidebarTab::Outline
                } else {
                    SidebarTab::Files
                };
                cx.notify();
            }),
        );
        let open_folder = icon_button(
            "sidebar-open-folder",
            IconName::FolderOpen,
            "Open Folder…",
            palette,
            cx,
        )
        .disabled(self.file_busy)
        .on_click(cx.listener(|this, _, window, cx| this.open_folder(window, cx)));
        let content = if !files {
            self.outline_rows(palette, cx).into_any_element()
        } else if self.folder_loaded {
            self.folder_tree(palette, cx).into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .items_start()
                .gap_2()
                .px_4()
                .py_4()
                .text_size(px(13.))
                .text_color(palette.muted)
                .child("No folder is open")
                .child(
                    open_folder_button("open-folder", cx)
                        .secondary()
                        .icon(IconName::FolderOpen)
                        .disabled(self.file_busy),
                )
                .into_any_element()
        };
        let mode = self
            .has_active_document
            .then(|| self.mode_button(palette, cx));

        div()
            .w(width)
            .h_full()
            .flex()
            .flex_col()
            .flex_shrink_0()
            .border_r_1()
            .border_color(palette.border)
            .bg(palette.sidebar)
            .child(
                div()
                    .h(px(40.))
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .gap_2()
                    .border_b_1()
                    .border_color(palette.border)
                    .px_2()
                    .child(switch_tab)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .truncate()
                            .text_center()
                            .text_size(px(13.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    )
                    .child(if files {
                        open_folder.into_any_element()
                    } else {
                        div().w(px(28.)).into_any_element()
                    }),
            )
            .child(div().flex_1().min_h_0().child(content))
            .child(
                div()
                    .h(SIDEBAR_FOOTER_HEIGHT)
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_t_1()
                    .border_color(palette.border)
                    .px_2()
                    .child(div().children(mode))
                    .child(Self::settings_button(palette, cx)),
            )
            .into_any_element()
    }

    fn folder_tree(&self, palette: Palette, cx: &mut Context<Self>) -> impl IntoElement {
        let owner = cx.weak_entity();
        let active_path = self.document.path.clone();
        tree(&self.folder, move |index, entry, _, _, _| {
            let item = entry.item();
            let is_folder = entry.is_folder() || entry.is_root();
            let is_current = active_path
                .as_ref()
                .is_some_and(|path| path.to_string_lossy() == item.id.as_ref());
            let icon = if is_folder {
                if entry.is_expanded() {
                    IconName::FolderOpen
                } else {
                    IconName::Folder
                }
            } else {
                IconName::FileText
            };
            let row = ListItem::new(index)
                .h(px(28.))
                .rounded_md()
                .pl(px(4. + entry.depth() as f32 * 14.))
                .pr_2()
                .when(is_current, |row| row.bg(palette.active))
                .accessibility_label(item.label.clone())
                .child(
                    div()
                        .flex()
                        .min_w_0()
                        .items_center()
                        .gap_1p5()
                        .child(
                            div()
                                .w(px(12.))
                                .flex_shrink_0()
                                .when(is_folder, |indicator| {
                                    indicator.child(
                                        Icon::new(if entry.is_expanded() {
                                            IconName::ChevronDown
                                        } else {
                                            IconName::ChevronRight
                                        })
                                        .size(px(12.))
                                        .text_color(palette.muted),
                                    )
                                }),
                        )
                        .child(Icon::new(icon).size(px(15.)).text_color(palette.muted))
                        .child(
                            div()
                                .truncate()
                                .text_size(px(13.))
                                .when(is_current || entry.is_root(), |label| {
                                    label.font_weight(FontWeight::MEDIUM)
                                })
                                .child(item.label.clone()),
                        ),
                );
            if is_folder {
                return row;
            }
            let id = item.id.clone();
            let owner = owner.clone();
            row.on_click(move |_, window, cx| {
                if let Some(workspace) = owner.upgrade() {
                    workspace.update(cx, |this, cx| {
                        if let Some(path) = this.folder_files.get(&id).cloned()
                            && this.document.path.as_ref() != Some(&path)
                        {
                            this.open_path(path, window, cx);
                        }
                    });
                }
            })
        })
        .p_2()
    }

    fn welcome(&self, palette: Palette, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .px_6()
            .pb_8()
            .child(
                div()
                    .w_full()
                    .max_w(px(620.))
                    .flex()
                    .flex_col()
                    .items_start()
                    .child(img(WELCOME_LOGO.clone()).size(px(40.)).rounded(px(10.)))
                    .child(
                        div()
                            .mt_5()
                            .text_size(px(13.))
                            .text_color(palette.muted)
                            .child("A local-first Markdown editor"),
                    )
                    .child(
                        div()
                            .mt_1()
                            .text_size(px(28.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Start with a document"),
                    )
                    .child(
                        div()
                            .mt_5()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .gap_2()
                            .child(
                                Button::new("new-document")
                                    .primary()
                                    .bg(palette.primary_fill)
                                    .small()
                                    .h(px(32.))
                                    .rounded(px(6.))
                                    .label("New Document")
                                    .disabled(self.file_busy)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.file_action(FileAction::New, window, cx);
                                    })),
                            )
                            .child(
                                Button::new("open-document")
                                    .ghost()
                                    .small()
                                    .h(px(32.))
                                    .label("Open File…")
                                    .disabled(self.file_busy)
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.file_action(FileAction::Open, window, cx);
                                    })),
                            )
                            .child(
                                open_folder_button("welcome-open-folder", cx)
                                    .disabled(self.file_busy),
                            ),
                    ),
            )
    }

    fn outline_rows(&mut self, palette: Palette, cx: &mut Context<Self>) -> impl IntoElement {
        let editor = self.editor.read(cx);
        let revision = editor.revision();
        if self
            .outline
            .as_ref()
            .is_none_or(|(cached, _)| *cached != revision)
        {
            let document = MarkdownDocument::new(editor.markdown());
            let mut entries = Vec::new();
            if let Ok(blocks) = document.blocks() {
                let mut line_start = 0;
                let mut line = 1;
                collect_headings(
                    document.source(),
                    blocks,
                    &mut line_start,
                    &mut line,
                    &mut entries,
                );
            }
            self.outline = Some((revision, entries));
        }
        let entries = self
            .outline
            .as_ref()
            .map(|(_, entries)| entries.as_slice())
            .unwrap_or_default();
        div()
            .id("document-outline")
            .h_full()
            .overflow_y_scroll()
            .p_2()
            .when(entries.is_empty(), |this| {
                this.child(
                    div()
                        .px_2()
                        .py_3()
                        .text_size(px(13.))
                        .text_color(palette.muted)
                        .child("No headings in this document."),
                )
            })
            .children(entries.iter().enumerate().map(|(index, entry)| {
                let line = entry.line;
                ListItem::new(index)
                    .rounded_md()
                    .h(px(28.))
                    .pl(px(8. + f32::from(entry.level.saturating_sub(1)) * 12.))
                    .accessibility_label(entry.title.clone())
                    .child(div().truncate().text_sm().child(entry.title.clone()))
                    .on_click(cx.listener(move |this, _, _window, cx| {
                        this.editor
                            .update(cx, |editor, cx| editor.seek_line(line, cx));
                    }))
            }))
    }

    fn draft_recovery_banner(
        &self,
        palette: Palette,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let draft = self.pending_draft.as_ref()?;
        let time_str = {
            let secs = draft.last_modified_at / 1000;
            let mins = (secs / 60) % 60;
            let hours = (secs / 3600) % 24;
            format!("{hours:02}:{mins:02}")
        };
        let message = format!("检测到该文档存在上次未保存的本地草稿（记录于 {time_str}）。");
        let is_dark = gpui_kit::component::theme::Theme::global(cx).is_dark();
        let (banner_bg, banner_border) = if is_dark {
            (rgb(0x2d1f04), rgb(0x523405))
        } else {
            (rgb(0xfef3c7), rgb(0xfcd34d))
        };

        Some(
            div()
                .id("draft-recovery-banner")
                .flex()
                .items_center()
                .justify_between()
                .px_4()
                .py_2()
                .text_xs()
                .bg(banner_bg)
                .border_b_1()
                .border_color(banner_border)
                .text_color(palette.text)
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            Icon::new(IconName::FileText)
                                .size(px(14.))
                                .text_color(rgb(0xf59e0b)),
                        )
                        .child(message),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            Button::new("preview-draft")
                                .ghost()
                                .small()
                                .label("查看草稿预览")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.draft_preview_open = true;
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("discard-draft")
                                .ghost()
                                .small()
                                .label("放弃草稿")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.discard_pending_draft(cx);
                                })),
                        )
                        .child(
                            Button::new("restore-draft")
                                .primary()
                                .small()
                                .label("恢复草稿")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.restore_pending_draft(window, cx);
                                })),
                        ),
                )
                .into_any_element(),
        )
    }

    fn draft_preview_modal(&self, palette: Palette, cx: &mut Context<Self>) -> Option<AnyElement> {
        if !self.draft_preview_open {
            return None;
        }
        let draft = self.pending_draft.as_ref()?;
        let draft_content = draft.draft_content.clone();

        Some(
            div()
                .id("draft-preview-modal-backdrop")
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .bg(gpui::black().opacity(0.4))
                .child(
                    div()
                        .id("draft-preview-modal")
                        .w(px(640.))
                        .max_h(px(520.))
                        .flex()
                        .flex_col()
                        .rounded_xl()
                        .border_1()
                        .border_color(palette.border)
                        .bg(palette.surface)
                        .shadow_lg()
                        .overflow_hidden()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .border_b_1()
                                .border_color(palette.border)
                                .px_4()
                                .py_3()
                                .child(
                                    div()
                                        .text_sm()
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(palette.text)
                                        .child("未保存草稿预览"),
                                )
                                .child(
                                    Button::new("close-draft-preview-x")
                                        .ghost()
                                        .small()
                                        .label("✕")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.draft_preview_open = false;
                                            cx.notify();
                                        })),
                                ),
                        )
                        .child(
                            div()
                                .id("draft-preview-content")
                                .flex_1()
                                .min_h(px(200.))
                                .max_h(px(380.))
                                .overflow_y_scroll()
                                .p_4()
                                .font_family("monospace")
                                .text_xs()
                                .text_color(palette.text)
                                .bg(palette.sidebar)
                                .child(draft_content),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .justify_end()
                                .gap_2()
                                .border_t_1()
                                .border_color(palette.border)
                                .px_4()
                                .py_3()
                                .child(
                                    Button::new("close-draft-preview")
                                        .ghost()
                                        .small()
                                        .label("关闭")
                                        .on_click(cx.listener(|this, _, _, cx| {
                                            this.draft_preview_open = false;
                                            cx.notify();
                                        })),
                                )
                                .child(
                                    Button::new("restore-draft-modal")
                                        .primary()
                                        .small()
                                        .label("恢复此草稿")
                                        .on_click(cx.listener(|this, _, window, cx| {
                                            this.restore_pending_draft(window, cx);
                                        })),
                                ),
                        ),
                )
                .into_any_element(),
        )
    }
}

fn collect_headings(
    source: &str,
    blocks: Vec<SourceBlock>,
    line_start: &mut usize,
    line: &mut usize,
    entries: &mut Vec<OutlineEntry>,
) {
    for block in blocks {
        if let BlockKind::Heading { level } = block.kind
            && let Some(title) = source.get(block.content_range)
        {
            let start = block.range.start;
            *line += source.as_bytes()[*line_start..start]
                .iter()
                .filter(|&&byte| byte == b'\n')
                .count();
            *line_start = start;
            entries.push(OutlineEntry {
                line: *line,
                level,
                title: title.trim().to_owned(),
            });
        }
        collect_headings(source, block.children, line_start, line, entries);
    }
}

impl Render for Workspace {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = Palette::for_app(cx);
        let sidebar_width = self.sidebar_visible.then(|| {
            let width = window.viewport_size().width.as_f32() * 0.32;
            px(width.clamp(200., 272.))
        });
        let title_bar = self.title_bar(sidebar_width, palette, window, cx);
        let sidebar = sidebar_width.map(|width| self.sidebar(width, palette, cx));
        let banner = self.draft_recovery_banner(palette, cx);
        let preview_modal = self.draft_preview_modal(palette, cx);
        let content = if self.has_active_document {
            div()
                .flex()
                .flex_col()
                .size_full()
                .children(banner)
                .child(self.editor.clone().into_any_element())
                .into_any_element()
        } else {
            // The native child view is only mounted once a document is ready to edit.
            self.welcome(palette, cx).into_any_element()
        };

        let suggestion = self.suggestion.as_ref().map(|suggestion| {
            div()
                .id("suggestion")
                .flex()
                .flex_col()
                .gap_2()
                .px_4()
                .py_3()
                .max_h(px(200.))
                .overflow_y_scroll()
                .border_t_1()
                .border_color(palette.border)
                .child(suggestion.text.clone())
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(Button::new("accept").small().label("Insert").on_click(
                            cx.listener(|this, _, window, cx| this.accept_completion(window, cx)),
                        ))
                        .child(Button::new("dismiss").small().label("Dismiss").on_click(
                            cx.listener(|this, _, _, cx| {
                                this.suggestion = None;
                                this.message("Suggestion dismissed", cx);
                            }),
                        )),
                )
        });

        div()
            .key_context("Inkpoint")
            .track_focus(&self.welcome_focus)
            .size_full()
            .flex()
            .flex_col()
            .bg(palette.surface)
            .text_color(palette.text)
            .on_action(cx.listener(|this, _: &NewDocument, window, cx| {
                this.file_action(FileAction::New, window, cx)
            }))
            .on_action(cx.listener(|this, _: &OpenDocument, window, cx| {
                this.file_action(FileAction::Open, window, cx)
            }))
            .on_action(cx.listener(|this, _: &OpenFolder, window, cx| this.open_folder(window, cx)))
            .on_action(
                cx.listener(|this, _: &SaveDocument, window, cx| {
                    this.save(false, None, window, cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &SaveAs, window, cx| this.save(true, None, window, cx)),
            )
            .on_action(cx.listener(|this, _: &CloseDocument, window, cx| {
                this.file_action(FileAction::Close, window, cx)
            }))
            .on_action(cx.listener(|this, _: &ContinueWithLocalAi, window, cx| {
                this.request_completion(window, cx)
            }))
            .on_action(cx.listener(|this, command: &HostCommand, window, cx| {
                if *command == HostCommand::ToggleOutline {
                    this.show_outline(cx);
                } else if this.has_active_document
                    && let Some(mapped) = host_command(*command)
                {
                    this.editor
                        .update(cx, |editor, cx| editor.execute_command(mapped, window, cx));
                    // A rejected command used to fail silently: the menu click did
                    // nothing and the user had no way to know why.
                    let error = this.editor.read(cx).last_error().map(ToString::to_string);
                    if let Some(error) = error {
                        this.message(error, cx);
                    }
                }
            }))
            .child(title_bar)
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .children(sidebar)
                    .child(div().flex_1().min_w_0().h_full().child(content)),
            )
            .children(suggestion)
            .children(preview_modal)
            .when(
                !matches!(self.status.as_ref(), "Ready" | "Saved" | "Opened folder"),
                |this| {
                    this.child(
                        div()
                            .px_4()
                            .py_1()
                            .border_t_1()
                            .border_color(palette.border)
                            .text_xs()
                            .text_color(palette.muted)
                            .child(self.status.clone()),
                    )
                },
            )
    }
}

/// Maps formatting actions from the menu to editor commands.
fn host_command(command: HostCommand) -> Option<inkpoint_editor_core::session::EditorCommand> {
    use inkpoint_editor_core::session::EditorCommand as Typeset;
    match command {
        HostCommand::FormatInline(format) => Some(match format {
            InlineFormat::Bold => Typeset::ToggleBold,
            InlineFormat::Italic => Typeset::ToggleItalic,
            InlineFormat::Strikethrough => Typeset::ToggleStrikethrough,
            InlineFormat::Code => Typeset::ToggleInlineCode,
        }),
        HostCommand::FormatBlock(format) => Some(match format {
            BlockFormat::Heading(level) => Typeset::Heading(level),
            BlockFormat::Quote => Typeset::ToggleQuote,
            BlockFormat::UnorderedList => Typeset::ToggleBulletList,
            BlockFormat::OrderedList => Typeset::ToggleOrderedList,
            BlockFormat::TaskList => Typeset::ToggleTaskList,
        }),
        HostCommand::ToggleOutline => None,
    }
}
