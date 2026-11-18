import { api } from "/api.js";
// src/logic.ts
var MAX_SHARES = 1e7;
var MAX_PER_SHARE_CENTS = 1e7;
function isPositiveInt(value) {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
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
function validateInput(input) {
	if (!isPositiveInt(input.ownerId)) return "保有者を選んでください";
	if (input.ticker.trim() === "") return "銘柄コードを入力してください";
	if (!isValidDate(input.payDate)) return "受取日を入力してください";
	if (parseShares(input.sharesText) === null) return "保有株数は1以上の整数で入力してください";
	if (parsePerShare(input.perShareText) === null) return "1株当たり配当は0以上、小数第2位までで入力してください";
	return null;
}
function isValidRecord(value) {
	if (typeof value !== "object" || value === null) return false;
	const r = value;
	const { shares, perShareCents } = r;
	return typeof r["id"] === "string" && isPositiveInt(r["ownerId"]) && typeof r["ticker"] === "string" && r["ticker"] !== "" && typeof r["name"] === "string" && typeof r["payDate"] === "string" && isValidDate(r["payDate"]) && isPositiveInt(shares) && shares <= MAX_SHARES && typeof perShareCents === "number" && Number.isInteger(perShareCents) && perShareCents >= 0 && perShareCents <= MAX_PER_SHARE_CENTS && r["amount"] === calcAmount(shares, perShareCents) && isPositiveInt(r["createdBy"]) && typeof r["createdAt"] === "string";
}
function filterByOwner(records, ownerId) {
	return ownerId === null ? [...records] : records.filter((r) => r.ownerId === ownerId);
}
function yearlyTotals(records) {
	const totals = /* @__PURE__ */ new Map();
	for (const record of records) {
		const year = record.payDate.substring(0, 4);
		totals.set(year, (totals.get(year) ?? 0) + record.amount);
	}
	return Array.from(totals, ([year, total]) => ({
		year,
		total
	})).sort((a, b) => a.year < b.year ? 1 : a.year > b.year ? -1 : 0);
}
function sortByPayDateDesc(records) {
	return [...records].sort((a, b) => a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0);
}
function formatYen(amount) {
	return groupDigits(String(amount)) + "円";
}
function formatPerShare(cents) {
	const yen = groupDigits(String(Math.trunc(cents / 100)));
	const fraction = String(cents % 100).padStart(2, "0").replace(/0+$/, "");
	return fraction === "" ? `${yen}円` : `${yen}.${fraction}円`;
}
// src/index.ts
var ENDPOINT = "/api/extensions/dividend-tracker/records";
var EMPTY_TEXT = "まだ記録がありません";
var UNKNOWN_USER = "（不明なユーザー）";
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
function input(type, name) {
	const node = el("input");
	node.type = type;
	node.name = name;
	return node;
}
function option(value, text, selected = false) {
	const node = el("option", void 0, text);
	node.value = value;
	node.selected = selected;
	return node;
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
	let members = /* @__PURE__ */ new Map();
	let me = {
		id: 0,
		isAdmin: false,
		canWrite: false
	};
	let csrfToken = "";
	let filter = null;
	let errorEl = el("p", "dt-error");
	let submitEl = null;
	const memberName = (id) => members.get(id) ?? UNKNOWN_USER;
	const canDelete = (r) => me.canWrite && (me.isAdmin || r.ownerId === me.id);
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
		section.appendChild(el("h2", void 0, "年間配当合計"));
		const select = el("select");
		select.name = "filter";
		select.appendChild(option("", "すべて", filter === null));
		for (const [id, name] of members) select.appendChild(option(String(id), name, filter === id));
		section.appendChild(labeled("保有者", select));
		const totals = yearlyTotals(visible);
		if (totals.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const ul = el("ul", "dt-totals");
		for (const { year, total } of totals) ul.appendChild(el("li", void 0, `${year}年: ${formatYen(total)}`));
		section.appendChild(ul);
		return section;
	};
	const buildList = (visible) => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "受取履歴"));
		if (visible.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const headRow = el("tr");
		for (const [text, numeric] of [
			["受取日", false],
			["保有者", false],
			["銘柄", false],
			["銘柄名", false],
			["保有株数", true],
			["1株配当", true],
			["受取額", true],
			["操作", false]
		]) headRow.appendChild(el("th", numeric ? "dt-num" : void 0, text));
		const thead = el("thead");
		thead.appendChild(headRow);
		const tbody = el("tbody");
		for (const rec of sortByPayDateDesc(visible)) {
			const row = el("tr");
			row.append(el("td", void 0, rec.payDate), el("td", void 0, memberName(rec.ownerId)), el("td", void 0, rec.ticker), el("td", void 0, rec.name), el("td", "dt-num", formatYen(rec.shares).replace(/円$/, "株")), el("td", "dt-num", formatPerShare(rec.perShareCents)), el("td", "dt-num", formatYen(rec.amount)));
			const cell = el("td");
			if (canDelete(rec)) {
				const del = el("button", void 0, "削除");
				del.type = "button";
				del.dataset["action"] = "delete";
				del.dataset["id"] = rec.id;
				cell.appendChild(del);
			}
			row.appendChild(cell);
			tbody.appendChild(row);
		}
		const table = el("table", "dt-table");
		table.append(thead, tbody);
		section.appendChild(table);
		return section;
	};
	const buildForm = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "配当を追加"));
		errorEl = el("p", "dt-error");
		submitEl = null;
		if (!me.canWrite) {
			section.appendChild(el("p", void 0, "閲覧のみの権限です"));
			return section;
		}
		const owner = el("select");
		owner.name = "ownerId";
		const choices = me.isAdmin ? [...members.keys()] : [me.id];
		if (!choices.includes(me.id)) choices.unshift(me.id);
		for (const id of choices) owner.appendChild(option(String(id), memberName(id), id === me.id));
		const shares = input("number", "shares");
		shares.min = "1";
		shares.step = "1";
		const perShare = input("text", "perShare");
		perShare.inputMode = "decimal";
		const form = el("form", "dt-form");
		form.append(labeled("保有者", owner), labeled("銘柄コード", input("text", "ticker")), labeled("銘柄名", input("text", "name")), labeled("受取日", input("date", "payDate")), labeled("保有株数", shares), labeled("1株当たり配当（円）", perShare));
		submitEl = el("button", void 0, "追加");
		submitEl.type = "submit";
		form.appendChild(submitEl);
		section.append(form, errorEl);
		return section;
	};
	const draw = (message = "") => {
		const visible = filterByOwner(records, filter);
		shell(buildTotals(visible), buildList(visible), buildForm());
		errorEl.textContent = message;
	};
	const showFailure = (message = "データを読み込めませんでした") => {
		const section = el("section", "page-section");
		const retry = el("button", void 0, "再読み込み");
		retry.type = "button";
		retry.dataset["action"] = "reload";
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
	container.addEventListener("change", (e) => {
		const target = e.target;
		if (!(target instanceof HTMLSelectElement) || target.name !== "filter") return;
		filter = target.value === "" ? null : Number(target.value);
		draw();
	}, { signal });
	container.addEventListener("submit", async (e) => {
		e.preventDefault();
		const form = e.target;
		if (!(form instanceof HTMLFormElement)) return;
		const data = new FormData(form);
		const text = (key) => String(data.get(key) ?? "");
		const payload = {
			ownerId: Number(text("ownerId")),
			ticker: text("ticker"),
			name: text("name"),
			payDate: text("payDate"),
			sharesText: text("shares"),
			perShareText: text("perShare")
		};
		const error = validateInput(payload);
		if (error !== null) {
			errorEl.textContent = error;
			return;
		}
		const button = submitEl;
		if (button) button.disabled = true;
		try {
			const res = await request("POST", ENDPOINT, payload);
			if (signal.aborted) return;
			if (!res.ok) {
				errorEl.textContent = await errorMessage(res, "保存できませんでした");
				return;
			}
			const body = await res.json();
			if (signal.aborted) return;
			if (isValidRecord(body.data)) records = [...records, body.data];
			draw();
		} catch {
			if (!signal.aborted) errorEl.textContent = "保存できませんでした";
		} finally {
			if (button) button.disabled = false;
		}
	}, { signal });
	container.addEventListener("click", async (e) => {
		if (!(e.target instanceof Element)) return;
		if (e.target.closest("[data-action=\"reload\"]")) {
			await load();
			return;
		}
		const id = e.target.closest("[data-action=\"delete\"]")?.dataset["id"];
		if (!id || !confirm("この記録を削除しますか？")) return;
		try {
			const res = await request("DELETE", `${ENDPOINT}/${encodeURIComponent(id)}`);
			if (signal.aborted) return;
			if (!res.ok) {
				errorEl.textContent = await errorMessage(res, "削除できませんでした");
				return;
			}
			records = records.filter((r) => r.id !== id);
			draw();
		} catch {
			if (!signal.aborted) errorEl.textContent = "削除できませんでした";
		}
	}, { signal });
	await load();
}
export { render };
