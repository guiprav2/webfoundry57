import prettier from '../other/prettier.js';
import { mountCodeMirror } from '../other/codemirror.js';

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
      queueMicrotask(() => this.editorMount?.editor?.refresh?.());
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
    this.root.returnDetail = value;
    this.root.close(ev.submitter.value);
  };
}

export default CodeDialog;
