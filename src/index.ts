import { api } from '/api.js';
import * as i18n from '/i18n.js';
import {
    type Breakdown,
    type Currency,
    type CurrencyBreakdown,
    type DividendRecord,
    type Payment,
    type RecordInput,
    type YearlyTotal,
    CURRENCIES,
    MAX_PAYMENTS,
    MAX_YEAR,
    MIN_YEAR,
    amountDecimal,
    amountDecimals,
    annualTotals,
    filterByOwner,
    isValidRecord,
    isValidYearlyTotal,
    monthlyTotals,
    parseYear,
    perShareInputText,
    recordTotal,
    sortForList,
    usedCurrencies,
    validateInput,
    yearlyChart,
} from './logic.ts';

const ENDPOINT = '/api/extensions/dividend-tracker/records';
const YEARLY_ENDPOINT = '/api/extensions/dividend-tracker/yearly-totals';
const KEY_PREFIX = 'extensions.dividend-tracker.';
const OWNER_COLORS = 8; // --dt-owner-1 to 8 in style.css

type Params = Record<string, string | number>;

/** A module string (a key in locales/<locale>.json). */
function tr(key: string, params?: Params): string {
    return i18n.t(KEY_PREFIX + key, params);
}

/** The translation, or the fallback key's translation when there is none (t returned the key). */
function trOr(key: string, fallbackKey: string, params?: Params): string {
    const text = tr(key, params);
    return text === KEY_PREFIX + key ? tr(fallbackKey) : text;
}

/** The tag if Intl accepts it, otherwise 'en'. */
function safeLocale(tag: string | undefined): string {
    if (!tag) return 'en';
    try {
        return Intl.getCanonicalLocales(tag)[0] ?? 'en';
    } catch {
        return 'en';
    }
}

/** UI language (dates, text) and number-format region (numbers, amounts). Read again on every draw(). */
function currentLocales(): { ui: string; format: string } {
    const ui = safeLocale(i18n.getLocale?.() || document.documentElement.lang || 'en');
    const format = safeLocale(i18n.getFormatLocale?.() || ui);
    return { ui, format };
}

const intlCache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();

function numberFormat(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
    const key = `n\u0000${locale}\u0000${JSON.stringify(options)}`;
    let fmt = intlCache.get(key);
    if (!(fmt instanceof Intl.NumberFormat)) {
        fmt = new Intl.NumberFormat(locale, options);
        intlCache.set(key, fmt);
    }
    return fmt;
}

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `d\u0000${locale}\u0000${JSON.stringify(options)}`;
    let fmt = intlCache.get(key);
    if (!(fmt instanceof Intl.DateTimeFormat)) {
        fmt = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
        intlCache.set(key, fmt);
    }
    return fmt;
}

/** Locale-aware formatting (display only, never used for money calculations). */
interface Format {
    money(amount: number, currency: Currency): string;
    integer(value: number): string;
    payDate(payDate: string): string; // 'MM-DD' → '6/30', '30.6.', etc.
    monthShort(month: number): string;
    monthLong(month: number): string;
    yearLabel(year: number): string; // digits without grouping
    yearName(year: number): string; // '2026', with a suffix in some locales such as ja
    currencyName(currency: Currency): string;
    join(items: string[]): string;
}

function makeFormat(): Format {
    const { ui, format } = currentLocales();
    const day = (month: number, date = 1): Date => new Date(Date.UTC(2000, month - 1, date));
    let names: Intl.DisplayNames | null = null;
    try {
        names = new Intl.DisplayNames(ui, { type: 'currency' });
    } catch {
        names = null;
    }
    return {
        money(amount, currency) {
            const digits = amountDecimals(currency);
            const fmt = numberFormat(format, {
                style: 'currency',
                currency,
                minimumFractionDigits: digits,
                maximumFractionDigits: digits,
            });
            // Pass a decimal string: Intl formats it exactly, with no floating-point error
            return fmt.format(amountDecimal(amount, currency) as Intl.StringNumericLiteral);
        },
        integer: (value) => numberFormat(format).format(value),
        payDate(payDate) {
            const [month = '1', date = '1'] = payDate.split('-');
            const fmt = dateFormat(ui, { month: 'numeric', day: 'numeric' });
            return fmt.format(day(Number(month), Number(date)));
        },
        monthShort: (month) => dateFormat(ui, { month: 'short' }).format(day(month)),
        monthLong: (month) => dateFormat(ui, { month: 'long' }).format(day(month)),
        yearLabel: (year) => numberFormat(format, { useGrouping: false }).format(year),
        yearName: (year) =>
            dateFormat(ui, { year: 'numeric' }).format(new Date(Date.UTC(year, 0, 1))),
        currencyName(currency) {
            const name = names?.of(currency) ?? currency;
            return tr('currency.option', { name, code: currency });
        },
        join: (items) => items.join(tr('common.separator')),
    };
}

