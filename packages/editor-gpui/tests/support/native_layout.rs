use std::{cell::RefCell, collections::HashMap, rc::Rc};

use gpui_kit::base::text::editor_host::{LeafGeometry, RenderContext, collect_leaf_geometry};
use gpui_kit::prelude::*;
use gpui_kit::{
    AnyElement, App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, IntoElement,
    LayoutId, Pixels, Window, div, px,
};
use inkpoint_editor_typeset::{LeafIndex, TypesetDocument};

use super::{NativeDocumentInput, NativeLayoutConfig, NativeLayoutState, render_document};

struct GeometryProbe {
    element: AnyElement,
    leaves: Rc<RefCell<HashMap<u64, LeafGeometry>>>,
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
        let (_, leaves) = collect_leaf_geometry(HashMap::new(), || {
            self.element.prepaint(window, cx);
        });
        *self.leaves.borrow_mut() = leaves;
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

struct NativeDocument {
    document: TypesetDocument,
    layout: NativeLayoutState,
    width: f32,
    leaves: Rc<RefCell<HashMap<u64, LeafGeometry>>>,
}

impl Render for NativeDocument {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let content = render_document(
            &mut self.layout,
            NativeDocumentInput {
                blocks: self.document.blocks(),
                block_ranges: self.document.block_ranges(),
                source: self.document.source(),
                revision: 0,
                reveal: None,
            },
            RenderContext::from_app(cx),
            NativeLayoutConfig::default(),
        );
        GeometryProbe {
            element: div().w(px(self.width)).child(content).into_any_element(),
            leaves: self.leaves.clone(),
        }
    }
}

fn leaf_containing(document: &TypesetDocument, needle: &str) -> u64 {
    document
        .leaf_spans()
        .iter()
        .find(|leaf| {
            leaf.span()
                .and_then(|span| document.source().get(span))
                .is_some_and(|source| source.contains(needle))
        })
        .unwrap_or_else(|| panic!("no leaf contains {needle:?}"))
        .key()
}

fn draw(
    cx: &mut gpui_kit::TestAppContext,
    source: &str,
    width: f32,
) -> (TypesetDocument, LeafIndex) {
    let document = TypesetDocument::parse(source).expect("Markdown should parse");
    let leaves = Rc::new(RefCell::new(HashMap::new()));
    let (_, visual) = cx.add_window_view({
        let document = TypesetDocument::parse(source).expect("Markdown should parse");
        let leaves = leaves.clone();
        move |_, _| NativeDocument {
            document,
            layout: NativeLayoutState::new(NativeLayoutConfig::default()),
            width,
            leaves,
        }
    });
    visual.update(|window, cx| {
        window.draw(cx).clear(cx);
    });
    visual.run_until_parked();
    (document, LeafIndex::new(leaves.borrow().clone()))
}

#[gpui_kit::test]
fn centered_page_reflows_text_and_preserves_wide_code_geometry(cx: &mut gpui_kit::TestAppContext) {
    cx.update(gpui_kit::init);
    let paragraph = "A long paragraph keeps enough words to wrap several times when the editing measure is narrow, while retaining one keyed text leaf for every position the user can select and navigate through. This continuation adds enough material to ensure the wide and narrow layouts have visibly different heights.";
    let code = format!(
        "const extremely_long_identifier_for_horizontal_overflow = '{}';",
        "long_identifier_and_value_".repeat(36)
    );
    let table_value =
        "long_table_cell_value_that_keeps_its_natural_width_under_the_native_horizontal_scroller";
    let source = format!(
        "{paragraph}\n\n```js\n{code}\n```\n\n| name | value |\n| --- | --- |\n| row | {table_value} |\n"
    );
    let (narrow_document, narrow) = draw(cx, &source, 320.);
    let (wide_document, wide) = draw(cx, &source, 800.);
    let paragraph_key = leaf_containing(&narrow_document, "A long paragraph");
    let code_key = leaf_containing(&narrow_document, "extremely_long_identifier");
    let table_key = leaf_containing(&narrow_document, "long_table_cell_value");
    let narrow_paragraph = narrow
        .get(paragraph_key)
        .expect("narrow paragraph geometry");
    let wide_paragraph = wide
        .get(leaf_containing(&wide_document, "A long paragraph"))
        .expect("wide paragraph geometry");
    let code_geometry = narrow.get(code_key).expect("code geometry");
    let table_geometry = narrow.get(table_key).expect("table cell geometry");

    assert!(
        narrow_paragraph.bounds().size.height > wide_paragraph.bounds().size.height,
        "narrow prose should wrap to more lines"
    );
    assert!(
        wide_paragraph.bounds().origin.x.as_f32() > narrow_paragraph.bounds().origin.x.as_f32(),
        "wide windows should center the readable page inside the available measure"
    );
    let code_end = code_geometry.position_for_index(code_geometry.len()).x;
    assert!(
        (code_end - code_geometry.bounds().origin.x).as_f32() > 720.,
        "long nowrap code should retain its natural caret extent beyond the page, got {:?}",
        code_end - code_geometry.bounds().origin.x
    );
    assert!(
        table_geometry.bounds().size.width.as_f32() > 280.,
        "nowrap table cells should retain their natural width inside the table scroller"
    );
    assert!(
        (narrow_paragraph.line_height().as_f32() - 28.05).abs() < 1.0,
        "17pt body text should use a 1.65 line-height: {:?}",
        narrow_paragraph.line_height()
    );
}

#[gpui_kit::test]
fn page_configuration_keeps_the_desktop_reading_measure(cx: &mut gpui_kit::TestAppContext) {
    cx.update(gpui_kit::init);
    let config = NativeLayoutConfig::default();
    assert_eq!(config.page_width, 720.0);
    assert_eq!(config.narrow_margin, 20.0);
    assert_eq!(config.body_font_size, 17.0);
    assert_eq!(config.line_height, 1.65);
}
