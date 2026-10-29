//! Look Up, the Mac's dictionary panel, for a word on the page. WebKit's own right-click menu has
//! it, but the page shows its own menu, so the page asks for it here.

use serde::Deserialize;

/// The font of the text on the page, as CSS has it.
#[derive(Deserialize, Debug)]
pub struct Font {
    /// A CSS `font-family` list, such as `"iA Writer Mono S", ui-monospace, monospace`.
    family: String,
    size: f64,
    bold: bool,
    italic: bool,
}

/// Shows the panel for `text`, and draws `text` over the page with its baseline starting at
/// `x`, `y`: CSS pixels from the page's top left.
#[tauri::command]
pub fn look_up<R: tauri::Runtime>(
    webview: tauri::Webview<R>,
    text: String,
    x: f64,
    y: f64,
    font: Font,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let families = font_families(&font.family);
        webview
            .with_webview(move |platform| {
                // SAFETY: on macOS the platform webview is a WKWebView, which is an NSView, and
                // this runs on the main thread while the window is open.
                let view: &objc2_app_kit::NSView = unsafe { &*platform.inner().cast() };
                mac::show(view, &text, x, y, &families, &font);
            })
            .map_err(|e| format!("Look Up failed: {e}"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (webview, text, x, y, font);
        Err("Look Up needs macOS".into())
    }
}

/// The family names in a CSS `font-family` list, in order, without their quotes.
fn font_families(css: &str) -> Vec<String> {
    css.split(',')
        .map(|f| f.trim().trim_matches(|c| c == '"' || c == '\'').to_string())
        .filter(|f| !f.is_empty())
        .collect()
}

/// A point from the page's top left as a point in the view, whose y may count up from the bottom.
fn view_point(x: f64, y: f64, height: f64, flipped: bool) -> (f64, f64) {
    (x, if flipped { y } else { height - y })
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{view_point, Font};
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{
        NSFont, NSFontAttributeName, NSFontDescriptor, NSFontDescriptorSymbolicTraits,
        NSFontWeightRegular, NSView,
    };
    use objc2_foundation::{NSAttributedString, NSDictionary, NSPoint, NSString};

    pub fn show(view: &NSView, text: &str, x: f64, y: f64, families: &[String], font: &Font) {
        let font = font_for(families, font.size, font.bold, font.italic);
        // SAFETY: NSFontAttributeName takes an NSFont.
        let string = unsafe {
            let attributes = NSDictionary::<NSString, AnyObject>::from_slices(
                &[NSFontAttributeName],
                &[font.as_ref()],
            );
            NSAttributedString::new_with_attributes(&NSString::from_str(text), &attributes)
        };
        let (x, y) = view_point(x, y, view.frame().size.height, view.isFlipped());
        view.showDefinitionForAttributedString_atPoint(Some(&string), NSPoint::new(x, y));
    }

    /// The first family in the list that the Mac has, as the page would pick it, or the system font.
    pub fn font_for(families: &[String], size: f64, bold: bool, italic: bool) -> Retained<NSFont> {
        let base = families
            .iter()
            .find_map(|family| descriptor(family, size))
            .unwrap_or_else(|| NSFont::systemFontOfSize(size).fontDescriptor());
        let mut traits = base.symbolicTraits();
        if bold {
            traits |= NSFontDescriptorSymbolicTraits::TraitBold;
        }
        if italic {
            traits |= NSFontDescriptorSymbolicTraits::TraitItalic;
        }
        // AppKit says this never gives nil, but it does for a family without the style, so it's
        // called here in a way that allows nil.
        // SAFETY: the method takes the traits and returns a descriptor or nil.
        let styled: Option<Retained<NSFontDescriptor>> =
            unsafe { msg_send![&*base, fontDescriptorWithSymbolicTraits: traits] };
        styled
            .and_then(|styled| NSFont::fontWithDescriptor_size(&styled, size))
            .or_else(|| NSFont::fontWithDescriptor_size(&base, size))
            .unwrap_or_else(|| NSFont::systemFontOfSize(size))
    }

    fn descriptor(family: &str, size: f64) -> Option<Retained<NSFontDescriptor>> {
        match family {
            // SAFETY: a plain weight constant.
            "ui-monospace" => Some(
                NSFont::monospacedSystemFontOfSize_weight(size, unsafe { NSFontWeightRegular })
                    .fontDescriptor(),
            ),
            "system-ui" | "-apple-system" | "ui-sans-serif" => {
                Some(NSFont::systemFontOfSize(size).fontDescriptor())
            }
            name => {
                // SAFETY: no attributes, which gives an empty descriptor.
                let wanted = unsafe { NSFontDescriptor::fontDescriptorWithFontAttributes(None) }
                    .fontDescriptorWithFamily(&NSString::from_str(name));
                // No font when the Mac doesn't have the family.
                NSFont::fontWithDescriptor_size(&wanted, size).map(|_| wanted)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_css_font_list() {
        assert_eq!(
            font_families(
                r#""iA Writer Mono S", 'JetBrains Mono', ui-monospace, Menlo, monospace"#
            ),
            vec![
                "iA Writer Mono S",
                "JetBrains Mono",
                "ui-monospace",
                "Menlo",
                "monospace"
            ]
        );
        assert_eq!(font_families(""), Vec::<String>::new());
    }

    #[test]
    fn turns_a_page_point_into_a_view_point() {
        assert_eq!(view_point(10.0, 30.0, 800.0, true), (10.0, 30.0));
        assert_eq!(view_point(10.0, 30.0, 800.0, false), (10.0, 770.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn picks_the_first_font_the_mac_has() {
        use objc2_app_kit::NSFont;
        let list = |css: &str| font_families(css);
        let family = |f: &NSFont| f.familyName().unwrap().to_string();

        let menlo = mac::font_for(&list("No Such Font, Menlo, monospace"), 16.0, false, false);
        assert_eq!(family(&menlo), "Menlo");
        assert_eq!(menlo.fontName().to_string(), "Menlo-Regular");
        assert_eq!(menlo.pointSize(), 16.0);

        let bold = mac::font_for(&list("Menlo"), 16.0, true, false);
        assert_eq!(bold.fontName().to_string(), "Menlo-Bold");
        let italic = mac::font_for(&list("Menlo"), 16.0, false, true);
        assert_eq!(italic.fontName().to_string(), "Menlo-Italic");

        let system = NSFont::systemFontOfSize(16.0);
        let fallback = mac::font_for(&list("No Such Font"), 16.0, false, false);
        assert_eq!(family(&fallback), family(&system));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn keeps_a_family_without_the_style() {
        let zapfino = mac::font_for(&font_families("Zapfino"), 16.0, true, true);
        assert_eq!(zapfino.familyName().unwrap().to_string(), "Zapfino");
    }
}
