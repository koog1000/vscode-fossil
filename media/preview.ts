const $ = (s: string) => document.getElementById(s);
const vscode = acquireVsCodeApi<{ uri: string }>();

function htmlToElements(html: string): HTMLCollection {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.children;
}

function find_diff(olds: HTMLCollection, news: HTMLCollection): Element {
    const n = Math.max(olds.length, news.length);
    for (let i = 0; i < n; ++i) {
        if (olds[i] && news[i]) {
            if (olds[i].isEqualNode(news[i])) {
                continue;
            } else {
                if (!news[i].children.length) {
                    return news[i];
                }
                return find_diff(olds[i].children, news[i].children);
            }
        } else {
            return news[i];
        }
    }
    return news[0];
}

function scrollIntoViewIfNeeded(target: Element): void {
    if (target.getBoundingClientRect().bottom > window.innerHeight) {
        target.scrollIntoView(false);
    }

    if (target.getBoundingClientRect().top < 0) {
        target.scrollIntoView();
    }
}

window.addEventListener(
    'message',
    (event: MessageEvent<{ html: string; uri: string }>): void => {
        const news = htmlToElements(event.data.html);
        const content = $('fossil-preview-content');
        const diff_el = find_diff(content.children, news);
        content.replaceChildren(...news);
        vscode.setState({ uri: event.data.uri });
        if (diff_el) {
            scrollIntoViewIfNeeded(diff_el);
        }
    }
);

window.addEventListener('load', () => {
    vscode.postMessage({ status: 'loaded' });
});
