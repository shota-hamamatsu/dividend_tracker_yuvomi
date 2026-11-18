import { api } from '/api.js';
import {
    type DividendRecord,
    filterByOwner,
    formatYen,
    isValidRecord,
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

function input(type: string, name: string): HTMLInputElement {
    const node = el('input');
    node.type = type;
    node.name = name;
    return node;
}

function option(value: string, text: string, selected = false): HTMLOptionElement {
    const node = el('option', undefined, text);
    node.value = value;
    node.selected = selected;
    return node;
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
    let errorEl = el('p', 'dt-error');
    let submitEl: HTMLButtonElement | null = null;

    const memberName = (id: number): string => members.get(id) ?? UNKNOWN_USER;

    const request = (method: 'POST', url: string, body?: unknown): Promise<Response> =>
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

    const buildForm = (): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, '配当を追加'));
        errorEl = el('p', 'dt-error');
        submitEl = null;
        if (!me.canWrite) {
            section.appendChild(el('p', undefined, '閲覧のみの権限です'));
            return section;
        }

        const owner = el('select');
        owner.name = 'ownerId';
        const choices = me.isAdmin ? [...members.keys()] : [me.id];
        if (!choices.includes(me.id)) choices.unshift(me.id);
        for (const id of choices) {
            owner.appendChild(option(String(id), memberName(id), id === me.id));
        }

        const shares = input('number', 'shares');
        shares.min = '1';
        shares.step = '1';
        const perShare = input('text', 'perShare');
        perShare.inputMode = 'decimal';

        const form = el('form', 'dt-form');
        form.append(
            labeled('保有者', owner),
            labeled('銘柄コード', input('text', 'ticker')),
            labeled('銘柄名', input('text', 'name')),
            labeled('受取日', input('date', 'payDate')),
            labeled('保有株数', shares),
            labeled('1株当たり配当（円）', perShare),
        );
        submitEl = el('button', undefined, '追加');
        submitEl.type = 'submit';
        form.appendChild(submitEl);
        section.append(form, errorEl);
        return section;
    };

    const draw = (message = ''): void => {
        const visible = filterByOwner(records, filter);
        shell(buildTotals(visible), buildForm());
        errorEl.textContent = message;
    };

    const showFailure = (message = 'データを読み込めませんでした'): void => {
        const section = el('section', 'page-section');
        const retry = el('button', undefined, '再読み込み');
        retry.type = 'button';
        retry.dataset['action'] = 'reload';
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

    container.addEventListener(
        'change',
        (e) => {
            const target = e.target;
            if (!(target instanceof HTMLSelectElement) || target.name !== 'filter') return;
            filter = target.value === '' ? null : Number(target.value);
            draw();
        },
        { signal },
    );

    container.addEventListener(
        'submit',
        async (e) => {
            e.preventDefault();
            const form = e.target;
            if (!(form instanceof HTMLFormElement)) return;
            const data = new FormData(form);
            const text = (key: string): string => String(data.get(key) ?? '');
            const payload = {
                ownerId: Number(text('ownerId')),
                ticker: text('ticker'),
                name: text('name'),
                payDate: text('payDate'),
                sharesText: text('shares'),
                perShareText: text('perShare'),
            };
            const error = validateInput(payload);
            if (error !== null) {
                errorEl.textContent = error;
                return;
            }
            const button = submitEl;
            if (button) button.disabled = true;
            try {
                const res = await request('POST', ENDPOINT, payload);
                if (signal.aborted) return;
                if (!res.ok) {
                    errorEl.textContent = await errorMessage(res, '保存できませんでした');
                    return;
                }
                const body = (await res.json()) as { data?: unknown };
                if (signal.aborted) return;
                if (isValidRecord(body.data)) records = [...records, body.data];
                draw();
            } catch {
                if (!signal.aborted) errorEl.textContent = '保存できませんでした';
            } finally {
                if (button) button.disabled = false;
            }
        },
        { signal },
    );

    container.addEventListener(
        'click',
        async (e) => {
            if (!(e.target instanceof Element)) return;
            if (e.target.closest('[data-action="reload"]')) await load();
        },
        { signal },
    );

    await load();
}
