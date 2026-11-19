import { render } from '../src/index.ts';
import { LOCALES, setLocale } from './mock-i18n.ts';
import { installMockFetch, SCENARIOS, type Scenario } from './mock-records.ts';

const bar = document.getElementById('dev-bar');
const app = document.getElementById('app');
if (!bar || !app) throw new Error('Elements in dev/index.html are missing');

const isScenario = (value: string | null): value is Scenario =>
    SCENARIOS.some((name) => name === value);

function select(label: string, options: [string, string][], current: string): HTMLSelectElement {
    const node = document.createElement('select');
    for (const [value, text] of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        option.selected = value === current;
        node.appendChild(option);
    }
    node.setAttribute('aria-label', label);
    return node;
}

let controller: AbortController | null = null;

function show(scenario: Scenario): void {
    controller?.abort();
    controller = new AbortController();
    installMockFetch(scenario);
    void render(app as HTMLElement, { signal: controller.signal });
}

const params = new URLSearchParams(location.search);
const param = params.get('scenario');
const initial: Scenario = isScenario(param) ? param : 'admin';
const langParam = params.get('lang') ?? '';
const initialLang = LOCALES.includes(langParam) ? langParam : 'ja';

/** Keeps scenario and lang in the URL. */
function saveParams(scenario: string, lang: string): void {
    history.replaceState(null, '', `?scenario=${scenario}&lang=${lang}`);
}

const scenarioSelect = select(
    'Scenario',
    SCENARIOS.map((name) => [name, name]),
    initial,
);
scenarioSelect.addEventListener('change', () => {
    const next = scenarioSelect.value;
    if (!isScenario(next)) return;
    saveParams(next, langSelect.value);
    show(next);
});

const themeSelect = select(
    'Theme',
    [
        ['light', 'Light'],
        ['dark', 'Dark'],
    ],
    'light',
);
themeSelect.addEventListener('change', () => {
    document.documentElement.dataset['theme'] = themeSelect.value;
});

const langSelect = select(
    'Language',
    LOCALES.map((code) => [code, code]),
    initialLang,
);
langSelect.addEventListener('change', () => {
    saveParams(scenarioSelect.value, langSelect.value);
    setLocale(langSelect.value);
});
setLocale(initialLang);

bar.append(scenarioSelect, themeSelect, langSelect);
show(initial);
