import { api } from '/api.js';
import {
    type DividendRecord,
    type Payment,
    type RecordInput,
    MAX_PAYMENTS,
    filterByOwner,
    formatYen,
    isValidRecord,
    monthlyTotals,
    recordTotal,
    sortForList,
    validateInput,
    yearlyTotals,
} from './logic.ts';

const ENDPOINT = '/api/extensions/dividend-tracker/records';
const EMPTY_TEXT = 'まだ記録がありません';
const UNKNOWN_USER = '（不明なユーザー）';

interface Me {
    id: number;
    isAdmin: boolean;
    canWrite: boolean;
}

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

function labeled(text: string, control: HTMLElement): HTMLLabelElement {
    const label = el('label', undefined, text);
    label.appendChild(control);
    return label;
}

function input(type: string, name: string, value = ''): HTMLInputElement {
    const node = el('input');
    node.type = type;
    node.name = name;
    node.value = value;
    return node;
}

function option(value: string, text: string, selected = false): HTMLOptionElement {
    const node = el('option', undefined, text);
    node.value = value;
    node.selected = selected;
    return node;
}

function button(text: string, action: string, className?: string): HTMLButtonElement {
    const node = el('button', className, text);
    node.type = 'button';
    node.dataset['action'] = action;
    return node;
}

/** 1/100 円単位の整数を入力欄用の文字列に戻す（3750 → '37.5'、5 → '0.05'、1200 → '12'）。 */
function perShareText(cents: number): string {
    const yen = String(Math.trunc(cents / 100));
    const fraction = String(cents % 100)
        .padStart(2, '0')
        .replace(/0+$/, '');
    return fraction === '' ? yen : `${yen}.${fraction}`;
}

/** 受取日の一覧表示。年が 2 種類以上なら年も付ける（'3/31、9/30' / '2024/12/31、2025/6/30'）。 */
function formatPayDates(payments: Payment[]): string {
    const withYear = new Set(payments.map((p) => p.payDate.substring(0, 4))).size > 1;
    return payments
        .map(({ payDate }) => {
            const [year, month, day] = payDate.split('-');
            const md = `${Number(month)}/${Number(day)}`;
            return withYear ? `${year}/${md}` : md;
        })
        .join('、');
}

/** 一覧・確認文で使う銘柄の表示（'7203 トヨタ自動車'、name が空なら ticker だけ）。 */
function recordLabel(record: DividendRecord): string {
    return record.name === '' ? record.ticker : `${record.ticker} ${record.name}`;
}

function parseMembers(body: unknown): Map<number, string> {
    const map = new Map<number, string>();
    const data = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) return map;
    for (const m of data) {
        const { id, display_name } = (m ?? {}) as { id?: unknown; display_name?: unknown };
        if (typeof id === 'number' && Number.isInteger(id) && id > 0) {
            map.set(id, typeof display_name === 'string' ? display_name : String(id));
        }
    }
    return map;
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
    try {
        const body = (await res.json()) as { error?: unknown };
        return typeof body.error === 'string' ? body.error : fallback;
    } catch {
        return fallback;
    }
}

