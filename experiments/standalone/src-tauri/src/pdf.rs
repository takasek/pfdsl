pub fn envelope(svg: &str, width: f64, height: f64) -> Result<String, String> {
    if ![width, height]
        .into_iter()
        .all(|value| value.is_finite() && value > 0.0 && value <= 32768.0)
    {
        return Err("PDF dimensions must be finite CSS pixels between 0 and 32768".into());
    }
    let document = roxmltree::Document::parse_with_options(
        svg,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            ..Default::default()
        },
    )
    .map_err(|e| format!("Invalid SVG document: {e}"))?;
    let root = document.root_element();
    if root.tag_name().name() != "svg"
        || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
    {
        return Err("PDF input must be an SVG document".into());
    }
    // Graphviz's external DTD is parsed without fetching it and omitted from HTML.
    // Keep a static SVG vocabulary so animation/HTML cannot activate resources later.
    let allowed = [
        "svg",
        "g",
        "a",
        "title",
        "desc",
        "text",
        "tspan",
        "path",
        "polygon",
        "polyline",
        "rect",
        "line",
        "circle",
        "ellipse",
        "defs",
        "clipPath",
        "marker",
        "linearGradient",
        "radialGradient",
        "stop",
        "pattern",
        "symbol",
        "use",
    ];
    for node in root.descendants().filter(|node| node.is_element()) {
        if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg")
            || !allowed.contains(&node.tag_name().name())
        {
            return Err(format!(
                "Unsupported element in PDF SVG: {}",
                node.tag_name().name()
            ));
        }
        for attribute in node.attributes() {
            if attribute.name().to_ascii_lowercase().starts_with("on") {
                return Err("Event handlers are not allowed in PDF SVG".into());
            }
            if attribute.name() == "href"
                && node.tag_name().name() != "a"
                && !attribute.value().starts_with('#')
            {
                return Err("External resources are not allowed in PDF SVG".into());
            }
        }
    }
    let content = &svg[root.range()];
    Ok(format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'\"><style>html,body{{margin:0;padding:0;width:{width}px;height:{height}px;background:white;overflow:hidden}}svg{{display:block;width:{width}px;height:{height}px}}</style></head><body>{content}</body></html>"))
}

#[cfg(target_os = "macos")]
pub async fn render(html: String, width: f64, height: f64) -> Result<Vec<u8>, String> {
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        slice,
    };
    type PdfResult = Result<Vec<u8>, String>;
    type Sender = tokio::sync::oneshot::Sender<PdfResult>;
    extern "C" {
        fn pfdsl_create_pdf(
            html: *const c_char,
            width: f64,
            height: f64,
            context: *mut c_void,
            callback: unsafe extern "C" fn(*mut c_void, *const u8, usize, *const c_char),
        );
    }
    unsafe extern "C" fn complete(
        context: *mut c_void,
        bytes: *const u8,
        length: usize,
        error: *const c_char,
    ) {
        // The Objective-C renderer calls exactly once, while the NSData/error are alive.
        let sender = Box::from_raw(context.cast::<Sender>());
        let result = if !error.is_null() {
            Err(CStr::from_ptr(error).to_string_lossy().into_owned())
        } else if bytes.is_null() || length == 0 {
            Err("WebKit returned an empty PDF".into())
        } else {
            Ok(slice::from_raw_parts(bytes, length).to_vec())
        };
        let _ = sender.send(result);
    }
    let html = CString::new(html).map_err(|_| "SVG contains a null byte")?;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    unsafe {
        pfdsl_create_pdf(
            html.as_ptr(),
            width,
            height,
            Box::into_raw(Box::new(sender)).cast(),
            complete,
        );
    }
    receiver
        .await
        .map_err(|_| "Native PDF renderer stopped before completion".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn render(_html: String, _width: f64, _height: f64) -> Result<Vec<u8>, String> {
    Err("Native PDF export is available only on macOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    const SVG: &str = r#"<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg" width="640px" height="480px" viewBox="0 0 640 480"><text x="20" y="30">日本語の成果物</text></svg>"#;

    #[test]
    fn wraps_graphviz_svg_with_full_dimensions_and_cjk() {
        let html = envelope(SVG, 640.0, 480.0).unwrap();
        assert!(html.contains("width:640px;height:480px"));
        assert!(html.contains("日本語の成果物"));
        assert!(html.contains("default-src 'none'"));
        assert!(!html.contains("DOCTYPE svg"));
    }

    #[test]
    fn rejects_invalid_dimensions_and_non_svg_documents() {
        for size in [0.0, -1.0, f64::NAN, f64::INFINITY, 32769.0] {
            assert!(envelope(SVG, size, 100.0).is_err());
            assert!(envelope(SVG, 100.0, size).is_err());
        }
        assert!(envelope("<html>wrong</html>", 100.0, 100.0).is_err());
        assert!(envelope("<svg>", 100.0, 100.0).is_err());
    }

    #[test]
    fn rejects_scripts_events_and_external_resources() {
        for content in [
            "<script>alert(1)</script>",
            "<foreignObject><p>HTML</p></foreignObject>",
            "<text onclick='alert(1)'>bad</text>",
            "<image href='https://example.com/a.png'/>",
            "<style>@import url(https://example.com/a.css)</style>",
        ] {
            assert!(
                envelope(
                    &format!("<svg xmlns='http://www.w3.org/2000/svg'>{content}</svg>"),
                    100.0,
                    100.0
                )
                .is_err(),
                "{content}"
            );
        }
    }
}
