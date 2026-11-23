# The reproduction of the repeat of a request that leaves the feed behind.
#
#   python scripts/stands\repro-retry-scroll.py
#
# The panel of the stand gets the messages of the host directly, the same
# way the host sends them after the repeat of a request:
#
#   session_loaded  the history is cut before the failed request, the panel
#                   gets the tail of it: the count of the messages stays the
#                   same, the history under the reader is another one
#   user_message    the request runs again
#   assistant_start the answer of the model comes
#   text_delta      the text of the answer
#
# The reader sits above the end of the feed. The feed has to go to the end
# and follow the new turn: before the fix it stayed at the old place and
# the new turn went under the fold.
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:5199/?theme=dark'
PAGE = 120
PAIRS = 200
FAILED = 199


def post(page, message):
    page.evaluate('(m) => window.postMessage(m, "*")', message)


def chat(pairs, failed_at):
    out = []
    for i in range(pairs):
        out.append({'id': 'u%d' % i, 'role': 'user',
                    'text': 'Request %d: check the module of the project.' % i})
        out.append({'id': 'a%d' % i, 'role': 'assistant',
                    'text': 'Answer %d: the module reads the file. ' % i +
                            'The details of the work take a few lines. ' * 4})
        if i == failed_at:
            out.append({'id': 'e%d' % i, 'role': 'notice', 'kind': 'error',
                        'text': 'The request failed: 500 Internal Server Error'})
    return out


def read_feed(page):
    return page.evaluate(
        """() => {
        const el = document.querySelector('.messages');
        if (!el) return null;
        const last = el.querySelector('.message:last-child');
        const box = last ? last.getBoundingClientRect() : null;
        const mine = el.getBoundingClientRect();
        return {
            scrollTop: Math.round(el.scrollTop),
            scrollHeight: Math.round(el.scrollHeight),
            clientHeight: el.clientHeight,
            rows: el.querySelectorAll('.message').length,
            lastBottom: box ? Math.round(box.bottom - mine.bottom) : null
        };
    }"""
    )


def gap(state):
    return state['scrollHeight'] - state['scrollTop'] - state['clientHeight']


messages = chat(PAIRS, FAILED)
with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 760}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_selector('.messages')
    page.wait_for_timeout(300)
    # The panel holds the tail of the history.
    post(page, {'type': 'session_loaded', 'messages': messages[-PAGE:],
                'olderMessages': len(messages) - PAGE})
    page.wait_for_timeout(500)
    # The reader sits above the end of the feed.
    page.evaluate('document.querySelector(".messages").scrollTop = 1e6')
    page.wait_for_timeout(300)
    page.evaluate('document.querySelector(".messages").scrollTop -= 300')
    page.wait_for_timeout(300)
    before = read_feed(page)
    page.screenshot(path=os.path.join(HERE, 'retry-repro-before.png'))
    print('before the repeat:', before, 'gap', gap(before))
    # The host cuts the history before the failed request and sends the tail.
    host = messages[:2 * FAILED]
    post(page, {'type': 'session_loaded', 'messages': host[-PAGE:],
                'olderMessages': max(0, len(host) - PAGE)})
    page.wait_for_timeout(150)
    post(page, {'type': 'user_message', 'id': 'u%d-again' % FAILED,
                'text': 'Request %d again.' % FAILED})
    page.wait_for_timeout(150)
    post(page, {'type': 'assistant_start', 'id': 'a%d-again' % FAILED})
    post(page, {'type': 'text_delta', 'text': 'The tests run now, the helper was wrong.'})
    page.wait_for_timeout(900)
    after = read_feed(page)
    page.screenshot(path=os.path.join(HERE, 'retry-repro-after.png'))
    print('after the repeat: ', after, 'gap', gap(after))
    failed = []
    if gap(after) > 80:
        failed.append('the feed is not at the end of the history')
    if after['lastBottom'] is None or after['lastBottom'] > 0:
        failed.append('the new turn is under the fold')
    if failed:
        for line in failed:
            print('FAIL:', line)
        browser.close()
        sys.exit(1)
    print('OK: the feed is at the end and shows the new turn')
    browser.close()
