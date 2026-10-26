// Denizen settings page (R5). Builds the page from the host's `state` message and sends back
// `{ kind: 'set', key, value }`. It never colours code itself: every span arrives typed by the
// real tokenizer, and this file only maps types to CSS variables.
//
// Edit contract: while a colour is being dragged or typed, only the CSS variables change; the
// setting is written once, when the edit is committed (picker closed, HEX field left, B / I /
// switch clicked). Each `state` replaces every value -- an edit made in settings.json or synced
// from elsewhere wins over what the page had -- except in the field that has focus.
//
// The CSP allows no inline <style>: colours go through element.style (CSSOM) only.

(function () {
    'use strict';
    const vscode = acquireVsCodeApi();
    const saved = vscode.getState() || {};
    const root = document.documentElement;
    const app = document.getElementById('app');

    let state = null;
    /** Local copy of the colours, edited live; replaced by every state. */
    let colors = {};
    let built = false;
    const ui = { cards: {}, options: {}, map: [] };

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function set(key, value) {
        vscode.postMessage({ kind: 'set', key, value });
    }

    function normalizeHex(input) {
        const m = /^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.exec(input.trim());
        if (!m) return null;
        const d = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
        return '#' + d.toUpperCase();
    }

    /** Same rule as settingsModel.formatPaletteValue. */
    function formatPaletteValue(v) {
        const head = v.color !== null ? v.color : v.text;
        return [head].concat(v.bold ? ['weight=bold'] : [], v.italic ? ['style=italic'] : [], v.rest).join('|');
    }

    /**
     * The value each card last wrote, until the state echoing it arrives. A state from before that
     * write (the echo of an earlier click) would otherwise reset the card mid-edit, and the next
     * B / I would be built on the stale value. Expires so an echo that never comes cannot pin it.
     */
    const pending = {};
    const PENDING_MS = 3000;

    function paint(type) {
        const v = colors[type];
        // An unreadable colour is ignored by the editor, which falls back to the theme: not shown here either.
        root.style.setProperty('--c-' + type, v.color || 'var(--code-fg)');
        root.style.setProperty('--w-' + type, v.bold ? '700' : '400');
        root.style.setProperty('--s-' + type, v.italic ? 'italic' : 'normal');
    }

    /**
     * One line of typed spans. `mark` (a card's own type) gets the underlay, one block per run:
     * whitespace between two marked spans joins them, since spaces are a token type of their own.
     */
    function spansInto(parent, spans, mark) {
        parent.textContent = '';
        const marked = spans.map(s => mark !== null && s.type === mark && s.text.trim() !== '');
        spans.forEach((s, i) => {
            if (!marked[i] && mark !== null && s.text.trim() === '') {
                const before = marked.slice(0, i).lastIndexOf(true);
                const after = marked.indexOf(true, i + 1);
                marked[i] = before >= 0 && after >= 0 && spans.slice(before + 1, after).every(x => x.text.trim() === '');
            }
        });
        let block = null;
        spans.forEach((s, i) => {
            const e = el('span', null, s.text);
            if (s.type) e.dataset.k = s.type;
            if (s.inline) {
                e.classList.add('inl');
                e.style.color = s.inline.split('|')[0];
            }
            if (marked[i]) {
                if (block === null) {
                    block = el('span', 'hl');
                    parent.appendChild(block);
                }
                block.appendChild(e);
            }
            else {
                block = null;
                parent.appendChild(e);
            }
        });
    }

    // ---------- building (once) ----------

    const SECTIONS = [
        { id: 'colors', icon: '🎨', title: 'Syntax colors' },
        { id: 'sources', icon: '📦', title: 'Meta sources' },
        { id: 'hints', icon: '💡', title: 'Suggestions' },
        { id: 'checks', icon: '✓', title: 'Checks' },
        { id: 'text', icon: 'Aa', title: 'Text colors' },
    ];

    function build() {
        const wrap = el('div', 'wrap');
        const nav = el('nav');
        const main = el('main');
        const current = SECTIONS.some(s => s.id === saved.section) ? saved.section : 'colors';
        for (const s of SECTIONS) {
            const a = el('a');
            a.dataset.s = s.id;
            a.tabIndex = 0;
            a.append(el('span', 'ic', s.icon), document.createTextNode(s.title));
            a.addEventListener('click', () => showSection(s.id));
            a.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showSection(s.id); } });
            nav.appendChild(a);
        }
        const note = el('div', 'note');
        note.append('Values live in your user settings — ', el('code', null, 'settings.json'), ' and Settings Sync keep working.');
        nav.appendChild(note);

        main.append(buildColors(), buildSources(), buildOptions('hints', 'Suggestions'), buildOptions('checks', 'Checks'), buildText());
        wrap.append(nav, main);
        app.appendChild(wrap);
        showSection(current);
    }

    function showSection(id) {
        document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.dataset.s === id));
        document.querySelectorAll('main > section').forEach(s => s.classList.toggle('on', s.id === id));
        vscode.setState(Object.assign({}, vscode.getState(), { section: id }));
    }

    function buildColors() {
        const sec = el('section');
        sec.id = 'colors';
        const seg = el('div', 'seg');
        seg.id = 'mode';
        const palette = el('button', null, 'Denizen palette');
        const theme = el('button', null, 'VS Code theme colors');
        palette.addEventListener('click', () => { if (!state.paletteOn) set('denizenscript.behaviors.use_custom_syntax_colors', true); });
        theme.addEventListener('click', () => { if (state.paletteOn) set('denizenscript.behaviors.use_custom_syntax_colors', false); });
        seg.append(palette, theme);
        ui.mode = { palette, theme };

        const cols = el('div', 'cols');
        const rows = el('div');
        rows.id = 'rows';
        let section = null;
        for (const card of state.cardInfo) {
            if (card.section !== section) {
                section = card.section;
                rows.appendChild(el('h2', null, section));
            }
            // As in the mockup: a comment card's sample says what it is.
            if (card.section !== 'Comments') rows.appendChild(el('div', 'lbl', card.label));
            rows.appendChild(buildColorCard(card));
        }

        const preview = el('div', 'preview');
        const ph = el('div', 'ph');
        ui.modeLabel = el('span');
        ph.append(el('span', null, 'test_script.dsc'), ui.modeLabel);
        ui.code = el('pre');
        ui.code.id = 'code';
        preview.append(ph, ui.code);
        cols.append(rows, preview);
        sec.append(seg, cols);
        return sec;
    }

    function buildColorCard(card) {
        const type = card.type;
        const wrap = el('div', 'cardwrap');
        const c = el('div', 'card');
        c.dataset.id = type;
        const sample = el('div', 'sample');
        const ctl = el('div', 'ctl');
        const hex = el('input', 'inp hex');
        hex.maxLength = 7;
        hex.spellcheck = false;
        hex.title = 'HEX: #RRGGBB, RRGGBB or #RGB';
        const dot = el('label', 'dot');
        dot.title = 'Color';
        const picker = el('input');
        picker.type = 'color';
        dot.appendChild(picker);
        const b = el('button', 'tg', 'B');
        b.title = 'Bold';
        const i = el('button', 'tg i', 'I');
        i.title = 'Italic';
        ctl.append(hex, dot, b, i);
        c.append(sample, ctl);
        const ovr = el('div', 'ovr', 'Overridden in this workspace — this edits your user value');
        wrap.append(c, ovr);

        const commit = () => {
            const value = formatPaletteValue(colors[type]);
            clearTimeout(pending[type] && pending[type].timer);
            pending[type] = { value, timer: setTimeout(() => { delete pending[type]; if (state) update(); }, PENDING_MS) };
            set('denizenscript.theme_colors.' + type, value);
        };
        const preview = color => {
            colors[type].color = color;
            paint(type);
            dot.style.background = color;
        };
        picker.addEventListener('input', () => {
            const color = picker.value.toUpperCase();
            preview(color);
            hex.value = color;
            hex.classList.remove('bad');
        });
        // Commit what the control holds, not the model, which a state may have reset meanwhile.
        picker.addEventListener('change', () => { preview(picker.value.toUpperCase()); commit(); });
        hex.addEventListener('input', () => {
            const color = normalizeHex(hex.value);
            hex.classList.toggle('bad', color === null);
            if (color !== null) {
                preview(color);
                picker.value = color.toLowerCase();
            }
        });
        const leaveHex = () => {
            const color = normalizeHex(hex.value);
            hex.classList.remove('bad');
            if (color !== null && color !== state.colors[type].color) {
                preview(color);
                commit();
            }
            else {
                // Invalid or unchanged: back to the last valid value.
                colors[type].color = state.colors[type].color;
                paint(type);
                syncCard(type);
                hex.value = colors[type].color || colors[type].text;
            }
        };
        hex.addEventListener('blur', leaveHex);
        hex.addEventListener('keydown', e => {
            if (e.key === 'Enter') hex.blur();
            if (e.key === 'Escape') { hex.value = ''; hex.blur(); }
        });
        b.addEventListener('click', () => { colors[type].bold = !colors[type].bold; paint(type); syncCard(type); commit(); });
        i.addEventListener('click', () => { colors[type].italic = !colors[type].italic; paint(type); syncCard(type); commit(); });

        c.addEventListener('mouseenter', () => flash(type));
        c.addEventListener('mouseleave', unflash);
        ui.cards[type] = { sample, hex, picker, dot, b, i, ovr };
        return wrap;
    }

    function flash(type) {
        const hits = ui.code.querySelectorAll('[data-k="' + type + '"]');
        hits.forEach(e => { if (e.textContent.trim() !== '') e.classList.add('flash'); });
        // A height-capped preview (narrow window) scrolls to the first place this card colours.
        const pre = ui.code;
        const first = Array.prototype.find.call(hits, e => e.textContent.trim() !== '');
        if (first && pre.scrollHeight > pre.clientHeight) {
            const top = first.offsetTop - pre.offsetTop;
            if (top < pre.scrollTop || top > pre.scrollTop + pre.clientHeight - 24) {
                pre.scrollTo({ top: top - pre.clientHeight / 3, behavior: 'smooth' });
            }
        }
    }

    function unflash() {
        ui.code.querySelectorAll('.flash').forEach(e => e.classList.remove('flash'));
    }

    function buildOptionCard(card) {
        const opt = el('div', 'opt');
        const tx = el('div', 'tx', card.label);
        if (card.detail) tx.appendChild(el('div', 'd', card.detail));
        const ovr = el('div', 'ovr', 'Overridden in this workspace — this edits your user value');
        tx.appendChild(ovr);
        const key = card.key.startsWith('refinedDenizenscript.') ? card.key : 'denizenscript.' + card.key;
        let control;
        if (card.kind === 'bool') {
            control = el('button', 'sw');
            control.title = card.label;
            control.setAttribute('role', 'switch');
            control.addEventListener('click', () => set(key, !state.options[card.key].value));
        }
        else {
            control = el('input', 'inp');
            control.spellcheck = false;
            control.addEventListener('change', () => set(key, control.value));
            control.addEventListener('keydown', e => { if (e.key === 'Enter') control.blur(); });
        }
        opt.append(tx, control);
        ui.options[card.key] = { control, ovr, kind: card.kind };
        return opt;
    }

    function buildOptions(id, section) {
        const sec = el('section');
        sec.id = id;
        sec.appendChild(el('h2', null, section));
        for (const card of state.optionInfo) {
            if (card.section === section) sec.appendChild(buildOptionCard(card));
        }
        return sec;
    }

    // ---------- meta sources (R6) ----------
    //
    // The page sends the whole edited list (`sources`) or a pasted link (`addSource`); the host
    // re-reads both through metaSources.ts before writing. Lists are re-rendered on every state;
    // the Add field is built once, so typing in it survives a state.

    function sourceCard(name, url, badge) {
        const opt = el('div', 'opt src');
        const tx = el('div', 'tx', name);
        if (badge) tx.appendChild(el('span', 'badge', badge));
        tx.appendChild(el('div', 'u', url.replace(/^https:\/\//, '')));
        opt.appendChild(tx);
        return opt;
    }

    function sourceSwitch(on, onClick) {
        const sw = el('button', 'sw' + (on ? ' on' : ''));
        sw.setAttribute('role', 'switch');
        sw.setAttribute('aria-checked', String(on));
        if (onClick) sw.addEventListener('click', onClick);
        else { sw.classList.add('locked'); sw.disabled = true; }
        return sw;
    }

    /**
     * The list the page last posted, until a state shows it stored. Clicks build on it, not on the
     * last state: a second switch clicked before the first one's write came back would otherwise
     * post a list without the first (final review, R6). Expires, so a write that never lands
     * cannot hide the stored list for good.
     */
    let pendingSources = null;

    function sourcesKey(s) {
        return JSON.stringify([s.addons.filter(a => a.enabled).map(a => a.id), s.custom, s.replaceDefaults]);
    }

    function shownSources() {
        return pendingSources ? pendingSources.value : state.sources;
    }

    /** A copy of the shown sources with one change applied: shown at once, posted as the new list. */
    function postSources(change) {
        const next = JSON.parse(JSON.stringify(shownSources()));
        change(next);
        if (pendingSources) clearTimeout(pendingSources.timer);
        pendingSources = { value: next, timer: setTimeout(() => { pendingSources = null; if (state) renderSources(); }, 3000) };
        renderSources();
        vscode.postMessage({ kind: 'sources', value: next });
    }

    function buildSources() {
        const sec = el('section');
        sec.id = 'sources';
        sec.appendChild(el('h2', null, 'Official'));
        ui.official = el('div');
        sec.appendChild(ui.official);
        sec.appendChild(el('h2', null, 'Add-ons'));
        ui.addons = el('div');
        sec.appendChild(ui.addons);
        sec.appendChild(el('h2', null, 'Custom'));
        ui.custom = el('div');
        sec.appendChild(ui.custom);

        const add = el('div', 'add');
        const input = el('input', 'inp');
        input.placeholder = 'Direct .zip link or GitHub repository';
        input.spellcheck = false;
        const button = el('button', 'btn sec', 'Add');
        const submit = () => {
            if (input.value.trim() === '') return;
            vscode.postMessage({ kind: 'addSource', input: input.value });
        };
        button.addEventListener('click', submit);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        input.addEventListener('input', () => input.classList.remove('bad'));
        add.append(input, button);
        ui.addInput = input;
        sec.appendChild(add);

        const replace = el('div', 'opt');
        const tx = el('div', 'tx');
        tx.append('Use custom sources ', el('b', null, 'instead of'), ' official ones');
        tx.appendChild(el('div', 'd', 'For a Denizen fork that removes things from upstream'));
        ui.replace = sourceSwitch(false, () => postSources(s => { s.replaceDefaults = !s.replaceDefaults; }));
        replace.append(tx, ui.replace);
        sec.appendChild(replace);
        ui.sourcesOvr = el('div', 'ovr', 'Overridden in this workspace — this edits your user value');
        sec.appendChild(ui.sourcesOvr);

        ui.status = el('div', 'status');
        sec.appendChild(ui.status);
        const reinstallRow = el('div', 'reinstall');
        ui.reinstall = el('button', 'btn', '⟳ Reinstall instances');
        ui.reinstall.addEventListener('click', () => {
            ui.reinstalling = true;
            renderReinstall();
            vscode.postMessage({ kind: 'reinstall' });
        });
        reinstallRow.append(ui.reinstall, el('span', 'status', 'Clear the cache, re-download enabled sources, restart the server'));
        sec.appendChild(reinstallRow);
        return sec;
    }

    function renderReinstall() {
        // Busy from the click until the host says the reinstall ended -- its own load reported, or
        // the command gave up waiting -- so a load that never reports cannot leave it stuck.
        const busy = ui.reinstalling === true;
        ui.reinstall.disabled = busy;
        ui.reinstall.textContent = busy ? 'Reinstalling…' : '⟳ Reinstall instances';
    }

    function renderSources() {
        if (pendingSources && sourcesKey(state.sources) === sourcesKey(pendingSources.value)) {
            clearTimeout(pendingSources.timer);
            pendingSources = null;
        }
        const s = shownSources();
        const anyEnabled = s.addons.some(a => a.enabled) || s.custom.some(c => c.enabled);
        const replaced = s.replaceDefaults && anyEnabled;

        ui.official.textContent = '';
        for (const o of s.official) {
            const card = sourceCard(o.name, o.url, replaced ? 'replaced' : 'always');
            card.appendChild(sourceSwitch(!replaced, null));
            ui.official.appendChild(card);
        }
        ui.addons.textContent = '';
        s.addons.forEach((a, i) => {
            const card = sourceCard(a.name, a.url, a.author);
            card.appendChild(sourceSwitch(a.enabled, () => postSources(n => { n.addons[i].enabled = !n.addons[i].enabled; })));
            ui.addons.appendChild(card);
        });
        ui.custom.textContent = '';
        s.custom.forEach((c, i) => {
            const card = sourceCard(c.name, c.url, null);
            const remove = el('button', 'x', '✕');
            remove.title = 'Remove';
            remove.addEventListener('click', () => postSources(n => { n.custom.splice(i, 1); }));
            card.append(remove, sourceSwitch(c.enabled, () => postSources(n => { n.custom[i].enabled = !n.custom[i].enabled; })));
            ui.custom.appendChild(card);
        });
        if (s.custom.length === 0) ui.custom.appendChild(el('div', 'empty', 'No sources of your own yet.'));

        ui.replace.classList.toggle('on', s.replaceDefaults);
        ui.replace.setAttribute('aria-checked', String(s.replaceDefaults));
        ui.sourcesOvr.style.display = state.sourcesOverridden ? '' : 'none';
        ui.status.textContent = state.metaStatusLine;
        renderReinstall();
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || !ui.addInput) return;
        if (message.kind === 'addResult') {
            if (message.ok) ui.addInput.value = '';
            else ui.addInput.classList.add('bad');
        }
        else if (message.kind === 'reinstallDone') {
            ui.reinstalling = false;
            renderReinstall();
        }
    });

    function buildText() {
        const sec = el('section');
        sec.id = 'text';
        sec.appendChild(el('h2', null, 'Text colors'));
        const texts = [];
        for (const card of state.optionInfo) {
            if (card.section !== 'Text colors') continue;
            if (card.kind === 'bool') sec.appendChild(buildOptionCard(card));
            else texts.push(card);
        }
        sec.appendChild(el('h2', null, 'Custom colors from config.yml'));
        ui.mapRows = el('div');
        ui.mapOvr = el('div', 'ovr', 'Overridden in this workspace — this edits your user value');
        sec.append(ui.mapRows, ui.mapOvr);
        if (texts.length) {
            sec.appendChild(el('h2', null, 'Comments'));
            texts.forEach(card => sec.appendChild(buildOptionCard(card)));
        }
        return sec;
    }

    function renderColorMap() {
        // Rebuilt only when the entries change, so an open picker is not torn down by its own write.
        const names = state.colorMap.map(e => e.name).join(',');
        if (ui.mapNames !== names) {
            ui.mapNames = names;
            ui.mapRows.textContent = '';
            ui.map = state.colorMap.map((entry, index) => {
                const c = el('div', 'card');
                const sample = el('div', 'sample');
                const tag = el('span', 'inl', '<&[' + entry.name + ']>');
                sample.append(tag, ' ' + entry.name);
                const ctl = el('div', 'ctl');
                const dot = el('label', 'dot');
                dot.title = 'Color';
                const picker = el('input');
                picker.type = 'color';
                dot.appendChild(picker);
                ctl.appendChild(dot);
                c.append(sample, ctl);
                picker.addEventListener('input', () => { tag.style.color = picker.value; dot.style.background = picker.value; });
                picker.addEventListener('change', () => {
                    const entries = state.colorMap.map((e, i) => i === index ? { name: e.name, color: picker.value.toUpperCase() } : e);
                    set('denizenscript.theme_colors.text_color_map', entries.map(e => e.name + '=' + e.color).join(','));
                });
                ui.mapRows.appendChild(c);
                return { tag, dot, picker };
            });
        }
        state.colorMap.forEach((entry, i) => {
            const row = ui.map[i];
            row.tag.style.color = entry.color;
            row.dot.style.background = entry.color;
            const hex = normalizeHex(entry.color);
            if (hex && document.activeElement !== row.picker) row.picker.value = hex.toLowerCase();
        });
        ui.mapOvr.style.display = state.colorMapOverridden ? '' : 'none';
    }

    // ---------- updating (every state) ----------

    function syncCard(type) {
        const v = colors[type];
        const card = ui.cards[type];
        const shown = v.color || '#000000';
        if (document.activeElement !== card.hex) {
            card.hex.value = v.color || v.text;
            // Not a colour the editor can use: shown as an error until replaced.
            card.hex.classList.toggle('bad', v.color === null);
        }
        if (document.activeElement !== card.picker) {
            card.picker.value = shown.slice(0, 7).toLowerCase();
        }
        card.dot.style.background = v.color || 'transparent';
        card.b.classList.toggle('on', v.bold);
        card.i.classList.toggle('on', v.italic);
    }

    function update() {
        const previous = colors;
        colors = {};
        for (const type in state.colors) {
            const v = state.colors[type];
            if (pending[type] && formatPaletteValue(v) === pending[type].value) {
                clearTimeout(pending[type].timer);
                delete pending[type];
            }
            if (pending[type] && previous[type]) {
                colors[type] = previous[type];
            }
            else {
                colors[type] = { color: v.color, text: v.text, bold: v.bold, italic: v.italic, rest: v.rest.slice() };
                // A HEX edit in progress stays in the preview.
                const typed = document.activeElement === ui.cards[type].hex ? normalizeHex(ui.cards[type].hex.value) : null;
                if (typed !== null) colors[type].color = typed;
            }
            paint(type);
            syncCard(type);
            ui.cards[type].ovr.style.display = v.overridden ? '' : 'none';
            spansInto(ui.cards[type].sample, state.cards[type], type);
        }

        document.body.classList.toggle('theme', !state.paletteOn);
        ui.mode.palette.classList.toggle('on', state.paletteOn);
        ui.mode.theme.classList.toggle('on', !state.paletteOn);
        ui.modeLabel.textContent = state.paletteOn ? 'Denizen palette' : 'Colours come from your VS Code theme';

        const scroll = ui.code.scrollTop;
        ui.code.textContent = '';
        const critical = new Set(state.criticalLines);
        state.preview.forEach((spans, i) => {
            const ln = el('span', critical.has(i) ? 'ln blk' : 'ln');
            spansInto(ln, spans, null);
            ui.code.appendChild(ln);
        });
        ui.code.scrollTop = scroll;

        for (const key in ui.options) {
            const o = ui.options[key];
            const v = state.options[key];
            if (o.kind === 'bool') {
                o.control.classList.toggle('on', v.value === true);
                o.control.setAttribute('aria-checked', String(v.value === true));
            }
            else if (document.activeElement !== o.control) {
                o.control.value = v.value === undefined ? '' : String(v.value);
            }
            o.ovr.style.display = v.overridden ? '' : 'none';
        }
        renderColorMap();
        renderSources();
    }

    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || message.kind !== 'state') return;
        state = message;
        if (!built) {
            build();
            built = true;
        }
        update();
    });
    vscode.postMessage({ kind: 'ready' });
}());