export async function render(
    container: HTMLElement,
    context: { signal: AbortSignal },
): Promise<void> {
    const { signal } = context;
    let records: DividendRecord[] = [];
    let members = new Map<number, string>();
    let me: Me = { id: 0, isAdmin: false, canWrite: false };
    let csrfToken = '';
    let filter: number | null = null;
    let chartYear: string | null = null;
    let listError = '';
    let dialog: HTMLDialogElement | null = null;
    let editing: DividendRecord | null = null;

    const memberName = (id: number): string => members.get(id) ?? UNKNOWN_USER;
    const canEdit = (record: DividendRecord): boolean =>
        me.canWrite && (me.isAdmin || record.ownerId === me.id);

    const request = (
        method: 'POST' | 'PUT' | 'DELETE',
        url: string,
        body?: unknown,
    ): Promise<Response> =>
        fetch(url, {
            method,
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
            headers: {
                'X-DT-CSRF': csrfToken,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });

    const shell = (...sections: HTMLElement[]): void => {
        const toolbar = el('div', 'page-toolbar');
        toolbar.appendChild(el('h1', 'page-toolbar__title', '配当管理'));
        const body = el('div', 'app-page__body');
        body.append(...sections);
        container.replaceChildren(toolbar, body);
    };

    const buildTotals = (visible: DividendRecord[]): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '年間配当合計'));

        const select = el('select');
        select.name = 'filter';
        select.appendChild(option('', 'すべて', filter === null));
        for (const [id, name] of members) {
            select.appendChild(option(String(id), name, filter === id));
        }
        section.appendChild(labeled('保有者', select));

        const totals = yearlyTotals(visible);
        if (totals.length === 0) {
            section.appendChild(el('p', undefined, EMPTY_TEXT));
            return section;
        }
        const ul = el('ul', 'dt-totals');
        for (const { year, total } of totals) {
            ul.appendChild(el('li', undefined, `${year}年: ${formatYen(total)}`));
        }
        section.appendChild(ul);
        return section;
    };

    const buildList = (visible: DividendRecord[]): HTMLElement => {
        const section = el('section', 'page-section');
        const heading = el('div', 'dt-heading');
        heading.appendChild(el('h2', undefined, '銘柄一覧'));
        if (me.canWrite) heading.appendChild(button('追加', 'add'));
        section.appendChild(heading);
        if (!me.canWrite) section.appendChild(el('p', undefined, '閲覧のみの権限です'));
        section.appendChild(el('p', 'dt-error', listError));

        if (visible.length === 0) {
            section.appendChild(el('p', undefined, EMPTY_TEXT));
            return section;
        }
        const table = el('table', 'dt-list');
        const headRow = el('tr');
        if (me.canWrite) {
            const th = el('th', 'dt-delete-cell');
            th.setAttribute('aria-label', '削除');
            headRow.appendChild(th);
        }
        for (const [text, className] of [
            ['保有者', undefined],
            ['銘柄', undefined],
            ['保有株数', 'dt-num'],
            ['受取日', undefined],
            ['合計', 'dt-num'],
        ] as const) {
            headRow.appendChild(el('th', className, text));
        }
        table.appendChild(el('thead')).appendChild(headRow);

        const tbody = el('tbody');
        for (const record of sortForList(visible)) {
            const row = el('tr');
            const label = recordLabel(record);
            if (me.canWrite) {
                const cell = el('td', 'dt-delete-cell');
                if (canEdit(record)) {
                    const remove = button('×', 'delete', 'dt-button--danger');
                    remove.title = '削除';
                    remove.dataset['id'] = record.id;
                    remove.setAttribute('aria-label', `${label} を削除`);
                    cell.appendChild(remove);
                }
                row.appendChild(cell);
            }
            row.append(
                el('td', 'dt-owner', memberName(record.ownerId)),
                el('td', undefined, label),
                el('td', 'dt-num', `${record.shares.toLocaleString('ja-JP')}株`),
                el('td', undefined, formatPayDates(record.payments)),
                el('td', 'dt-num', formatYen(recordTotal(record))),
            );
            if (canEdit(record)) {
                row.className = 'dt-row--editable';
                row.dataset['id'] = record.id;
                row.tabIndex = 0;
            }
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
        section.appendChild(table);
        return section;
    };

    const buildChart = (visible: DividendRecord[]): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '月別配当額'));
        const years = yearlyTotals(visible).map((t) => t.year);
        if (years.length === 0) {
            section.appendChild(el('p', undefined, EMPTY_TEXT));
            return section;
        }
        const thisYear = String(new Date().getFullYear());
        const year =
            chartYear !== null && years.includes(chartYear)
                ? chartYear
                : years.includes(thisYear)
                  ? thisYear
                  : (years[0] as string);

        const select = el('select');
        select.name = 'chartYear';
        for (const y of years) select.appendChild(option(y, `${y}年`, y === year));
        section.appendChild(labeled('年', select));

        const months = monthlyTotals(visible, year);
        const max = Math.max(...months.map((m) => m.total));
        const chart = el('ol', 'dt-chart');
        chart.setAttribute('aria-label', `${year}年の月別配当額`);
        for (const { month, total } of months) {
            const item = el('li', 'dt-chart__month');
            const text = `${month}月: ${formatYen(total)}`;
            item.title = text;
            item.setAttribute('aria-label', text);
            const track = el('div', 'dt-chart__track');
            const bar = el('div', 'dt-chart__bar');
            // 表示用の比率。金額の計算には使わない
            bar.style.height = `${max > 0 ? (total / max) * 100 : 0}%`;
            track.appendChild(bar);
            item.append(
                el('span', 'dt-chart__value', total > 0 ? formatYen(total) : ''),
                track,
                el('span', 'dt-chart__label', `${month}月`),
            );
            chart.appendChild(item);
        }
        section.appendChild(chart);
        return section;
    };

    const draw = (): void => {
        const visible = filterByOwner(records, filter);
        shell(buildTotals(visible), buildList(visible), buildChart(visible));
    };

    // ---- ダイアログ ----

    const paymentRow = (payDate = '', perShare = ''): HTMLElement => {
        const row = el('div', 'dt-payment');
        const perShareInput = input('text', 'perShare', perShare);
        perShareInput.inputMode = 'decimal';
        row.append(
            labeled('受取日', input('date', 'payDate', payDate)),
            labeled('1株当たり配当（円）', perShareInput),
            button('削除', 'remove-payment', 'dt-button--secondary'),
        );
        return row;
    };

    /** 行の数に合わせて「削除」「受取日を追加」の disabled を切り替える。 */
    const refreshPaymentButtons = (form: HTMLFormElement): void => {
        const rows = form.querySelectorAll('.dt-payment');
        for (const remove of form.querySelectorAll<HTMLButtonElement>(
            '[data-action="remove-payment"]',
        )) {
            remove.disabled = rows.length <= 1;
        }
        const add = form.querySelector<HTMLButtonElement>('[data-action="add-payment"]');
        if (add) add.disabled = rows.length >= MAX_PAYMENTS;
    };

    const openDialog = (record: DividendRecord | null): void => {
        if (dialog) return;
        editing = record;

        const owner = el('select');
        owner.name = 'ownerId';
        const selected = record?.ownerId ?? me.id;
        const choices = me.isAdmin ? [...members.keys()] : [me.id];
        if (!choices.includes(selected)) choices.unshift(selected);
        for (const id of choices) {
            owner.appendChild(option(String(id), memberName(id), id === selected));
        }

        const shares = input('number', 'shares', record ? String(record.shares) : '');
        shares.min = '1';
        shares.step = '1';

        const payments = el('fieldset', 'dt-payments');
        payments.appendChild(el('legend', undefined, '受取日と1株当たり配当'));
        if (record) {
            for (const p of record.payments) {
                payments.appendChild(paymentRow(p.payDate, perShareText(p.perShareCents)));
            }
        } else {
            payments.appendChild(paymentRow());
        }
        payments.appendChild(button('受取日を追加', 'add-payment', 'dt-button--secondary'));

        const submit = el('button', undefined, record ? '保存' : '追加');
        submit.type = 'submit';
        const actions = el('div', 'dt-actions');
        actions.append(button('キャンセル', 'cancel', 'dt-button--secondary'), submit);

        const form = el('form', 'dt-form');
        const ownerField = labeled('保有者', owner);
        ownerField.className = 'dt-field--wide';
        const sharesField = labeled('保有株数', shares);
        sharesField.className = 'dt-field--shares';
        form.append(
            ownerField,
            labeled('銘柄コード', input('text', 'ticker', record?.ticker ?? '')),
            labeled('銘柄名', input('text', 'name', record?.name ?? '')),
            sharesField,
            payments,
            el('p', 'dt-error'),
            actions,
        );
        refreshPaymentButtons(form);

        dialog = el('dialog', 'dt-dialog');
        dialog.append(el('h2', undefined, record ? '配当を編集' : '配当を追加'), form);
        const opened = dialog;
        opened.addEventListener(
            'close',
            () => {
                opened.remove();
                if (dialog === opened) {
                    dialog = null;
                    editing = null;
                }
            },
            { signal },
        );
        container.appendChild(opened);
        opened.showModal();
    };

    const readForm = (form: HTMLFormElement): RecordInput => {
        const data = new FormData(form);
        const text = (key: string): string => String(data.get(key) ?? '');
        const dates = data.getAll('payDate').map(String);
        const perShares = data.getAll('perShare').map(String);
        return {
            ownerId: Number(text('ownerId')),
            ticker: text('ticker'),
            name: text('name'),
            sharesText: text('shares'),
            payments: dates.map((payDate, i) => ({ payDate, perShareText: perShares[i] ?? '' })),
        };
    };

    const showFailure = (message = 'データを読み込めませんでした'): void => {
        const section = el('section', 'page-section');
        const retry = button('再読み込み', 'reload');
        section.append(el('p', 'dt-error', message), retry);
        shell(section);
    };

    const load = async (): Promise<void> => {
        shell(el('p', undefined, '読み込み中…'));
        try {
            const [memberBody, res] = await Promise.all([
                api.get('/family/members', { signal }),
                fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', signal }),
            ]);
            if (signal.aborted) return;
            if (!res.ok) {
                const message = await errorMessage(res, 'データを読み込めませんでした');
                if (!signal.aborted) showFailure(message);
                return;
            }
            const body = (await res.json()) as {
                data?: unknown;
                me?: Partial<Me>;
                csrfToken?: unknown;
            };
            if (signal.aborted) return;
            members = parseMembers(memberBody);
            records = Array.isArray(body.data) ? body.data.filter(isValidRecord) : [];
            me = {
                id: typeof body.me?.id === 'number' ? body.me.id : 0,
                isAdmin: body.me?.isAdmin === true,
                canWrite: body.me?.canWrite === true,
            };
            csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
            if (filter !== null && !members.has(filter)) filter = null;
            draw();
        } catch {
            if (!signal.aborted) showFailure();
        }
    };

    const deleteRecord = async (deleteButton: HTMLButtonElement): Promise<void> => {
        const record = records.find((r) => r.id === deleteButton.dataset['id']);
        if (!record || !canEdit(record)) return;
        const message = `「${recordLabel(record)}」（${memberName(record.ownerId)}）を削除しますか？この操作は取り消せません。`;
        if (!window.confirm(message)) return;
        deleteButton.disabled = true;
        try {
            const res = await request('DELETE', `${ENDPOINT}/${encodeURIComponent(record.id)}`);
            if (signal.aborted) return;
            if (res.ok) {
                records = records.filter((r) => r.id !== record.id);
                listError = '';
            } else {
                listError = await errorMessage(res, '削除できませんでした');
                if (signal.aborted) return;
            }
        } catch {
            if (signal.aborted) return;
            listError = '削除できませんでした';
        }
        draw();
    };

    const openEditor = (row: Element): void => {
        const id = row instanceof HTMLElement ? row.dataset['id'] : undefined;
        const record = records.find((r) => r.id === id);
        if (record && canEdit(record)) openDialog(record);
    };

    container.addEventListener(
        'change',
        (e) => {
            const target = e.target;
            if (!(target instanceof HTMLSelectElement)) return;
            if (target.name === 'filter') {
                filter = target.value === '' ? null : Number(target.value);
                listError = '';
            } else if (target.name === 'chartYear') {
                chartYear = target.value;
            } else {
                return;
            }
            draw();
        },
        { signal },
    );

    container.addEventListener(
        'submit',
        async (e) => {
            e.preventDefault();
            const form = e.target;
            if (!(form instanceof HTMLFormElement) || !dialog?.contains(form)) return;
            const errorEl = form.querySelector('.dt-error');
            const showError = (message: string): void => {
                if (errorEl) errorEl.textContent = message;
            };
            const payload = readForm(form);
            const error = validateInput(payload);
            if (error !== null) {
                showError(error);
                return;
            }
            const target = editing;
            const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
            if (submit) submit.disabled = true;
            try {
                const res = target
                    ? await request('PUT', `${ENDPOINT}/${encodeURIComponent(target.id)}`, payload)
                    : await request('POST', ENDPOINT, payload);
                if (signal.aborted) return;
                if (!res.ok) {
                    showError(await errorMessage(res, '保存できませんでした'));
                    return;
                }
                const body = (await res.json()) as { data?: unknown };
                if (signal.aborted) return;
                const saved = body.data;
                if (isValidRecord(saved)) {
                    records = target
                        ? records.map((r) => (r.id === saved.id ? saved : r))
                        : [...records, saved];
                }
                dialog?.close();
                listError = '';
                draw();
            } catch {
                if (!signal.aborted) showError('保存できませんでした');
            } finally {
                if (submit) submit.disabled = false;
            }
        },
        { signal },
    );

    container.addEventListener(
        'click',
        async (e) => {
            if (!(e.target instanceof Element)) return;
            const actionEl = e.target.closest('[data-action]');
            const action = actionEl instanceof HTMLElement ? actionEl.dataset['action'] : undefined;
            const form = actionEl?.closest('form');
            if (action === 'reload') {
                await load();
            } else if (action === 'add') {
                openDialog(null);
            } else if (action === 'cancel') {
                dialog?.close();
            } else if (action === 'delete' && actionEl instanceof HTMLButtonElement) {
                await deleteRecord(actionEl);
            } else if (action === 'add-payment' && form) {
                const rows = form.querySelectorAll('.dt-payment');
                if (rows.length < MAX_PAYMENTS) actionEl?.before(paymentRow());
                refreshPaymentButtons(form);
            } else if (action === 'remove-payment' && form) {
                if (form.querySelectorAll('.dt-payment').length > 1) {
                    actionEl?.closest('.dt-payment')?.remove();
                }
                refreshPaymentButtons(form);
            } else if (action === undefined) {
                const row = e.target.closest('tr.dt-row--editable');
                if (row) openEditor(row);
            }
        },
        { signal },
    );

    container.addEventListener(
        'keydown',
        (e) => {
            const target = e.target;
            if (!(target instanceof HTMLTableRowElement)) return;
            if (!target.classList.contains('dt-row--editable')) return;
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            openEditor(target);
        },
        { signal },
    );

    await load();
}
