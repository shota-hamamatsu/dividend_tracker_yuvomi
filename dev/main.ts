import { render } from '../src/index.ts';
import { installMockFetch, SCENARIOS, type Scenario } from './mock-records.ts';

const bar = document.getElementById('dev-bar');
const app = document.getElementById('app');
if (!bar || !app) throw new Error('dev/index.html の要素が見つかりません');

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

const param = new URLSearchParams(location.search).get('scenario');
const initial: Scenario = isScenario(param) ? param : 'admin';

const scenarioSelect = select(
    'シナリオ',
    SCENARIOS.map((name) => [name, name]),
    initial,
);
scenarioSelect.addEventListener('change', () => {
    const next = scenarioSelect.value;
    if (!isScenario(next)) return;
    history.replaceState(null, '', `?scenario=${next}`);
    show(next);
});

const themeSelect = select(
    'テーマ',
    [
        ['light', 'ライト'],
        ['dark', 'ダーク'],
    ],
    'light',
);
themeSelect.addEventListener('change', () => {
    document.documentElement.dataset['theme'] = themeSelect.value;
});

bar.append(scenarioSelect, themeSelect);
show(initial);
