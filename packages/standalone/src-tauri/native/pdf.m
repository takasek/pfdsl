#import <AppKit/AppKit.h>
#import <PDFKit/PDFKit.h>
#import <WebKit/WebKit.h>

typedef void (*PFDPDFCallback)(void *, const unsigned char *, size_t, const char *);

// Count UTF-16 units literally. Both members of each Kangxi radical/ideograph
// pair fit in one unit, even when labels repeat or are substrings of each other.
static NSCountedSet<NSNumber *> *characterCounts(NSString *text) {
    NSCountedSet *counts = [NSCountedSet new];
    for (NSUInteger i = 0; i < text.length; ++i) {
        [counts addObject:@([text characterAtIndex:i])];
    }
    return counts;
}

static NSString *substitutedCharacters(NSCountedSet *source, NSCountedSet *printed) {
    NSMutableString *missing = [NSMutableString string];
    for (unichar ch = 0x2F00; ch <= 0x2FD5; ++ch) {
        NSInteger radicalDelta = (NSInteger)[printed countForObject:@(ch)] - (NSInteger)[source countForObject:@(ch)];
        if (radicalDelta == 0) continue;
        NSString *radical = [NSString stringWithCharacters:&ch length:1];
        NSString *ideograph = radical.precomposedStringWithCompatibilityMapping;
        NSNumber *expected = @([ideograph characterAtIndex:0]);
        NSInteger ideographDelta = (NSInteger)[printed countForObject:expected] - (NSInteger)[source countForObject:expected];
        if (radicalDelta > 0 && ideographDelta < 0) [missing appendString:ideograph];
        if (radicalDelta < 0 && ideographDelta > 0) [missing appendString:radical];
    }
    return missing;
}

// This web view never receives Tauri scripts, message handlers, or a file URL.
@interface PFDPDFJob : NSObject <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *view;
@property(nonatomic, strong) PFDPDFJob *keepAlive;
@property(nonatomic) PFDPDFCallback callback;
@property(nonatomic) void *context;
@property(nonatomic) NSRect bounds;
@property(nonatomic) BOOL finished;
@property(nonatomic, strong) NSData *originalPDF;
@end

@implementation PFDPDFJob
- (void)finish:(NSData *)data error:(NSString *)error {
    if (self.finished) return;
    self.finished = YES;
    if (error && self.originalPDF) { data = self.originalPDF; error = nil; }
    self.callback(self.context, data.bytes, data.length, error.UTF8String);
    self.view.navigationDelegate = nil;
    [self.view stopLoading];
    self.view = nil;
    self.keepAlive = nil;
}

