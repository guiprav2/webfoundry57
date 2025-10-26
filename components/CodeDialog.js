import prettier from '../other/prettier.js';
import { mountCodeMirror } from '../other/codemirror.js';

let COLOR_MAP = {
  'red-600': '#dc2626',
  'red-800': '#991b1b',
  'orange-600': '#ea580c',
  'orange-800': '#9a3412',
  'amber-600': '#d97706',
  'amber-800': '#92400e',
  'yellow-600': '#ca8a04',
  'yellow-800': '#854d0e',
  'lime-600': '#65a30d',
  'lime-800': '#3f6212',
  'green-600': '#16a34a',
  'green-800': '#166534',
  'emerald-600': '#059669',
  'emerald-800': '#065f46',
  'teal-600': '#0d9488',
  'teal-800': '#115e59',
  'cyan-600': '#0891b2',
  'cyan-800': '#155e75',
  'sky-600': '#0284c7',
  'sky-800': '#075985',
  'blue-600': '#2563eb',
  'blue-800': '#1e40af',
  'indigo-600': '#4f46e5',
  'indigo-800': '#3730a3',
  'violet-600': '#7c3aed',
  'violet-800': '#5b21b6',
  'purple-600': '#9333ea',
  'purple-800': '#6b21a8',
  'fuchsia-600': '#c026d3',
  'fuchsia-800': '#86198f',
  'pink-600': '#db2777',
  'pink-800': '#9d174d',
  'rose-600': '#e11d48',
  'rose-800': '#9f1239',
};

