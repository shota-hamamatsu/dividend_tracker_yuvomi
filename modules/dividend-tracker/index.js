// src/logic.ts
function isValidRecord(value) {
	if (typeof value !== "object" || value === null) return false;
	const obj = value;
	for (const key of [
		"id",
		"ticker",
		"name",
		"payDate"
	]) if (typeof obj[key] !== "string") return false;
	const amount = obj["amount"];
	if (typeof amount !== "number" || !Number.isInteger(amount) || amount < 0) return false;
	if (obj["ticker"].length === 0) return false;
	return /^\d{4}-\d{2}-\d{2}$/.test(obj["payDate"]);
}
function parseRecords(json) {
	if (json === null) return [];
	try {
		const parsed = JSON.parse(json);
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(isValidRecord);
	} catch {
		return [];
	}
}
function validateInput(input) {
	if (input.ticker.trim().length === 0) return "銘柄コードを入力してください";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(input.payDate)) return "受取日を入力してください";
	if (!/^\d+$/.test(input.amountText)) return "受取額は0以上の整数で入力してください";
	return null;
}
function yearlyTotals(records) {
	const totals = /* @__PURE__ */ new Map();
	for (const record of records) {
		const year = record.payDate.substring(0, 4);
		const currentTotal = totals.get(year) || 0;
		totals.set(year, currentTotal + record.amount);
	}
	const result = Array.from(totals.entries()).map(([year, total]) => ({
		year,
		total
	}));
	result.sort((a, b) => a.year < b.year ? 1 : a.year > b.year ? -1 : 0);
	return result;
}
function sortByPayDateDesc(records) {
	return [...records].sort((a, b) => a.payDate < b.payDate ? 1 : a.payDate > b.payDate ? -1 : 0);
}
function formatYen(amount) {
	return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "円";
}
function newId() {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
	return `${Date.now()}-${Math.floor(Math.random() * 1e6).toString(16)}`;
}
// src/index.ts
var STORAGE_KEY = "dividend-tracker:v1";
var EMPTY_TEXT = "まだ記録がありません";
function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== void 0) node.textContent = text;
	return node;
}
function load() {
	try {
		return parseRecords(localStorage.getItem(STORAGE_KEY));
	} catch {
		return [];
	}
}
function save(records) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
		return true;
	} catch {
		return false;
	}
}
function labeled(text, input) {
	const label = el("label", void 0, text);
	label.appendChild(input);
	return label;
}
function input(type, name) {
	const node = el("input");
	node.type = type;
	node.name = name;
	return node;
}
async function render(container, context) {
	const { signal } = context;
	let records = load();
	let errorEl = el("p", "dt-error");
	const buildTotals = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "年別合計"));
		const totals = yearlyTotals(records);
		if (totals.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const ul = el("ul");
		for (const { year, total } of totals) ul.appendChild(el("li", void 0, `${year}年: ${formatYen(total)}`));
		section.appendChild(ul);
		return section;
	};
	const buildForm = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "配当を追加"));
		const form = el("form", "dt-form");
		const amount = input("number", "amount");
		amount.min = "0";
		amount.step = "1";
		form.append(labeled("銘柄コード", input("text", "ticker")), labeled("銘柄名", input("text", "name")), labeled("受取日", input("date", "payDate")), labeled("受取額（円）", amount));
		const submit = el("button", void 0, "追加");
		submit.type = "submit";
		form.appendChild(submit);
		errorEl = el("p", "dt-error");
		section.append(form, errorEl);
		return section;
	};
	const buildList = () => {
		const section = el("section", "page-section");
		section.appendChild(el("h2", void 0, "受取履歴"));
		if (records.length === 0) {
			section.appendChild(el("p", void 0, EMPTY_TEXT));
			return section;
		}
		const table = el("table", "dt-table");
		const headRow = el("tr");
		for (const [text, numeric] of [
			["受取日", false],
			["銘柄", false],
			["銘柄名", false],
			["受取額", true],
			["操作", false]
		]) headRow.appendChild(el("th", numeric ? "dt-num" : void 0, text));
		const thead = el("thead");
		thead.appendChild(headRow);
		const tbody = el("tbody");
		for (const rec of sortByPayDateDesc(records)) {
			const row = el("tr");
			row.append(el("td", void 0, rec.payDate), el("td", void 0, rec.ticker), el("td", void 0, rec.name), el("td", "dt-num", formatYen(rec.amount)));
			const del = el("button", void 0, "削除");
			del.type = "button";
			del.dataset["action"] = "delete";
			del.dataset["id"] = rec.id;
			const cell = el("td");
			cell.appendChild(del);
			row.appendChild(cell);
			tbody.appendChild(row);
		}
		table.append(thead, tbody);
		section.appendChild(table);
		return section;
	};
	const draw = (message = "") => {
		const toolbar = el("div", "page-toolbar");
		toolbar.appendChild(el("h1", "page-toolbar__title", "配当管理"));
		const body = el("div", "app-page__body");
		body.append(buildTotals(), buildForm(), buildList());
		container.replaceChildren(toolbar, body);
		errorEl.textContent = message;
	};
	const commit = (next) => {
		records = next;
		draw(save(records) ? "" : "保存できませんでした");
	};
	container.addEventListener("submit", (e) => {
		e.preventDefault();
		const form = e.target;
		if (!(form instanceof HTMLFormElement)) return;
		const data = new FormData(form);
		const text = (key) => String(data.get(key) ?? "");
		const ticker = text("ticker").trim();
		const payDate = text("payDate");
		const amountText = text("amount");
		const error = validateInput({
			ticker,
			payDate,
			amountText
		});
		if (error !== null) {
			errorEl.textContent = error;
			return;
		}
		commit([...records, {
			id: newId(),
			ticker,
			name: text("name").trim(),
			payDate,
			amount: Number(amountText)
		}]);
	}, { signal });
	container.addEventListener("click", (e) => {
		if (!(e.target instanceof Element)) return;
		const button = e.target.closest("[data-action=\"delete\"]");
		if (!button) return;
		const id = button.dataset["id"];
		commit(records.filter((r) => r.id !== id));
	}, { signal });
	draw();
}
export { render };
