use crate::appearance::Palette;

use std::rc::Rc;

use gpui_kit::{
    assets::IconName,
    base::input::InputState,
    component::{
        Icon, Selectable, Sizable,
        button::{Button, ButtonVariants},
        input::Input,
    },
    *,
};

use super::{Preferences, ThemeMode};

#[derive(Clone, Copy, PartialEq, Eq)]
enum SettingsTab {
    Editor,
    Appearance,
    Shortcuts,
}

actions!(inkpoint_settings, [CancelSettings]);

pub(super) fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("escape", CancelSettings, Some("Settings")),
        KeyBinding::new("cmd-w", CancelSettings, Some("Settings")),
        KeyBinding::new("ctrl-w", CancelSettings, Some("Settings")),
    ]);
}

type SaveHandler = Rc<dyn Fn(Preferences, &mut App) -> Result<(), String> + 'static>;

pub(super) struct SettingsView {
    focus: FocusHandle,
    draft: Preferences,
    active_tab: SettingsTab,
    prose_font: Entity<InputState>,
    code_font: Entity<InputState>,
    save_handler: SaveHandler,
    error: Option<String>,
    _appearance_observer: Subscription,
}

impl SettingsView {
    pub(super) fn new(
        initial: Preferences,
        on_save: impl Fn(Preferences, &mut App) -> Result<(), String> + 'static,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        let prose_font = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("System font")
                .default_value(initial.editor.prose_font_family.clone())
        });
        let code_font = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("System monospace font")
                .default_value(initial.editor.code_font_family.clone())
        });
        let appearance_observer = window.observe_window_appearance(super::sync_system_theme);
        Self {
            focus,
            draft: initial,
            active_tab: if cfg!(target_os = "macos") {
                SettingsTab::Editor
            } else {
                SettingsTab::Appearance
            },
            prose_font,
            code_font,
            save_handler: Rc::new(on_save),
            error: None,
            _appearance_observer: appearance_observer,
        }
    }

    fn save(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.draft.editor.prose_font_family = self.prose_font.read(cx).value().trim().to_owned();
        self.draft.editor.code_font_family = self.code_font.read(cx).value().trim().to_owned();
        match (self.save_handler)(self.draft.clone(), cx) {
            Ok(()) => window.remove_window(),
            Err(error) => {
                self.error = Some(error);
                cx.notify();
            }
        }
    }

    fn close(&self, window: &mut Window) {
        window.remove_window();
    }

    fn tab_button(
        &self,
        id: &'static str,
        title: &'static str,
        icon: IconName,
        tab: SettingsTab,
        palette: &Palette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let selected = self.active_tab == tab;
        Button::new(id)
            .w_full()
            .h(px(44.))
            .rounded(px(8.))
            .ghost()
            .selected(selected)
            .bg(if selected {
                palette.active
            } else {
                transparent_black()
            })
            .text_color(if selected {
                palette.text
            } else {
                palette.muted
            })
            .accessibility_label(title)
            .child(
                div()
                    .flex_1()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(Icon::new(icon).size(px(16.)))
                    .child(
                        div()
                            .text_size(px(13.))
                            .font_weight(FontWeight::MEDIUM)
                            .child(title),
                    ),
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                this.active_tab = tab;
                this.error = None;
                cx.notify();
            }))
    }

    fn editor_panel(&mut self, palette: &Palette, cx: &mut Context<Self>) -> AnyElement {
        let font_size = self.draft.editor.wysiwyg_font_size;

        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(section_title("Typography", palette))
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(field_title("WYSIWYG font size", "13–22 px", palette))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                Button::new("font-size-down")
                                    .small()
                                    .ghost()
                                    .label("−")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.draft.editor.wysiwyg_font_size = this
                                            .draft
                                            .editor
                                            .wysiwyg_font_size
                                            .saturating_sub(1)
                                            .max(13);
                                        cx.notify();
                                    })),
                            )
                            .child(div().w(px(34.)).text_center().child(format!("{font_size}")))
                            .child(
                                Button::new("font-size-up")
                                    .small()
                                    .ghost()
                                    .label("+")
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.draft.editor.wysiwyg_font_size =
                                            (this.draft.editor.wysiwyg_font_size + 1).min(22);
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(field_title(
                        "Prose font",
                        "Leave blank to use the system font",
                        palette,
                    ))
                    .child(Input::new(&self.prose_font).w_full()),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(field_title(
                        "Code font",
                        "Leave blank to use the system monospace font",
                        palette,
                    ))
                    .child(Input::new(&self.code_font).w_full()),
            )
            .child(section_title("Display", palette))
            .child(field_title(
                "Code block line numbers",
                "Unavailable in this editor",
                palette,
            ))
            .child(field_title(
                "Inline Markdown style markers",
                "Unavailable in this editor",
                palette,
            ))
            .child(field_title(
                "Markdown lint",
                "Unavailable in this editor",
                palette,
            ))
            .text_color(palette.text)
            .into_any_element()
    }

    fn appearance_panel(&self, palette: &Palette, cx: &mut Context<Self>) -> AnyElement {
        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(section_title("Theme", palette))
            .child(div().flex().gap_2().children([
                theme_button("System", ThemeMode::System, self.draft.theme, cx),
                theme_button("Light", ThemeMode::Light, self.draft.theme, cx),
                theme_button("Dark", ThemeMode::Dark, self.draft.theme, cx),
            ]))
            .text_color(palette.text)
            .into_any_element()
    }

    fn shortcuts_panel(&self, palette: &Palette, cx: &App) -> AnyElement {
        let shortcuts = crate::shortcuts::ALL
            .into_iter()
            .map(|shortcut| {
                (
                    shortcut.0,
                    crate::shortcuts::display_key(crate::shortcuts::key(shortcut)),
                )
            })
            .chain(
                inkpoint_editor_gpui::format_shortcuts(cx.platform_info().os)
                    .into_iter()
                    .map(|(format, key)| {
                        let label = match format {
                            inkpoint_editor_gpui::InlineFormat::Bold => "Bold",
                            inkpoint_editor_gpui::InlineFormat::Italic => "Italic",
                            inkpoint_editor_gpui::InlineFormat::Code => "Inline code",
                            inkpoint_editor_gpui::InlineFormat::Strikethrough => "Strikethrough",
                        };
                        (label, crate::shortcuts::display_key(&key))
                    }),
            );
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(section_title("Keyboard Shortcuts", palette))
            .children(shortcuts.map(|(label, shortcut)| {
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .border_b_1()
                    .border_color(palette.border)
                    .py_2()
                    .child(label)
                    .child(
                        div()
                            .rounded_md()
                            .bg(palette.sidebar)
                            .px_2()
                            .py_1()
                            .text_sm()
                            .child(shortcut),
                    )
            }))
            .text_color(palette.text)
            .into_any_element()
    }
}

