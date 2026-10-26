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
        const head = v.color !== null && normalizeHex(v.text) !== v.color ? v.color : v.text;
        return [head].concat(v.bold ? ['weight=bold'] : [], v.italic ? ['style=italic'] : [], v.rest).join('|');
    }

    function paint(type) {
        const v = colors[type];
        root.style.setProperty('--c-' + type, v.color || v.text || 'inherit');
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

        main.append(buildColors(), buildOptions('hints', 'Suggestions'), buildOptions('checks', 'Checks'), buildText());
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

        const commit = () => set('denizenscript.theme_colors.' + type, formatPaletteValue(colors[type]));
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
        picker.addEventListener('change', commit);
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
                commit();
            }
            else {
                // Invalid or unchanged: back to the last valid value.
                colors[type].color = state.colors[type].color;
                paint(type);
                syncCard(type);
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
            card.hex.classList.remove('bad');
        }
        card.picker.value = shown.toLowerCase();
        card.dot.style.background = v.color || v.text;
        card.b.classList.toggle('on', v.bold);
        card.i.classList.toggle('on', v.italic);
    }

    function update() {
        colors = {};
        for (const type in state.colors) {
            const v = state.colors[type];
            colors[type] = { color: v.color, text: v.text, bold: v.bold, italic: v.italic, rest: v.rest.slice() };
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
