#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <PDFKit/PDFKit.h>
extern void pfdsl_create_pdf(const char *, double, double, void *, void (*)(void *, const unsigned char *, size_t, const char *));

@interface ExportProbe : NSObject <WKNavigationDelegate>
@property WKWebView *view;
@property NSString *svg;
@property NSString *pdfPath;
@property NSString *pngPath;
@property NSMutableDictionary *result;
@property BOOL pdfDone;
@property BOOL pngDone;
@end
@implementation ExportProbe
- (void)webView:(WKWebView *)view didFinishNavigation:(WKNavigation *)navigation {
 [view callAsyncJavaScript:@"const bytes = await PFDExport.svgToPng(svg); return Array.from(bytes);" arguments:@{@"svg": self.svg} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
  if (error) self.result[@"pngError"] = error.localizedDescription;
  else {
   NSMutableData *data = [NSMutableData data]; for (NSNumber *number in (NSArray *)value) {uint8_t b = number.unsignedCharValue; [data appendBytes:&b length:1];}
   [data writeToFile:self.pngPath atomically:YES];
   NSBitmapImageRep *image = [NSBitmapImageRep imageRepWithData:data];
   self.result[@"pngWidth"] = @(image.pixelsWide); self.result[@"pngHeight"] = @(image.pixelsHigh);
   NSColor *corner = [[image colorAtX:0 y:0] colorUsingColorSpace:NSColorSpace.deviceRGBColorSpace];
   self.result[@"whiteCorner"] = @(corner.redComponent > .99 && corner.greenComponent > .99 && corner.blueComponent > .99 && corner.alphaComponent > .99);
  }
  self.pngDone = YES;
 }];
}
@end
static void pdf_complete(void *context, const unsigned char *bytes, size_t length, const char *error) {
 ExportProbe *probe = (__bridge ExportProbe *)context;
 if (error) probe.result[@"pdfError"] = [NSString stringWithUTF8String:error];
 else {
  NSData *data = [NSData dataWithBytes:bytes length:length]; [data writeToFile:probe.pdfPath atomically:YES];
  PDFDocument *document = [[PDFDocument alloc] initWithData:data];
  NSRect bounds = [[document pageAtIndex:0] boundsForBox:kPDFDisplayBoxMediaBox];
  probe.result[@"pdfPages"] = @(document.pageCount); probe.result[@"pdfWidth"] = @(bounds.size.width); probe.result[@"pdfHeight"] = @(bounds.size.height); probe.result[@"pdfText"] = document.string ?: @"";
  NSImage *thumbnail = [[document pageAtIndex:0] thumbnailOfSize:NSMakeSize(962,722) forBox:kPDFDisplayBoxMediaBox];
  NSBitmapImageRep *bitmap = [NSBitmapImageRep imageRepWithData:thumbnail.TIFFRepresentation];
  [[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[probe.pdfPath stringByAppendingString:@".png"] atomically:YES];
 }
 probe.pdfDone = YES;
}
int main(int argc, const char **argv) {
 @autoreleasepool {
  if (argc != 8) return 2;
  [NSApplication sharedApplication]; [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
  ExportProbe *probe = [ExportProbe new]; probe.result = [NSMutableDictionary dictionary];
  probe.svg = [NSString stringWithContentsOfFile:@(argv[1]) encoding:NSUTF8StringEncoding error:nil];
  NSString *html = [NSString stringWithContentsOfFile:@(argv[2]) encoding:NSUTF8StringEncoding error:nil];
  NSString *script = [NSString stringWithContentsOfFile:@(argv[3]) encoding:NSUTF8StringEncoding error:nil];
  probe.pdfPath = @(argv[6]); probe.pngPath = @(argv[7]);
  pfdsl_create_pdf(html.UTF8String, atof(argv[4]), atof(argv[5]), (__bridge void *)probe, pdf_complete);
  WKWebViewConfiguration *configuration = [WKWebViewConfiguration new]; configuration.websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore;
  [configuration.userContentController addUserScript:[[WKUserScript alloc] initWithSource:script injectionTime:WKUserScriptInjectionTimeAtDocumentEnd forMainFrameOnly:YES]];
  probe.view = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,800,600) configuration:configuration]; probe.view.navigationDelegate = probe;
  [probe.view loadHTMLString:@"<!doctype html><html><body></body></html>" baseURL:nil];
  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:35];
  while ((!probe.pdfDone || !probe.pngDone) && deadline.timeIntervalSinceNow > 0) [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:.02]];
  if (!probe.pdfDone || !probe.pngDone) return 3;
  NSData *json = [NSJSONSerialization dataWithJSONObject:probe.result options:0 error:nil]; puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
  return probe.result[@"pdfError"] || probe.result[@"pngError"] ? 1 : 0;
 }
}