- (void)retryPDF:(NSData *)original characters:(NSString *)missing source:(NSCountedSet *)source printed:(NSCountedSet *)printed configuration:(WKPDFConfiguration *)configuration {
    self.originalPDF = original;
    // Select a different WebKit fallback for the missing member of each pair.
    // Keep literal radicals in their own run when the two occur in one label.
    NSString *script = @"const wanted = new Set(characters);"
                        "const texts = document.createTreeWalker(document.querySelector('svg'), NodeFilter.SHOW_TEXT);"
                        "const runs = []; while (texts.nextNode()) {"
                        "  const n = texts.currentNode;"
                        "  if (n.parentElement.closest('text') && Array.from(n.data).some(c => wanted.has(c))) runs.push(n);"
                        "}"
                        "for (const n of runs) {"
                        "  const parts = n.data.split(/([\\u2f00-\\u2fd5]+)/u);"
                        "  n.replaceWith(...parts.map(part => {"
                        "    if (!Array.from(part).some(c => wanted.has(c))) return document.createTextNode(part);"
                        "    const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');"
                        "    span.setAttribute('lang', /^[\\u2f00-\\u2fd5]/u.test(part) ? 'zh-Hans' : 'ja');"
                        "    span.textContent = part; return span;"
                        "  }));"
                        "}"
                        "document.documentElement.getBoundingClientRect(); await document.fonts.ready;";
    [self.view callAsyncJavaScript:script arguments:@{@"characters": missing} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id value, NSError *error) {
        if (self.finished) return;
        if (error) { [self finish:original error:nil]; return; }
        [self.view createPDFWithConfiguration:configuration completionHandler:^(NSData *candidate, NSError *error) {
            if (self.finished) return;
            NSString *text = candidate ? [[PDFDocument alloc] initWithData:candidate].string : nil;
            NSCountedSet *counts = text ? characterCounts(text) : nil;
            for (NSUInteger i = 0; i < missing.length; ++i) {
                NSNumber *code = @([missing characterAtIndex:i]);
                if ([counts countForObject:code] != [source countForObject:code]) {
                    [self finish:original error:nil];
                    return;
                }
            }
            for (NSNumber *code in source) {
                if ([counts countForObject:code] < MIN([source countForObject:code], [printed countForObject:code])) {
                    [self finish:original error:nil];
                    return;
                }
            }
            [self finish:candidate error:nil];
        }];
    }];
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    // Use source text only for diagrams that can contain a radical/ideograph pair.
    NSString *readText = @"await document.fonts.ready;"
                          "const labels = Array.from(document.querySelectorAll('svg text'), node => node.textContent).join('');"
                          "return /[\\u2f00-\\u2fd5\\u4e00-\\u9fff]/u.test(labels) ? labels : '';";
    [webView callAsyncJavaScript:readText arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(NSString *labels, NSError *fontError) {
        if (self.finished) return;
        if (fontError) { [self finish:nil error:[NSString stringWithFormat:@"PDF fonts failed: %@", fontError.localizedDescription]]; return; }
        WKPDFConfiguration *configuration = [WKPDFConfiguration new];
        configuration.rect = self.bounds;
        [webView createPDFWithConfiguration:configuration completionHandler:^(NSData *data, NSError *error) {
            if (self.finished) return;
            if (data && !error && labels.length) {
                NSString *text = [[PDFDocument alloc] initWithData:data].string;
                NSCharacterSet *radicals = [NSCharacterSet characterSetWithRange:NSMakeRange(0x2F00, 214)];
                if (text && ([text rangeOfCharacterFromSet:radicals].location != NSNotFound ||
                             [labels rangeOfCharacterFromSet:radicals].location != NSNotFound)) {
                    NSCountedSet *source = characterCounts(labels);
                    NSCountedSet *printed = characterCounts(text);
                    NSString *missing = substitutedCharacters(source, printed);
                    if (missing.length) {
                        [self retryPDF:data characters:missing source:source printed:printed configuration:configuration];
                        return;
                    }
                }
            }
            [self finish:data error:error ? [NSString stringWithFormat:@"WebKit PDF failed: %@", error.localizedDescription] : nil];
        }];
    }];
}

- (void)webView:(WKWebView *)webView didFailNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:nil error:[NSString stringWithFormat:@"PDF document failed to load: %@", error.localizedDescription]];
}

- (void)webView:(WKWebView *)webView didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error {
    [self finish:nil error:[NSString stringWithFormat:@"PDF document failed to load: %@", error.localizedDescription]];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    [self finish:nil error:@"WebKit PDF process terminated"];
}

- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    BOOL localDocument = [action.request.URL.absoluteString isEqualToString:@"about:blank"];
    decisionHandler(localDocument ? WKNavigationActionPolicyAllow : WKNavigationActionPolicyCancel);
}
@end

void pfdsl_create_pdf(const char *html, double width, double height, void *context, PFDPDFCallback callback) {
    // Copy before returning to Rust: the caller's CString is temporary.
    NSString *document = [[NSString alloc] initWithUTF8String:html];
    dispatch_async(dispatch_get_main_queue(), ^{
        PFDPDFJob *job = [PFDPDFJob new];
        job.keepAlive = job;
        job.callback = callback;
        job.context = context;
        job.bounds = NSMakeRect(0, 0, width, height);
        WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
        configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];
        configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
        job.view = [[WKWebView alloc] initWithFrame:job.bounds configuration:configuration];
        job.view.navigationDelegate = job;
        [job.view loadHTMLString:document baseURL:nil];
        __weak PFDPDFJob *weakJob = job;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            [weakJob finish:nil error:@"Native PDF export timed out after 30 seconds"];
        });
    });
}
