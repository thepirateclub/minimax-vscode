# The screenshots of the folding sections of the panel and their geometry.
#
# The stand of the panel (npm run preview) serves the real webview with a fake
# host. The script opens the chat of the sections (?sections=1), shoots the feed
# of the panel in both themes and prints the geometry of every head of a
# section: the chevron, the icon, the title and the counter. The coordinates
# are counted from the left upper corner of the feed, so they are the same
# numbers the screenshot of the feed holds.
#
#   python scripts/stands\shoot-sections.py before
#   python scripts/stands\shoot-sections.py after
import json
import os
import sys

from playwright.sync_api import sync_playwright

LABEL = sys.argv[1] if len(sys.argv) > 1 else 'before'
HERE = os.path.dirname(os.path.abspath(__file__))
URL = 'http://localhost:5199/?theme={theme}&sections=1'

MEASURE = '''
() => {
  const feed = document.querySelector('.messages');
  const origin = feed.getBoundingClientRect();
  const at = (box) => ({
    left: Math.round((box.left - origin.left) * 100) / 100,
    right: Math.round((box.right - origin.left) * 100) / 100,
    top: Math.round((box.top - origin.top) * 100) / 100,
    bottom: Math.round((box.bottom - origin.top) * 100) / 100,
    midY: Math.round(((box.top + box.bottom) / 2 - origin.top) * 100) / 100
  });
  const out = [];
  const heads = Array.from(document.querySelectorAll('.tool-steps-head, .thinking-toggle'));
  for (const head of heads) {
    const row = head.getBoundingClientRect();
    const part = (sel) => {
      const node = head.querySelector(sel);
      return node ? at(node.getBoundingClientRect()) : null;
    };
    // The words of the head: a span or a bare text node.
    let words = null;
    const span = head.querySelector('.tool-steps-title, .section-title');
    if (span) {
      words = at(span.getBoundingClientRect());
    } else {
      const walker = document.createTreeWalker(head, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.textContent.trim().length > 0) {
          const range = document.createRange();
          range.selectNodeContents(node);
          words = at(range.getBoundingClientRect());
          break;
        }
        node = walker.nextNode();
      }
    }
    out.push({
      head: head.className,
      row: at(row),
      chevron: part('.chevron'),
      icon: part('.thinking-icon, .tool-steps-icon'),
      title: words,
      count: part('.tool-steps-count')
    });
  }
  return out;
}
'''

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for theme in ('dark', 'light'):
        page = browser.new_page(viewport={'width': 609, 'height': 420}, device_scale_factor=2)
        page.goto(URL.format(theme=theme))
        page.wait_for_selector('.tool-steps-head')
        page.wait_for_timeout(300)
        feed = page.query_selector('.messages')
        feed.screenshot(path=os.path.join(HERE, 'sections-%s-%s.png' % (LABEL, theme)))
        data = page.evaluate(MEASURE)
        with open(os.path.join(HERE, 'geometry-%s-%s.json' % (LABEL, theme)), 'w', encoding='utf-8') as file:
            json.dump(data, file, indent=2)
        print('---', theme)
        for item in data:
            chev = item['chevron']
            icon = item['icon']
            title = item['title']
            count = item['count']
            print(
                item['head'],
                '| row left', item['row']['left'], 'right', item['row']['right'],
                'height', item['row']['height'] if 'height' in item['row'] else '',
                '| chevron', (chev['left'], chev['midY']) if chev else None,
                '| icon', (icon['left'], icon['midY']) if icon else None,
                '| title', (title['left'], title['midY']) if title else None,
                '| count', (count['right'], count['midY']) if count else None
            )
        page.close()
    browser.close()
print('screenshots written to', HERE)