impl Render for SettingsView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let palette = Palette::for_app(cx);

        let mut page = div()
            .size_full()
            .flex()
            .flex_col()
            .key_context("Settings")
            .track_focus(&self.focus)
            .bg(palette.surface)
            .text_color(palette.text)
            .on_action(cx.listener(|this, _: &CancelSettings, window, _| this.close(window)))
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .child(
                        div()
                            .w(px(190.))
                            .flex_shrink_0()
                            .flex()
                            .flex_col()
                            .gap_1()
                            .border_r_1()
                            .border_color(palette.border)
                            .bg(palette.sidebar)
                            .px_3()
                            .py_4()
                            .children(cfg!(target_os = "macos").then(|| {
                                self.tab_button(
                                    "settings-editor",
                                    "Editor",
                                    IconName::BookOpen,
                                    SettingsTab::Editor,
                                    &palette,
                                    cx,
                                )
                            }))
                            .child(self.tab_button(
                                "settings-appearance",
                                "Appearance",
                                IconName::Palette,
                                SettingsTab::Appearance,
                                &palette,
                                cx,
                            ))
                            .child(self.tab_button(
                                "settings-shortcuts",
                                "Shortcuts",
                                IconName::Asterisk,
                                SettingsTab::Shortcuts,
                                &palette,
                                cx,
                            )),
                    )
                    .child(
                        div()
                            .id("settings-panel")
                            .flex_1()
                            .min_w_0()
                            .overflow_y_scroll()
                            .px_7()
                            .py_5()
                            .child(match self.active_tab {
                                SettingsTab::Editor => self.editor_panel(&palette, cx),
                                SettingsTab::Appearance => self.appearance_panel(&palette, cx),
                                SettingsTab::Shortcuts => self.shortcuts_panel(&palette, cx),
                            }),
                    ),
            );

        if let Some(error) = &self.error {
            page = page.child(
                div()
                    .px_5()
                    .py_2()
                    .text_color(rgb(0xb42318))
                    .child(error.clone()),
            );
        }

        page.child(
            div()
                .h(px(62.))
                .flex_shrink_0()
                .flex()
                .items_center()
                .justify_end()
                .gap_2()
                .border_t_1()
                .border_color(palette.border)
                .bg(palette.sidebar)
                .px_5()
                .child(
                    Button::new("settings-cancel")
                        .label("Cancel")
                        .on_click(cx.listener(|this, _, window, _| this.close(window))),
                )
                .child(
                    Button::new("settings-save")
                        .primary()
                        .bg(palette.primary_fill)
                        .label("Save")
                        .on_click(cx.listener(|this, _, window, cx| this.save(window, cx))),
                ),
        )
    }
}

fn section_title(title: &'static str, palette: &Palette) -> impl IntoElement {
    div()
        .pb_3()
        .border_b_1()
        .border_color(palette.border)
        .text_lg()
        .font_weight(FontWeight::MEDIUM)
        .child(title)
}

fn field_title(
    title: &'static str,
    description: &'static str,
    palette: &Palette,
) -> impl IntoElement {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(div().text_sm().font_weight(FontWeight::MEDIUM).child(title))
        .child(div().text_xs().text_color(palette.muted).child(description))
}

fn theme_button(
    label: &'static str,
    theme: ThemeMode,
    selected: ThemeMode,
    cx: &mut Context<SettingsView>,
) -> AnyElement {
    Button::new(label)
        .selected(theme == selected)
        .label(label)
        .on_click(cx.listener(move |this, _, _, cx| {
            this.draft.theme = theme;
            cx.notify();
        }))
        .into_any_element()
}
