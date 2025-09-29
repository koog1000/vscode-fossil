const $ = (s: string) => document.getElementById(s);
const vscode = acquireVsCodeApi<{ uri: string }>();
type Nodes = NodeListOf<ChildNode>;

function htmlToElements(html: string): Nodes {
    const template = document.createElement('template');
    template.innerHTML = html;
    return template.content.childNodes;
}

function find_diff(olds: Nodes, news: Nodes): ChildNode {
    const n = Math.max(olds.length, news.length);
    for (let i = 0; i < n; ++i) {
        if (olds[i] && news[i]) {
            if (
                olds[i].isEqualNode(news[i]) ||
                news[i].nodeType == Node.COMMENT_NODE
            ) {
                continue;
            } else {
                if (!news[i].childNodes.length) {
                    return news[i];
                }
                return find_diff(olds[i].childNodes, news[i].childNodes);
            }
        } else {
            return news[i];
        }
    }
    return news[0];
}

function scrollIntoViewIfNeeded(target: ChildNode): void {
    while (target.nodeType != target.ELEMENT_NODE) {
        target = target.previousSibling ?? target.parentElement;
    }
    const rect = (target as Element).getBoundingClientRect();
    if (rect.bottom > window.innerHeight || rect.top < 0) {
        (target as Element).scrollIntoView({
            behavior: 'auto',
            block: 'center',
            inline: 'center',
        });
    }
}

window.addEventListener(
    'message',
    (event: MessageEvent<{ html: string; uri: string }>): void => {
        const news = htmlToElements(event.data.html);
        const content = $('fossil-preview-content');
        const diff_el = find_diff(content.childNodes, news);
        content.replaceChildren(...news);
        vscode.setState({ uri: event.data.uri });
        if (diff_el) {
            scrollIntoViewIfNeeded(diff_el);
        }
    }
);

window.addEventListener('keydown', e => {
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        vscode.postMessage({ action: 'save' });
    }
});

window.addEventListener('load', () => {
    vscode.postMessage({ action: 'update' });
});
