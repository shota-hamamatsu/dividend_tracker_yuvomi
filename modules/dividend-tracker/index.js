import { api } from "/api.js";
// src/logic.ts
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
function groupDigits(digits) {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function parseShares(text) {
	if (!/^[1-9]\d*$/.test(text)) return null;
	const value = Number(text);
	return value <= MAX_SHARES ? value : null;
}
function parsePerShare(text) {
	const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
	if (!match) return null;
	const cents = BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
	return cents <= BigInt(MAX_PER_SHARE_CENTS) ? Number(cents) : null;
}
/** 受取額（円）。1円未満は切り捨て。 */
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
/** 'MM-DD' がうるう年（2000 年）に実在する月日か。 */
function isValidPayDate(text) {
	return /^\d{2}-\d{2}$/.test(text) && isValidDate(`2000-${text}`);
}
function validateInput(input) {
	if (!isPositiveInt(input.ownerId)) return "保有者を選んでください";
	if (input.ticker.trim() === "") return "銘柄コードを入力してください";
	if (parseShares(input.sharesText) === null) return "保有株数は1以上の整数で入力してください";
	if (input.payments.length === 0) return "受取日を1つ以上入力してください";
	if (input.payments.length > 24) return `受取日は24件までです`;
	for (const payment of input.payments) {
		if (!isValidPayDate(payment.payDate)) return "受取日を正しく選んでください";
		if (parsePerShare(payment.perShareText) === null) return "1株当たり配当は0以上、小数第2位までで入力してください";
	}
	if (new Set(input.payments.map((p) => p.payDate)).size !== input.payments.length) return "同じ受取日が重複しています";
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
/** 記録の形を調べる。日付の形式（v0.4 は MM-DD、v0.3 は YYYY-MM-DD）だけ差し替えられる。 */
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
	return isRecordShape(value, isValidPayDate);
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
/** 記録の 1 年分の受取額の合計と、保有者ごとの内訳。 */
function annualTotals(records) {
	const byOwner = /* @__PURE__ */ new Map();
	for (const record of records) byOwner.set(record.ownerId, (byOwner.get(record.ownerId) ?? 0) + recordTotal(record));
	return toBreakdown(byOwner);
}
function isValidYear(value) {
	return typeof value === "number" && Number.isInteger(value) && value >= 2e3 && value <= 2100;
}
function isValidYearlyTotal(value) {
	if (typeof value !== "object" || value === null) return false;
	const t = value;
	const { owners } = t;
	if (!Array.isArray(owners)) return false;
	let sum = 0;
	let previous = 0;
	for (const item of owners) {
		if (typeof item !== "object" || item === null) return false;
		const { ownerId, total } = item;
		if (!isPositiveInt(ownerId) || !isPositiveInt(total) || ownerId <= previous) return false;
		previous = ownerId;
		sum += total;
	}
	return isValidYear(t["year"]) && t["total"] === sum && isPositiveInt(t["registeredBy"]) && typeof t["registeredAt"] === "string";
}
/** 'YYYY' を MIN_YEAR〜MAX_YEAR の整数にする。それ以外は null。 */
function parseYear(text) {
	if (!/^\d{4}$/.test(text)) return null;
	const year = Number(text);
	return isValidYear(year) ? year : null;
}
/** 1〜12 月それぞれの受取額の合計（記録の 1 年分）と、保有者ごとの内訳。 */
function monthlyTotals(records) {
	const byOwner = Array.from({ length: 12 }, () => /* @__PURE__ */ new Map());
	for (const record of records) for (const payment of record.payments) {
		const owners = byOwner[Number(payment.payDate.substring(0, 2)) - 1];
		if (!owners) continue;
		owners.set(record.ownerId, (owners.get(record.ownerId) ?? 0) + payment.amount);
	}
	return byOwner.map((owners, i) => ({
		month: i + 1,
		...toBreakdown(owners)
	}));
}
/**
* 年別グラフ用。endYear までの CHART_YEARS 年分を年の昇順で返す。登録の無い年は 0 円。
* ownerId が null でなければ、その保有者の分だけにする。
*/
function yearlyChart(totals, endYear, ownerId) {
	return Array.from({ length: 12 }, (_, i) => {
		const year = endYear - 12 + 1 + i;
		const owners = (totals.find((t) => t.year === year)?.owners ?? []).filter((o) => ownerId === null || o.ownerId === ownerId).map((o) => ({ ...o }));
		return {
			year,
			total: owners.reduce((sum, o) => sum + o.total, 0),
			owners
		};
	});
}
/** 一覧表示用。ticker → ownerId → id の昇順。 */
function sortForList(records) {
	return [...records].sort((a, b) => compareText(a.ticker, b.ticker) || a.ownerId - b.ownerId || compareText(a.id, b.id));
}
function formatYen(amount) {
	return groupDigits(String(amount)) + "円";
}
// src/index.ts
var ENDPOINT = "/api/extensions/dividend-tracker/records";
var YEARLY_ENDPOINT = "/api/extensions/dividend-tracker/yearly-totals";
var EMPTY_TEXT = "まだ記録がありません";
var UNKNOWN_USER = "（不明なユーザー）";
var OWNER_COLORS = 8;
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
/** 1/100 円単位の整数を入力欄用の文字列に戻す（3750 → '37.5'、5 → '0.05'、1200 → '12'）。 */
function perShareText(cents) {
	const yen = String(Math.trunc(cents / 100));
	const fraction = String(cents % 100).padStart(2, "0").replace(/0+$/, "");
	return fraction === "" ? yen : `${yen}.${fraction}`;
}
/** 受取日の一覧表示（'3/31、9/30'）。 */
function formatPayDates(payments) {
	return payments.map(({ payDate }) => {
		const [month, day] = payDate.split("-");
		return `${Number(month)}/${Number(day)}`;
	}).join("、");
}
/** 月・日の select（value は 2 桁、先頭は未選択の空の選択肢）。 */
function numberSelect(name, ariaLabel, placeholder, count, unit, selected) {
	const select = el("select");
	select.name = name;
	select.setAttribute("aria-label", ariaLabel);
	select.appendChild(option("", placeholder, selected === ""));
	for (let n = 1; n <= count; n++) {
		const value = String(n).padStart(2, "0");
		select.appendChild(option(value, `${n}${unit}`, value === selected));
	}
	return select;
}
/** 一覧・確認文で使う銘柄の表示（'7203 トヨタ自動車'、name が空なら ticker だけ）。 */
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
async function errorMessage(res, fallback) {
	try {
		const body = await res.json();
		return typeof body.error === "string" ? body.error : fallback;
	} catch {
		return fallback;
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
	let listError = "";
	let dialog = null;
	let editing = null;
	const memberName = (id) => members.get(id) ?? UNKNOWN_USER;
	/** 保有者の色の番号。家族一覧の取得順で 1〜OWNER_COLORS、それ以外は OWNER_COLORS + 1（other）。 */
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
		toolbar.appendChild(el("h1", "page-toolbar__title", "配当管理"));
		const body = el("div", "app-page__body");
		body.append(...sections);
		container.replaceChildren(toolbar, body);
	};
	const buildTotals = (visible) => {
		const section = el("section", "page-section");
		section.append(el("h2", void 0, "合計額"), el("p", "dt-total", formatYen(annualTotals(visible).total)));
		if (!me.canWrite) return section;
		const year = input("number", "registerYear", registerYear);
		year.min = String(MIN_YEAR);
		year.max = String(MAX_YEAR);
		year.step = "1";
		year.inputMode = "numeric";
		const register = el("div", "dt-register");
		register.append(labeled("登録する年", year), button("確定", "register-year"));
		section.appendChild(register);
		if (filter !== null) section.appendChild(el("p", "dt-note", "登録されるのは全員分の合計です"));
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
		select.appendChild(option("", "すべて", filter === null));
		for (const [id, name] of members) select.appendChild(option(String(id), name, filter === id));
		const filterField = labeled("保有者", select);
		filterField.className = "dt-filter";
		heading.append(el("h2", void 0, "銘柄一覧"), filterField);
		if (me.canWrite) heading.appendChild(button("追加", "add"));
		section.appendChild(heading);
		if (!me.canWrite) section.appendChild(el("p", void 0, "閲覧のみの権限です"));
		section.appendChild(el("p", "dt-error", listError));
		if (visible.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const table = el("table", "dt-list");
		const headRow = el("tr");
		if (me.canWrite) {
			const th = el("th", "dt-delete-cell");
			th.setAttribute("aria-label", "削除");
			headRow.appendChild(th);
		}
		for (const [text, className] of [
			["保有者", void 0],
			["銘柄", void 0],
			["保有株数", "dt-num"],
			["受取日", void 0],
			["合計", "dt-num"]
		]) headRow.appendChild(el("th", className, text));
		table.appendChild(el("thead")).appendChild(headRow);
		const tbody = el("tbody");
		for (const record of sortForList(visible)) {
			const row = el("tr");
			const label = recordLabel(record);
			if (me.canWrite) {
				const cell = el("td", "dt-delete-cell");
				if (canEdit(record)) {
					const remove = button("×", "delete", "dt-button--danger");
					remove.title = "削除";
					remove.dataset["id"] = record.id;
					remove.setAttribute("aria-label", `${label} を削除`);
					cell.appendChild(remove);
				}
				row.appendChild(cell);
			}
			row.append(el("td", "dt-owner", memberName(record.ownerId)), el("td", void 0, label), el("td", "dt-num", `${record.shares.toLocaleString("ja-JP")}株`), el("td", void 0, formatPayDates(record.payments)), el("td", "dt-num", formatYen(recordTotal(record))));
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
	/** 保有者ごとの色で積み上げた棒グラフ・ツールチップ・凡例（月別・年別で共通）。 */
	const buildBars = (bars, chartLabel) => {
		const max = Math.max(...bars.map((b) => b.total));
		const byColor = (a, b) => colorSlot(a.ownerId) - colorSlot(b.ownerId);
		const wrap = el("div", "dt-chart-wrap");
		const chart = el("ol", "dt-chart");
		chart.setAttribute("aria-label", chartLabel);
		const sumByOwner = /* @__PURE__ */ new Map();
		for (const { label, name, key, value, total, owners } of bars) {
			const sorted = [...owners].sort(byColor);
			const item = el("li", "dt-chart__month");
			const breakdown = sorted.map((o) => `${memberName(o.ownerId)} ${formatYen(o.total)}`).join("、");
			const text = `${name}: ${formatYen(total)}`;
			item.setAttribute("aria-label", breakdown === "" ? text : `${text}（${breakdown}）`);
			const track = el("div", "dt-chart__track");
			const bar = el("div", "dt-chart__bar");
			bar.style.height = `${max > 0 ? total / max * 100 : 0}%`;
			for (const o of sorted) {
				const segment = el("div", `dt-chart__segment ${colorClass(o.ownerId)}`);
				segment.style.flexGrow = String(o.total);
				segment.dataset["tooltip"] = `${memberName(o.ownerId)}\n${formatYen(o.total)}`;
				segment.dataset[key] = value;
				bar.appendChild(segment);
				sumByOwner.set(o.ownerId, (sumByOwner.get(o.ownerId) ?? 0) + o.total);
			}
			track.appendChild(bar);
			item.append(el("span", "dt-chart__value", total > 0 ? formatYen(total) : ""), track, el("span", "dt-chart__label", label));
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
			li.append(el("span", `dt-legend__swatch ${colorClass(ownerId)}`), document.createTextNode(`${memberName(ownerId)} ${formatYen(total)}`));
			legend.appendChild(li);
		}
		wrap.appendChild(legend);
		return wrap;
	};
	const buildMonthly = (visible) => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "月別配当額"));
		if (visible.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const bars = monthlyTotals(visible).map((m) => ({
			...m,
			label: `${m.month}月`,
			name: `${m.month}月`,
			key: "month",
			value: String(m.month)
		}));
		section.appendChild(buildBars(bars, "月別配当額"));
		return section;
	};
	const buildYearly = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "年別配当額"));
		const endYear = Math.max((/* @__PURE__ */ new Date()).getFullYear(), ...yearlyTotals.map((t) => t.year));
		const bars = yearlyChart(yearlyTotals, endYear, filter).map((b) => ({
			...b,
			label: String(b.year),
			name: `${b.year}年`,
			key: "year",
			value: String(b.year)
		}));
		if (bars.every((b) => b.total === 0)) {
			section.appendChild(el("p", void 0, "まだ登録された年がありません"));
			return section;
		}
		section.appendChild(buildBars(bars, "年別配当額"));
		return section;
	};
	const draw = () => {
		const visible = filterByOwner(records, filter);
		shell(buildList(visible), buildTotals(visible), buildMonthly(visible), buildYearly());
	};
	const paymentRow = (payDate = "", perShare = "") => {
		const row = el("div", "dt-payment");
		const perShareInput = input("text", "perShare", perShare);
		perShareInput.inputMode = "decimal";
		const [month = "", day = ""] = payDate.split("-");
		const payday = el("div", "dt-payday");
		payday.append(numberSelect("payMonth", "受取日の月", "月", 12, "月", month), numberSelect("payDay", "受取日の日", "日", 31, "日", day));
		row.append(labeled("受取日", payday), labeled("1株当たり配当（円）", perShareInput), button("削除", "remove-payment", "dt-button--secondary"));
		return row;
	};
	/** 行の数に合わせて「削除」「受取日を追加」の disabled を切り替える。 */
	const refreshPaymentButtons = (form) => {
		const rows = form.querySelectorAll(".dt-payment");
		for (const remove of form.querySelectorAll("[data-action=\"remove-payment\"]")) remove.disabled = rows.length <= 1;
		const add = form.querySelector("[data-action=\"add-payment\"]");
		if (add) add.disabled = rows.length >= 24;
	};
	const openDialog = (record) => {
		if (dialog) return;
		editing = record;
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
		payments.appendChild(el("legend", void 0, "受取日と1株当たり配当"));
		if (record) for (const p of record.payments) payments.appendChild(paymentRow(p.payDate, perShareText(p.perShareCents)));
		else payments.appendChild(paymentRow());
		payments.appendChild(button("受取日を追加", "add-payment", "dt-button--secondary"));
		const submit = el("button", void 0, record ? "保存" : "追加");
		submit.type = "submit";
		const actions = el("div", "dt-actions");
		actions.append(button("キャンセル", "cancel", "dt-button--secondary"), submit);
		const form = el("form", "dt-form");
		const ownerField = labeled("保有者", owner);
		ownerField.className = "dt-field--wide";
		const sharesField = labeled("保有株数", shares);
		sharesField.className = "dt-field--shares";
		form.append(labeled("銘柄コード", input("text", "ticker", record?.ticker ?? "")), labeled("銘柄名", input("text", "name", record?.name ?? "")), sharesField, ownerField, payments, el("p", "dt-error"), actions);
		refreshPaymentButtons(form);
		dialog = el("dialog", "dt-dialog");
		dialog.append(el("h2", void 0, record ? "配当を編集" : "配当を追加"), form);
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
			ticker: text("ticker"),
			name: text("name"),
			sharesText: text("shares"),
			payments: dates.map((payDate, i) => ({
				payDate,
				perShareText: perShares[i] ?? ""
			}))
		};
	};
	const showFailure = (message = "データを読み込めませんでした") => {
		const section = el("section", "page-section");
		const retry = button("再読み込み", "reload");
		section.append(el("p", "dt-error", message), retry);
		shell(section);
	};
	const load = async () => {
		shell(el("p", void 0, "読み込み中…"));
		try {
			const [memberBody, res] = await Promise.all([api.get("/family/members", { signal }), fetch(ENDPOINT, {
				credentials: "same-origin",
				cache: "no-store",
				signal
			})]);
			if (signal.aborted) return;
			if (!res.ok) {
				const message = await errorMessage(res, "データを読み込めませんでした");
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
			draw();
		} catch {
			if (!signal.aborted) showFailure();
		}
	};
	const deleteRecord = async (deleteButton) => {
		const record = records.find((r) => r.id === deleteButton.dataset["id"]);
		if (!record || !canEdit(record)) return;
		const message = `「${recordLabel(record)}」（${memberName(record.ownerId)}）を削除しますか？この操作は取り消せません。`;
		if (!window.confirm(message)) return;
		deleteButton.disabled = true;
		try {
			const res = await request("DELETE", `${ENDPOINT}/${encodeURIComponent(record.id)}`);
			if (signal.aborted) return;
			if (res.ok) {
				records = records.filter((r) => r.id !== record.id);
				listError = "";
			} else {
				listError = await errorMessage(res, "削除できませんでした");
				if (signal.aborted) return;
			}
		} catch {
			if (signal.aborted) return;
			listError = "削除できませんでした";
		}
		draw();
	};
	const registerYearlyTotal = async (registerButton) => {
		const year = parseYear(registerYear.trim());
		if (year === null) {
			totalsMessage = `年は${MIN_YEAR}〜${MAX_YEAR}で指定してください`;
			draw();
			return;
		}
		const registered = yearlyTotals.find((t) => t.year === year);
		if (registered && !window.confirm(`${year}年の配当合計は登録済みです（${formatYen(registered.total)}）。現在の合計額で置き換えますか？`)) return;
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
					totalsMessage = `${year}年の配当合計を登録しました（${formatYen(saved.total)}）`;
				} else totalsMessage = "登録できませんでした";
			} else {
				totalsMessage = await errorMessage(res, "登録できませんでした");
				if (signal.aborted) return;
			}
		} catch {
			if (signal.aborted) return;
			totalsMessage = "登録できませんでした";
		}
		draw();
	};
	const openEditor = (row) => {
		const id = row instanceof HTMLElement ? row.dataset["id"] : void 0;
		const record = records.find((r) => r.id === id);
		if (record && canEdit(record)) openDialog(record);
	};
	container.addEventListener("change", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLSelectElement)) return;
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
			showError(error);
			return;
		}
		const target = editing;
		const submit = form.querySelector("button[type=\"submit\"]");
		if (submit) submit.disabled = true;
		try {
			const res = target ? await request("PUT", `${ENDPOINT}/${encodeURIComponent(target.id)}`, payload) : await request("POST", ENDPOINT, payload);
			if (signal.aborted) return;
			if (!res.ok) {
				showError(await errorMessage(res, "保存できませんでした"));
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
			if (!signal.aborted) showError("保存できませんでした");
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
