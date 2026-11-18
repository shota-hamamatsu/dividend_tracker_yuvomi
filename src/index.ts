import {
    type DividendRecord,
    parseRecords,
    validateInput,
    yearlyTotals,
    sortByPayDateDesc,
    formatYen,
    newId,
} from './logic.ts';

const STORAGE_KEY = 'dividend-tracker:v1';
const EMPTY_TEXT = 'まだ記録がありません';

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function load(): DividendRecord[] {
    try {
        return parseRecords(localStorage.getItem(STORAGE_KEY));
    } catch {
        return [];
    }
}

function save(records: DividendRecord[]): boolean {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        return true;
    } catch {
        return false;
    }
}

function labeled(text: string, input: HTMLInputElement): HTMLLabelElement {
    const label = el('label', undefined, text);
    label.appendChild(input);
    return label;
}

function input(type: string, name: string): HTMLInputElement {
    const node = el('input');
    node.type = type;
    node.name = name;
    return node;
}

export async function render(
    container: HTMLElement,
    context: { signal: AbortSignal },
): Promise<void> {
    const { signal } = context;
    let records = load();
    let errorEl = el('p', 'dt-error');

    const buildTotals = (): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '年別合計'));
        const totals = yearlyTotals(records);
        if (totals.length === 0) {
            section.appendChild(el('p', undefined, EMPTY_TEXT));
            return section;
        }
        const ul = el('ul');
        for (const { year, total } of totals) {
            ul.appendChild(el('li', undefined, `${year}年: ${formatYen(total)}`));
        }
        section.appendChild(ul);
        return section;
    };

    const buildForm = (): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '配当を追加'));
        const form = el('form', 'dt-form');
        const amount = input('number', 'amount');
        amount.min = '0';
        amount.step = '1';
        form.append(
            labeled('銘柄コード', input('text', 'ticker')),
            labeled('銘柄名', input('text', 'name')),
            labeled('受取日', input('date', 'payDate')),
            labeled('受取額（円）', amount),
        );
        const submit = el('button', undefined, '追加');
        submit.type = 'submit';
        form.appendChild(submit);
        errorEl = el('p', 'dt-error');
        section.append(form, errorEl);
        return section;
    };

    const buildList = (): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '受取履歴'));
        if (records.length === 0) {
            section.appendChild(el('p', undefined, EMPTY_TEXT));
            return section;
        }
        const table = el('table', 'dt-table');
        const headRow = el('tr');
        for (const [text, numeric] of [
            ['受取日', false],
            ['銘柄', false],
            ['銘柄名', false],
            ['受取額', true],
            ['操作', false],
        ] as const) {
            headRow.appendChild(el('th', numeric ? 'dt-num' : undefined, text));
        }
        const thead = el('thead');
        thead.appendChild(headRow);

        const tbody = el('tbody');
        for (const rec of sortByPayDateDesc(records)) {
            const row = el('tr');
            row.append(
                el('td', undefined, rec.payDate),
                el('td', undefined, rec.ticker),
                el('td', undefined, rec.name),
                el('td', 'dt-num', formatYen(rec.amount)),
            );
            const del = el('button', undefined, '削除');
            del.type = 'button';
            del.dataset['action'] = 'delete';
            del.dataset['id'] = rec.id;
            const cell = el('td');
            cell.appendChild(del);
            row.appendChild(cell);
            tbody.appendChild(row);
        }
        table.append(thead, tbody);
        section.appendChild(table);
        return section;
    };

    const draw = (message = ''): void => {
        const toolbar = el('div', 'page-toolbar');
        toolbar.appendChild(el('h1', 'page-toolbar__title', '配当管理'));
        const body = el('div', 'app-page__body');
        body.append(buildTotals(), buildForm(), buildList());
        container.replaceChildren(toolbar, body);
        errorEl.textContent = message;
    };

    const commit = (next: DividendRecord[]): void => {
        records = next;
        draw(save(records) ? '' : '保存できませんでした');
    };

    container.addEventListener(
        'submit',
        (e) => {
            e.preventDefault();
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            const data = new FormData(form);
            const text = (key: string): string => String(data.get(key) ?? '');
            const ticker = text('ticker').trim();
            const payDate = text('payDate');
            const amountText = text('amount');

            const error = validateInput({ ticker, payDate, amountText });
            if (error !== null) {
                errorEl.textContent = error;
                return;
            }
            commit([
                ...records,
                {
                    id: newId(),
                    ticker,
                    name: text('name').trim(),
                    payDate,
                    amount: Number(amountText),
                },
            ]);
        },
        { signal },
    );

    container.addEventListener(
        'click',
        (e) => {
            if (!(e.target instanceof Element)) return;
            const button = e.target.closest<HTMLElement>('[data-action="delete"]');
            if (!button) return;
            const id = button.dataset['id'];
            commit(records.filter((r) => r.id !== id));
        },
        { signal },
    );

    draw();
}
