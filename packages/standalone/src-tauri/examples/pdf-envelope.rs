// The native export probe uses the product parser, envelope and point dimensions.
#[allow(dead_code)]
#[path = "../src/pdf.rs"]
mod pdf;

fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("Usage: pdf-envelope <svg-path> <width-css-px> <height-css-px>".into());
    }
    let svg = std::fs::read_to_string(&args[0]).map_err(|e| e.to_string())?;
    let dimension = |value: &str| value.parse::<f64>().map_err(|e| e.to_string());
    let prepared = pdf::prepare(&svg, dimension(&args[1])?, dimension(&args[2])?)?;
    println!(
        "{}",
        serde_json::json!({ "html": prepared.html, "width": prepared.width, "height": prepared.height })
    );
    Ok(())
}
