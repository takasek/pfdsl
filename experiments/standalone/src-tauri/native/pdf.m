#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

typedef void (*PFDPDFCallback)(void *, const unsigned char *, size_t, const char *);

// This web view never receives Tauri scripts, message handlers, or a file URL.
@interface PFDPDFJob : NSObject <WKNavigationDelegate>
@property(nonatomic, strong) WKWebView *view;
@property(nonatomic, strong) PFDPDFJob *keepAlive;
@property(nonatomic) PFDPDFCallback callback;
@property(nonatomic) void *context;
@property(nonatomic) NSRect bounds;
@property(nonatomic) BOOL finished;
@end

@implementation PFDPDFJob
- (void)finish:(NSData *)data error:(NSString *)error {
    if (self.finished) return;
    self.finished = YES;
    self.callback(self.context, data.bytes, data.length, error.UTF8String);
    self.view.navigationDelegate = nil;
    [self.view stopLoading];
    self.view = nil;
    self.keepAlive = nil;
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    WKPDFConfiguration *configuration = [WKPDFConfiguration new];
    configuration.rect = self.bounds;
    [webView createPDFWithConfiguration:configuration completionHandler:^(NSData *data, NSError *error) {
        [self finish:data error:error ? [NSString stringWithFormat:@"WebKit PDF failed: %@", error.localizedDescription] : nil];
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