/** One bar of a chart (shared by the monthly and yearly charts). */
interface Bar extends Breakdown {
    label: string; // label under the bar ('Jun' / '2026')
    name: string; // for screen readers ('June' / '2026')
    key: 'month' | 'year'; // value goes into the segment's data-<key>
    value: string;
}

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

/** A currency select (options show the currency name, values are currency codes). */
function currencySelect(
    fmt: Format,
    name: string,
    choices: readonly Currency[],
    selected: Currency,
): HTMLSelectElement {
    const select = el('select');
    select.name = name;
    for (const currency of choices) {
        select.appendChild(option(currency, fmt.currencyName(currency), currency === selected));
    }
    return select;
}

/** Joins the per-currency totals (0 yen when empty). */
function formatTotals(fmt: Format, totals: CurrencyBreakdown[]): string {
    return totals.length === 0
        ? fmt.money(0, 'JPY')
        : fmt.join(totals.map((t) => fmt.money(t.total, t.currency)));
}

/** Pay dates for the list ('3/31, 9/30', etc.). */
function formatPayDates(fmt: Format, payments: Payment[]): string {
    return fmt.join(payments.map(({ payDate }) => fmt.payDate(payDate)));
}

/** The stock label used in the list and confirmations ('7203 Toyota Motor', or just the ticker without a name). */
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

/** Translates the response code, or uses fallbackKey (the English error text is never shown). */
async function errorMessage(res: Response, fallbackKey: string): Promise<string> {
    try {
        const body = (await res.json()) as { code?: unknown; params?: unknown };
        if (typeof body.code !== 'string' || !/^\w+$/.test(body.code)) return tr(fallbackKey);
        const params: Params = {};
        if (typeof body.params === 'object' && body.params !== null) {
            for (const [name, value] of Object.entries(body.params)) {
                if (typeof value === 'number' || typeof value === 'string') params[name] = value;
            }
        }
        return trOr(`errors.${body.code}`, fallbackKey, params);
    } catch {
        return tr(fallbackKey);
    }
}

