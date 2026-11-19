pub(crate) mod preferences;
mod view;

use self::{
    preferences::{Preferences, ThemeMode},
    view::SettingsView,
};
use gpui_kit::{component::theme, *};
use std::path::PathBuf;

actions!(inkpoint, [OpenSettings]);

struct Settings {
    preferences: Entity<Preferences>,
    path: Option<PathBuf>,
    window: Option<AnyWindowHandle>,
}

impl Global for Settings {}

pub(crate) fn init(cx: &mut App) {
    let path = dirs::data_dir().map(|directory| directory.join("md-editor/settings.json"));
    let initial = path.as_deref().map_or_else(Preferences::default, |path| {
        Preferences::load(path).unwrap_or_else(|error| {
            eprintln!("Could not load settings: {error}");
            Preferences::default()
        })
    });
    apply_theme(initial.theme, cx);
    let preferences = cx.new(|_| initial);
    cx.set_global(Settings {
        preferences,
        path,
        window: None,
    });
    cx.on_action(|_: &OpenSettings, cx| open(cx));
    view::bind_keys(cx);
}

pub(crate) fn current(cx: &App) -> &Entity<Preferences> {
    &cx.global::<Settings>().preferences
}

pub(crate) fn sync_system_theme(window: &mut Window, cx: &mut App) {
    if current(cx).read(cx).theme == ThemeMode::System
        && theme::Theme::global(cx).mode != window.appearance().into()
    {
        theme::Theme::sync_system_appearance(Some(window), cx);
    }
}

pub(crate) fn open(cx: &mut App) {
    // A shortcut can be delivered while GPUI is still dispatching events in this window.
    cx.defer(|cx| {
        let active = cx.global::<Settings>().window;
        if let Some(handle) = active
            && handle
                .update(cx, |_, window, _| window.activate_window())
                .is_ok()
        {
            return;
        }

        let initial = current(cx).read(cx).clone();
        let options = WindowOptions {
            titlebar: Some(TitlebarOptions {
                title: Some("Settings".into()),
                ..Default::default()
            }),
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(840.), px(620.)),
                cx,
            ))),
            window_min_size: Some(size(px(760.), px(520.))),
            ..Default::default()
        };
        match open_window(options, cx, |window, cx| {
            cx.new(|cx| SettingsView::new(initial, save, window, cx))
        }) {
            Ok((window, _)) => cx.global_mut::<Settings>().window = Some(window),
            Err(error) => eprintln!("Could not open settings: {error}"),
        }
    });
}

fn save(draft: Preferences, cx: &mut App) -> Result<(), String> {
    let settings = cx.global::<Settings>();
    let preferences = settings.preferences.clone();
    if preferences.read(cx) == &draft {
        return Ok(());
    }

    let path = settings
        .path
        .as_deref()
        .ok_or("Could not locate the settings folder.")?;
    draft
        .save(path)
        .map_err(|error| format!("Could not save settings. {error}"))?;

    if preferences.read(cx).theme != draft.theme {
        apply_theme(draft.theme, cx);
    }
    preferences.update(cx, |current, cx| {
        *current = draft;
        cx.notify();
    });
    Ok(())
}

fn apply_theme(mode: ThemeMode, cx: &mut App) {
    let appearance = match mode {
        ThemeMode::System => None,
        ThemeMode::Light => Some(WindowAppearance::Light),
        ThemeMode::Dark => Some(WindowAppearance::Dark),
    };
    cx.set_window_appearance(appearance);
    theme::Theme::change(
        appearance.unwrap_or_else(|| cx.window_appearance()),
        None,
        cx,
    );
}