let resolveColor = (name, alpha = 1) => {
  let hex = COLOR_MAP[name] || '#94a3b8';
  if (alpha >= 1) {
    return hex;
  }
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

class CodeDialog {
  constructor(props) {
    this.props = props;
  }

  handleSettingsOption = async ({ k }) => {
    if (k !== 'vim') {
      return;
    }
    await this.applyVim();
  };

  inferMode = () => {
    let mode = this.props?.mode;
    if (!mode && typeof this.props?.title === 'string') {
      let lowered = this.props.title.toLowerCase();
      if (lowered.includes('html')) mode = 'htmlmixed';
      else if (lowered.includes('css')) mode = 'css';
      else if (lowered.includes('json')) mode = 'json';
      else if (lowered.includes('markdown')) mode = 'markdown';
      else if (lowered.includes('javascript') || lowered.includes('js')) mode = 'javascript';
    }
    mode ??= 'htmlmixed';
    return mode;
  };

  updateVimButton = enabled => {
    if (!this.vimToggle) {
      return;
    }
    this.vimToggle.textContent = enabled ? 'Vim On' : 'Vim Off';
    this.vimToggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  };

  applyVim = async () => {
    let enabled = !!state.settings?.opt?.vim;
    if (this.editorMount) {
      await this.editorMount.setKeyMap(enabled ? 'vim' : 'default');
    }
    this.updateVimButton(enabled);
    if (this.statusEl) {
      this.statusEl.textContent = enabled
        ? 'Vim mode enabled globally.'
        : 'Vim mode disabled globally.';
      this.statusEl.classList.remove('hidden');
    }
  };

  onAttach = async () => {
    let wrapper = this.root.querySelector('.CodeDialog-editor');
    if (!wrapper) {
      return;
    }
    wrapper.innerHTML = '';
    this.vimToggle = this.root.querySelector('.CodeDialog-vimToggle');
    this.statusEl = this.root.querySelector('.CodeDialog-status');
    let initialValue = this.props.initialValue;
    if (initialValue == null) {
      initialValue = '';
    }
    initialValue = await prettier(String(initialValue), { parser: 'html' });
    let keyMap = state.settings?.opt?.vim ? 'vim' : 'default';
    let mode = this.inferMode();
    try {
      this.editorMount = await mountCodeMirror(wrapper, {
        value: initialValue,
        mode,
        theme: 'monokai',
        keyMap,
        lineNumbers: true,
        lineWrapping: true,
        autofocus: true,
      });
    } catch (err) {
      console.error(err);
      let fallback = d.el('textarea', {
        class: 'w-full min-h-72 rounded-md border border-slate-800/60 bg-slate-950/70 p-3 text-sm text-slate-100 font-mono',
      });
      fallback.value = initialValue;
      wrapper.append(fallback);
      this.fallbackTextarea = fallback;
    }
    if (this.editorMount?.editor) {
      this.attachSelectionHandlers();
      queueMicrotask(() => {
        this.editorMount?.editor?.refresh?.();
        this.handleCursorActivity();
      });
    }
    await this.applyVim();
    let bus = state.event?.bus;
    if (bus) {
      bus.on('settings:global:option:ready', this.handleSettingsOption);
    }
  };

  onDetach = () => {
    let bus = state.event?.bus;
    if (bus) {
      bus.off('settings:global:option:ready', this.handleSettingsOption);
    }
    this.detachSelectionHandlers();
    if (this.editorMount) {
      this.editorMount.destroy();
      this.editorMount = null;
    }
    this.fallbackTextarea = null;
    this.vimToggle = null;
    this.statusEl = null;
  };

  toggleVim = async () => {
    await post('settings.option', 'vim');
    await this.applyVim();
  };

  onSubmit = ev => {
    ev.preventDefault();
    let value = this.editorMount?.editor?.getValue?.();
    if (value == null && this.fallbackTextarea) {
      value = this.fallbackTextarea.value;
    }
    if (value == null) {
      value = this.props.initialValue ?? '';
    }
    this.root.parentElement.returnDetail = value;
    this.root.parentElement.close(ev.submitter.value);
  };

  clearLocalSelection = () => {
    if (!this.selfSelection) {
      return;
    }
    this.selfSelection.mark?.clear?.();
    this.selfSelection.caret?.clear?.();
    this.selfSelection = null;
  };

  renderLocalSelection = (anchor, head) => {
    let cm = this.editorMount?.editor;
    if (!cm) {
      return;
    }
    this.clearLocalSelection();
    let value = cm.getValue();
    if (typeof value !== 'string') {
      value = '';
    }
    let valueLength = value.length;
    let anchorIndex = Math.max(0, Math.min(anchor ?? 0, valueLength));
    let headIndex = Math.max(0, Math.min(head ?? anchorIndex, valueLength));
    let colorName = state.collab?.rtc?.color || 'sky-600';
    let from = cm.posFromIndex(Math.min(anchorIndex, headIndex));
    let to = cm.posFromIndex(Math.max(anchorIndex, headIndex));
    let caretPos = cm.posFromIndex(headIndex);
    let mark = null;
    if (anchorIndex !== headIndex) {
      mark = cm.markText(from, to, {
        css: `background: ${resolveColor(colorName, 0.25)}; border-radius: 2px;`,
      });
    }
    let caretEl = document.createElement('span');
    caretEl.className = 'CodeDialog-selfCaret animate-pulse';
    caretEl.style.display = 'block';
    caretEl.style.position = 'absolute';
    caretEl.style.left = '-1px';
    caretEl.style.top = '0';
    caretEl.style.height = `${cm.defaultTextHeight()}px`;
    caretEl.style.borderLeft = `2px solid ${resolveColor(colorName, 1)}`;
    caretEl.style.pointerEvents = 'none';
    caretEl.style.transform = 'translate(0, -0.75rem)';
    let container = document.createElement('span');
    container.style.position = 'relative';
    container.style.display = 'inline-block';
    container.style.width = '0';
    container.style.height = '0';
    container.append(caretEl);
    let caret = cm.setBookmark(caretPos, { widget: container, insertLeft: true, handleMouseEvents: false });
    this.selfSelection = { mark, caret };
  };

  handleCursorActivity = () => {
    let cm = this.editorMount?.editor;
    if (!cm) {
      return;
    }
    let selections = cm.listSelections();
    if (!selections?.length) {
      return;
    }
    let primary = selections[0];
    let anchorIndex = cm.indexFromPos(primary.anchor);
    let headIndex = cm.indexFromPos(primary.head);
    this.renderLocalSelection(anchorIndex, headIndex);
  };

  attachSelectionHandlers = () => {
    let cm = this.editorMount?.editor;
    if (!cm) {
      return;
    }
    this.detachSelectionHandlers();
    this.cursorHandler = () => this.handleCursorActivity();
    cm.on('cursorActivity', this.cursorHandler);
    this.handleCursorActivity();
  };

  detachSelectionHandlers = () => {
    let cm = this.editorMount?.editor;
    if (cm && this.cursorHandler) {
      cm.off('cursorActivity', this.cursorHandler);
    }
    this.cursorHandler = null;
    this.clearLocalSelection();
  };
}

export default CodeDialog;
