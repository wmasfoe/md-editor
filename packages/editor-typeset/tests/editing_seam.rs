//! Verifies the editing seam this crate is built on.
//!
//! The question these tests answer: after gpui-kit lays out a Markdown document
//! with real heading sizes, can the host recover, per text leaf, the geometry
//! needed to place a caret and map a click back to a byte index? If it cannot,
//! a native editor on this seam is not viable and the whole approach fails.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use gpui_kit::base::text::editor_host::{LeafGeometry, RenderContext, collect_leaf_geometry};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, IntoElement,
    LayoutId, Pixels, Window, div, px,
};
use inkpoint_editor_typeset::{LeafIndex, TypesetDocument};

/// Runs `collect_leaf_geometry` around a prepaint of `element` and records what
/// each keyed leaf reported.
struct GeometryProbe {
    element: AnyElement,
    out: Rc<RefCell<HashMap<u64, LeafGeometry>>>,
}

impl IntoElement for GeometryProbe {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for GeometryProbe {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static core::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.element.request_layout(window, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let out = self.out.clone();
        let (_, leaves) = collect_leaf_geometry(HashMap::new(), || {
            self.element.prepaint(window, cx);
        });
        *out.borrow_mut() = leaves;
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        _: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        self.element.paint(window, cx);
    }
}

struct Host {
    document: TypesetDocument,
    out: Rc<RefCell<HashMap<u64, LeafGeometry>>>,
}

impl Render for Host {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        // The probe owns the collection scope, so the document is rendered
        // through `render_blocks`: collection scopes are isolated and nesting
        // one inside another would report nothing to the outer probe.
        let context = RenderContext::from_app(cx);
        let blocks = self.document.render_blocks(px(16.), context, window, cx);
        GeometryProbe {
            element: div().w(px(600.)).child(blocks).into_any_element(),
            out: self.out.clone(),
        }
    }
}

/// Draws `markdown` in a 600px window and returns the leaf index it produced.
fn draw(cx: &mut gpui_kit::TestAppContext, markdown: &str) -> LeafIndex {
    cx.update(gpui_kit::init);
    let document = TypesetDocument::parse(markdown).expect("markdown should parse");
    let out = Rc::new(RefCell::new(HashMap::new()));
    let (_, vcx) = cx.add_window_view({
        let out = out.clone();
        move |_, _| Host { document, out }
    });
    vcx.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    vcx.run_until_parked();
    let leaves = out.borrow().clone();
    LeafIndex::new(leaves)
}

#[gpui_kit::test]
fn a_heading_lays_out_taller_than_body_text(cx: &mut gpui_kit::TestAppContext) {
    let index = draw(cx, "# Heading\n\nBody text.\n");
    assert!(
        index.len() >= 2,
        "expected a heading and a paragraph leaf, got {}",
        index.len()
    );
    let mut heights: Vec<Pixels> = index.leaves().map(|leaf| leaf.line_height()).collect();
    heights.sort_by(|a, b| b.partial_cmp(a).expect("heights are finite"));
    let tallest = heights[0];
    let shortest = *heights.last().expect("at least one height");
    assert!(
        tallest > shortest,
        "a heading must lay out taller than body text: {tallest:?} vs {shortest:?}"
    );
}

#[gpui_kit::test]
fn a_click_inside_a_leaf_maps_to_a_byte_index(cx: &mut gpui_kit::TestAppContext) {
    let index = draw(cx, "# Heading\n\nBody text here.\n");
    let leaf = index
        .leaves()
        .find(|leaf| !leaf.is_empty())
        .expect("a non-empty leaf");
    let bounds = leaf.bounds();
    let inside = gpui_kit::point(
        bounds.origin.x + px(2.),
        bounds.origin.y + bounds.size.height / 2.,
    );
    let hit = leaf.index_for_position(inside);
    assert!(
        hit <= leaf.len(),
        "index {hit} must be within the leaf length {}",
        leaf.len()
    );
    let caret = leaf.caret_for_position(inside);
    assert_eq!(
        caret.index, hit,
        "the caret index must agree with the hit-test index"
    );
}

#[gpui_kit::test]
fn every_leaf_reports_a_positive_line_and_caret_height(cx: &mut gpui_kit::TestAppContext) {
    let index = draw(cx, "# One\n\nTwo\n\n### Three\n\nFour\n");
    assert!(!index.is_empty(), "the document must lay out some leaves");
    for (key, leaf) in index.entries() {
        assert!(
            leaf.line_height() > Pixels::ZERO,
            "leaf {key} reported a non-positive line height"
        );
        assert!(
            leaf.caret_height() > Pixels::ZERO,
            "leaf {key} reported a non-positive caret height"
        );
    }
}

#[gpui_kit::test]
fn a_caret_position_round_trips_through_the_leaf(cx: &mut gpui_kit::TestAppContext) {
    let index = draw(cx, "Body text here.\n");
    let leaf = index
        .leaves()
        .find(|leaf| !leaf.is_empty())
        .expect("a non-empty leaf");
    for offset in [0, 1, 5, leaf.len()] {
        let position = leaf.position_for_index(offset);
        let caret = leaf.caret_for_position(position);
        assert!(
            caret.index <= leaf.len(),
            "round trip produced an out-of-range index {} for leaf length {}",
            caret.index,
            leaf.len()
        );
    }
}

#[gpui_kit::test]
fn chinese_text_lays_out_and_hit_tests(cx: &mut gpui_kit::TestAppContext) {
    let index = draw(cx, "中文段落测试。\n");
    let leaf = index
        .leaves()
        .find(|leaf| !leaf.is_empty())
        .expect("a non-empty CJK leaf");
    let bounds = leaf.bounds();
    let inside = gpui_kit::point(
        bounds.origin.x + px(2.),
        bounds.origin.y + bounds.size.height / 2.,
    );
    let hit = leaf.index_for_position(inside);
    assert!(
        hit <= leaf.len(),
        "CJK hit test produced {hit}, beyond leaf length {}",
        leaf.len()
    );
}