export async function render(
    container: HTMLElement,
    context: { signal: AbortSignal },
): Promise<void> {
    const { signal } = context;
    let records: DividendRecord[] = [];
    let yearlyTotals: YearlyTotal[] = [];
    let registerYear = String(new Date().getFullYear());
    let totalsMessage = '';
    let members = new Map<number, string>();
    let me: Me = { id: 0, isAdmin: false, canWrite: false };
    let csrfToken = '';
    let filter: number | null = null;
    let chartCurrency: Currency = 'JPY';
    let listError = '';
    let dialog: HTMLDialogElement | null = null;
    let editing: DividendRecord | null = null;
    let fmt = makeFormat();
    let loaded = false;

    const memberName = (id: number): string => members.get(id) ?? tr('common.unknown_user');
    /** Holder colour slot: 1 to OWNER_COLORS by family-list order, otherwise OWNER_COLORS + 1 (other). */
    const colorSlot = (ownerId: number): number => {
        const index = [...members.keys()].indexOf(ownerId);
        return index >= 0 && index < OWNER_COLORS ? index + 1 : OWNER_COLORS + 1;
    };
    const colorClass = (ownerId: number): string => {
        const slot = colorSlot(ownerId);
        return `dt-owner-color-${slot > OWNER_COLORS ? 'other' : slot}`;
    };
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
        toolbar.appendChild(el('h1', 'page-toolbar__title', tr('title')));
        const body = el('div', 'app-page__body');
        body.append(...sections);
        // Keep an open dialog (so a language change does not close it).
        // Removing it with replaceChildren fires no close event, so `dialog` would stay set and no dialog could open again
        for (const child of [...container.childNodes]) {
            if (child !== dialog) child.remove();
        }
        container.prepend(toolbar, body);
    };

    const buildTotals = (visible: DividendRecord[]): HTMLElement => {
        const section = el('section', 'page-section');
        const totals = el('div', 'dt-totals');
        const byCurrency = annualTotals(visible);
        if (byCurrency.length === 0) {
            totals.appendChild(el('p', 'dt-total', fmt.money(0, 'JPY')));
        }
        for (const { currency, total } of byCurrency) {
            totals.appendChild(el('p', 'dt-total', fmt.money(total, currency)));
        }
        section.append(el('h2', undefined, tr('totals.title')), totals);
        if (!me.canWrite) return section;

        const year = input('number', 'registerYear', registerYear);
        year.min = String(MIN_YEAR);
        year.max = String(MAX_YEAR);
        year.step = '1';
        year.inputMode = 'numeric';
        const register = el('div', 'dt-register');
        register.append(
            labeled(tr('totals.register_year'), year),
            button(tr('totals.register'), 'register-year'),
        );
        section.appendChild(register);
        if (filter !== null) {
            section.appendChild(el('p', 'dt-note', tr('totals.all_owners_note')));
        }
        const message = el('p', 'dt-register__message', totalsMessage);
        message.setAttribute('aria-live', 'polite');
        section.appendChild(message);
        return section;
    };

    const buildList = (visible: DividendRecord[]): HTMLElement => {
        const section = el('section', 'page-section');
        const heading = el('div', 'dt-heading');
        const select = el('select');
        select.name = 'filter';
        select.appendChild(option('', tr('list.filter_all'), filter === null));
        for (const [id, name] of members) {
            select.appendChild(option(String(id), name, filter === id));
        }
        const filterField = labeled(tr('list.filter'), select);
        filterField.className = 'dt-filter';
        heading.append(el('h2', undefined, tr('list.title')), filterField);
        if (me.canWrite) heading.appendChild(button(tr('list.add'), 'add'));
        section.appendChild(heading);
        if (!me.canWrite) section.appendChild(el('p', undefined, tr('list.read_only')));
        section.appendChild(el('p', 'dt-error', listError));

        if (visible.length === 0) {
            section.appendChild(el('p', undefined, tr('list.empty')));
            return section;
        }
        const table = el('table', 'dt-list');
        const headRow = el('tr');
        if (me.canWrite) {
            const th = el('th', 'dt-delete-cell');
            th.setAttribute('aria-label', tr('list.delete'));
            headRow.appendChild(th);
        }
        for (const [key, className] of [
            ['list.col_owner', undefined],
            ['list.col_ticker', undefined],
            ['list.col_shares', 'dt-num'],
            ['list.col_pay_dates', undefined],
            ['list.col_total', 'dt-num'],
        ] as const) {
            headRow.appendChild(el('th', className, tr(key)));
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
                    remove.title = tr('list.delete');
                    remove.dataset['id'] = record.id;
                    remove.setAttribute('aria-label', tr('list.delete_label', { label }));
                    cell.appendChild(remove);
                }
                row.appendChild(cell);
            }
            const shares = tr('list.shares', {
                count: record.shares,
                shares: fmt.integer(record.shares),
            });
            row.append(
                el('td', 'dt-owner', memberName(record.ownerId)),
                el('td', undefined, label),
                el('td', 'dt-num dt-shares', shares),
                el('td', undefined, formatPayDates(fmt, record.payments)),
                el('td', 'dt-num', fmt.money(recordTotal(record), record.currency)),
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

    /** A bar chart stacked by holder colour, with tooltip and legend (shared by both charts). */
    const buildBars = (bars: Bar[], chartLabel: string, currency: Currency): HTMLElement => {
        const money = (amount: number): string => fmt.money(amount, currency);
        const max = Math.max(...bars.map((b) => b.total));
        const byColor = (a: { ownerId: number }, b: { ownerId: number }): number =>
            colorSlot(a.ownerId) - colorSlot(b.ownerId);
        const ownerAmount = (ownerId: number, amount: number): string =>
            tr('chart.owner_amount', { owner: memberName(ownerId), amount: money(amount) });

        const wrap = el('div', 'dt-chart-wrap');
        const chart = el('ol', 'dt-chart');
        chart.setAttribute('aria-label', chartLabel);
        const sumByOwner = new Map<number, number>();
        for (const { label, name, key, value, total, owners } of bars) {
            const sorted = [...owners].sort(byColor);
            const item = el('li', 'dt-chart__month');
            const breakdown = fmt.join(sorted.map((o) => ownerAmount(o.ownerId, o.total)));
            item.setAttribute(
                'aria-label',
                sorted.length === 0
                    ? tr('chart.bar', { name, amount: money(total) })
                    : tr('chart.bar_breakdown', { name, amount: money(total), breakdown }),
            );
            const track = el('div', 'dt-chart__track');
            const bar = el('div', 'dt-chart__bar');
            // Display ratio only, never used for money calculations
            bar.style.height = `${max > 0 ? (total / max) * 100 : 0}%`;
            for (const o of sorted) {
                const segment = el('div', `dt-chart__segment ${colorClass(o.ownerId)}`);
                segment.style.flexGrow = String(o.total);
                segment.dataset['tooltip'] = `${memberName(o.ownerId)}\n${money(o.total)}`;
                segment.dataset[key] = value;
                bar.appendChild(segment);
                sumByOwner.set(o.ownerId, (sumByOwner.get(o.ownerId) ?? 0) + o.total);
            }
            track.appendChild(bar);
            item.append(
                el('span', 'dt-chart__value', total > 0 ? money(total) : ''),
                track,
                el('span', 'dt-chart__label', label),
            );
            chart.appendChild(item);
        }
        const tooltip = el('div', 'dt-tooltip');
        tooltip.setAttribute('role', 'tooltip');
        tooltip.hidden = true;
        wrap.append(chart, tooltip);

        const legend = el('ul', 'dt-legend');
        const owners = Array.from(sumByOwner, ([ownerId, total]) => ({ ownerId, total }));
        for (const { ownerId, total } of owners.sort(byColor)) {
            const li = el('li');
            li.append(
                el('span', `dt-legend__swatch ${colorClass(ownerId)}`),
                document.createTextNode(ownerAmount(ownerId, total)),
            );
            legend.appendChild(li);
        }
        wrap.appendChild(legend);
        return wrap;
    };

    const buildMonthly = (visible: DividendRecord[], choices: Currency[]): HTMLElement => {
        const section = el('section', 'page-section');
        const title = el('h2', undefined, tr('chart.monthly'));
        if (choices.length >= 2) {
            // The currency choice applies to both the monthly and yearly charts
            const heading = el('div', 'dt-heading');
            const field = labeled(
                tr('chart.currency'),
                currencySelect(fmt, 'chartCurrency', choices, chartCurrency),
            );
            field.className = 'dt-filter';
            heading.append(title, field);
            section.appendChild(heading);
        } else {
            section.appendChild(title);
        }
        if (visible.length === 0) {
            section.appendChild(el('p', undefined, tr('list.empty')));
            return section;
        }
        const bars = monthlyTotals(visible, chartCurrency).map((m) => ({
            ...m,
            label: fmt.monthShort(m.month),
            name: fmt.monthLong(m.month),
            key: 'month' as const,
            value: String(m.month),
        }));
        section.appendChild(buildBars(bars, tr('chart.monthly'), chartCurrency));
        return section;
    };

    const buildYearly = (): HTMLElement => {
        const section = el('section', 'page-section');
        section.appendChild(el('h2', undefined, tr('chart.yearly')));
        const endYear = Math.max(new Date().getFullYear(), ...yearlyTotals.map((t) => t.year));
        const bars = yearlyChart(yearlyTotals, endYear, filter, chartCurrency).map((b) => ({
            ...b,
            label: fmt.yearLabel(b.year),
            name: fmt.yearName(b.year),
            key: 'year' as const,
            value: String(b.year),
        }));
        if (bars.every((b) => b.total === 0)) {
            section.appendChild(el('p', undefined, tr('chart.no_years')));
            return section;
        }
        section.appendChild(buildBars(bars, tr('chart.yearly'), chartCurrency));
        return section;
    };

    const draw = (): void => {
        fmt = makeFormat();
        const visible = filterByOwner(records, filter);
        // Choices come from all records regardless of the holder filter (so filtering does not change them)
        const choices = usedCurrencies(records, yearlyTotals);
        const first = choices[0];
        if (first !== undefined && !choices.includes(chartCurrency)) chartCurrency = first;
        shell(
            buildList(visible),
            buildTotals(visible),
            buildMonthly(visible, choices),
            buildYearly(),
        );
    };

    // ---- Dialog ----

    /** A month or day select (two-digit values, starting with an empty option). */
    const dateSelect = (name: string, ariaKey: string, selected: string): HTMLSelectElement => {
        const isMonth = name === 'payMonth';
        const select = el('select');
        select.name = name;
        select.setAttribute('aria-label', tr(ariaKey));
        const placeholder = tr(isMonth ? 'field.month_placeholder' : 'field.day_placeholder');
        select.appendChild(option('', placeholder, selected === ''));
        for (let n = 1; n <= (isMonth ? 12 : 31); n++) {
            const value = String(n).padStart(2, '0');
            const text = isMonth
                ? fmt.monthLong(n)
                : tr('field.day_option', { day: fmt.integer(n) });
            select.appendChild(option(value, text, value === selected));
        }
        return select;
    };

    const paymentRow = (payDate = '', perShare = ''): HTMLElement => {
        const row = el('div', 'dt-payment');
        const perShareInput = input('text', 'perShare', perShare);
        perShareInput.inputMode = 'decimal';
        const [month = '', day = ''] = payDate.split('-');
        const payday = el('div', 'dt-payday');
        payday.append(
            dateSelect('payMonth', 'field.pay_month', month),
            dateSelect('payDay', 'field.pay_day', day),
        );
        row.append(
            labeled(tr('field.pay_date'), payday),
            labeled(tr('field.per_share'), perShareInput),
            button(tr('dialog.remove_payment'), 'remove-payment', 'dt-button--secondary'),
        );
        return row;
    };

    /** Enables or disables Remove and Add pay date for the number of rows. */
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
        fmt = makeFormat();

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
        payments.appendChild(el('legend', undefined, tr('field.payments')));
        if (record) {
            for (const p of record.payments) {
                payments.appendChild(
                    paymentRow(p.payDate, perShareInputText(p.perShareCents, record.currency)),
                );
            }
        } else {
            payments.appendChild(paymentRow());
        }
        payments.appendChild(
            button(tr('dialog.add_payment'), 'add-payment', 'dt-button--secondary'),
        );

        const submit = el(
            'button',
            undefined,
            tr(record ? 'dialog.submit_save' : 'dialog.submit_add'),
        );
        submit.type = 'submit';
        const actions = el('div', 'dt-actions');
        actions.append(button(tr('dialog.cancel'), 'cancel', 'dt-button--secondary'), submit);

        const form = el('form', 'dt-form');
        const ownerField = labeled(tr('field.owner'), owner);
        ownerField.className = 'dt-field--wide';
        const currencyField = labeled(
            tr('field.currency'),
            currencySelect(fmt, 'currency', CURRENCIES, record?.currency ?? 'JPY'),
        );
        form.append(
            labeled(tr('field.ticker'), input('text', 'ticker', record?.ticker ?? '')),
            labeled(tr('field.name'), input('text', 'name', record?.name ?? '')),
            labeled(tr('field.shares'), shares),
            currencyField,
            ownerField,
            payments,
            el('p', 'dt-error'),
            actions,
        );
        refreshPaymentButtons(form);

        dialog = el('dialog', 'dt-dialog');
        dialog.append(
            el('h2', undefined, tr(record ? 'dialog.edit_title' : 'dialog.add_title')),
            form,
        );
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
        const months = data.getAll('payMonth').map(String);
        const days = data.getAll('payDay').map(String);
        const perShares = data.getAll('perShare').map(String);
        // Empty when the month or day is missing (validateInput then returns pay_date_invalid)
        const dates = months.map((month, i) => {
            const day = days[i] ?? '';
            return month !== '' && day !== '' ? `${month}-${day}` : '';
        });
        return {
            ownerId: Number(text('ownerId')),
            currency: text('currency'),
            ticker: text('ticker'),
            name: text('name'),
            sharesText: text('shares'),
            payments: dates.map((payDate, i) => ({ payDate, perShareText: perShares[i] ?? '' })),
        };
    };

    const showFailure = (message = tr('errors.load_failed')): void => {
        const section = el('section', 'page-section');
        const retry = button(tr('reload'), 'reload');
        section.append(el('p', 'dt-error', message), retry);
        shell(section);
    };

    const load = async (): Promise<void> => {
        loaded = false;
        shell(el('p', undefined, tr('loading')));
        try {
            const [memberBody, res] = await Promise.all([
                api.get('/family/members', { signal }),
                fetch(ENDPOINT, { credentials: 'same-origin', cache: 'no-store', signal }),
            ]);
            if (signal.aborted) return;
            if (!res.ok) {
                const message = await errorMessage(res, 'errors.load_failed');
                if (!signal.aborted) showFailure(message);
                return;
            }
            const body = (await res.json()) as {
                data?: unknown;
                yearlyTotals?: unknown;
                me?: Partial<Me>;
                csrfToken?: unknown;
            };
            if (signal.aborted) return;
            members = parseMembers(memberBody);
            records = Array.isArray(body.data) ? body.data.filter(isValidRecord) : [];
            yearlyTotals = Array.isArray(body.yearlyTotals)
                ? body.yearlyTotals.filter(isValidYearlyTotal).sort((a, b) => a.year - b.year)
                : [];
            me = {
                id: typeof body.me?.id === 'number' ? body.me.id : 0,
                isAdmin: body.me?.isAdmin === true,
                canWrite: body.me?.canWrite === true,
            };
            csrfToken = typeof body.csrfToken === 'string' ? body.csrfToken : '';
            if (filter !== null && !members.has(filter)) filter = null;
            loaded = true;
            draw();
        } catch {
            if (!signal.aborted) showFailure();
        }
    };

    const deleteRecord = async (deleteButton: HTMLButtonElement): Promise<void> => {
        const record = records.find((r) => r.id === deleteButton.dataset['id']);
        if (!record || !canEdit(record)) return;
        const message = tr('list.confirm_delete', {
            label: recordLabel(record),
            owner: memberName(record.ownerId),
        });
        if (!window.confirm(message)) return;
        deleteButton.disabled = true;
        try {
            const res = await request('DELETE', `${ENDPOINT}/${encodeURIComponent(record.id)}`);
            if (signal.aborted) return;
            if (res.ok) {
                records = records.filter((r) => r.id !== record.id);
                listError = '';
            } else {
                listError = await errorMessage(res, 'errors.delete_failed');
                if (signal.aborted) return;
            }
        } catch {
            if (signal.aborted) return;
            listError = tr('errors.delete_failed');
        }
        draw();
    };

    const registerYearlyTotal = async (registerButton: HTMLButtonElement): Promise<void> => {
        const year = parseYear(registerYear.trim());
        if (year === null) {
            totalsMessage = tr('errors.invalid_year', { min: MIN_YEAR, max: MAX_YEAR });
            draw();
            return;
        }
        const registered = yearlyTotals.find((t) => t.year === year);
        if (
            registered &&
            !window.confirm(
                tr('totals.confirm_replace', {
                    year: fmt.yearName(year),
                    amount: formatTotals(fmt, registered.totals),
                }),
            )
        ) {
            return;
        }
        registerButton.disabled = true;
        try {
            const res = await request('PUT', `${YEARLY_ENDPOINT}/${year}`);
            if (signal.aborted) return;
            if (res.ok) {
                const body = (await res.json()) as { data?: unknown };
                if (signal.aborted) return;
                const saved = body.data;
                if (isValidYearlyTotal(saved)) {
                    yearlyTotals = [
                        ...yearlyTotals.filter((t) => t.year !== saved.year),
                        saved,
                    ].sort((a, b) => a.year - b.year);
                    totalsMessage = tr('totals.registered', {
                        year: fmt.yearName(year),
                        amount: formatTotals(fmt, saved.totals),
                    });
                } else {
                    totalsMessage = tr('errors.register_failed');
                }
            } else {
                totalsMessage = await errorMessage(res, 'errors.register_failed');
                if (signal.aborted) return;
            }
        } catch {
            if (signal.aborted) return;
            totalsMessage = tr('errors.register_failed');
        }
        draw();
    };

    const openEditor = (row: Element): void => {
        const id = row instanceof HTMLElement ? row.dataset['id'] : undefined;
        const record = records.find((r) => r.id === id);
        if (record && canEdit(record)) openDialog(record);
    };

    // Redraw when the display language changes (an open dialog stays as it is)
    window.addEventListener(
        'locale-changed',
        () => {
            if (loaded) draw();
        },
        { signal },
    );

    container.addEventListener(
        'change',
        (e) => {
            const target = e.target;
            if (!(target instanceof HTMLSelectElement)) return;
            if (target.name === 'chartCurrency') {
                const choice = CURRENCIES.find((c) => c === target.value);
                if (choice) chartCurrency = choice;
                draw();
                return;
            }
            if (target.name !== 'filter') return;
            filter = target.value === '' ? null : Number(target.value);
            listError = '';
            draw();
        },
        { signal },
    );

    container.addEventListener(
        'input',
        (e) => {
            const target = e.target;
            if (target instanceof HTMLInputElement && target.name === 'registerYear') {
                registerYear = target.value;
            }
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
                showError(tr(`errors.${error.code}`, error.params));
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
                    showError(await errorMessage(res, 'errors.save_failed'));
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
                if (!signal.aborted) showError(tr('errors.save_failed'));
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
            } else if (action === 'register-year' && actionEl instanceof HTMLButtonElement) {
                await registerYearlyTotal(actionEl);
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

    const hideTooltip = (): void => {
        for (const tip of container.querySelectorAll<HTMLElement>('.dt-tooltip')) {
            tip.hidden = true;
        }
    };

    const showTooltip = (segment: HTMLElement): void => {
        const wrap = segment.closest('.dt-chart-wrap');
        const tip = wrap?.querySelector<HTMLElement>('.dt-tooltip');
        if (!(wrap instanceof HTMLElement) || !tip) return;
        const [name = '', amount = ''] = (segment.dataset['tooltip'] ?? '').split('\n');
        tip.replaceChildren(
            el('span', 'dt-tooltip__name', name),
            el('span', 'dt-tooltip__amount', amount),
        );
        tip.hidden = false;
        const area = wrap.getBoundingClientRect();
        const rect = segment.getBoundingClientRect();
        const half = tip.offsetWidth / 2;
        const center = rect.left + rect.width / 2 - area.left;
        tip.style.left = `${Math.min(Math.max(center, half), Math.max(half, area.width - half))}px`;
        tip.style.top = `${rect.top - area.top}px`;
    };

    container.addEventListener(
        'pointerover',
        (e) => {
            if (!(e.target instanceof Element)) return;
            const segment = e.target.closest('.dt-chart__segment');
            if (segment instanceof HTMLElement) showTooltip(segment);
        },
        { signal },
    );

    container.addEventListener(
        'pointerout',
        (e) => {
            // Touch sends pointerout on release, so keep the tooltip until something else is touched
            if (e.pointerType === 'touch') return;
            if (e.target instanceof Element && e.target.closest('.dt-chart__segment')) {
                hideTooltip();
            }
        },
        { signal },
    );

    container.addEventListener(
        'pointerdown',
        (e) => {
            if (e.target instanceof Element && !e.target.closest('.dt-chart__segment')) {
                hideTooltip();
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
