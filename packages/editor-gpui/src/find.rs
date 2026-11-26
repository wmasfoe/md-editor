//! Document find and replace state and UI, styled with Apple Liquid Glass aesthetics.
use super::*;
use gpui_kit::{
    Subscription,
    base::input::{InputEvent, InputState},
    component::{
        Sizable,
        button::{Button, ButtonVariants},
        input::Input,
    },
};
use inkpoint_editor_core::FindOptions;

actions!(
    inkpoint_find,
    [
        CloseFind,
        FindNext,
        FindPrevious,
        ToggleReplace,
        ReplaceCurrent,
        ReplaceAllMatches,
        ToggleCaseSensitive,
        ToggleWholeWord,
        ToggleRegex,
    ]
);

pub(super) struct FindState {
    pub(super) input: Entity<InputState>,
    pub(super) replace_input: Entity<InputState>,
    _query_subscription: Subscription,
    _replace_subscription: Subscription,
    pub(super) open: bool,
    pub(super) show_replace: bool,
    pub(super) options: FindOptions,
    pub(super) current: Option<Range<usize>>,
    pub(super) matches: Vec<Range<usize>>,
    pub(super) count: usize,
}

impl FindState {
    pub(super) fn new(window: &mut Window, cx: &mut Context<TypesetView>) -> Self {
        let input =
            cx.new(|cx| InputState::new(window, cx).placeholder("在文档中查找... (Enter 下一个)"));
        let replace_input =
            cx.new(|cx| InputState::new(window, cx).placeholder("替换为... (Enter 替换当前)"));

        let query_subscription = cx.subscribe_in(
            &input,
            window,
            |view, input, event: &InputEvent, _, cx| match event {
                InputEvent::Change => {
                    view.find.current = None;
                    let query = input.read(cx).value().to_string();
                    view.find_match(&query, false);
                    cx.notify();
                }
                InputEvent::PressEnter { shift, .. } => {
                    let query = input.read(cx).value().to_string();
                    view.find_match(&query, *shift);
                    cx.notify();
                }
                _ => {}
            },
        );

        let replace_subscription = cx.subscribe_in(
            &replace_input,
            window,
            |view, _, event: &InputEvent, window, cx| {
                if let InputEvent::PressEnter { .. } = event {
                    view.replace_current(window, cx);
                    cx.notify();
                }
            },
        );

        Self {
            input,
            replace_input,
            _query_subscription: query_subscription,
            _replace_subscription: replace_subscription,
            open: false,
            show_replace: false,
            options: FindOptions::default(),
            current: None,
            matches: Vec::new(),
            count: 0,
        }
    }
}

