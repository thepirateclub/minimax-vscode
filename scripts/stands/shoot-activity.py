# The live status over the field of the request.
#
# The stand of the panel serves the real webview with a fake host. The script
# sends the events of a running action to the panel and checks the row over
# the field: it appears, it counts the time and it goes away when the action
# ends.
#
#   python analysis\code-review\shoot-activity.py
import os

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 760}, device_scale_factor=2)
    page.goto('http://localhost:5199/?theme=dark')
    page.wait_for_selector('.composer-input')
    print('before the action, the row exists:', page.query_selector('.composer-activity') is not None)
    # The host starts an action: the tool call comes and the state of the
    # panel goes to the work.
    page.evaluate('''() => {
        window.postMessage({
            type: 'tool_start', id: 'live-1', name: 'read_file',
            input: { path: 'src/ui/format.ts' }
        }, '*');
        window.postMessage({ type: 'status', state: 'tool', tokens: 0 }, '*');
    }''')
    page.wait_for_timeout(1500)
    row = page.query_selector('.composer-activity')
    print('during the action, the row exists:', row is not None)
    if row:
        print('the text of the row:', row.inner_text().replace('\n', ' | '))
    page.screenshot(path=os.path.join(HERE, 'activity-live.png'))
    # The action ends.
    page.evaluate('''() => {
        window.postMessage({
            type: 'tool_end', id: 'live-1', name: 'read_file',
            content: 'export function formatCount(value: number): string { return String(value); }',
            isError: false, durationMs: 1200
        }, '*');
        window.postMessage({ type: 'status', state: 'idle', tokens: 0 }, '*');
    }''')
    page.wait_for_timeout(300)
    print('after the action, the row exists:', page.query_selector('.composer-activity') is not None)
    browser.close()
