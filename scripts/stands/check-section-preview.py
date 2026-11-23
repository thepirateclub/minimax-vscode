# The previews of the folded sections of the chat.
#
#   python scripts/stands\check-section-preview.py
#
# The stand shows a chat with a long reasoning and a group of actions. Both
# sections are folded, both show one line of themselves in the row of the
# head: the reasoning takes its first words, the group shows its last
# action. A click on the preview opens the section.
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:5199/?theme=dark&preview=1'


def previews(page):
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('.section-preview')).map((el) => ({
            text: el.textContent,
            italic: getComputedStyle(el).fontStyle,
            lines: Math.round(el.getBoundingClientRect().height / 18)
        }))"""
    )


def row(page, head, child):
    return page.evaluate(
        """([head, child]) => {
            const box = (el) => {
                const b = el.getBoundingClientRect();
                return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width };
            };
            const root = document.querySelector(head);
            if (!root) return null;
            const title = root.querySelector('.section-title');
            const preview = root.querySelector('.section-preview');
            const counter = root.querySelector('.tool-steps-count');
            const text = preview ? preview.querySelector('.section-preview-text') : null;
            return {
                head: box(root),
                title: title ? box(title) : null,
                preview: preview ? box(preview) : null,
                counter: counter ? box(counter) : null,
                clipped: text ? text.scrollWidth > text.clientWidth + 1 : false
            };
        }""",
        [head, child]
    )


with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={'width': 609, 'height': 760}, device_scale_factor=2)
    page.goto(URL)
    page.wait_for_selector('.messages')
    page.wait_for_timeout(500)
    failed = []

    shown = previews(page)
    print('previews:', shown)
    if len(shown) != 2:
        failed.append('the chat has %d previews, two are expected' % len(shown))
    for item in shown:
        if item['italic'] != 'italic':
            failed.append('the preview is not in italics')
        if item['lines'] != 1:
            failed.append('the preview takes %d lines, one is expected' % item['lines'])
    thinking = next((item['text'] for item in shown if item['text'].startswith('The user')), '')
    actions = next((item['text'] for item in shown if item['text'].startswith('read_file')), '')
    if not thinking.endswith('…'):
        failed.append('the reasoning is not cut with the ellipsis')
    if actions != 'read_file src/tools/git.ts':
        failed.append('the group does not show its last action: ' + actions)
    # The live status of the agent is gone: the preview of the group took
    # its place.
    if page.query_selector('.composer-activity') is not None:
        failed.append('the live status stands over the field of the request')
    page.screenshot(path=os.path.join(HERE, 'section-preview-before.png'))

    # The preview stands in the row of the head, behind the name of the
    # section, and the counter of the group stays on the right edge.
    for head, name in (('.thinking-head', 'reasoning'), ('.tool-steps-head', 'actions')):
        box = row(page, head, name)
        print(name, ':', box)
        if not box or not box['title'] or not box['preview']:
            failed.append('the %s has no title or no preview' % name)
            continue
        if box['preview']['left'] < box['title']['right']:
            failed.append('the preview of the %s stands before its name' % name)
        if box['preview']['top'] > box['title']['bottom'] - 4:
            failed.append('the preview of the %s stands below its name' % name)
        if box['preview']['top'] < box['title']['top'] - 4:
            failed.append('the preview of the %s stands above its name' % name)
        if box['counter'] and box['counter']['left'] < box['preview']['right']:
            failed.append('the counter of the %s stands before its preview' % name)

    # A narrow panel cuts the preview, the name of the section keeps its
    # place.
    wide = row(page, '.thinking-head', 'thinking')
    page.set_viewport_size({'width': 320, 'height': 760})
    page.wait_for_timeout(300)
    narrow = row(page, '.thinking-head', 'thinking')
    print('narrow:', narrow)
    if not narrow or not narrow['title'] or not narrow['preview']:
        failed.append('the narrow panel lost the preview')
    else:
        if abs(narrow['title']['left'] - wide['title']['left']) > 1:
            failed.append('the name of the section moved in the narrow panel')
        if narrow['preview']['width'] >= wide['preview']['width']:
            failed.append('the preview did not give the room to the narrow panel')
        if not narrow['clipped']:
            failed.append('the preview is not cut with the ellipsis')
    page.screenshot(path=os.path.join(HERE, 'section-preview-narrow.png'))
    page.set_viewport_size({'width': 609, 'height': 760})
    page.wait_for_timeout(300)

    # A click on the preview of the reasoning opens the section.
    page.click('.thinking .section-preview')
    page.wait_for_timeout(300)
    if page.query_selector('.thinking-body') is None:
        failed.append('the reasoning did not open on a click of the preview')
    page.screenshot(path=os.path.join(HERE, 'section-preview-thinking.png'))

    # A click on the preview of the group opens the cards of the actions.
    page.click('.tool-steps .section-preview')
    page.wait_for_timeout(300)
    if page.query_selector('.tool-steps-body') is None:
        failed.append('the actions did not open on a click of the preview')
    page.screenshot(path=os.path.join(HERE, 'section-preview-actions.png'))

    if failed:
        for line in failed:
            print('FAIL:', line)
        browser.close()
        sys.exit(1)
    print('OK: the previews are one italic line in the row of the head and they open the sections')
    browser.close()