impl TypesetView {
    pub(super) fn open_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.composing() {
            return;
        }
        self.find.open = true;
        let selected = self.editor.selected_text();
        if !selected.is_empty() && !selected.contains('\n') {
            let sel_string = selected.to_string();
            self.find.input.update(cx, |input, cx| {
                input.set_value(sel_string.clone(), window, cx);
                input.select_all(window, cx);
            });
            self.find_match(&sel_string, false);
        }
        self.find
            .input
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    pub(super) fn close_find(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.find.open = false;
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub(super) fn find_match(&mut self, query: &str, backwards: bool) {
        let source = self.editor.source();
        if query.is_empty() {
            self.find.count = 0;
            self.find.matches.clear();
            self.find.current = None;
            return;
        }
        let matches = inkpoint_editor_core::find_matches(source, query, &self.find.options);
        self.find.count = matches.len();
        self.find.matches = matches.clone();
        if matches.is_empty() {
            self.find.current = None;
            return;
        }
        let anchor = self
            .find
            .current
            .as_ref()
            .map(|range| range.start)
            .unwrap_or(self.editor.selection().range().start);
        let index = if backwards {
            matches
                .iter()
                .rposition(|range| range.start < anchor)
                .unwrap_or(matches.len() - 1)
        } else if self.find.current.is_some() {
            matches
                .iter()
                .position(|range| range.start > anchor)
                .unwrap_or(0)
        } else {
            matches
                .iter()
                .position(|range| range.start >= anchor)
                .unwrap_or(0)
        };
        let range = matches[index].clone();
        self.editor.set_selection(range.start, range.end);
        self.find.current = Some(range.clone());
        self.scroll_range_into_view(&range);
    }

    fn scroll_range_into_view(&mut self, range: &Range<usize>) {
        self.scroll_offset_into_view(range.start);
    }

    pub(super) fn replace_current(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(current) = self.find.current.clone() else {
            return;
        };
        let repl = self.find.replace_input.read(cx).value().to_string();
        let result = self.editor.replace_match(current, &repl);
        self.apply(result, cx);
        let query = self.find.input.read(cx).value().to_string();
        self.find_match(&query, false);
    }

    pub(super) fn replace_all(&mut self, cx: &mut Context<Self>) {
        let query = self.find.input.read(cx).value().to_string();
        let repl = self.find.replace_input.read(cx).value().to_string();
        let result = self.editor.replace_all(&query, &repl, &self.find.options);
        match result {
            Ok(_) => {
                self.apply(Ok(()), cx);
                self.find.matches.clear();
                self.find.current = None;
                self.find.count = 0;
            }
            Err(e) => {
                self.apply(Err(e), cx);
            }
        }
    }

    pub(super) fn find_bar(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let query = self.find.input.read(cx).value().to_string();
        let badge_text = if query.is_empty() {
            String::new()
        } else if self.find.matches.is_empty() {
            "无结果".to_string()
        } else {
            let current_idx = self
                .find
                .current
                .as_ref()
                .and_then(|cur| self.find.matches.iter().position(|r| r == cur))
                .map(|i| i + 1)
                .unwrap_or(1);
            format!("{}/{}", current_idx, self.find.matches.len())
        };

        let case_active = self.find.options.case_sensitive;
        let word_active = self.find.options.whole_word;
        let regex_active = self.find.options.regex;

        div()
            .id("typeset-find")
            .key_context("TypesetFind")
            .flex()
            .flex_col()
            .gap_1p5()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(gpui_kit::rgb(0xe2e8f0))
            .bg(gpui_kit::rgba(0xf8fa_fcf0))
            .shadow_sm()
            .on_action(cx.listener(|this, _: &CloseFind, window, cx| {
                this.find.open = false;
                this.focus.focus(window, cx);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &FindNext, _, cx| {
                let query = this.find.input.read(cx).value().to_string();
                this.find_match(&query, false);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &FindPrevious, _, cx| {
                let query = this.find.input.read(cx).value().to_string();
                this.find_match(&query, true);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleReplace, _, cx| {
                this.find.show_replace = !this.find.show_replace;
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleCaseSensitive, _, cx| {
                this.find.options.case_sensitive = !this.find.options.case_sensitive;
                let query = this.find.input.read(cx).value().to_string();
                this.find_match(&query, false);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleWholeWord, _, cx| {
                this.find.options.whole_word = !this.find.options.whole_word;
                let query = this.find.input.read(cx).value().to_string();
                this.find_match(&query, false);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ToggleRegex, _, cx| {
                this.find.options.regex = !this.find.options.regex;
                let query = this.find.input.read(cx).value().to_string();
                this.find_match(&query, false);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ReplaceCurrent, window, cx| {
                this.replace_current(window, cx);
                cx.notify();
            }))
            .on_action(cx.listener(|this, _: &ReplaceAllMatches, _, cx| {
                this.replace_all(cx);
                cx.notify();
            }))
            // Search row
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(Input::new(&self.find.input).w_full())
                    .when(!badge_text.is_empty(), |row| {
                        row.child(
                            div()
                                .px_1p5()
                                .py_0p5()
                                .rounded_sm()
                                .text_xs()
                                .text_color(if self.find.matches.is_empty() {
                                    gpui_kit::rgb(0xef4444)
                                } else {
                                    gpui_kit::rgb(0x64748b)
                                })
                                .child(badge_text),
                        )
                    })
                    .child(
                        Button::new("prev-btn")
                            .small()
                            .ghost()
                            .label("↑")
                            .tooltip("上一个 (Shift+Enter)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                let query = this.find.input.read(cx).value().to_string();
                                this.find_match(&query, true);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("next-btn")
                            .small()
                            .ghost()
                            .label("↓")
                            .tooltip("下一个 (Enter)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                let query = this.find.input.read(cx).value().to_string();
                                this.find_match(&query, false);
                                cx.notify();
                            })),
                    )
                    .child(div().w(px(1.)).h(px(16.)).bg(gpui_kit::rgb(0xcbd5e1)))
                    .child(
                        Button::new("case-btn")
                            .small()
                            .when(case_active, |b| b.primary())
                            .when(!case_active, |b| b.ghost())
                            .label("Aa")
                            .tooltip("区分大小写 (Alt+⌘+C)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.find.options.case_sensitive =
                                    !this.find.options.case_sensitive;
                                let query = this.find.input.read(cx).value().to_string();
                                this.find_match(&query, false);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("word-btn")
                            .small()
                            .when(word_active, |b| b.primary())
                            .when(!word_active, |b| b.ghost())
                            .label("\\b")
                            .tooltip("全词匹配 (Alt+⌘+W)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.find.options.whole_word = !this.find.options.whole_word;
                                let query = this.find.input.read(cx).value().to_string();
                                this.find_match(&query, false);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("regex-btn")
                            .small()
                            .when(regex_active, |b| b.primary())
                            .when(!regex_active, |b| b.ghost())
                            .label(".*")
                            .tooltip("正则表达式 (Alt+⌘+R)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.find.options.regex = !this.find.options.regex;
                                let query = this.find.input.read(cx).value().to_string();
                                this.find_match(&query, false);
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("toggle-replace-btn")
                            .small()
                            .when(self.find.show_replace, |b| b.primary())
                            .when(!self.find.show_replace, |b| b.ghost())
                            .label("⇄")
                            .tooltip("展开/折叠替换 (⌘H)")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.find.show_replace = !this.find.show_replace;
                                cx.notify();
                            })),
                    )
                    .child(
                        Button::new("close-find-btn")
                            .small()
                            .ghost()
                            .label("✕")
                            .tooltip("关闭 (Esc)")
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.find.open = false;
                                this.focus.focus(window, cx);
                                cx.notify();
                            })),
                    ),
            )
            // Replace row
            .when(self.find.show_replace, |panel| {
                panel.child(
                    div()
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(Input::new(&self.find.replace_input).w_full())
                        .child(
                            Button::new("replace-one-btn")
                                .small()
                                .ghost()
                                .label("替换")
                                .tooltip("替换当前 (Enter)")
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.replace_current(window, cx);
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("replace-all-btn")
                                .small()
                                .primary()
                                .label("全部替换")
                                .tooltip("替换所有匹配项")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.replace_all(cx);
                                    cx.notify();
                                })),
                        ),
                )
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui_kit::TestAppContext;

    #[gpui_kit::test]
    fn find_keys_select_chinese_matches_without_editing(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let keys = cx.update(|cx| CommandKeys::for_os(cx.platform_info().os));
        let (view, vcx) = cx.add_window_view(|window, cx| {
            TypesetView::new(window, cx, "中文 first\n\nsecond 中文")
        });
        for _ in 0..2 {
            vcx.update(|window, cx| {
                view.update(cx, |v, cx| {
                    v.focus(window, cx);
                    v.editor.set_caret(0);
                });
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.simulate_keystrokes(&keys.find);
        vcx.simulate_input("中文");
        vcx.run_until_parked();
        assert_eq!(
            view.read_with(vcx, |v, _| v.editor.selection().range()),
            0..6
        );
        vcx.simulate_keystrokes(&keys.bold);
        assert_eq!(
            view.read_with(vcx, |v, _| v.editor.source().to_string()),
            "中文 first\n\nsecond 中文"
        );
        vcx.simulate_keystrokes("enter");
        vcx.run_until_parked();
        assert_eq!(
            view.read_with(vcx, |v, _| v.editor.selection().range()),
            21..27
        );
        vcx.simulate_keystrokes("shift-enter");
        vcx.run_until_parked();
        assert_eq!(
            view.read_with(vcx, |v, _| v.editor.selection().range()),
            0..6
        );
        vcx.simulate_keystrokes("escape");
        assert_eq!(
            view.read_with(vcx, |v, _| v.editor.source().to_string()),
            "中文 first\n\nsecond 中文"
        );
        assert!(!view.read_with(vcx, |v, _| v.find.open));
    }

    #[gpui_kit::test]
    fn find_scrolls_to_offscreen_match_and_handles_absence(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let source = format!("{}目标", "paragraph text\n\n".repeat(80));
        let target = source.find("目标").unwrap();
        let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, &source));
        for _ in 0..3 {
            vcx.update(|window, cx| {
                window.draw(cx).clear(cx);
            });
            vcx.run_until_parked();
        }
        vcx.update(|_, cx| {
            view.update(cx, |view, _| {
                view.find_match("目标", false);
                assert_eq!(
                    view.editor.selection().range(),
                    target..target + "目标".len()
                );
                assert!(view.native_layout.top_item_index() > 0);
                view.find_match("missing", false);
                assert_eq!(view.find.count, 0);
                assert_eq!(
                    view.editor.selection().range(),
                    target..target + "目标".len()
                );
                assert!(!view.editor.undo());
            })
        });
    }

    #[gpui_kit::test]
    fn find_options_and_replacement_work(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        cx.update(TypesetView::bind_keys);
        let (view, vcx) =
            cx.add_window_view(|window, cx| TypesetView::new(window, cx, "Alpha alpha ALPHA"));
        vcx.update(|window, cx| {
            view.update(cx, |v, cx| {
                v.find.options.case_sensitive = true;
                v.find_match("alpha", false);
                assert_eq!(v.find.count, 1);
                assert_eq!(v.editor.selection().range(), 6..11);

                // Replace single
                v.find
                    .replace_input
                    .update(cx, |input, cx| input.set_value("beta", window, cx));
                v.replace_current(window, cx);
                assert_eq!(v.editor.source(), "Alpha beta ALPHA");
                assert!(v.editor.undo());
                assert_eq!(v.editor.source(), "Alpha alpha ALPHA");

                // Replace all case-insensitive
                v.find.options.case_sensitive = false;
                v.find
                    .input
                    .update(cx, |input, cx| input.set_value("alpha", window, cx));
                v.replace_all(cx);
                assert_eq!(v.editor.source(), "beta beta beta");
                assert!(v.editor.undo());
                assert_eq!(v.editor.source(), "Alpha alpha ALPHA");
            });
        });
    }
}
