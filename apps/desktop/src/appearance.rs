use gpui_kit::{App, Hsla, rgb};

#[derive(Clone, Copy)]
pub(crate) struct Palette {
    pub(crate) surface: Hsla,
    pub(crate) sidebar: Hsla,
    pub(crate) text: Hsla,
    pub(crate) muted: Hsla,
    pub(crate) border: Hsla,
    pub(crate) hover: Hsla,
    pub(crate) active: Hsla,
    pub(crate) primary_fill: Hsla,
}

impl Palette {
    pub(crate) fn for_app(cx: &App) -> Self {
        // Match the GitHub and Night themes used by the editor renderer.
        if gpui_kit::component::theme::Theme::global(cx).is_dark() {
            Self {
                surface: rgb(0x14171d).into(),
                sidebar: rgb(0x101318).into(),
                text: rgb(0xd7dae0).into(),
                muted: rgb(0x9aa3ad).into(),
                border: rgb(0x262c35).into(),
                hover: rgb(0x1c222b).into(),
                active: rgb(0x252d38).into(),
                primary_fill: rgb(0x4774ca).into(),
            }
        } else {
            Self {
                surface: rgb(0xffffff).into(),
                sidebar: rgb(0xffffff).into(),
                text: rgb(0x24292f).into(),
                muted: rgb(0x57606a).into(),
                border: rgb(0xd8dee4).into(),
                hover: rgb(0xf3f4f6).into(),
                active: rgb(0xeaeef2).into(),
                primary_fill: rgb(0x0969da).into(),
            }
        }
    }
}
