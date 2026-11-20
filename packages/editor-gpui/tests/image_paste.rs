use std::{cell::RefCell, rc::Rc};

use gpui_kit::{
    ClipboardEntry, ClipboardItem, ClipboardString, EntityInputHandler, Image, ImageFormat,
    OperatingSystem, TestAppContext,
};
use inkpoint_editor_gpui::{ImagePaste, TypesetView};

#[gpui_kit::test]
fn image_paste_obeys_host_capability_and_editing_state(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    cx.update(TypesetView::bind_keys);
    let (view, vcx) = cx.add_window_view(|window, cx| TypesetView::new(window, cx, "abc"));
    for _ in 0..2 {
        vcx.update(|window, cx| {
            view.update(cx, |view, cx| view.focus(window, cx));
            window.draw(cx).clear(cx);
        });
        vcx.run_until_parked();
    }
    let events = Rc::new(RefCell::new(Vec::new()));
    let captured = events.clone();
    let (subscription, paste_key) = vcx.update(|_, cx| {
        let subscription = cx.subscribe(&view, move |_, event: &ImagePaste, _| {
            captured.borrow_mut().push(event.clone())
        });
        let key = if cx.platform_info().os == OperatingSystem::Mac {
            "cmd-v"
        } else {
            "ctrl-v"
        };
        (subscription, key)
    });
    let _subscription = subscription;
    vcx.run_until_parked();
    let image = Image::from_bytes(ImageFormat::Png, vec![1, 2, 3]);
    let mixed = ClipboardItem {
        entries: vec![
            ClipboardEntry::Image(image.clone()),
            ClipboardEntry::String(ClipboardString::new("X".into())),
        ],
    };
    // Hosts without image storage retain the text fallback for mixed content.
    vcx.update(|_, cx| {
        cx.write_to_clipboard(mixed.clone());
        view.update(cx, |view, cx| view.set_caret(2, cx));
    });
    vcx.simulate_keystrokes(paste_key);
    assert!(events.borrow().is_empty());
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_string()),
        "abXc"
    );
    vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.set_image_paste_enabled(true);
            view.set_caret(2, cx);
        })
    });
    vcx.simulate_keystrokes(paste_key);
    assert_eq!(events.borrow().len(), 1);
    assert_eq!(events.borrow()[0].target.selection, 2..2);
    assert_eq!(events.borrow()[0].image, image);
    let target = events.borrow()[0].target.clone();
    vcx.update(|_, cx| {
        view.update(cx, |view, cx| {
            view.set_caret(0, cx);
            assert!(
                view.insert_image_if_unchanged(&target, "./assets/image.png", cx)
                    .is_err()
            );
            view.set_caret(2, cx);
        });
    });
    assert_eq!(
        view.read_with(&*vcx, |view, _| view.markdown().to_string()),
        "abXc"
    );
    vcx.update(|_, cx| view.update(cx, |view, cx| view.set_readonly(true, cx)));
    vcx.simulate_keystrokes(paste_key);
    assert_eq!(events.borrow().len(), 1);
    assert!(view.read_with(&*vcx, |view, _| view.last_error().is_some()));
    vcx.update(|window, cx| {
        view.update(cx, |view, cx| {
            view.set_readonly(false, cx);
            view.replace_and_mark_text_in_range(None, "z", Some(1..1), window, cx);
        })
    });
    assert!(view.read_with(&*vcx, |view, _| view.composing()));
    vcx.simulate_keystrokes(paste_key);
    assert_eq!(events.borrow().len(), 1);
    assert!(view.read_with(&*vcx, |view, _| {
        view.last_error().unwrap().contains("composition")
    }));
}
