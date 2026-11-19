import { api } from "/api.js";
import * as i18n from "/i18n.js";
// src/logic.ts
var CURRENCIES = [
	"JPY",
	"USD",
	"EUR",
	"GBP",
	"AUD",
	"CAD",
	"CHF",
	"HKD",
	"CNY",
	"SGD"
];
var MAX_SHARES = 1e7;
var MAX_PER_SHARE_CENTS = 1e7;
var MIN_YEAR = 2e3;
var MAX_YEAR = 2100;
function isPositiveInt(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function compareText(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}
function isCurrency(value) {
	return typeof value === "string" && CURRENCIES.includes(value);
}
/** Number of decimal places for the dividend per share. */
function perShareDecimals(currency) {
	return currency === "JPY" ? 2 : 4;
}
function parseShares(text) {
	if (!/^[1-9]\d*$/.test(text)) return null;
	const value = Number(text);
	return value <= MAX_SHARES ? value : null;
}
function parsePerShare(text, currency) {
	const decimals = perShareDecimals(currency);
	const match = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(text);
	if (!match) return null;
	const units = BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt((match[2] ?? "").padEnd(decimals, "0"));
	return units <= BigInt(MAX_PER_SHARE_CENTS) ? Number(units) : null;
}
/** Amount received, floored to the amount unit (JPY: 1 yen, others: 1/100). */
function calcAmount(shares, perShareCents) {
	return Number(BigInt(shares) * BigInt(perShareCents) / 100n);
}
function isValidDate(text) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
/** Whether 'MM-DD' is a real day in a leap year (2000). */
function isValidPayDate(text) {
	return /^\d{2}-\d{2}$/.test(text) && isValidDate(`2000-${text}`);
}
function validateInput(input) {
	if (!isPositiveInt(input.ownerId)) return { code: "owner_required" };
	const { currency } = input;
	if (!isCurrency(currency)) return { code: "currency_required" };
	if (input.ticker.trim() === "") return { code: "ticker_required" };
	if (parseShares(input.sharesText) === null) return { code: "shares_invalid" };
	if (input.payments.length === 0) return { code: "payments_required" };
	if (input.payments.length > 24) return {
		code: "payments_too_many",
		params: { max: 24 }
	};
	for (const payment of input.payments) {
		if (!isValidPayDate(payment.payDate)) return { code: "pay_date_invalid" };
		if (parsePerShare(payment.perShareText, currency) === null) return {
			code: "per_share_invalid",
			params: { decimals: perShareDecimals(currency) }
		};
	}
	if (new Set(input.payments.map((p) => p.payDate)).size !== input.payments.length) return { code: "pay_date_duplicate" };
	return null;
}
function isValidShares(value) {
	return isPositiveInt(value) && value <= MAX_SHARES;
}
function isValidPerShareCents(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_PER_SHARE_CENTS;
}
function isValidPayment(value, shares, isDate) {
	if (typeof value !== "object" || value === null) return false;
	const p = value;
	const { perShareCents } = p;
	return typeof p["payDate"] === "string" && isDate(p["payDate"]) && isValidPerShareCents(perShareCents) && p["amount"] === calcAmount(shares, perShareCents);
}
/**
* Checks the shape of a record (not its currency).
* Only the date format can vary (MM-DD from v0.4, YYYY-MM-DD in v0.3).
*/
function isRecordShape(value, isDate) {
	if (typeof value !== "object" || value === null) return false;
	const r = value;
	const { shares, payments } = r;
	if (!isValidShares(shares)) return false;
	if (!Array.isArray(payments) || payments.length === 0 || payments.length > 24) return false;
	for (let i = 0; i < payments.length; i++) {
		const payment = payments[i];
		if (!isValidPayment(payment, shares, isDate)) return false;
		if (i > 0 && payments[i - 1].payDate >= payment.payDate) return false;
	}
	return typeof r["id"] === "string" && isPositiveInt(r["ownerId"]) && typeof r["ticker"] === "string" && r["ticker"] !== "" && typeof r["name"] === "string" && isPositiveInt(r["createdBy"]) && typeof r["createdAt"] === "string" && typeof r["updatedAt"] === "string";
}
function isValidRecord(value) {
	return isRecordShape(value, isValidPayDate) && isCurrency(value["currency"]);
}
function filterByOwner(records, ownerId) {
	return ownerId === null ? [...records] : records.filter((r) => r.ownerId === ownerId);
}
function recordTotal(record) {
	return record.payments.reduce((sum, p) => sum + p.amount, 0);
}
function toBreakdown(byOwner) {
	const owners = Array.from(byOwner, ([ownerId, total]) => ({
		ownerId,
		total
	})).filter((o) => o.total > 0).sort((a, b) => a.ownerId - b.ownerId);
	return {
		total: owners.reduce((sum, o) => sum + o.total, 0),
		owners
	};
}
/** One year of amounts with a breakdown by holder, per currency (in currency order, 0 omitted). */
function annualTotals(records) {
	const result = [];
	for (const currency of CURRENCIES) {
		const byOwner = /* @__PURE__ */ new Map();
		for (const record of records) {
			if (record.currency !== currency) continue;
			byOwner.set(record.ownerId, (byOwner.get(record.ownerId) ?? 0) + recordTotal(record));
		}
		const breakdown = toBreakdown(byOwner);
		if (breakdown.total > 0) result.push({
			currency,
			...breakdown
		});
	}
	return result;
}
function isValidYear(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 2e3 && value <= 2100;
}
/** True when owners are strictly ascending by ownerId, each total is 1 or more, and total is their sum. */
function isValidBreakdown(owners, total) {
	if (!Array.isArray(owners)) return false;
	let sum = 0;
	let previous = 0;
	for (const item of owners) {
		if (typeof item !== "object" || item === null) return false;
		const o = item;
		if (!isPositiveInt(o["ownerId"]) || !isPositiveInt(o["total"])) return false;
		if (o["ownerId"] <= previous) return false;
		previous = o["ownerId"];
		sum += o["total"];
	}
	return total === sum;
}
function isValidRegistration(t) {
	return isValidYear(t["year"]) && isPositiveInt(t["registeredBy"]) && typeof t["registeredAt"] === "string";
}
function isValidYearlyTotal(value) {
	if (typeof value !== "object" || value === null) return false;
	const t = value;
	const { totals } = t;
	if (!Array.isArray(totals) || !isValidRegistration(t)) return false;
	let previous = -1;
	for (const item of totals) {
		if (typeof item !== "object" || item === null) return false;
		const c = item;
		if (!isCurrency(c["currency"])) return false;
		const index = CURRENCIES.indexOf(c["currency"]);
		if (index <= previous) return false;
		previous = index;
		if (!isPositiveInt(c["total"]) || !isValidBreakdown(c["owners"], c["total"])) return false;
	}
	return true;
}
/** Parses 'YYYY' into an integer from MIN_YEAR to MAX_YEAR, otherwise null. */
function parseYear(text) {
	if (!/^\d{4}$/.test(text)) return null;
	const year = Number(text);
	return isValidYear(year) ? year : null;
}
/** For each month 1 to 12, the total in that currency (one year of records) with a breakdown by holder. */
function monthlyTotals(records, currency) {
	const byOwner = Array.from({ length: 12 }, () => /* @__PURE__ */ new Map());
	for (const record of records) {
		if (record.currency !== currency) continue;
		for (const payment of record.payments) {
			const owners = byOwner[Number(payment.payDate.substring(0, 2)) - 1];
			if (!owners) continue;
			owners.set(record.ownerId, (owners.get(record.ownerId) ?? 0) + payment.amount);
		}
	}
	return byOwner.map((owners, i) => ({
		month: i + 1,
		...toBreakdown(owners)
	}));
}
/**
* For the yearly chart: CHART_YEARS years up to endYear, ascending. Years or currencies not registered are 0.
* When ownerId is not null, only that holder is counted.
*/
function yearlyChart(totals, endYear, ownerId, currency) {
	return Array.from({ length: 12 }, (_, i) => {
		const year = endYear - 12 + 1 + i;
		const owners = ((totals.find((t) => t.year === year)?.totals.find((c) => c.currency === currency))?.owners ?? []).filter((o) => ownerId === null || o.ownerId === ownerId).map((o) => ({ ...o }));
		return {
			year,
			total: owners.reduce((sum, o) => sum + o.total, 0),
			owners
		};
	});
}
/** Currencies used in the records and yearly totals (no duplicates, in currency order). */
function usedCurrencies(records, totals) {
	const used = new Set(records.map((r) => r.currency));
	for (const t of totals) for (const c of t.totals) used.add(c.currency);
	return CURRENCIES.filter((c) => used.has(c));
}
/** For the list: ascending by ticker, then ownerId, then id. */
function sortForList(records) {
	return [...records].sort((a, b) => compareText(a.ticker, b.ticker) || a.ownerId - b.ownerId || compareText(a.id, b.id));
}
/** Splits a non-negative integer, read as a fixed-point number with `decimals` places, into whole and fraction strings. */
function splitFixed(value, decimals) {
	const digits = String(value).padStart(decimals + 1, "0");
	return [digits.slice(0, digits.length - decimals), digits.slice(digits.length - decimals)];
}
/** Decimal places of an amount (JPY: 0, others: 2). */
function amountDecimals(currency) {
	return currency === "JPY" ? 0 : 2;
}
/**
* Writes an amount as a decimal string (1234 JPY → '1234', 123456 USD → '1234.56').
* No grouping or currency symbol; the UI formats it with Intl.
*/
function amountDecimal(amount, currency) {
	const decimals = amountDecimals(currency);
	if (decimals === 0) return String(amount);
	const [whole, fraction] = splitFixed(amount, decimals);
	return `${whole}.${fraction}`;
}
/** Turns a dividend per share back into input text (3750 JPY → '37.5', 2475 USD → '0.2475'). */
function perShareInputText(perShareCents, currency) {
	const [whole, fraction] = splitFixed(perShareCents, perShareDecimals(currency));
	const trimmed = fraction.replace(/0+$/, "");
	return trimmed === "" ? whole : `${whole}.${trimmed}`;
}
// src/index.ts
var ENDPOINT = "/api/extensions/dividend-tracker/records";
var YEARLY_ENDPOINT = "/api/extensions/dividend-tracker/yearly-totals";
var KEY_PREFIX = "extensions.dividend-tracker.";
var OWNER_COLORS = 8;
/** A module string (a key in locales/<locale>.json). */
function tr(key, params) {
	return i18n.t(KEY_PREFIX + key, params);
}
/** The translation, or the fallback key's translation when there is none (t returned the key). */
function trOr(key, fallbackKey, params) {
	const text = tr(key, params);
	return text === KEY_PREFIX + key ? tr(fallbackKey) : text;
}
/** The tag if Intl accepts it, otherwise 'en'. */
function safeLocale(tag) {
	if (!tag) return "en";
	try {
		return Intl.getCanonicalLocales(tag)[0] ?? "en";
	} catch {
		return "en";
	}
}
/** UI language (dates, text) and number-format region (numbers, amounts). Read again on every draw(). */
function currentLocales() {
	const ui = safeLocale(i18n.getLocale?.() || document.documentElement.lang || "en");
	return {
		ui,
		format: safeLocale(i18n.getFormatLocale?.() || ui)
	};
}
var intlCache = /* @__PURE__ */ new Map();
function numberFormat(locale, options = {}) {
	const key = `n\u0000${locale}\u0000${JSON.stringify(options)}`;
	let fmt = intlCache.get(key);
	if (!(fmt instanceof Intl.NumberFormat)) {
		fmt = new Intl.NumberFormat(locale, options);
		intlCache.set(key, fmt);
	}
	return fmt;
}
function dateFormat(locale, options) {
	const key = `d\u0000${locale}\u0000${JSON.stringify(options)}`;
	let fmt = intlCache.get(key);
	if (!(fmt instanceof Intl.DateTimeFormat)) {
		fmt = new Intl.DateTimeFormat(locale, {
			...options,
			timeZone: "UTC"
		});
		intlCache.set(key, fmt);
	}
	return fmt;
}
function makeFormat() {
	const { ui, format } = currentLocales();
	const day = (month, date = 1) => new Date(Date.UTC(2e3, month - 1, date));
	let names = null;
	try {
		names = new Intl.DisplayNames(ui, { type: "currency" });
	} catch {
		names = null;
	}
	return {
		money(amount, currency) {
			const digits = amountDecimals(currency);
			return numberFormat(format, {
				style: "currency",
				currency,
				minimumFractionDigits: digits,
				maximumFractionDigits: digits
			}).format(amountDecimal(amount, currency));
		},
		integer: (value) => numberFormat(format).format(value),
		payDate(payDate) {
			const [month = "1", date = "1"] = payDate.split("-");
			return dateFormat(ui, {
				month: "numeric",
				day: "numeric"
			}).format(day(Number(month), Number(date)));
		},
		monthShort: (month) => dateFormat(ui, { month: "short" }).format(day(month)),
		monthLong: (month) => dateFormat(ui, { month: "long" }).format(day(month)),
		yearLabel: (year) => numberFormat(format, { useGrouping: false }).format(year),
		yearName: (year) => dateFormat(ui, { year: "numeric" }).format(new Date(Date.UTC(year, 0, 1))),
		currencyName(currency) {
			return tr("currency.option", {
				name: names?.of(currency) ?? currency,
				code: currency
			});
		},
		join: (items) => items.join(tr("common.separator"))
	};
}
function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== void 0) node.textContent = text;
	return node;
}
function labeled(text, control) {
	const label = el("label", void 0, text);
	label.appendChild(control);
	return label;
}
function input(type, name, value = "") {
	const node = el("input");
	node.type = type;
	node.name = name;
	node.value = value;
	return node;
}
function option(value, text, selected = false) {
	const node = el("option", void 0, text);
	node.value = value;
	node.selected = selected;
	return node;
}
function button(text, action, className) {
	const node = el("button", className, text);
	node.type = "button";
	node.dataset["action"] = action;
	return node;
}
/** A currency select (options show the currency name, values are currency codes). */
function currencySelect(fmt, name, choices, selected) {
	const select = el("select");
	select.name = name;
	for (const currency of choices) select.appendChild(option(currency, fmt.currencyName(currency), currency === selected));
	return select;
}
/** Joins the per-currency totals (0 yen when empty). */
function formatTotals(fmt, totals) {
	return totals.length === 0 ? fmt.money(0, "JPY") : fmt.join(totals.map((t) => fmt.money(t.total, t.currency)));
}
/** Pay dates for the list ('3/31, 9/30', etc.). */
function formatPayDates(fmt, payments) {
	return fmt.join(payments.map(({ payDate }) => fmt.payDate(payDate)));
}
/** The stock label used in the list and confirmations ('7203 Toyota Motor', or just the ticker without a name). */
function recordLabel(record) {
	return record.name === "" ? record.ticker : `${record.ticker} ${record.name}`;
}
function parseMembers(body) {
	const map = /* @__PURE__ */ new Map();
	const data = body?.data;
	if (!Array.isArray(data)) return map;
	for (const m of data) {
		const { id, display_name } = m ?? {};
		if (typeof id === "number" && Number.isInteger(id) && id > 0) map.set(id, typeof display_name === "string" ? display_name : String(id));
	}
	return map;
}
/** Translates the response code, or uses fallbackKey (the English error text is never shown). */
async function errorMessage(res, fallbackKey) {
	try {
		const body = await res.json();
		if (typeof body.code !== "string" || !/^\w+$/.test(body.code)) return tr(fallbackKey);
		const params = {};
		if (typeof body.params === "object" && body.params !== null) {
			for (const [name, value] of Object.entries(body.params)) if (typeof value === "number" || typeof value === "string") params[name] = value;
		}
		return trOr(`errors.${body.code}`, fallbackKey, params);
	} catch {
		return tr(fallbackKey);
	}
}
async function render(container, context) {
	const { signal } = context;
	let records = [];
	let yearlyTotals = [];
	let registerYear = String((/* @__PURE__ */ new Date()).getFullYear());
	let totalsMessage = "";
	let members = /* @__PURE__ */ new Map();
	let me = {
		id: 0,
		isAdmin: false,
		canWrite: false
	};
	let csrfToken = "";
	let filter = null;
	let chartCurrency = "JPY";
	let listError = "";
	let dialog = null;
	let editing = null;
	let fmt = makeFormat();
	let loaded = false;
	const memberName = (id) => members.get(id) ?? tr("common.unknown_user");
	/** Holder colour slot: 1 to OWNER_COLORS by family-list order, otherwise OWNER_COLORS + 1 (other). */
	const colorSlot = (ownerId) => {
		const index = [...members.keys()].indexOf(ownerId);
		return index >= 0 && index < OWNER_COLORS ? index + 1 : 9;
	};
	const colorClass = (ownerId) => {
		const slot = colorSlot(ownerId);
		return `dt-owner-color-${slot > OWNER_COLORS ? "other" : slot}`;
	};
	const canEdit = (record) => me.canWrite && (me.isAdmin || record.ownerId === me.id);
	const request = (method, url, body) => fetch(url, {
		method,
		credentials: "same-origin",
		cache: "no-store",
		signal,
		headers: {
			"X-DT-CSRF": csrfToken,
			...body === void 0 ? {} : { "Content-Type": "application/json" }
		},
		body: body === void 0 ? void 0 : JSON.stringify(body)
	});
	const shell = (...sections) => {
		const toolbar = el("div", "page-toolbar");
		toolbar.appendChild(el("h1", "page-toolbar__title", tr("title")));
		const body = el("div", "app-page__body");
		body.append(...sections);
		for (const child of [...container.childNodes]) if (child !== dialog) child.remove();
		container.prepend(toolbar, body);
	};
	const buildTotals = (visible) => {
		const section = el("section", "page-section");
		const totals = el("div", "dt-totals");
		const byCurrency = annualTotals(visible);
		if (byCurrency.length === 0) totals.appendChild(el("p", "dt-total", fmt.money(0, "JPY")));
		for (const { currency, total } of byCurrency) totals.appendChild(el("p", "dt-total", fmt.money(total, currency)));
		section.append(el("h2", void 0, tr("totals.title")), totals);
		if (!me.canWrite) return section;
		const year = input("number", "registerYear", registerYear);
		year.min = String(MIN_YEAR);
		year.max = String(MAX_YEAR);
		year.step = "1";
		year.inputMode = "numeric";
		const register = el("div", "dt-register");
		register.append(labeled(tr("totals.register_year"), year), button(tr("totals.register"), "register-year"));
		section.appendChild(register);
		if (filter !== null) section.appendChild(el("p", "dt-note", tr("totals.all_owners_note")));
		const message = el("p", "dt-register__message", totalsMessage);
		message.setAttribute("aria-live", "polite");
		section.appendChild(message);
		return section;
	};
	const buildList = (visible) => {
		const section = el("section", "page-section");
		const heading = el("div", "dt-heading");
		const select = el("select");
		select.name = "filter";
		select.appendChild(option("", tr("list.filter_all"), filter === null));
		for (const [id, name] of members) select.appendChild(option(String(id), name, filter === id));
		const filterField = labeled(tr("list.filter"), select);
		filterField.className = "dt-filter";
		heading.append(el("h2", void 0, tr("list.title")), filterField);
		if (me.canWrite) heading.appendChild(button(tr("list.add"), "add"));
		section.appendChild(heading);
		if (!me.canWrite) section.appendChild(el("p", void 0, tr("list.read_only")));
		section.appendChild(el("p", "dt-error", listError));
		if (visible.length === 0) {
			section.appendChild(el("p", void 0, tr("list.empty")));
			return section;
		}
		const table = el("table", "dt-list");
		const headRow = el("tr");
		if (me.canWrite) {
			const th = el("th", "dt-delete-cell");
			th.setAttribute("aria-label", tr("list.delete"));
			headRow.appendChild(th);
		}
		for (const [key, className] of [
			["list.col_owner", void 0],
			["list.col_ticker", void 0],
			["list.col_shares", "dt-num"],
			["list.col_pay_dates", void 0],
			["list.col_total", "dt-num"]
		]) headRow.appendChild(el("th", className, tr(key)));
		table.appendChild(el("thead")).appendChild(headRow);
		const tbody = el("tbody");
		for (const record of sortForList(visible)) {
			const row = el("tr");
			const label = recordLabel(record);
			if (me.canWrite) {
				const cell = el("td", "dt-delete-cell");
				if (canEdit(record)) {
					const remove = button("×", "delete", "dt-button--danger");
					remove.title = tr("list.delete");
					remove.dataset["id"] = record.id;
					remove.setAttribute("aria-label", tr("list.delete_label", { label }));
					cell.appendChild(remove);
				}
				row.appendChild(cell);
			}
			const shares = tr("list.shares", {
				count: record.shares,
				shares: fmt.integer(record.shares)
			});
			row.append(el("td", "dt-owner", memberName(record.ownerId)), el("td", void 0, label), el("td", "dt-num dt-shares", shares), el("td", void 0, formatPayDates(fmt, record.payments)), el("td", "dt-num", fmt.money(recordTotal(record), record.currency)));
			if (canEdit(record)) {
				row.className = "dt-row--editable";
				row.dataset["id"] = record.id;
				row.tabIndex = 0;
			}
			tbody.appendChild(row);
		}
		table.appendChild(tbody);
		section.appendChild(table);
		return section;
	};
	/** A bar chart stacked by holder colour, with tooltip and legend (shared by both charts). */
	const buildBars = (bars, chartLabel, currency) => {
		const money = (amount) => fmt.money(amount, currency);
		const max = Math.max(...bars.map((b) => b.total));
		const byColor = (a, b) => colorSlot(a.ownerId) - colorSlot(b.ownerId);
		const ownerAmount = (ownerId, amount) => tr("chart.owner_amount", {
			owner: memberName(ownerId),
			amount: money(amount)
		});
		const wrap = el("div", "dt-chart-wrap");
		const chart = el("ol", "dt-chart");
		chart.setAttribute("aria-label", chartLabel);
		const sumByOwner = /* @__PURE__ */ new Map();
		for (const { label, name, key, value, total, owners } of bars) {
			const sorted = [...owners].sort(byColor);
			const item = el("li", "dt-chart__month");
			const breakdown = fmt.join(sorted.map((o) => ownerAmount(o.ownerId, o.total)));
			item.setAttribute("aria-label", sorted.length === 0 ? tr("chart.bar", {
				name,
				amount: money(total)
			}) : tr("chart.bar_breakdown", {
				name,
				amount: money(total),
				breakdown
			}));
			const track = el("div", "dt-chart__track");
			const bar = el("div", "dt-chart__bar");
			bar.style.height = `${max > 0 ? total / max * 100 : 0}%`;
			for (const o of sorted) {
				const segment = el("div", `dt-chart__segment ${colorClass(o.ownerId)}`);
				segment.style.flexGrow = String(o.total);
				segment.dataset["tooltip"] = `${memberName(o.ownerId)}\n${money(o.total)}`;
				segment.dataset[key] = value;
				bar.appendChild(segment);
				sumByOwner.set(o.ownerId, (sumByOwner.get(o.ownerId) ?? 0) + o.total);
			}
			track.appendChild(bar);
			item.append(el("span", "dt-chart__value", total > 0 ? money(total) : ""), track, el("span", "dt-chart__label", label));
			chart.appendChild(item);
		}
		const tooltip = el("div", "dt-tooltip");
		tooltip.setAttribute("role", "tooltip");
		tooltip.hidden = true;
		wrap.append(chart, tooltip);
		const legend = el("ul", "dt-legend");
		const owners = Array.from(sumByOwner, ([ownerId, total]) => ({
			ownerId,
			total
		}));
		for (const { ownerId, total } of owners.sort(byColor)) {
			const li = el("li");
			li.append(el("span", `dt-legend__swatch ${colorClass(ownerId)}`), document.createTextNode(ownerAmount(ownerId, total)));
			legend.appendChild(li);
		}
		wrap.appendChild(legend);
		return wrap;
	};
	const buildMonthly = (visible, choices) => {
		const section = el("section", "page-section");
		const title = el("h2", void 0, tr("chart.monthly"));
		if (choices.length >= 2) {
			const heading = el("div", "dt-heading");
			const field = labeled(tr("chart.currency"), currencySelect(fmt, "chartCurrency", choices, chartCurrency));
			field.className = "dt-filter";
			heading.append(title, field);
			section.appendChild(heading);
		} else section.appendChild(title);
		if (visible.length === 0) {
			section.appendChild(el("p", void 0, tr("list.empty")));
			return section;
		}
		const bars = monthlyTotals(visible, chartCurrency).map((m) => ({
			...m,
			label: fmt.monthShort(m.month),
			name: fmt.monthLong(m.month),
			key: "month",
			value: String(m.month)
		}));
		section.appendChild(buildBars(bars, tr("chart.monthly"), chartCurrency));
		return section;
	};
	const buildYearly = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, tr("chart.yearly")));
		const endYear = Math.max((/* @__PURE__ */ new Date()).getFullYear(), ...yearlyTotals.map((t) => t.year));
		const bars = yearlyChart(yearlyTotals, endYear, filter, chartCurrency).map((b) => ({
			...b,
			label: fmt.yearLabel(b.year),
			name: fmt.yearName(b.year),
			key: "year",
			value: String(b.year)
		}));
		if (bars.every((b) => b.total === 0)) {
			section.appendChild(el("p", void 0, tr("chart.no_years")));
			return section;
		}
		section.appendChild(buildBars(bars, tr("chart.yearly"), chartCurrency));
		return section;
	};
	const draw = () => {
		fmt = makeFormat();
		const visible = filterByOwner(records, filter);
		const choices = usedCurrencies(records, yearlyTotals);
		const first = choices[0];
		if (first !== void 0 && !choices.includes(chartCurrency)) chartCurrency = first;
		shell(buildList(visible), buildTotals(visible), buildMonthly(visible, choices), buildYearly());
	};
	/** A month or day select (two-digit values, starting with an empty option). */
	const dateSelect = (name, ariaKey, selected) => {
		const isMonth = name === "payMonth";
		const select = el("select");
		select.name = name;
		select.setAttribute("aria-label", tr(ariaKey));
		const placeholder = tr(isMonth ? "field.month_placeholder" : "field.day_placeholder");
		select.appendChild(option("", placeholder, selected === ""));
		for (let n = 1; n <= (isMonth ? 12 : 31); n++) {
			const value = String(n).padStart(2, "0");
			const text = isMonth ? fmt.monthLong(n) : tr("field.day_option", { day: fmt.integer(n) });
			select.appendChild(option(value, text, value === selected));
		}
		return select;
	};
	const paymentRow = (payDate = "", perShare = "") => {
		const row = el("div", "dt-payment");
		const perShareInput = input("text", "perShare", perShare);
		perShareInput.inputMode = "decimal";
		const [month = "", day = ""] = payDate.split("-");
		const payday = el("div", "dt-payday");
		payday.append(dateSelect("payMonth", "field.pay_month", month), dateSelect("payDay", "field.pay_day", day));
		row.append(labeled(tr("field.pay_date"), payday), labeled(tr("field.per_share"), perShareInput), button(tr("dialog.remove_payment"), "remove-payment", "dt-button--secondary"));
		return row;
	};
	/** Enables or disables Remove and Add pay date for the number of rows. */
	const refreshPaymentButtons = (form) => {
		const rows = form.querySelectorAll(".dt-payment");
		for (const remove of form.querySelectorAll("[data-action=\"remove-payment\"]")) remove.disabled = rows.length <= 1;
		const add = form.querySelector("[data-action=\"add-payment\"]");
		if (add) add.disabled = rows.length >= 24;
	};
	const openDialog = (record) => {
		if (dialog) return;
		editing = record;
		fmt = makeFormat();
		const owner = el("select");
		owner.name = "ownerId";
		const selected = record?.ownerId ?? me.id;
		const choices = me.isAdmin ? [...members.keys()] : [me.id];
		if (!choices.includes(selected)) choices.unshift(selected);
		for (const id of choices) owner.appendChild(option(String(id), memberName(id), id === selected));
		const shares = input("number", "shares", record ? String(record.shares) : "");
		shares.min = "1";
		shares.step = "1";
		const payments = el("fieldset", "dt-payments");
		payments.appendChild(el("legend", void 0, tr("field.payments")));
		if (record) for (const p of record.payments) payments.appendChild(paymentRow(p.payDate, perShareInputText(p.perShareCents, record.currency)));
		else payments.appendChild(paymentRow());
		payments.appendChild(button(tr("dialog.add_payment"), "add-payment", "dt-button--secondary"));
		const submit = el("button", void 0, tr(record ? "dialog.submit_save" : "dialog.submit_add"));
		submit.type = "submit";
		const actions = el("div", "dt-actions");
		actions.append(button(tr("dialog.cancel"), "cancel", "dt-button--secondary"), submit);
		const form = el("form", "dt-form");
		const ownerField = labeled(tr("field.owner"), owner);
		ownerField.className = "dt-field--wide";
		const currencyField = labeled(tr("field.currency"), currencySelect(fmt, "currency", CURRENCIES, record?.currency ?? "JPY"));
		form.append(labeled(tr("field.ticker"), input("text", "ticker", record?.ticker ?? "")), labeled(tr("field.name"), input("text", "name", record?.name ?? "")), labeled(tr("field.shares"), shares), currencyField, ownerField, payments, el("p", "dt-error"), actions);
		refreshPaymentButtons(form);
		dialog = el("dialog", "dt-dialog");
		dialog.append(el("h2", void 0, tr(record ? "dialog.edit_title" : "dialog.add_title")), form);
		const opened = dialog;
		opened.addEventListener("close", () => {
			opened.remove();
			if (dialog === opened) {
				dialog = null;
				editing = null;
			}
		}, { signal });
		container.appendChild(opened);
		opened.showModal();
	};
	const readForm = (form) => {
		const data = new FormData(form);
		const text = (key) => String(data.get(key) ?? "");
		const months = data.getAll("payMonth").map(String);
		const days = data.getAll("payDay").map(String);
		const perShares = data.getAll("perShare").map(String);
		const dates = months.map((month, i) => {
			const day = days[i] ?? "";
			return month !== "" && day !== "" ? `${month}-${day}` : "";
		});
		return {
			ownerId: Number(text("ownerId")),
			currency: text("currency"),
			ticker: text("ticker"),
			name: text("name"),
			sharesText: text("shares"),
			payments: dates.map((payDate, i) => ({
				payDate,
				perShareText: perShares[i] ?? ""
			}))
		};
	};
	const showFailure = (message = tr("errors.load_failed")) => {
		const section = el("section", "page-section");
		const retry = button(tr("reload"), "reload");
		section.append(el("p", "dt-error", message), retry);
		shell(section);
	};
	const load = async () => {
		loaded = false;
		shell(el("p", void 0, tr("loading")));
		try {
			const [memberBody, res] = await Promise.all([api.get("/family/members", { signal }), fetch(ENDPOINT, {
				credentials: "same-origin",
				cache: "no-store",
				signal
			})]);
			if (signal.aborted) return;
			if (!res.ok) {
				const message = await errorMessage(res, "errors.load_failed");
				if (!signal.aborted) showFailure(message);
				return;
			}
			const body = await res.json();
			if (signal.aborted) return;
			members = parseMembers(memberBody);
			records = Array.isArray(body.data) ? body.data.filter(isValidRecord) : [];
			yearlyTotals = Array.isArray(body.yearlyTotals) ? body.yearlyTotals.filter(isValidYearlyTotal).sort((a, b) => a.year - b.year) : [];
			me = {
				id: typeof body.me?.id === "number" ? body.me.id : 0,
				isAdmin: body.me?.isAdmin === true,
				canWrite: body.me?.canWrite === true
			};
			csrfToken = typeof body.csrfToken === "string" ? body.csrfToken : "";
			if (filter !== null && !members.has(filter)) filter = null;
			loaded = true;
			draw();
		} catch {
			if (!signal.aborted) showFailure();
		}
	};
	const deleteRecord = async (deleteButton) => {
		const record = records.find((r) => r.id === deleteButton.dataset["id"]);
		if (!record || !canEdit(record)) return;
		const message = tr("list.confirm_delete", {
			label: recordLabel(record),
			owner: memberName(record.ownerId)
		});
		if (!window.confirm(message)) return;
		deleteButton.disabled = true;
		try {
			const res = await request("DELETE", `${ENDPOINT}/${encodeURIComponent(record.id)}`);
			if (signal.aborted) return;
			if (res.ok) {
				records = records.filter((r) => r.id !== record.id);
				listError = "";
			} else {
				listError = await errorMessage(res, "errors.delete_failed");
				if (signal.aborted) return;
			}
		} catch {
			if (signal.aborted) return;
			listError = tr("errors.delete_failed");
		}
		draw();
	};
	const registerYearlyTotal = async (registerButton) => {
		const year = parseYear(registerYear.trim());
		if (year === null) {
			totalsMessage = tr("errors.invalid_year", {
				min: MIN_YEAR,
				max: MAX_YEAR
			});
			draw();
			return;
		}
		const registered = yearlyTotals.find((t) => t.year === year);
		if (registered && !window.confirm(tr("totals.confirm_replace", {
			year: fmt.yearName(year),
			amount: formatTotals(fmt, registered.totals)
		}))) return;
		registerButton.disabled = true;
		try {
			const res = await request("PUT", `${YEARLY_ENDPOINT}/${year}`);
			if (signal.aborted) return;
			if (res.ok) {
				const body = await res.json();
				if (signal.aborted) return;
				const saved = body.data;
				if (isValidYearlyTotal(saved)) {
					yearlyTotals = [...yearlyTotals.filter((t) => t.year !== saved.year), saved].sort((a, b) => a.year - b.year);
					totalsMessage = tr("totals.registered", {
						year: fmt.yearName(year),
						amount: formatTotals(fmt, saved.totals)
					});
				} else totalsMessage = tr("errors.register_failed");
			} else {
				totalsMessage = await errorMessage(res, "errors.register_failed");
				if (signal.aborted) return;
			}
		} catch {
			if (signal.aborted) return;
			totalsMessage = tr("errors.register_failed");
		}
		draw();
	};
	const openEditor = (row) => {
		const id = row instanceof HTMLElement ? row.dataset["id"] : void 0;
		const record = records.find((r) => r.id === id);
		if (record && canEdit(record)) openDialog(record);
	};
	window.addEventListener("locale-changed", () => {
		if (loaded) draw();
	}, { signal });
	container.addEventListener("change", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLSelectElement)) return;
		if (target.name === "chartCurrency") {
			const choice = CURRENCIES.find((c) => c === target.value);
			if (choice) chartCurrency = choice;
			draw();
			return;
		}
		if (target.name !== "filter") return;
		filter = target.value === "" ? null : Number(target.value);
		listError = "";
		draw();
	}, { signal });
	container.addEventListener("input", (e) => {
		const target = e.target;
		if (target instanceof HTMLInputElement && target.name === "registerYear") registerYear = target.value;
	}, { signal });
	container.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.target;
		if (!(form instanceof HTMLFormElement) || !dialog?.contains(form)) return;
		const errorEl = form.querySelector(".dt-error");
		const showError = (message) => {
			if (errorEl) errorEl.textContent = message;
		};
		const payload = readForm(form);
		const error = validateInput(payload);
		if (error !== null) {
			showError(tr(`errors.${error.code}`, error.params));
			return;
		}
		const target = editing;
		const submit = form.querySelector("button[type=\"submit\"]");
		if (submit) submit.disabled = true;
		try {
			const res = target ? await request("PUT", `${ENDPOINT}/${encodeURIComponent(target.id)}`, payload) : await request("POST", ENDPOINT, payload);
			if (signal.aborted) return;
			if (!res.ok) {
				showError(await errorMessage(res, "errors.save_failed"));
				return;
			}
			const body = await res.json();
			if (signal.aborted) return;
			const saved = body.data;
			if (isValidRecord(saved)) records = target ? records.map((r) => r.id === saved.id ? saved : r) : [...records, saved];
			dialog?.close();
			listError = "";
			draw();
		} catch {
			if (!signal.aborted) showError(tr("errors.save_failed"));
		} finally {
			if (submit) submit.disabled = false;
		}
	}, { signal });
	container.addEventListener("click", async (e) => {
		if (!(e.target instanceof Element)) return;
		const actionEl = e.target.closest("[data-action]");
		const action = actionEl instanceof HTMLElement ? actionEl.dataset["action"] : void 0;
		const form = actionEl?.closest("form");
		if (action === "reload") await load();
		else if (action === "add") openDialog(null);
		else if (action === "cancel") dialog?.close();
		else if (action === "delete" && actionEl instanceof HTMLButtonElement) await deleteRecord(actionEl);
		else if (action === "register-year" && actionEl instanceof HTMLButtonElement) await registerYearlyTotal(actionEl);
		else if (action === "add-payment" && form) {
			if (form.querySelectorAll(".dt-payment").length < 24) actionEl?.before(paymentRow());
			refreshPaymentButtons(form);
		} else if (action === "remove-payment" && form) {
			if (form.querySelectorAll(".dt-payment").length > 1) actionEl?.closest(".dt-payment")?.remove();
			refreshPaymentButtons(form);
		} else if (action === void 0) {
			const row = e.target.closest("tr.dt-row--editable");
			if (row) openEditor(row);
		}
	}, { signal });
	const hideTooltip = () => {
		for (const tip of container.querySelectorAll(".dt-tooltip")) tip.hidden = true;
	};
	const showTooltip = (segment) => {
		const wrap = segment.closest(".dt-chart-wrap");
		const tip = wrap?.querySelector(".dt-tooltip");
		if (!(wrap instanceof HTMLElement) || !tip) return;
		const [name = "", amount = ""] = (segment.dataset["tooltip"] ?? "").split("\n");
		tip.replaceChildren(el("span", "dt-tooltip__name", name), el("span", "dt-tooltip__amount", amount));
		tip.hidden = false;
		const area = wrap.getBoundingClientRect();
		const rect = segment.getBoundingClientRect();
		const half = tip.offsetWidth / 2;
		const center = rect.left + rect.width / 2 - area.left;
		tip.style.left = `${Math.min(Math.max(center, half), Math.max(half, area.width - half))}px`;
		tip.style.top = `${rect.top - area.top}px`;
	};
	container.addEventListener("pointerover", (e) => {
		if (!(e.target instanceof Element)) return;
		const segment = e.target.closest(".dt-chart__segment");
		if (segment instanceof HTMLElement) showTooltip(segment);
	}, { signal });
	container.addEventListener("pointerout", (e) => {
		if (e.pointerType === "touch") return;
		if (e.target instanceof Element && e.target.closest(".dt-chart__segment")) hideTooltip();
	}, { signal });
	container.addEventListener("pointerdown", (e) => {
		if (e.target instanceof Element && !e.target.closest(".dt-chart__segment")) hideTooltip();
	}, { signal });
	container.addEventListener("keydown", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLTableRowElement)) return;
		if (!target.classList.contains("dt-row--editable")) return;
		if (e.key !== "Enter" && e.key !== " ") return;
		e.preventDefault();
		openEditor(target);
	}, { signal });
	await load();
}
export { render };
